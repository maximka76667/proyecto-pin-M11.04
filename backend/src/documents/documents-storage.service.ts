import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';

// Bucket PRIVADO de Supabase Storage (se crea a mano en el panel): ningún archivo se puede
// abrir con su dirección directa, solo con un enlace temporal que firma el servidor
export const BUCKET_DOCUMENTOS = 'apartment-documents';

@Injectable()
export class DocumentsStorageService {
  async upload(path: string, content: Buffer, contentType: string): Promise<void> {
    const res = await this.call(`/object/${BUCKET_DOCUMENTOS}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'x-upsert': 'false' },
      body: new Uint8Array(content),
    });
    if (!res.ok) {
      throw new BadGatewayException('Error al subir el archivo a Storage');
    }
  }

  async remove(path: string): Promise<void> {
    const res = await this.call(`/object/${BUCKET_DOCUMENTOS}/${path}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 404) {
      throw new BadGatewayException('Error al borrar el archivo de Storage');
    }
  }

  // Enlace de lectura que caduca a los `seconds` segundos
  async signedUrl(path: string, seconds: number): Promise<string> {
    const res = await this.call(`/object/sign/${BUCKET_DOCUMENTOS}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: seconds }),
    });
    if (!res.ok) {
      throw new BadGatewayException('No se ha podido abrir el archivo');
    }
    const data = (await res.json()) as { signedURL?: string };
    if (!data.signedURL) {
      throw new BadGatewayException('No se ha podido abrir el archivo');
    }
    return `${this.config().url}/storage/v1${data.signedURL}`;
  }

  private config() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
    if (!url || !key) {
      throw new InternalServerErrorException('Falta la configuración de Supabase Storage');
    }
    return { url, key };
  }

  private async call(path: string, init: RequestInit): Promise<Response> {
    const { url, key } = this.config();
    try {
      return await fetch(`${url}/storage/v1${path}`, {
        ...init,
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    } catch {
      throw new BadGatewayException('No se ha podido conectar con Storage');
    }
  }
}
