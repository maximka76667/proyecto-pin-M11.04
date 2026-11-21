import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../common/current-user.decorator';
import { CreateDocumentDto, UpdateDocumentDto, UUID_PATTERN } from './dto/document.dto';
import { DocumentoDemasiadoGrandeFilter, PESO_MAXIMO_DOCUMENTO } from './document-file';
import { DocumentsService } from './documents.service';

function assertUuid(value: string | undefined) {
  if (!value || !UUID_PATTERN.test(value)) {
    throw new BadRequestException('Validation failed (uuid is expected)');
  }
}

// Con el límite, multer corta la subida en 10 MB en vez de cargar el archivo entero en
// memoria; el filtro convierte su 413 en un 400 con el mensaje de «más de 10 MB»
const SUBIDA = FileInterceptor('file', {
  limits: { fileSize: PESO_MAXIMO_DOCUMENTO, files: 1 },
});

@Controller('documents')
@UseFilters(DocumentoDemasiadoGrandeFilter)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  list(@Query('apartment_id') apartmentId: string, @CurrentUser() userId: string) {
    assertUuid(apartmentId);
    return this.documents.list(apartmentId, userId);
  }

  // multipart/form-data: campos apartment_id, name y, o bien "file", o bien "url"
  @Post()
  @UseInterceptors(SUBIDA)
  create(
    @CurrentUser() userId: string,
    @Body() dto: CreateDocumentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.documents.create(userId, dto, file);
  }

  @Patch(':id')
  @UseInterceptors(SUBIDA)
  update(
    @Param('id') id: string,
    @CurrentUser() userId: string,
    @Body() dto: UpdateDocumentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    assertUuid(id);
    return this.documents.update(id, userId, dto, file);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() userId: string) {
    assertUuid(id);
    return this.documents.remove(id, userId);
  }

  @Get(':id/access')
  access(@Param('id') id: string, @CurrentUser() userId: string) {
    assertUuid(id);
    return this.documents.access(id, userId);
  }
}
