import { Injectable, INestApplication, Logger } from '@nestjs/common';
import { EventEmitter2, EventEmitterModule, OnEvent } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import * as eventosDeTareas from '../tasks/task.events';
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
  VERIFICACION_CONFIRMADA,
  VERIFICACION_RECHAZADA,
  VERIFICACION_SOLICITADA,
  VerificacionConfirmada,
  VerificacionRechazada,
  VerificacionSolicitada,
  type SwapNotice,
  type TaskAssignedNotice,
  type VerificationNotice,
} from '../tasks/task.events';
import * as eventosDeGastos from '../transactions/expense.events';
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
  type MoneyNotice,
  type ReceiptNotice,
} from '../transactions/expense.events';
import { NotificationsListener } from './notifications.listener';
import { NotificationsService } from './notifications.service';

// Patrón Observer · el observador por sí solo. Se emite cada evento con el EventEmitter2 real
// de @nestjs/event-emitter y se comprueba que NotificationsListener llama al método de
// avisos que toca, con los mismos datos; NotificationsService es un doble con un jest.fn()
// por método. También que el emisor espera al observador y que un observador que falla no
// rompe a quien emite ni a los demás observadores

const METODOS = [
  'taskAssigned', 'swapRequested', 'swapAccepted', 'swapRejected', 'swapCancelled',
  'verificationRequested', 'verificationApproved', 'verificationRejected',
  'expenseAdded', 'receiptAdded', 'expenseEdited', 'expenseDeleted', 'receiptDeleted',
  'paymentMarked', 'paymentConfirmed', 'paymentRejected',
] as const;
type Metodo = (typeof METODOS)[number];

const deuda = (to_user_id: string, amount: string): MoneyNotice => ({
  id: `deuda-${to_user_id}`,
  apartment_id: 'piso',
  from_user_id: 'juan',
  to_user_id,
  amount,
  concept: 'Cena',
  category: 'supplies',
});
const DEUDAS = [deuda('ana', '10.00'), deuda('luis', '10.00')];
const DESPUES = [deuda('ana', '15.00')];
const TICKET: ReceiptNotice = { id: 'ticket', apartment_id: 'piso', payer_id: 'juan', category: 'supplies' };
const PAGO = deuda('juan', '20.00');
const ASIGNACION: TaskAssignedNotice = {
  taskId: 'tarea',
  apartmentId: 'piso',
  assignerId: 'juan',
  dueDate: new Date('2026-11-13T00:00:00.000Z'),
  dueTime: '16:00',
  assignments: [{ id: 'asig', user_id: 'ana' }],
};
const PETICION = { id: 'peticion' } as SwapNotice;
const VERIFICACION: VerificationNotice = {
  assignmentId: 'asig',
  taskId: 'tarea',
  taskTitle: 'Limpiar el baño',
  apartmentId: 'piso',
  ownerId: 'ana',
  verifierId: 'luis',
};

// Cada evento, lo que se emite y las llamadas que tiene que recibir NotificationsService
const CASOS: [string, unknown, Metodo, unknown[][]][] = [
  [TAREA_ASIGNADA, new TareaAsignada(ASIGNACION), 'taskAssigned', [[ASIGNACION]]],
  [INTERCAMBIO_SOLICITADO, new IntercambioSolicitado(PETICION), 'swapRequested', [[PETICION]]],
  [INTERCAMBIO_ACEPTADO, new IntercambioAceptado(PETICION), 'swapAccepted', [[PETICION]]],
  [INTERCAMBIO_RECHAZADO, new IntercambioRechazado(PETICION), 'swapRejected', [[PETICION]]],
  [INTERCAMBIO_CANCELADO, new IntercambioCancelado('peticion'), 'swapCancelled', [['peticion']]],
  [VERIFICACION_SOLICITADA, new VerificacionSolicitada(VERIFICACION), 'verificationRequested', [[VERIFICACION]]],
  [VERIFICACION_CONFIRMADA, new VerificacionConfirmada(VERIFICACION), 'verificationApproved', [[VERIFICACION]]],
  [VERIFICACION_RECHAZADA, new VerificacionRechazada(VERIFICACION), 'verificationRejected', [[VERIFICACION]]],
  [GASTO_CREADO, new GastoCreado(DEUDAS, 'juan'), 'expenseAdded', [[DEUDAS, 'juan']]],
  [TICKET_CREADO, new TicketCreado(TICKET, DEUDAS, 'juan'), 'receiptAdded', [[TICKET, DEUDAS, 'juan']]],
  [GASTO_EDITADO, new GastoEditado(DEUDAS, DESPUES, 'juan'), 'expenseEdited', [[DEUDAS, DESPUES, 'juan']]],
  // Un «Gasto eliminado» por cada deuda que tenía el gasto
  [GASTO_BORRADO, new GastoBorrado(DEUDAS), 'expenseDeleted', [[DEUDAS[0]], [DEUDAS[1]]]],
  [TICKET_BORRADO, new TicketBorrado(TICKET, DEUDAS), 'receiptDeleted', [[TICKET, DEUDAS]]],
  [PAGO_MARCADO, new PagoMarcado(PAGO), 'paymentMarked', [[PAGO]]],
  [PAGO_CONFIRMADO, new PagoConfirmado(PAGO), 'paymentConfirmed', [[PAGO]]],
  [PAGO_RECHAZADO, new PagoRechazado(PAGO), 'paymentRejected', [[PAGO]]],
];

// Un segundo observador de GASTO_CREADO, para ver que no depende del primero
const registro: string[] = [];
@Injectable()
class OtroObservador {
  @OnEvent(GASTO_CREADO, { suppressErrors: true })
  async alCrearGasto() {
    await new Promise((resolver) => setTimeout(resolver, 20));
    registro.push('otro observador');
  }
}

describe('Patrón Observer · NotificationsListener (el observador)', () => {
  let app: INestApplication;
  let eventos: EventEmitter2;
  const notifications = Object.fromEntries(
    METODOS.map((metodo) => [metodo, jest.fn(() => Promise.resolve())]),
  ) as Record<Metodo, jest.Mock>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        NotificationsListener,
        OtroObservador,
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    eventos = app.get(EventEmitter2);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // La librería registra el error que suprime; aquí no hace falta verlo
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    METODOS.forEach((metodo) => notifications[metodo].mockImplementation(() => Promise.resolve()));
    registro.length = 0;
  });

  it.each(CASOS)('%s llega a NotificationsService.%s con los mismos datos', async (nombre, evento, metodo, llamadas) => {
    await eventos.emitAsync(nombre, evento);

    expect(notifications[metodo].mock.calls).toEqual(llamadas);
    // Y a ningún otro método
    for (const otro of METODOS.filter((m) => m !== metodo)) {
      expect(notifications[otro]).not.toHaveBeenCalled();
    }
  });

  it('cada uno de los 16 eventos tiene su propio nombre y todos tienen observador', () => {
    const nombres = [...Object.entries(eventosDeTareas), ...Object.entries(eventosDeGastos)]
      .filter(([clave, valor]) => /^[A-Z_]+$/.test(clave) && typeof valor === 'string')
      .map(([, valor]) => valor as string);

    expect(nombres).toHaveLength(16);
    expect(new Set(nombres).size).toBe(16);
    for (const nombre of nombres) {
      expect(eventos.listeners(nombre).length).toBeGreaterThan(0);
    }
  });

  it('emitAsync no termina hasta que el observador ha terminado: el aviso ya está guardado', async () => {
    const orden: string[] = [];
    notifications.paymentMarked.mockImplementation(async () => {
      await new Promise((resolver) => setTimeout(resolver, 30));
      orden.push('aviso guardado');
    });

    await eventos.emitAsync(PAGO_MARCADO, new PagoMarcado(PAGO));
    orden.push('el servicio responde');

    expect(orden).toEqual(['aviso guardado', 'el servicio responde']);
  });

  it('si el observador falla, quien emite no recibe el error (suppressErrors)', async () => {
    notifications.swapAccepted.mockRejectedValue(new Error('la base de datos no responde'));

    await expect(
      eventos.emitAsync(INTERCAMBIO_ACEPTADO, new IntercambioAceptado(PETICION)),
    ).resolves.toBeDefined();
    expect(notifications.swapAccepted).toHaveBeenCalledTimes(1);
  });

  it('si un observador falla, los demás observadores del mismo evento lo reciben igual', async () => {
    notifications.expenseAdded.mockRejectedValue(new Error('la base de datos no responde'));

    await eventos.emitAsync(GASTO_CREADO, new GastoCreado(DEUDAS, 'juan'));

    expect(registro).toEqual(['otro observador']);
  });

  it('un evento que nadie escucha no hace nada ni falla', async () => {
    await expect(eventos.emitAsync('evento.que.no.existe', {})).resolves.toEqual([]);
    for (const metodo of METODOS) expect(notifications[metodo]).not.toHaveBeenCalled();
  });
});
