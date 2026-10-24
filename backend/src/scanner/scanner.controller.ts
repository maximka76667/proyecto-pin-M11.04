import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PESO_MAXIMO_IMAGEN, ScannerService } from './scanner.service';

@Controller('scanner')
export class ScannerController {
  constructor(private readonly scannerService: ScannerService) {}

  // Lee una foto de un ticket (multipart, campo "image") y devuelve los datos para
  // rellenar el formulario. No crea la transacción: eso lo hace el usuario al confirmar.
  @Post('ticket')
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: PESO_MAXIMO_IMAGEN } }),
  )
  escanearTicket(@UploadedFile() imagen: Express.Multer.File | undefined) {
    return this.scannerService.escanearTicket(imagen);
  }
}
