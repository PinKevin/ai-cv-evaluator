import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

export enum EvaluationStatus {
  queued = 'queued',
  processing = 'processing',
  completed = 'completed',
  failed = 'failed',
}

@Entity('evaluation_results')
export class EvaluationResult {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  jobId: string;

  @Column({
    type: 'enum',
    enum: EvaluationStatus,
    default: EvaluationStatus.queued,
  })
  status: EvaluationStatus;

  @Column({ type: 'jsonb', nullable: true })
  result: any;
}
