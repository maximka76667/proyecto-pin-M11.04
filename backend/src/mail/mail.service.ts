import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Room8 <onboarding@resend.dev>';
const REQUEST_TIMEOUT_MS = 10_000;

// Envío de emails con la API HTTP de Resend (sin SDK). Variables de entorno:
//   RESEND_API_KEY  clave de la API (sin ella, en desarrollo el código sale por consola)
//   RESEND_FROM     remitente; sin dominio verificado, Resend solo entrega al dueño de la cuenta
//
// Nunca lanza: devuelve false si no se pudo enviar. Quien lo llama lo hace sin esperar
// la respuesta, para que el tiempo de respuesta no delate si un email está registrado.
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendPasswordResetCode(to: string, code: string, expiresInMinutes: number) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');

    if (!apiKey) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error('RESEND_API_KEY no está configurada: no se ha enviado el código');
      } else {
        this.logger.warn(`RESEND_API_KEY no está configurada. Código para ${to}: ${code}`);
      }
      return false;
    }

    try {
      const response = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.config.get<string>('RESEND_FROM') || DEFAULT_FROM,
          to: [to],
          subject: 'Tu código para restablecer la contraseña de Room8',
          text: resetText(code, expiresInMinutes),
          html: resetHtml(code, expiresInMinutes),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        // Sin el destinatario ni la clave en el log
        this.logger.error(`Resend ha rechazado el email (HTTP ${response.status})`);
        return false;
      }
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'error desconocido';
      this.logger.error(`No se ha podido conectar con Resend: ${reason}`);
      return false;
    }
  }
}

// El único dato variable es el código, que son 6 dígitos generados por el servidor
function resetText(code: string, minutes: number) {
  return [
    `Tu código para restablecer la contraseña de Room8 es: ${code}`,
    '',
    `Caduca en ${minutes} minutos y solo se puede usar una vez.`,
    'Si no has pedido cambiar la contraseña, ignora este email: tu cuenta sigue igual.',
  ].join('\n');
}

function resetHtml(code: string, minutes: number) {
  return `<div style="font-family:Arial,sans-serif;color:#1F2A24;max-width:480px">
  <h2 style="margin:0 0 12px">Restablecer tu contraseña</h2>
  <p>Introduce este código en la app de Room8:</p>
  <p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:16px 0;color:#2F6B55">${code}</p>
  <p>Caduca en ${minutes} minutos y solo se puede usar una vez.</p>
  <p style="color:#6B7280;font-size:13px">Si no has pedido cambiar la contraseña, ignora este email: tu cuenta sigue igual.</p>
</div>`;
}
