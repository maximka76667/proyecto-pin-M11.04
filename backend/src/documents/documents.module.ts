import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentsStorageService } from './documents-storage.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentsStorageService],
})
export class DocumentsModule {}
