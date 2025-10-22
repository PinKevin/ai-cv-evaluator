import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class EvaluateDto {
  @IsString()
  @IsNotEmpty()
  jobTitle: string;

  @IsNumber()
  @IsNotEmpty()
  cvId: number;

  @IsNumber()
  @IsNotEmpty()
  reportId: number;
}
