/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document } from '../document/document.entity';
import { EvaluationResult, EvaluationStatus } from './evaluation.entity';
import { ConfigService } from '@nestjs/config';
import { PDFParse } from 'pdf-parse';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  Metadata,
  MetadataMode,
  NodeWithScore,
  Settings,
  storageContextFromDefaults,
  TextNode,
  VectorStoreIndex,
} from 'llamaindex';
import { HuggingFaceEmbedding } from '@llamaindex/huggingface';

interface EvaluationJobData {
  cvId: number;
  reportId: number;
  jobTitle: string;
}

@Processor('evaluation-queue')
export class EvaluationProcessor extends WorkerHost {
  private logger = new Logger(EvaluationProcessor.name);
  private index: VectorStoreIndex | undefined;

  constructor(
    @InjectRepository(EvaluationResult)
    private resultRepository: Repository<EvaluationResult>,

    @InjectRepository(Document)
    private documentRepository: Repository<Document>,

    private configService: ConfigService,
    private httpService: HttpService,
  ) {
    super();

    Settings.embedModel = new HuggingFaceEmbedding({
      modelType: 'BAAI/bge-small-en-v1.5',
    });
    this.logger.log(
      '✨ Embedding model set to HuggingFace (BAAI/bge-small-en-v1.5)',
    );
  }

  async onModuleInit() {
    this.logger.log('EvaluationProcessor Module Initialized. Loading index...');
    await this.initializeIndex();
  }

  private async initializeIndex() {
    try {
      this.logger.log('Attempting to load index from storage...');
      const storageContext = await storageContextFromDefaults({
        persistDir: './storage',
      });

      this.index = await VectorStoreIndex.init({
        storageContext,
      });
      this.logger.log('✅ Successfully loaded index from storage.');
    } catch (error) {
      this.logger.error(
        "🔴 Failed to initialize index from storage. Did you run 'ingest-data.ts'?",
        error,
      );
      this.index = undefined;
    }
  }

  async process(job: Job<EvaluationJobData>): Promise<void> {
    if (!this.index) {
      this.logger.error(
        `Index not loaded for job ${job.id}. Cannot perform RAG.`,
      );
      const evalRecord = this.resultRepository.create({
        jobId: String(job.id),
        status: EvaluationStatus.failed,
        result: { error: 'RAG Index failed to load.' },
      });
      await this.resultRepository.save(evalRecord);
      return;
    }

    this.logger.log(`Starting evaluation for job ${job.id}.`);

    const evalRecord = this.resultRepository.create({
      jobId: String(job.id),
      status: EvaluationStatus.processing,
    });
    await this.resultRepository.save(evalRecord);

    try {
      const { cvId, reportId, jobTitle } = job.data;
      const [cvDocument, reportDocument] = await Promise.all([
        this.documentRepository.findOneByOrFail({
          id: cvId,
        }),
        this.documentRepository.findOneByOrFail({
          id: reportId,
        }),
      ]);

      const [cvText, reportText] = await Promise.all([
        this.getTextFromPdf(cvDocument.path),
        this.getTextFromPdf(reportDocument.path),
      ]);
      const retriever = this.index.asRetriever({ similarityTopK: 3 });

      const cvContextNodes = await retriever.retrieve(
        `Context for evaluating CV for the role: ${jobTitle}. Include Job Description requirements and CV Scoring Rubric.`,
      );
      const cvContext = this.formatContext(cvContextNodes);
      this.logger.log('🔍 CV Context Retrieved via LlamaIndex.');

      const reportContextNodes = await retriever.retrieve(
        `Context for evaluating Project Report based on Case Study Brief and Project Scoring Rubric.`,
      );
      const reportContext = this.formatContext(reportContextNodes);
      this.logger.log('🔍 Report Context Retrieved via LlamaIndex.');

      const apiKey = this.configService.get<string>('OPENROUTER_KEY');
      const apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
      const model = 'mistralai/mistral-7b-instruct:free';

      this.logger.log('📞 Calling OpenRouter for CV Evaluation...');
      const cvPrompt = this.createPrompt(
        'CV',
        cvText,
        cvContext,
        jobTitle,
        '{ "cv_match_rate": number(0.0-1.0), "cv_feedback": string(2-3 sentences) }',
      );
      const cvResponseData = await this.callOpenRouter(
        apiUrl,
        apiKey,
        model,
        cvPrompt,
      );
      const cvResult = JSON.parse(cvResponseData);
      this.logger.log('✅ CV Evaluation Received.');

      this.logger.log('📞 Calling OpenRouter for Project Report Evaluation...');
      const reportPrompt = this.createPrompt(
        'Project Report',
        reportText,
        reportContext,
        jobTitle,
        '{ "project_score": number(1.0-5.0), "project_feedback": string(2-3 sentences) }',
      );
      const reportResponseData = await this.callOpenRouter(
        apiUrl,
        apiKey,
        model,
        reportPrompt,
      );
      const reportResult = JSON.parse(reportResponseData);
      this.logger.log('✅ Project Report Evaluation Received.');

      this.logger.log('📞 Calling OpenRouter for Final Summary...');
      const summaryPrompt = `
        Based on the previous evaluations:
        CV Evaluation: ${JSON.stringify(cvResult)}
        Project Report Evaluation: ${JSON.stringify(reportResult)}

        Please provide a concise overall summary (2-3 sentences) about the candidate's suitability for the "${jobTitle}" role.
        Respond ONLY with a valid JSON object containing a single key "overall_summary". Example: { "overall_summary": "..." }
      `;
      const summaryResponseData = await this.callOpenRouter(
        apiUrl,
        apiKey,
        model,
        summaryPrompt,
      );
      const summaryResult = JSON.parse(summaryResponseData);
      this.logger.log('✅ Final Summary Received.');

      const finalResult = {
        ...cvResult,
        ...reportResult,
        ...summaryResult,
      };

      evalRecord.status = EvaluationStatus.completed;
      evalRecord.result = finalResult;
      await this.resultRepository.save(evalRecord);
      this.logger.log(
        `✅ Job ${job.id} completed successfully with RAG + OpenRouter.`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'An unknown error occurred';
      this.logger.error(
        `Job ${job.id} failed: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      evalRecord.status = EvaluationStatus.failed;
      evalRecord.result = { error: errorMessage };
      await this.resultRepository.save(evalRecord);
    }
  }

  private async getTextFromPdf(filePath: string): Promise<string> {
    try {
      const parser = new PDFParse({ url: filePath });
      const result = (await parser.getText()) as { text: string } | undefined;
      return result?.text ?? '';
    } catch (error) {
      this.logger.error(`Failed to read or parse PDF at ${filePath}`, error);
      throw new Error(`Could not process PDF file: ${filePath}`);
    }
  }

  private formatContext(nodes: NodeWithScore<Metadata>[]): string {
    if (!nodes || nodes.length === 0) {
      return 'No relevant context found.';
    }
    return nodes
      .map(
        (nodeWithScore, index) =>
          `--- Context Snippet ${index + 1} (Score: ${nodeWithScore.score?.toFixed(2) ?? 'N/A'}) ---\n${(nodeWithScore.node as unknown as TextNode).getContent(MetadataMode.NONE)}`,
      )
      .join('\n\n');
  }

  private createPrompt(
    docType: string,
    docText: string,
    context: string,
    jobTitle: string,
    jsonFormatExample: string,
  ): string {
    return `
      You are an expert HR analyst tasked with evaluating a candidate's ${docType} for the position of "${jobTitle}".
      Carefully review the following CONTEXT retrieved from internal documents (like Job Description, Scoring Rubrics, Case Study Brief):
      CONTEXT:
      ${context}

      Now, analyze the candidate's actual ${docType} provided below:
      CANDIDATE DOCUMENT TEXT:
      ${docText.substring(0, 4000)}

      Based *strictly* on comparing the CANDIDATE DOCUMENT TEXT against the provided CONTEXT, provide your evaluation.
      Your response MUST be ONLY a single, valid JSON object matching this exact format: ${jsonFormatExample}
      Do not include any text before or after the JSON object.
    `;
  }

  private async callOpenRouter(
    apiUrl: string,
    apiKey: string | undefined,
    model: string,
    prompt: string,
  ) {
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    const body = {
      model: model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post(apiUrl, body, { headers, timeout: 60000 }),
      );

      if (!response?.data?.choices?.[0]?.message?.content) {
        throw new Error(
          'Invalid response structure received from OpenRouter API.',
        );
      }
      return response.data.choices[0].message.content;
    } catch (error) {
      let detailedErrorMessage = `Failed to call OpenRouter model ${model}`;
      if (error.response) {
        detailedErrorMessage = `OpenRouter API Error (${error.response.status}): ${JSON.stringify(error.response.data)}`;
      } else if (error.code === 'ECONNABORTED') {
        detailedErrorMessage = `OpenRouter API call timed out after 60 seconds.`;
      } else if (error.request) {
        detailedErrorMessage = 'OpenRouter API Error: No response received.';
      } else {
        detailedErrorMessage = error.message;
      }
      this.logger.error(
        `Error during callOpenRouter: ${detailedErrorMessage}`,
        error.stack,
      );
      throw new Error(detailedErrorMessage);
    }
  }
}
