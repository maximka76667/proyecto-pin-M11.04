import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AvisoCreado } from '../notifications/notification.events';

// API de push de Expo: reenvía cada mensaje a APNs (iPhone) o FCM (Android). En Expo Go no hace
// falta ninguna credencial propia; en una app instalada, las de FCM y APNs se suben a EAS
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
// Máximo de mensajes por petición que admite Expo
const LOTE = 100;
const ESPERA_MAXIMA_MS = 10_000;

type MensajePush = {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  // Lo que lee la app al tocar la notificación para abrir la misma pantalla que el aviso
  data: { type: string; reference_id: string | null };
};

// Respuesta de Expo para cada mensaje, en el mismo orden en que se enviaron
type Ticket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message?: string; details?: { error?: string } };

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(private readonly prisma: PrismaService) {}

  // El móvil queda asociado a quien acaba de iniciar sesión en él. Si el token era de otra
  // cuenta (dos personas que comparten móvil), pasa a esta: la anterior ya cerró sesión allí
  async registrar(userId: string, token: string) {
    await this.prisma.pushToken.upsert({
      where: { token },
      create: { user_id: userId, token },
      update: { user_id: userId },
    });
  }

  // Al cerrar sesión. Solo borra el token si es del usuario: nadie puede quitarle las
  // notificaciones a otro
  async quitar(userId: string, token: string) {
    await this.prisma.pushToken.deleteMany({
      where: { AND: [{ token }, { user_id: userId }] },
    });
  }

  // Manda cada aviso a todos los móviles de su destinatario. Nunca lanza: una push que no sale
  // se registra y el aviso sigue estando dentro de la app
  async enviar(avisos: AvisoCreado[]) {
    try {
      const destinatarios = [...new Set(avisos.map((aviso) => aviso.user_id))];
      const filas = await this.prisma.pushToken.findMany({
        where: { user_id: { in: destinatarios } },
        select: { user_id: true, token: true },
      });
      if (filas.length === 0) return;

      const tokensDe = new Map<string, string[]>();
      for (const { user_id, token } of filas) {
        tokensDe.set(user_id, [...(tokensDe.get(user_id) ?? []), token]);
      }

      const mensajes = avisos.flatMap((aviso) =>
        (tokensDe.get(aviso.user_id) ?? []).map(
          (token): MensajePush => ({
            to: token,
            title: aviso.title,
            body: aviso.body,
            sound: 'default',
            data: { type: aviso.type, reference_id: aviso.reference_id ?? null },
          }),
        ),
      );

      for (let i = 0; i < mensajes.length; i += LOTE) {
        await this.enviarLote(mensajes.slice(i, i + LOTE));
      }
    } catch (error) {
      const motivo = error instanceof Error ? error.message : 'error desconocido';
      this.logger.warn(`No se han podido enviar las notificaciones push: ${motivo}`);
    }
  }

  private async enviarLote(mensajes: MensajePush[]) {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    // Opcional: solo hace falta si se activa "Enhanced Security for Push Notifications" en Expo
    const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const respuesta = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(mensajes),
      signal: AbortSignal.timeout(ESPERA_MAXIMA_MS),
    });
    if (!respuesta.ok) {
      this.logger.warn(`La API de push de Expo ha respondido HTTP ${respuesta.status}`);
      return;
    }

    const { data: tickets = [] } = (await respuesta.json()) as { data?: Ticket[] };
    const caducados: string[] = [];
    let fallidos = 0;
    tickets.forEach((ticket, i) => {
      if (ticket.status !== 'error') return;
      // La app se desinstaló o el usuario quitó el permiso: ese token ya no sirve
      if (ticket.details?.error === 'DeviceNotRegistered') caducados.push(mensajes[i].to);
      else fallidos++;
    });

    if (caducados.length > 0) {
      await this.prisma.pushToken.deleteMany({ where: { token: { in: caducados } } });
    }
    if (fallidos > 0) {
      // Sin el token en el registro: identifica un móvil concreto
      const ejemplo = tickets.find(
        (ticket): ticket is Extract<Ticket, { status: 'error' }> =>
          ticket.status === 'error' && ticket.details?.error !== 'DeviceNotRegistered',
      );
      this.logger.warn(
        `Expo ha rechazado ${fallidos} de ${mensajes.length} notificaciones push: ${ejemplo?.details?.error ?? ejemplo?.message ?? 'sin detalle'}`,
      );
    }
  }
}
