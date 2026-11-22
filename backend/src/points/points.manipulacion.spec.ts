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
import { crearPrismaEnMemoria } from '../../test/prisma-en-memoria';
import { configureApp } from '../app.setup';
import { AuthMiddleware } from '../auth/auth.middleware';
import { AuthService } from '../auth/auth.service';
import { GoogleCalendarService } from '../availability/google-calendar.service';
import { PrismaService } from '../prisma/prisma.service';
import { TaskSwapsService } from '../tasks/task-swaps.service';
import { TaskVerificationsController } from '../tasks/task-verifications.controller';
import { TaskVerificationsService } from '../tasks/task-verifications.service';
import { TasksController } from '../tasks/tasks.controller';
import { TasksService } from '../tasks/tasks.service';
import { PointsController } from './points.controller';
import { monthKey, PointsService } from './points.service';

// Sistema de reputación · intentos de manipular los puntos con peticiones a mano.
//
// Los puntos no son un saldo editable: son las filas del ledger TaskPoints, y solo se crean al
// completar una asignación propia con el valor de la tarea. Se prueba por HTTP con los
// servicios y el AuthMiddleware de verdad, y el Prisma en memoria de test/prisma-en-memoria.ts.

const db = crearPrismaEnMemoria();

const PISO = 'a0a0a0a0-0000-4000-8000-000000000001';
const ANA = 'a1a1a1a1-1111-4111-8111-111111111111';
const BETO = 'b2b2b2b2-2222-4222-8222-222222222222';

const TAREA_ANA = 'e0e0e0e0-0000-4000-8000-00000000000a';
const TAREA_BETO = 'e0e0e0e0-0000-4000-8000-00000000000b';
const ASIG_ANA = 'f0f0f0f0-0000-4000-8000-00000000000a';
const ASIG_BETO = 'f0f0f0f0-0000-4000-8000-00000000000b';

const PUNTOS_TAREA = 30;
const DIA = new Date('2026-11-12T00:00:00.000Z');

const TOKENS: Record<string, string> = { [ANA]: 'token-de-ana', [BETO]: 'token-de-beto' };
const USUARIO_DEL_TOKEN = Object.fromEntries(Object.entries(TOKENS).map(([id, token]) => [token, id]));

const nuevoUsuario = (id: string, full_name: string) => ({
  id,
  email: `${full_name.toLowerCase()}@ejemplo.com`,
  full_name,
  is_landlord: false,
  password_hash: null,
  google_subject: null,
});
const nuevaTarea = (id: string, title: string) => ({
  id,
  apartment_id: PISO,
  title,
  description: null,
  duration_minutes: 30,
  points: PUNTOS_TAREA,
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
  due_date: new Date(DIA),
  start_minute: 540,
  due_time,
});

function sembrar() {
  db.cargar({
    User: [nuevoUsuario(ANA, 'Ana'), nuevoUsuario(BETO, 'Beto')],
    Apartment: [
      {
        id: PISO,
        address: 'Calle Mayor, 1',
        name: 'Calle Mayor',
        invite_code: randomUUID(),
        landlord_id: null,
      },
    ],
    UserApartment: [
      { user_id: ANA, apartment_id: PISO },
      { user_id: BETO, apartment_id: PISO },
    ],
    Task: [nuevaTarea(TAREA_ANA, 'Fregar los platos'), nuevaTarea(TAREA_BETO, 'Sacar la basura')],
    TaskAssignment: [
      nuevaAsignacion(ASIG_ANA, TAREA_ANA, ANA, '10:00'),
      nuevaAsignacion(ASIG_BETO, TAREA_BETO, BETO, '18:00'),
    ],
  });
}

const ledger = () => db.filasDe('TaskPoints');
const asignacionGuardada = (id: string) => db.filasDe('TaskAssignment').find((a) => a.id === id);
const tareaGuardada = (id: string) => db.filasDe('Task').find((t) => t.id === id);

const auth = {
  userIdForToken: jest.fn((token: string) => Promise.resolve(USUARIO_DEL_TOKEN[token] ?? null)),
};
const google = { sync: jest.fn(() => Promise.resolve()) };

@Module({
  controllers: [TaskVerificationsController, TasksController, PointsController],
  providers: [
    TasksService,
    TaskSwapsService,
    TaskVerificationsService,
    PointsService,
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

describe('Puntos · intentos de manipular los puntos con peticiones a mano', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [ModuloDePrueba] }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    sembrar();
  });

  const como = (usuario: string) => {
    const autorizacion = `Bearer ${TOKENS[usuario]}`;
    const servidor = () => request(app.getHttpServer());
    return {
      patch: (url: string, body: object = {}) =>
        servidor().patch(url).set('Authorization', autorizacion).send(body),
      send: (metodo: 'post' | 'put' | 'patch' | 'delete', url: string, body: object = {}) =>
        servidor()[metodo](url).set('Authorization', autorizacion).send(body),
    };
  };

  const completar = (usuario: string, asignacion: string, body: object = {}) =>
    como(usuario).patch(`/points/assignments/${asignacion}/complete`, body);

  it('rechaza con 403 completar la tarea de otro miembro y no crea puntos', async () => {
    const respuesta = await completar(ANA, ASIG_BETO);

    expect(respuesta.status).toBe(403);
    expect(ledger()).toHaveLength(0);
    expect(asignacionGuardada(ASIG_BETO)?.status).toBe('pending');
  });

  it.each([
    ['points', { points: 9999 }],
    ['user_id', { user_id: BETO }],
    ['points_balance', { points_balance: 500 }],
    ['varios campos a la vez', { points: 9999, user_id: BETO, month: '2020-01' }],
  ])('rechaza con 400 un cuerpo con %s al completar y no crea puntos', async (_nombre, body) => {
    const respuesta = await completar(ANA, ASIG_ANA, body);

    expect(respuesta.status).toBe(400);
    expect(ledger()).toHaveLength(0);
    expect(asignacionGuardada(ASIG_ANA)?.status).toBe('pending');
  });

  it('rechaza con 400 un id de asignación que no es un UUID', async () => {
    const respuesta = await completar(ANA, 'no-es-un-uuid');

    expect(respuesta.status).toBe(400);
    expect(ledger()).toHaveLength(0);
  });

  it('da 404 si la asignación no existe', async () => {
    const respuesta = await completar(ANA, 'f0f0f0f0-0000-4000-8000-0000000000ff');

    expect(respuesta.status).toBe(404);
    expect(ledger()).toHaveLength(0);
  });

  // Con más de una persona en el piso, los puntos solo llegan cuando OTRO miembro confirma la tarea
  const enviarAVerificar = (usuario: string, asignacion: string) =>
    como(usuario).send('post', `/tasks/assignments/${asignacion}/submit`);
  const verificar = (usuario: string, asignacion: string) =>
    como(usuario).send('post', `/tasks/assignments/${asignacion}/verify`);

  it('el atajo de completar con puntos está cerrado si hay más miembros: 409 y sin puntos', async () => {
    const respuesta = await completar(ANA, ASIG_ANA);

    expect(respuesta.status).toBe(409);
    expect(ledger()).toHaveLength(0);
    expect(asignacionGuardada(ASIG_ANA)?.status).toBe('pending');
  });

  it('marcar la tarea como hecha no da puntos: queda esperando a que otro la verifique', async () => {
    const respuesta = await enviarAVerificar(ANA, ASIG_ANA);

    expect(respuesta.status).toBe(201);
    expect(respuesta.body).toMatchObject({ status: 'waiting_verification' });
    expect(asignacionGuardada(ASIG_ANA)).toMatchObject({
      status: 'waiting_verification',
      verifier_id: BETO, // el único otro miembro: nunca ella misma
    });
    expect(ledger()).toHaveLength(0);
  });

  it('quien hizo la tarea no puede verificarla él mismo', async () => {
    await enviarAVerificar(ANA, ASIG_ANA);

    const respuesta = await verificar(ANA, ASIG_ANA);

    expect(respuesta.status).toBe(403);
    expect(ledger()).toHaveLength(0);
    expect(asignacionGuardada(ASIG_ANA)?.status).toBe('waiting_verification');
  });

  it('al confirmar el verificador se dan exactamente los puntos de la tarea, y solo a quien la hizo', async () => {
    await enviarAVerificar(ANA, ASIG_ANA);

    const respuesta = await verificar(BETO, ASIG_ANA);

    expect(respuesta.status).toBe(201);
    expect(respuesta.body).toEqual({ status: 'completed' });
    expect(ledger()).toHaveLength(1);
    expect(ledger()[0]).toMatchObject({
      user_id: ANA, // los puntos son de quien hizo la tarea, no del verificador
      apartment_id: PISO,
      assignment_id: ASIG_ANA,
      points: PUNTOS_TAREA,
      month: monthKey(new Date()),
    });
  });

  it('si el verificador rechaza, no hay puntos y la tarea vuelve a quien la hizo con el motivo', async () => {
    await enviarAVerificar(ANA, ASIG_ANA);

    const respuesta = await como(BETO).send('post', `/tasks/assignments/${ASIG_ANA}/reject`, {
      reason: 'Quedó a medias',
    });

    expect(respuesta.status).toBe(201);
    expect(ledger()).toHaveLength(0);
    expect(asignacionGuardada(ASIG_ANA)).toMatchObject({
      status: 'pending',
      user_id: ANA, // sigue siendo suya
      rejection_reason: 'Quedó a medias',
    });
  });

  it('confirmar dos veces la misma tarea no suma dos veces', async () => {
    await enviarAVerificar(ANA, ASIG_ANA);
    await verificar(BETO, ASIG_ANA);
    const segunda = await verificar(BETO, ASIG_ANA);
    const atajo = await completar(ANA, ASIG_ANA);

    expect(segunda.status).toBe(409);
    expect(atajo.status).toBe(200);
    expect(atajo.body).toMatchObject({ points: 0 });
    expect(ledger()).toHaveLength(1);
  });

  it('cambiar después el valor de la tarea no altera los puntos ya ganados', async () => {
    await enviarAVerificar(ANA, ASIG_ANA);
    await verificar(BETO, ASIG_ANA);

    const edicion = await como(ANA).patch(`/tasks/${TAREA_ANA}`, { points: 500 });

    expect(edicion.status).toBe(200);
    expect(tareaGuardada(TAREA_ANA)?.points).toBe(500);
    expect(ledger()).toHaveLength(1);
    expect(ledger()[0].points).toBe(PUNTOS_TAREA);
  });

  it('no se pueden cambiar los puntos de una tarea mientras espera verificación: 409 y se paga lo que vio el verificador', async () => {
    await enviarAVerificar(ANA, ASIG_ANA);

    const edicion = await como(ANA).patch(`/tasks/${TAREA_ANA}`, { points: 500 });
    await verificar(BETO, ASIG_ANA);

    expect(edicion.status).toBe(409);
    expect(tareaGuardada(TAREA_ANA)?.points).toBe(PUNTOS_TAREA);
    expect(ledger()).toHaveLength(1);
    expect(ledger()[0].points).toBe(PUNTOS_TAREA);
  });

  it('mientras espera verificación se puede editar el resto de la tarea, aunque se reenvíen los mismos puntos', async () => {
    await enviarAVerificar(ANA, ASIG_ANA);

    const edicion = await como(ANA).patch(`/tasks/${TAREA_ANA}`, {
      title: 'Fregar los platos y la cocina',
      points: PUNTOS_TAREA,
    });

    expect(edicion.status).toBe(200);
    expect(tareaGuardada(TAREA_ANA)?.title).toBe('Fregar los platos y la cocina');
  });

  it('si el verificador rechaza, los puntos de la tarea vuelven a poder cambiarse', async () => {
    await enviarAVerificar(ANA, ASIG_ANA);
    await como(BETO).send('post', `/tasks/assignments/${ASIG_ANA}/reject`, { reason: 'Quedó a medias' });

    const edicion = await como(ANA).patch(`/tasks/${TAREA_ANA}`, { points: 500 });

    expect(edicion.status).toBe(200);
    expect(tareaGuardada(TAREA_ANA)?.points).toBe(500);
  });

  it('en un piso de una sola persona se completa directamente y da los puntos', async () => {
    await db.prisma.userApartment.deleteMany({ where: { user_id: BETO } }); // Ana se queda sola

    const respuesta = await enviarAVerificar(ANA, ASIG_ANA);

    expect(respuesta.status).toBe(201);
    expect(respuesta.body).toMatchObject({ status: 'completed' });
    expect(ledger()).toHaveLength(1);
    expect(ledger()[0]).toMatchObject({ user_id: ANA, points: PUNTOS_TAREA });
  });

  it.each([
    ['points_balance', { points_balance: 500 }],
    ['user_id', { user_id: BETO }],
    ['total_points', { total_points: 9999 }],
  ])('PATCH /tasks/:id rechaza con 400 el campo %s y no crea puntos', async (_nombre, body) => {
    const respuesta = await como(ANA).patch(`/tasks/${TAREA_ANA}`, body);

    expect(respuesta.status).toBe(400);
    expect(ledger()).toHaveLength(0);
  });

  it('no existe ningún endpoint para editar o borrar puntos directamente', async () => {
    const rutas = ['/points', '/points/balance', `/points/users/${BETO}`, '/points/ranking'];
    const metodos = ['post', 'put', 'patch', 'delete'] as const;

    for (const ruta of rutas) {
      for (const metodo of metodos) {
        const respuesta = await como(ANA).send(metodo, ruta, { points: 9999 });
        expect(respuesta.status).toBe(404);
      }
    }
    expect(ledger()).toHaveLength(0);
  });
});
