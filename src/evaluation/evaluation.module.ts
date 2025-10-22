import { Module } from '@nestjs/common';
import { EvaluationResult } from './evaluation.entity';
import { Document } from 'src/document/document.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { EvaluationProcessor } from './evaluation.processor';
import { EvaluationService } from './evaluation.service';
import { EvaluationController } from './evaluation.controller';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [
    TypeOrmModule.forFeature([EvaluationResult, Document]),
    BullModule.registerQueue({ name: 'evaluation-queue' }),
    HttpModule,
  ],
  providers: [EvaluationProcessor, EvaluationService],
  controllers: [EvaluationController],
})
export class EvaluationModule {}
