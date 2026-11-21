import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';
import { tipoDeImagen } from '../users/avatar-image';

export const PESO_MAXIMO_DOCUMENTO = 10 * 1024 * 1024; // 10 MB
export const MAX_DOCUMENTOS_POR_PISO = 50;
export const DOCUMENTO_MUY_GRANDE = 'El archivo no puede superar los 10 MB';
export const DOCUMENTO_NO_VALIDO = 'El archivo debe ser un PDF, JPG, PNG o WebP';

// Solo estos formatos: los abre cualquier móvil o navegador sin instalar nada. Word y Excel
// no (hace falta otra app); los documentos de Google se añaden como enlace
export type TipoDeDocumento =
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp';

export const EXTENSION_DE: Record<TipoDeDocumento, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// El tipo real sale de los primeros bytes del archivo, no del nombre ni del mimetype que
// manda el cliente, que cualquiera puede escribir como «application/pdf». Un vídeo con
// extensión .pdf no pasa. Devuelve null si no es uno de los formatos admitidos
export function tipoDeDocumento(buffer: Buffer | undefined): TipoDeDocumento | null {
  if (!buffer || buffer.length < 12) return null;
  if (buffer.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  return tipoDeImagen(buffer);
}

// Cuando el archivo pasa del límite, multer responde 413; se convierte en un 400 con el
// mensaje de «más de 10 MB», igual que cuando el tamaño se comprueba en el servicio
@Catch(PayloadTooLargeException)
export class DocumentoDemasiadoGrandeFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost) {
    host.switchToHttp().getResponse<Response>().status(400).json({
      statusCode: 400,
      error: 'Bad Request',
      message: DOCUMENTO_MUY_GRANDE,
    });
  }
}
