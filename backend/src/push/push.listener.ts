import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AVISOS_CREADOS, AvisosCreados } from '../notifications/notification.events';
import { PushService } from './push.service';

// Observador de los avisos (patrón Observer, en cadena): cuando NotificationsService guarda
// avisos nuevos, este los manda al móvil de cada destinatario. NotificationsService no sabe que
// existe, igual que las tareas y los gastos no saben que existe NotificationsListener.
//
// El evento llega con emit() (sin esperar), así que la petición que creó el aviso ya ha
// respondido cuando esto se ejecuta; `suppressErrors` evita que un fallo salga de aquí
@Injectable()
export class PushListener {
  constructor(private readonly push: PushService) {}

  @OnEvent(AVISOS_CREADOS, { suppressErrors: true })
  onAvisosCreados(evento: AvisosCreados) {
    return this.push.enviar(evento.avisos);
  }
}
