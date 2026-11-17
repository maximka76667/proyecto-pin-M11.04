import { randomUUID } from 'node:crypto';
import {
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../src/app.setup';
import { AuthMiddleware } from '../src/auth/auth.middleware';
import { AuthService } from '../src/auth/auth.service';
import { GoogleCalendarService } from '../src/availability/google-calendar.service';
import { NotificationsController } from '../src/notifications/notifications.controller';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TaskSwapsService } from '../src/tasks/task-swaps.service';
import { TasksController } from '../src/tasks/tasks.controller';
import { TasksService } from '../src/tasks/tasks.service';
import { crearPrismaEnMemoria, type Fila } from './prisma-en-memoria';

// Lo que comparten los specs de UT1019 · notificaciones de tareas (src/notifications/*.spec.ts):
// un spec por PA, todos sobre los mismos datos.
//
// Se prueba por HTTP con los servicios de verdad (tareas, intercambios y notificaciones) y el
// AuthMiddleware real, para que cada petición vaya como Ana, Beto, Carla o Dani según su token.
// La base de datos es el Prisma en memoria de prisma-en-memoria.ts, que lee schema.prisma:
// así se comprueban también la restricción única de los recordatorios y el borrado en cascada.
// Jest carga los módulos de nuevo en cada archivo de test, así que cada spec tiene su propio `db`

export const db = crearPrismaEnMemoria();

export const PISO = 'a0a0a0a0-0000-4000-8000-000000000001';
export const OTRO_PISO = 'a0a0a0a0-0000-4000-8000-000000000002';

// Ana, Beto y Carla viven en el piso; Dani, en otro.
// Ninguno es el USER_ID de desarrollo: así cada petición va de verdad con su token
export const ANA = 'a1a1a1a1-1111-4111-8111-111111111111';
export const BETO = 'b2b2b2b2-2222-4222-8222-222222222222';
export const CARLA = 'c3c3c3c3-3333-4333-8333-333333333333';
export const DANI = 'd4d4d4d4-4444-4444-8444-444444444444';

export const TAREA_A = 'e0e0e0e0-0000-4000-8000-00000000000a';
export const TAREA_B = 'e0e0e0e0-0000-4000-8000-00000000000b';
export const TAREA_C = 'e0e0e0e0-0000-4000-8000-00000000000c';
export const TAREA_LIBRE = 'e0e0e0e0-0000-4000-8000-00000000000d';
export const TAREA_X = 'e0e0e0e0-0000-4000-8000-00000000000e';

export const ASIG_A = 'f0f0f0f0-0000-4000-8000-00000000000a';
export const ASIG_B = 'f0f0f0f0-0000-4000-8000-00000000000b';
export const ASIG_C = 'f0f0f0f0-0000-4000-8000-00000000000c';
export const ASIG_X = 'f0f0f0f0-0000-4000-8000-00000000000e';

// Las tareas son el jueves 12 de noviembre de 2026. Las horas son de Madrid (UTC+1 en noviembre)
export const JUEVES = '2026-11-12';
export const VIERNES = '2026-11-13';
// Dos días antes, a las 9:00: todavía no vence nada, así que no hay recordatorios por medio
export const MARTES_9H = new Date('2026-11-10T08:00:00.000Z');
// El mismo jueves a las 9:00: la tarea de Ana (10:00) y la de Beto (18:00) vencen hoy
export const JUEVES_9H = new Date('2026-11-12T08:00:00.000Z');

// Los tipos de aviso de cada pestaña del panel. Los de gastos son de la UT1018: aquí solo sirven
// para comprobar que no se cuelan entre los de tareas
export const TIPOS_DE_TAREAS = [
  'task_assigned',
  'task_due_soon',
  'swap_requested',
  'swap_accepted',
  'swap_rejected',
];
export const TIPOS_DE_GASTOS = [
  'expense_added',
  'expense_updated',
  'expense_deleted',
  'payment_marked',
  'payment_confirmed',
  'payment_rejected',
];

// Solo se falsea Date; los temporizadores de supertest siguen reales (como en availability.spec.ts)
const SOLO_DATE = {
  doNotFake: [
    'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame',
    'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate',
    'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
  ],
} as const;

export const TOKENS: Record<string, string> = {
  [ANA]: 'token-de-ana',
  [BETO]: 'token-de-beto',
  [CARLA]: 'token-de-carla',
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
const nuevaAsignacion = (
  id: string,
  task_id: string,
  user_id: string,
  dia: string,
  due_time: string,
  status = 'pending',
) => ({
  id,
  task_id,
  user_id,
  status,
  due_date: new Date(`${dia}T00:00:00.000Z`),
  start_minute: 540,
  due_time,
});

// Tarea A de Ana a las 10:00, Tarea B de Beto a las 18:00 y Tarea C de Carla a las 12:00.
// «Limpiar el baño» todavía no la tiene nadie
export function sembrar() {
  db.cargar({
    User: [
      nuevoUsuario(ANA, 'Ana García'),
      nuevoUsuario(BETO, 'Beto Ruiz'),
      nuevoUsuario(CARLA, 'Carla Gómez'),
      nuevoUsuario(DANI, 'Dani Pérez'),
    ],
    Apartment: [nuevoPiso(PISO, 'Calle Mayor'), nuevoPiso(OTRO_PISO, 'Calle Luna')],
    UserApartment: [
      { user_id: ANA, apartment_id: PISO },
      { user_id: BETO, apartment_id: PISO },
      { user_id: CARLA, apartment_id: PISO },
      { user_id: DANI, apartment_id: OTRO_PISO },
    ],
    Task: [
      nuevaTarea(TAREA_A, PISO, 'Fregar los platos'),
      nuevaTarea(TAREA_B, PISO, 'Sacar la basura'),
      nuevaTarea(TAREA_C, PISO, 'Barrer el salón'),
      nuevaTarea(TAREA_LIBRE, PISO, 'Limpiar el baño'),
      nuevaTarea(TAREA_X, OTRO_PISO, 'Regar las plantas'),
    ],
    TaskAssignment: [
      nuevaAsignacion(ASIG_A, TAREA_A, ANA, JUEVES, '10:00'),
      nuevaAsignacion(ASIG_B, TAREA_B, BETO, JUEVES, '18:00'),
      nuevaAsignacion(ASIG_C, TAREA_C, CARLA, JUEVES, '12:00'),
      nuevaAsignacion(ASIG_X, TAREA_X, DANI, JUEVES, '10:00'),
    ],
  });
}

// Otra tarea del piso ya asignada, para los casos de los recordatorios
export function otraTareaDe(usuario: string, titulo: string, dia: string, hora: string, status = 'pending') {
  const tarea = randomUUID();
  db.filasDe('Task').push(nuevaTarea(tarea, PISO, titulo));
  db.filasDe('TaskAssignment').push(nuevaAsignacion(randomUUID(), tarea, usuario, dia, hora, status));
}

// Un aviso ya guardado, como si el evento hubiera ocurrido antes
export function avisoGuardado(datos: Fila & { user_id: string }) {
  const fila: Fila = {
    id: randomUUID(),
    apartment_id: PISO,
    type: 'task_assigned',
    title: 'Nueva tarea asignada',
    body: 'Beto Ruiz te ha asignado «Fregar los platos» para el 12 nov a las 10:00.',
    reference_id: TAREA_A,
    assignment_id: null,
    is_read: false,
    created_at: new Date('2026-11-09T08:00:00.000Z'),
    ...datos,
  };
  db.filasDe('Notification').push(fila);
  return fila as Fila & { id: string };
}

// Un aviso de gastos (UT1018) ya guardado, del mismo piso
export function avisoDeGastos(user_id: string, type: string, datos: Fila = {}) {
  return avisoGuardado({
    user_id,
    type,
    title: 'Aviso de cobro',
    body: 'Beto Ruiz solicita 15,00 € por la compra.',
    reference_id: randomUUID(),
    ...datos,
  });
}

export const avisosGuardados = () => db.filasDe('Notification');
export const avisoEnBaseDeDatos = (id: string) => avisosGuardados().find((aviso) => aviso.id === id);

export type Aviso = {
  id: string;
  type: string;
  title: string;
  body: string;
  reference_id: string | null;
  is_read: boolean;
  created_at: string;
};
export type Respuesta = { status: number; body: unknown };

export function exito(respuesta: Respuesta) {
  if (respuesta.status >= 300) {
    throw new Error(`Se esperaba 2xx y llegó HTTP ${respuesta.status}: ${JSON.stringify(respuesta.body)}`);
  }
}

const auth = {
  userIdForToken: jest.fn((token: string) => Promise.resolve(USUARIO_DEL_TOKEN[token] ?? null)),
};

// Al asignar y al pedir un intercambio se comprueba la disponibilidad; Google no trae eventos
const google = { sync: jest.fn(() => Promise.resolve()) };

// El mismo middleware que usa AppModule: cada petición va como el usuario de su token
@Module({
  controllers: [TasksController, NotificationsController],
  providers: [
    TasksService,
    TaskSwapsService,
    NotificationsService,
    AuthMiddleware,
    { provide: PrismaService, useValue: db.prisma },
    { provide: AuthService, useValue: auth },
    { provide: GoogleCalendarService, useValue: google },
  ],
})
class ModuloDePrueba implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}

// Se llama una vez al principio del describe de cada spec: levanta la app, deja los datos de
// partida antes de cada test con el reloj en MARTES_9H, y devuelve las peticiones de cada usuario
export function prepararNotificaciones() {
  let app: INestApplication<App>;
  const zonaHorariaOriginal = process.env.CALENDAR_TIME_ZONE;

  beforeAll(async () => {
    process.env.CALENDAR_TIME_ZONE = 'Europe/Madrid';
    const module = await Test.createTestingModule({ imports: [ModuloDePrueba] }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (zonaHorariaOriginal === undefined) delete process.env.CALENDAR_TIME_ZONE;
    else process.env.CALENDAR_TIME_ZONE = zonaHorariaOriginal;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ doNotFake: [...SOLO_DATE.doNotFake], now: MARTES_9H });
    sembrar();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const servidor = () => request(app.getHttpServer());

  const como = (usuario: string) => {
    const autorizacion = `Bearer ${TOKENS[usuario]}`;
    return {
      get: (url: string) => servidor().get(url).set('Authorization', autorizacion),
      post: (url: string, body: object = {}) =>
        servidor().post(url).set('Authorization', autorizacion).send(body),
      patch: (url: string) => servidor().patch(url).set('Authorization', autorizacion),
      delete: (url: string) => servidor().delete(url).set('Authorization', autorizacion),
    };
  };

  async function avisosDe(usuario: string, piso = PISO, opciones = '') {
    const respuesta = await como(usuario).get(`/notifications?apartment_id=${piso}${opciones}`);
    exito(respuesta);
    return respuesta.body as Aviso[];
  }

  async function sinLeerDe(usuario: string, piso = PISO, opciones = '') {
    const respuesta = await como(usuario).get(`/notifications/unread-count?apartment_id=${piso}${opciones}`);
    exito(respuesta);
    return (respuesta.body as { count: number }).count;
  }

  const marcarLeido = (usuario: string, id: string) => como(usuario).patch(`/notifications/${id}/read`);

  const asignar = (usuario: string, tarea: string, personas: string[], dia = VIERNES, hora = '16:00') =>
    como(usuario).post(`/tasks/${tarea}/assignments`, { user_ids: personas, due_date: dia, due_time: hora });

  async function solicitudDeAnaABeto() {
    const respuesta = await como(ANA).post('/tasks/swap-requests', {
      from_assignment_id: ASIG_A,
      to_assignment_id: ASIG_B,
    });
    exito(respuesta);
    return (respuesta.body as { id: string }).id;
  }
  const aceptar = (usuario: string, id: string) => como(usuario).post(`/tasks/swap-requests/${id}/accept`);
  const rechazar = (usuario: string, id: string) => como(usuario).post(`/tasks/swap-requests/${id}/reject`);
  const cancelar = (usuario: string, id: string) => como(usuario).delete(`/tasks/swap-requests/${id}`);

  return {
    // Peticiones sin token o con uno que no vale
    servidor,
    como,
    avisosDe,
    sinLeerDe,
    marcarLeido,
    asignar,
    solicitudDeAnaABeto,
    aceptar,
    rechazar,
    cancelar,
  };
}
