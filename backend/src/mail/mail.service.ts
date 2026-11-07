import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';

// Envío de emails con una cuenta de Gmail por SMTP. Llega a cualquier dirección, sin dominio propio.
// Variables de entorno:
//   GMAIL_USER          la cuenta de Gmail que envía (p. ej. room8.app@gmail.com)
//   GMAIL_APP_PASSWORD  contraseña de aplicación de esa cuenta (necesita la verificación en dos pasos);
//                       no es la contraseña normal de Gmail, que Google rechaza por SMTP
//   MAIL_FROM           opcional; por defecto "Room8 <GMAIL_USER>"
// Sin GMAIL_USER o GMAIL_APP_PASSWORD, en desarrollo el código se escribe en la consola.
//
// Nunca lanza: devuelve false si no se pudo enviar. Quien lo llama lo hace sin esperar la
// respuesta, para que el tiempo de respuesta no delate si un email está registrado.
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: ReturnType<typeof createTransport> | null = null;
  private readonly from: string = '';

  constructor(config: ConfigService) {
    const user = config.get<string>('GMAIL_USER')?.trim();
    // Google muestra la contraseña de aplicación en grupos con espacios ("abcd efgh ijkl mnop")
    const pass = config.get<string>('GMAIL_APP_PASSWORD')?.replace(/\s+/g, '');
    if (!user || !pass) return;

    this.transporter = createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user, pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    // Gmail sustituye el remitente por la cuenta que envía si no coinciden
    this.from = config.get<string>('MAIL_FROM')?.trim() || `Room8 <${user}>`;
  }

  // Al arrancar se comprueba la cuenta, para que un usuario o contraseña mal puestos se vean
  // en la consola enseguida y no al pedir el primer código
  onModuleInit() {
    if (!this.transporter) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error('Falta GMAIL_USER o GMAIL_APP_PASSWORD: no se enviarán los códigos de recuperación');
      } else {
        this.logger.warn('Falta GMAIL_USER o GMAIL_APP_PASSWORD: los códigos de recuperación saldrán en esta consola');
      }
      return;
    }
    void this.transporter
      .verify()
      .then(() => this.logger.log(`Gmail SMTP listo: los correos salen desde ${this.from}`))
      .catch((error: unknown) => this.logger.error(`No se puede enviar con Gmail: ${describeError(error)}`));
  }

  async sendPasswordResetCode(to: string, code: string, expiresInMinutes: number) {
    if (!this.transporter) {
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(`Gmail no está configurado. Código para ${to}: ${code}`);
      }
      return false;
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject: 'Tu código para restablecer la contraseña de Room8',
        text: resetText(code, expiresInMinutes),
        html: resetHtml(code, expiresInMinutes),
      });
      return true;
    } catch (error) {
      // Sin el destinatario ni las credenciales en el log
      this.logger.error(`No se ha podido enviar el código: ${describeError(error)}`);
      return false;
    }
  }
}

// Mensajes de nodemailer traducidos a lo que hay que revisar
function describeError(error: unknown) {
  const { code, message } = (error ?? {}) as { code?: string; message?: string };
  if (code === 'EAUTH') {
    return 'Gmail ha rechazado el usuario o la contraseña de aplicación. Revisa GMAIL_USER y GMAIL_APP_PASSWORD, y que la cuenta tenga activada la verificación en dos pasos';
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNECTION' || code === 'ESOCKET') {
    return `no hay conexión con smtp.gmail.com:465 (${code}). Puede que la red bloquee el puerto`;
  }
  return message ?? 'error desconocido';
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
