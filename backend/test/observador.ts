import { randomUUID } from 'node:crypto';
import {
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../src/app.setup';
import { AuthMiddleware } from '../src/auth/auth.middleware';
import { AuthService } from '../src/auth/auth.service';
import { GoogleCalendarService } from '../src/availability/google-calendar.service';
import { NotificationsListener } from '../src/notifications/notifications.listener';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TaskSwapsService } from '../src/tasks/task-swaps.service';
import { TasksController } from '../src/tasks/tasks.controller';
import { TasksService } from '../src/tasks/tasks.service';
import { ExpensesController } from '../src/transactions/expenses.controller';
import { ExpensesService } from '../src/transactions/expenses.service';
import { TransactionsController } from '../src/transactions/transactions.controller';
import { TransactionsService } from '../src/transactions/transactions.service';
import { UsersService } from '../src/users/users.service';
import { crearPrismaEnMemoria, type Fila } from './prisma-en-memoria';

// Lo que comparten los specs del patrón Observer (src/notifications/notifications.observer-*.spec.ts).
//
// La app se monta como en producción: los servicios de tareas y de gastos (los sujetos) emiten
// eventos con EventEmitter2.emitAsync y NotificationsListener (el observador) crea los avisos.
// Se espía emitAsync sin sustituirlo, así cada test ve qué se ha emitido y además el listener
// real hace su trabajo. Cada petición va como Ana, Juan, Luis o Dani según su token, con el
// AuthMiddleware real, y la base de datos es el Prisma en memoria que lee schema.prisma

export const db = crearPrismaEnMemoria();

export const PISO = 'a0a0a0a0-0000-4000-8000-000000000001';
export const OTRO_PISO = 'a0a0a0a0-0000-4000-8000-000000000002';

// Ana, Juan y Luis viven en el piso; Dani, en otro
export const ANA = 'a1a1a1a1-1111-4111-8111-111111111111';
export const JUAN = 'b2b2b2b2-2222-4222-8222-222222222222';
export const LUIS = 'c3c3c3c3-3333-4333-8333-333333333333';
export const DANI = 'd4d4d4d4-4444-4444-8444-444444444444';

export const TAREA_ANA = 'e0e0e0e0-0000-4000-8000-00000000000a';
export const TAREA_LUIS = 'e0e0e0e0-0000-4000-8000-00000000000b';
export const TAREA_LIBRE = 'e0e0e0e0-0000-4000-8000-00000000000c';
export const TAREA_OTRO_PISO = 'e0e0e0e0-0000-4000-8000-00000000000d';
export const ASIG_ANA = 'f0f0f0f0-0000-4000-8000-00000000000a';
export const ASIG_LUIS = 'f0f0f0f0-0000-4000-8000-00000000000b';

// Las tareas son el jueves 12 de noviembre de 2026 y el reloj está dos días antes, a las 9:00
// (hora de Madrid): así nada vence todavía y no se cuelan recordatorios
export const JUEVES = '2026-11-12';
export const VIERNES = '2026-11-13';
const MARTES_9H = new Date('2026-11-10T08:00:00.000Z');

// Solo se falsea Date; los temporizadores de supertest siguen reales (como en availability.spec.ts)
const SOLO_DATE = [
  'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame',
  'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate',
  'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
] as const;

export const TOKENS: Record<string, string> = {
  [ANA]: 'token-de-ana',
  [JUAN]: 'token-de-juan',
  [LUIS]: 'token-de-luis',
  [DANI]: 'token-de-dani',
};
const USUARIO_DEL_TOKEN = Object.fromEntries(Object.entries(TOKENS).map(([id, token]) => [token, id]));

const nuevoUsuario = (id: string, full_name: string) => ({
  id,
  email: `${full_name.split(' ')[0].toLowerCase()}@ejemplo.com`,
  full_name,
  is_landlord: false,
  password_hash: null,
  google_subject: null,
});
const nuevoPiso = (id: string, name: string) => ({
  id,
  address: `${name}, 1`,
  name,
  invite_code: randomUUID(),
  landlord_id: null,
});
const nuevaTarea = (id: string, apartment_id: string, title: string) => ({
  id,
  apartment_id,
  title,
  description: null,
  duration_minutes: 30,
  status: 'assigned',
  category: 'cleaning',
  priority: 'medium',
  frequency: 'none',
});
const nuevaAsignacion = (id: string, task_id: string, user_id: string, due_time: string) => ({
  id,
  task_id,
  user_id,
  status: 'pending',
  due_date: new Date(`${JUEVES}T00:00:00.000Z`),
  start_minute: 540,
  due_time,
});

// «Fregar los platos» es de Ana a las 10:00 y «Sacar la basura» de Luis a las 18:00.
// «Limpiar el baño» todavía no la tiene nadie. No hay ningún gasto
export function sembrar() {
  db.cargar({
    User: [
      nuevoUsuario(ANA, 'Ana García'),
      nuevoUsuario(JUAN, 'Juan Pérez'),
      nuevoUsuario(LUIS, 'Luis Gómez'),
      nuevoUsuario(DANI, 'Dani Ruiz'),
    ],
    Apartment: [nuevoPiso(PISO, 'Calle Mayor'), nuevoPiso(OTRO_PISO, 'Calle Luna')],
    UserApartment: [
      { user_id: ANA, apartment_id: PISO },
      { user_id: JUAN, apartment_id: PISO },
      { user_id: LUIS, apartment_id: PISO },
      { user_id: DANI, apartment_id: OTRO_PISO },
    ],
    Task: [
      nuevaTarea(TAREA_ANA, PISO, 'Fregar los platos'),
      nuevaTarea(TAREA_LUIS, PISO, 'Sacar la basura'),
      nuevaTarea(TAREA_LIBRE, PISO, 'Limpiar el baño'),
      nuevaTarea(TAREA_OTRO_PISO, OTRO_PISO, 'Regar las plantas'),
    ],
    TaskAssignment: [
      nuevaAsignacion(ASIG_ANA, TAREA_ANA, ANA, '10:00'),
      nuevaAsignacion(ASIG_LUIS, TAREA_LUIS, LUIS, '18:00'),
    ],
  });
}

export type Aviso = Fila & { type: string; body: string; is_read: boolean; reference_id: string };
export const avisosDe = (usuario: string) =>
  db.filasDe('Notification').filter((aviso) => aviso.user_id === usuario) as Aviso[];
export const deTipo = (usuario: string, tipo: string) =>
  avisosDe(usuario).filter((aviso) => aviso.type === tipo);
// Intl pone un espacio duro (U+00A0) antes del €: se cambia por uno normal para comparar
export const texto = (aviso?: Aviso) => aviso?.body.replace(/ /g, ' ');

export function exito(respuesta: { status: number; body: unknown }) {
  if (respuesta.status >= 300) {
    throw new Error(`Se esperaba 2xx y llegó HTTP ${respuesta.status}: ${JSON.stringify(respuesta.body)}`);
  }
}

const auth = {
  userIdForToken: jest.fn((token: string) => Promise.resolve(USUARIO_DEL_TOKEN[token] ?? null)),
};
// Al asignar y al pedir un intercambio se sincroniza Google; aquí no trae nada
const google = { sync: jest.fn(() => Promise.resolve()) };

// Lo mismo que montan TasksModule, TransactionsModule y NotificationsModule, con el
// EventEmitterModule de AppModule. `extra` permite añadir observadores de prueba
export function moduloDePrueba(extra: { providers?: unknown[] } = {}) {
  @Module({
    imports: [EventEmitterModule.forRoot()],
    controllers: [TasksController, TransactionsController, ExpensesController],
    providers: [
      TasksService,
      TaskSwapsService,
      TransactionsService,
      ExpensesService,
      UsersService,
      NotificationsService,
      NotificationsListener,
      AuthMiddleware,
      { provide: PrismaService, useValue: db.prisma },
      { provide: AuthService, useValue: auth },
      { provide: GoogleCalendarService, useValue: google },
      ...((extra.providers ?? []) as []),
    ],
  })
  class ModuloDelObservador implements NestModule {
    configure(consumer: MiddlewareConsumer) {
      consumer.apply(AuthMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
    }
  }
  return ModuloDelObservador;
}

// Se llama al principio del describe de cada spec. Devuelve las peticiones de cada persona y
// la lista de eventos emitidos en el test ([nombre, evento], en orden)
export function prepararObservador(extra: { providers?: unknown[] } = {}) {
  let app: INestApplication<App>;
  let emitAsync: jest.SpyInstance;
  const zonaHorariaOriginal = process.env.CALENDAR_TIME_ZONE;

  beforeAll(async () => {
    process.env.CALENDAR_TIME_ZONE = 'Europe/Madrid';
    const module = await Test.createTestingModule({ imports: [moduloDePrueba(extra)] }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    // Espía sin sustituir: los observadores siguen recibiendo el evento
    emitAsync = jest.spyOn(app.get(EventEmitter2), 'emitAsync');
  });

  afterAll(async () => {
    await app.close();
    if (zonaHorariaOriginal === undefined) delete process.env.CALENDAR_TIME_ZONE;
    else process.env.CALENDAR_TIME_ZONE = zonaHorariaOriginal;
  });

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: [...SOLO_DATE], now: MARTES_9H });
    sembrar();
    emitAsync.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const servidor = () => request(app.getHttpServer());
  const como = (usuario: string) => {
    const autorizacion = `Bearer ${TOKENS[usuario]}`;
    return {
      get: (url: string) => servidor().get(url).set('Authorization', autorizacion),
      post: (url: string, body: object = {}) => servidor().post(url).set('Authorization', autorizacion).send(body),
      patch: (url: string, body: object = {}) => servidor().patch(url).set('Authorization', autorizacion).send(body),
      delete: (url: string) => servidor().delete(url).set('Authorization', autorizacion),
    };
  };

  return {
    app: () => app,
    como,
    // [nombre, evento] de cada emitAsync del test
    emitidos: () => emitAsync.mock.calls.map(([nombre, evento]) => [nombre, evento] as [string, unknown]),
    nombresEmitidos: () => emitAsync.mock.calls.map(([nombre]) => nombre as string),
  };
}
