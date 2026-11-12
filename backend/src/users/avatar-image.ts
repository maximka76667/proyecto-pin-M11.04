import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';

export const PESO_MAXIMO_AVATAR = 5 * 1024 * 1024; // 5 MB
export const IMAGEN_MUY_GRANDE = 'La imagen no puede superar los 5 MB';
export const IMAGEN_NO_VALIDA = 'La imagen debe ser JPG, PNG o WebP';

// Solo los formatos que cualquier navegador pinta. SVG no: puede llevar scripts. HEIC
// tampoco: Chrome no lo muestra, y el selector del móvil ya devuelve JPEG
export type TipoDeImagen = 'image/jpeg' | 'image/png' | 'image/webp';

const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const FIRMA_JPEG = [0xff, 0xd8, 0xff];

function empiezaPor(buffer: Buffer, firma: number[], desde = 0) {
  return firma.every((byte, i) => buffer[desde + i] === byte);
}

// El tipo real sale de los primeros bytes del archivo (su «firma»), no del mimetype que
// manda el cliente, que cualquiera puede escribir como «image/png». Devuelve null si el
// contenido no es una de las imágenes admitidas
export function tipoDeImagen(buffer: Buffer | undefined): TipoDeImagen | null {
  if (!buffer || buffer.length < 12) return null;
  if (empiezaPor(buffer, FIRMA_PNG)) return 'image/png';
  if (empiezaPor(buffer, FIRMA_JPEG)) return 'image/jpeg';
  // WebP: «RIFF», 4 bytes con el tamaño y «WEBP»
  if (
    buffer.toString('latin1', 0, 4) === 'RIFF' &&
    buffer.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

// Cuando el archivo pasa del límite, multer responde 413. La PA-1016.06 pide un 400 con
// el mensaje de «más de 5 MB», igual que cuando el tamaño se comprueba en el servicio
@Catch(PayloadTooLargeException)
export class ImagenDemasiadoGrandeFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost) {
    host.switchToHttp().getResponse<Response>().status(400).json({
      statusCode: 400,
      error: 'Bad Request',
      message: IMAGEN_MUY_GRANDE,
    });
  }
}
