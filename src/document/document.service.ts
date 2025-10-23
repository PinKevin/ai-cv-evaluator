import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Document } from './document.entity';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EvaluateDto } from './dto/evaluate.dto';
import { EvaluationStatus } from 'src/evaluation/evaluation.entity';

type UploadedFiles = {
  cv?: Express.Multer.File[];
  report?: Express.Multer.File[];
};

@Injectable()
export class DocumentService {
  constructor(
    @InjectRepository(Document)
    private documentRepository: Repository<Document>,

    @InjectQueue('evaluation-queue')
    private evaluationQueue: Queue,
  ) {}

  async uploadAndSaveDocument(files: UploadedFiles) {
    const cvFile = files.cv?.[0];
    const reportFile = files.report?.[0];

    if (!cvFile || !reportFile) {
      throw new BadRequestException(
        'CV and Project Report files are required.',
      );
    }

    this.validateFile(cvFile);
    this.validateFile(reportFile);

    const [savedCv, savedReport] = await Promise.all([
      this.saveFileMetadata(cvFile),
      this.saveFileMetadata(reportFile),
    ]);

    return {
      message: 'Files successfully uploaded.',
      cv: { id: savedCv.id },
      report: { id: savedReport.id },
    };
  }

  async startEvaluation(evaluateDto: EvaluateDto) {
    const job = await this.evaluationQueue.add(
      'evaluate-task',
      {
        ...evaluateDto,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    );

    return {
      id: job.id,
      status: EvaluationStatus.queued,
    };
  }

  private validateFile(file: Express.Multer.File) {
    const MAX_FILE_SIZE_MB = 5;
    const ALLOWED_MIME_TYPES = ['application/pdf'];

    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      throw new BadRequestException(
        `File "${file.originalname}" is too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`,
      );
    }

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `File type of "${file.originalname}" is invalid. Only PDF files are allowed.`,
      );
    }
  }

  private async saveFileMetadata(file: Express.Multer.File): Promise<Document> {
    const newDocument = this.documentRepository.create({
      originalName: file.originalname,
      fileName: file.filename,
      path: file.path,
    });
    return await this.documentRepository.save(newDocument);
  }
}
