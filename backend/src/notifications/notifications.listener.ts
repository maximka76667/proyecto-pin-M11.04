import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  INTERCAMBIO_ACEPTADO,
  INTERCAMBIO_CANCELADO,
  INTERCAMBIO_RECHAZADO,
  INTERCAMBIO_SOLICITADO,
  IntercambioAceptado,
  IntercambioCancelado,
  IntercambioRechazado,
  IntercambioSolicitado,
  TAREA_ASIGNADA,
  TareaAsignada,
} from '../tasks/task.events';
import {
  GASTO_BORRADO,
  GASTO_CREADO,
  GASTO_EDITADO,
  GastoBorrado,
  GastoCreado,
  GastoEditado,
  PAGO_CONFIRMADO,
  PAGO_MARCADO,
  PAGO_RECHAZADO,
  PagoConfirmado,
  PagoMarcado,
  PagoRechazado,
  TICKET_BORRADO,
  TICKET_CREADO,
  TicketBorrado,
  TicketCreado,
} from '../transactions/expense.events';
import { NotificationsService } from './notifications.service';

// El observador del patrón Observer: escucha los eventos que anuncian las tareas (UT1019) y los
// gastos (UT1018) y crea los avisos. Los servicios que emiten no saben que existe.
//
// Los servicios emiten con emitAsync y lo esperan, así que el aviso queda guardado antes de
// responder la petición. `suppressErrors` hace que un aviso que falla nunca rompa la acción que
// lo origina (NotificationsService, además, ya registra el fallo y sigue)
const SIN_ROMPER = { suppressErrors: true } as const;

@Injectable()
export class NotificationsListener {
  constructor(private readonly notifications: NotificationsService) {}

  // ─── Tareas (UT1019) ──────────────────────────────────────────────────────────────────

  @OnEvent(TAREA_ASIGNADA, SIN_ROMPER)
  onTareaAsignada(evento: TareaAsignada) {
    return this.notifications.taskAssigned(evento.asignacion);
  }

  @OnEvent(INTERCAMBIO_SOLICITADO, SIN_ROMPER)
  onIntercambioSolicitado(evento: IntercambioSolicitado) {
    return this.notifications.swapRequested(evento.peticion);
  }

  @OnEvent(INTERCAMBIO_ACEPTADO, SIN_ROMPER)
  onIntercambioAceptado(evento: IntercambioAceptado) {
    return this.notifications.swapAccepted(evento.peticion);
  }

  @OnEvent(INTERCAMBIO_RECHAZADO, SIN_ROMPER)
  onIntercambioRechazado(evento: IntercambioRechazado) {
    return this.notifications.swapRejected(evento.peticion);
  }

  @OnEvent(INTERCAMBIO_CANCELADO, SIN_ROMPER)
  onIntercambioCancelado(evento: IntercambioCancelado) {
    return this.notifications.swapCancelled(evento.peticionId);
  }

  // ─── Gastos y pagos (UT1018) ──────────────────────────────────────────────────────────

  @OnEvent(GASTO_CREADO, SIN_ROMPER)
  onGastoCreado(evento: GastoCreado) {
    return this.notifications.expenseAdded(evento.deudas, evento.actorId);
  }

  @OnEvent(TICKET_CREADO, SIN_ROMPER)
  onTicketCreado(evento: TicketCreado) {
    return this.notifications.receiptAdded(evento.ticket, evento.deudas, evento.actorId);
  }

  @OnEvent(GASTO_EDITADO, SIN_ROMPER)
  onGastoEditado(evento: GastoEditado) {
    return this.notifications.expenseEdited(evento.antes, evento.despues, evento.actorId);
  }

  @OnEvent(GASTO_BORRADO, SIN_ROMPER)
  async onGastoBorrado(evento: GastoBorrado) {
    for (const deuda of evento.deudas) {
      await this.notifications.expenseDeleted(deuda);
    }
  }

  @OnEvent(TICKET_BORRADO, SIN_ROMPER)
  onTicketBorrado(evento: TicketBorrado) {
    return this.notifications.receiptDeleted(evento.ticket, evento.deudas);
  }

  @OnEvent(PAGO_MARCADO, SIN_ROMPER)
  onPagoMarcado(evento: PagoMarcado) {
    return this.notifications.paymentMarked(evento.pago);
  }

  @OnEvent(PAGO_CONFIRMADO, SIN_ROMPER)
  onPagoConfirmado(evento: PagoConfirmado) {
    return this.notifications.paymentConfirmed(evento.pago);
  }

  @OnEvent(PAGO_RECHAZADO, SIN_ROMPER)
  onPagoRechazado(evento: PagoRechazado) {
    return this.notifications.paymentRejected(evento.pago);
  }
}
