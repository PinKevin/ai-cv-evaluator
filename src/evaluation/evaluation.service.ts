import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EvaluationResult, EvaluationStatus } from './evaluation.entity';
import { Repository } from 'typeorm';

@Injectable()
export class EvaluationService {
  constructor(
    @InjectRepository(EvaluationResult)
    private resultRepository: Repository<EvaluationResult>,
  ) {}

  async getResultByJobId(jobId: string) {
    const evaluationResult = await this.resultRepository.findOne({
      where: { jobId },
    });
    if (!evaluationResult) {
      throw new NotFoundException(`Result for job ID ${jobId} not found.`);
    }

    if (evaluationResult.status === EvaluationStatus.completed) {
      return {
        id: evaluationResult.jobId,
        status: evaluationResult.status,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        result: evaluationResult.result,
      };
    }

    return {
      id: evaluationResult.jobId,
      status: evaluationResult.status,
    };
  }
}
