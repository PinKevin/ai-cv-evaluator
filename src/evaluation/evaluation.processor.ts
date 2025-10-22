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

interface EvaluationJobData {
  cvId: number;
  reportId: number;
  jobTitle: string;
}

@Processor('evaluation-queue')
export class EvaluationProcessor extends WorkerHost {
  private logger = new Logger(EvaluationProcessor.name);

  constructor(
    @InjectRepository(EvaluationResult)
    private resultRepository: Repository<EvaluationResult>,

    @InjectRepository(Document)
    private documentRepository: Repository<Document>,

    private configService: ConfigService,
    private httpService: HttpService,
  ) {
    super();
  }

  async process(job: Job<EvaluationJobData>): Promise<void> {
    this.logger.log(`Starting evaluation for job ${job.id}...`);

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

      const prompt = `
        You are an expert HR analyst. Your task is to evaluate a candidate's CV and his report for a "${jobTitle}" position.
        Analyze the provided CV and report text and provide a structured evaluation.
        
        CV TEXT:
        ---
        ${cvText.substring(0, 4000)}
        ---

        REPORT TEXT:
        ---
        ${reportText.substring(0, 4000)}
        ---
        
        Please provide your response ONLY in a valid JSON format. The JSON object must have two keys:
        1. "cv_match_rate": A number between 0.0 and 1.0 representing how well the CV matches the job title.
        2. "cv_feedback": A concise string (2-3 sentences) explaining the reasons for the match rate, highlighting strengths and weaknesses.
        3. "project_score": A number between 1.0 and 5.0 representing how well the project done.
        4. "project_feedback": A concise string (2-3 sentences) explaining the reasons for the project score, highlighting correctness and suitability.
        5. "overall_summary": A concise string (2-3 sentences) explaining overall summary of candidate based on their CV and report.
      `;

      const apiKey = this.configService.get<string>('OPENROUTER_KEY');
      const apiUrl = 'https://openrouter.ai/api/v1/chat/completions';

      const headers = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      };

      const body = {
        model: 'mistralai/mistral-7b-instruct:free',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      };

      const response = await firstValueFrom(
        this.httpService.post(apiUrl, body, { headers }),
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const messageContent = response.data.choices[0].message.content;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const result = JSON.parse(messageContent);

      evalRecord.status = EvaluationStatus.completed;
      evalRecord.result = result;
      await this.resultRepository.save(evalRecord);

      this.logger.log(`Job ${job.id} has completed successfully.`);
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
}
