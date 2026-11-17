import { Injectable, Logger } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { OnEvent } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import {
  ANA,
  ASIG_ANA,
  ASIG_LUIS,
  JUAN,
  LUIS,
  PISO,
  db,
  deTipo,
  prepararObservador,
  sembrar,
} from '../../test/observador';
import { PrismaService } from '../prisma/prisma.service';
import { INTERCAMBIO_SOLICITADO, IntercambioSolicitado } from '../tasks/task.events';
import { TasksModule } from '../tasks/tasks.module';
import { ExpensesService } from '../transactions/expenses.service';
import { GASTO_CREADO, GastoCreado } from '../transactions/expense.events';
import { TransactionsModule } from '../transactions/transactions.module';
import { TransactionsService } from '../transactions/transactions.service';
import { UsersService } from '../users/users.service';
import { NotificationsModule } from './notifications.module';

// Patrón Observer · sujetos y observador desacoplados. Las tareas y los gastos no saben que
// existen las notificaciones: no importan su módulo, funcionan sin emisor de eventos, y se
// pueden añadir observadores nuevos sin tocarlos. Un observador que falla no rompe la acción

// Observadores nuevos que solo existen en este test. Llevan la cuenta de lo que reciben y, si
// se les pide, fallan o tardan (como un correo o una notificación push lentos)
const recibidos: GastoCreado[] = [];
const intercambios: IntercambioSolicitado[] = [];
let fallar = false;
let tardar = 0;
const esperar = () => new Promise((resolver) => setTimeout(resolver, tardar));

@Injectable()
class ContadorDeGastos {
  @OnEvent(GASTO_CREADO, { suppressErrors: true })
  async alCrearGasto(evento: GastoCreado) {
    if (tardar) await esperar();
    recibidos.push(evento);
    if (fallar) throw new Error('el contador se ha roto');
  }
}

@Injectable()
class ContadorDeIntercambios {
  @OnEvent(INTERCAMBIO_SOLICITADO, { suppressErrors: true })
  async alSolicitar(evento: IntercambioSolicitado) {
    if (tardar) await esperar();
    intercambios.push(evento);
  }
}

const gastoDeCena = {
  apartment_id: PISO,
  from_user_id: JUAN,
  to_user_ids: [JUAN, ANA, LUIS],
  amount: '30',
  concept: 'Cena del viernes',
  category: 'supplies',
};

describe('Patrón Observer · sujetos y observador desacoplados', () => {
  describe('estructura', () => {
    it.each([
      ['TasksModule', TasksModule],
      ['TransactionsModule', TransactionsModule],
    ])('%s no importa NotificationsModule', (_nombre, modulo) => {
      const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, modulo) as unknown[];

      expect(imports).not.toContain(NotificationsModule);
    });
  });

  describe('sin emisor de eventos (como en los tests que solo dan Prisma)', () => {
    beforeEach(() => {
      sembrar();
    });

    it('TransactionsService crea un gasto sin errores y no se crea ningún aviso', async () => {
      const module = await Test.createTestingModule({
        providers: [TransactionsService, UsersService, { provide: PrismaService, useValue: db.prisma }],
      }).compile();
      const servicio = module.get(TransactionsService);

      await expect(servicio.create(gastoDeCena as never, JUAN)).resolves.toHaveLength(2);
      expect(db.filasDe('Transaction')).toHaveLength(2);
      expect(db.filasDe('Notification')).toEqual([]);
    });

    it('ExpensesService edita y borra un gasto sin errores y no se crea ningún aviso', async () => {
      const module = await Test.createTestingModule({
        providers: [
          TransactionsService,
          ExpensesService,
          UsersService,
          { provide: PrismaService, useValue: db.prisma },
        ],
      }).compile();
      await module.get(TransactionsService).create(gastoDeCena as never, JUAN);
      const gastos = module.get(ExpensesService);
      const gasto = () => db.filasDe('Expense')[0] as { id: string; version: number };

      await gastos.update(gasto().id, { version: gasto().version, amount: '45' }, JUAN);
      await gastos.remove(gasto().id, gasto().version, JUAN);

      expect(db.filasDe('Expense')).toEqual([]);
      expect(db.filasDe('Notification')).toEqual([]);
    });
  });

  describe('un observador nuevo, sin tocar los servicios', () => {
    const { como } = prepararObservador({ providers: [ContadorDeGastos, ContadorDeIntercambios] });

    beforeEach(() => {
      recibidos.length = 0;
      intercambios.length = 0;
      fallar = false;
      tardar = 0;
    });

    // emitAsync con await: la petición no responde hasta que han terminado todos los
    // observadores, también el más lento. Sin el await, la respuesta saldría antes
    it('la respuesta de un gasto espera a que termine el observador, aunque tarde', async () => {
      tardar = 150;

      const respuesta = await como(JUAN).post('/transactions', gastoDeCena);

      expect(respuesta.status).toBe(201);
      expect(recibidos).toHaveLength(1);
    });

    it('la respuesta de una solicitud de intercambio también lo espera', async () => {
      tardar = 150;

      const respuesta = await como(ANA).post('/tasks/swap-requests', {
        from_assignment_id: ASIG_ANA,
        to_assignment_id: ASIG_LUIS,
      });

      expect(respuesta.status).toBe(201);
      expect(intercambios).toHaveLength(1);
    });

    it('recibe GASTO_CREADO con los mismos datos que NotificationsListener', async () => {
      const respuesta = await como(JUAN).post('/transactions', gastoDeCena);

      expect(respuesta.status).toBe(201);
      expect(recibidos).toHaveLength(1);
      expect(recibidos[0]).toBeInstanceOf(GastoCreado);
      expect(recibidos[0].actorId).toBe(JUAN);
      expect(recibidos[0].deudas.map((deuda) => deuda.to_user_id)).toEqual([ANA, LUIS]);
      // Y el observador de siempre ha hecho su trabajo
      expect(deTipo(ANA, 'expense_added')).toHaveLength(1);
    });

    it('si falla, el gasto se guarda igual, la respuesta es 2xx y los avisos se crean', async () => {
      const registro = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      fallar = true;

      const respuesta = await como(JUAN).post('/transactions', gastoDeCena);

      expect(respuesta.status).toBe(201);
      expect(recibidos).toHaveLength(1);
      expect(db.filasDe('Transaction')).toHaveLength(2);
      expect(deTipo(ANA, 'expense_added')).toHaveLength(1);
      expect(deTipo(LUIS, 'expense_added')).toHaveLength(1);
      registro.mockRestore();
    });
  });
});
