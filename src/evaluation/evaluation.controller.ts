import { Controller, Get, Param } from '@nestjs/common';
import { EvaluationService } from './evaluation.service';

@Controller('result')
export class EvaluationController {
  constructor(private evaluationService: EvaluationService) {}

  @Get(':id')
  getResult(@Param('id') id: string) {
    return this.evaluationService.getResultByJobId(id);
  }
}
