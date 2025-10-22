import {
  Body,
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { DocumentService } from './document.service';
import { EvaluateDto } from './dto/evaluate.dto';

@Controller()
export class DocumentController {
  constructor(private documentService: DocumentService) {}

  @Post('upload')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'cv', maxCount: 1 },
      { name: 'report', maxCount: 1 },
    ]),
  )
  async uploadFiles(
    @UploadedFiles()
    files: {
      cv?: Express.Multer.File[];
      report?: Express.Multer.File[];
    },
  ) {
    return this.documentService.uploadAndSaveDocument(files);
  }

  @Post('evaluate')
  async evaluate(@Body() evaluateDto: EvaluateDto) {
    return this.documentService.startEvaluation(evaluateDto);
  }
}
