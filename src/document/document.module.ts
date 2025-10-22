import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from './document.entity';
import { DocumentService } from './document.service';
import { DocumentController } from './document.controller';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    TypeOrmModule.forFeature([Document]),
    MulterModule.register({
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) => {
          const randomName = Array(32)
            .fill(null)
            .map(() => Math.round(Math.random() * 16).toString())
            .join('');
          cb(null, `${randomName}${extname(file.originalname)}`);
        },
      }),
    }),
    BullModule.registerQueue({
      name: 'evaluation-queue',
    }),
  ],
  providers: [DocumentService],
  controllers: [DocumentController],
})
export class DocumentModule {}
