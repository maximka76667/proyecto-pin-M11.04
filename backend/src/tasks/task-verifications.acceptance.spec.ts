import { randomUUID } from 'node:crypto';
import {
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { crearPrismaEnMemoria, type Fila } from '../../test/prisma-en-memoria';
import { configureApp } from '../app.setup';
import { AuthMiddleware } from '../auth/auth.middleware';
import { AuthService } from '../auth/auth.service';
import { NotificationsListener } from '../notifications/notifications.listener';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { TaskVerificationsController } from './task-verifications.controller';
import { TaskVerificationsService } from './task-verifications.service';

// Pruebas de aceptación de la UT 1021 (sistema de verificación de tareas), PA-1021.01 a .09.
//
// Cada describe sigue las CONDICIONES, PASOS y RESULTADO del PA tal como están escritos, no lo
// que hace hoy el código: una prueba en rojo es una diferencia real con el PA (o una decisión de
// producto pendiente). Por HTTP, con el servicio y el AuthMiddleware de verdad y el Prisma en
// memoria de test/prisma-en-memoria.ts.

const db = crearPrismaEnMemoria();

const PISO = 'a0a0a0a0-0000-4000-8000-000000000001';
const OTRA_CASA = 'a0a0a0a0-0000-4000-8000-000000000002';

// A hace la tarea; B y C son sus compañeros de casa; X vive en otra casa
const A = 'a1a1a1a1-1111-4111-8111-111111111111';
const B = 'b2b2b2b2-2222-4222-8222-222222222222';
const C = 'c3c3c3c3-3333-4333-8333-333333333333';
const X = 'd4d4d4d4-4444-4444-8444-444444444444';

const TAREA_A = 'e0e0e0e0-0000-4000-8000-00000000000a';
const TAREA_B = 'e0e0e0e0-0000-4000-8000-00000000000b';
const ASIG_A = 'f0f0f0f0-0000-4000-8000-00000000000a';
const ASIG_B = 'f0f0f0f0-0000-4000-8000-00000000000b';

const PUNTOS = 30;
const HORA = 3_600_000;

const TOKENS: Record<string, string> = {
  [A]: 'token-a',
  [B]: 'token-b',
  [C]: 'token-c',
  [X]: 'token-x',
};
const USUARIO_DEL_TOKEN = Object.fromEntries(Object.entries(TOKENS).map(([id, token]) => [token, id]));

const nuevoUsuario = (id: string, full_name: string) => ({
  id,
  email: `${full_name.toLowerCase()}@ejemplo.com`,
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
const nuevaTarea = (id: string, title: string, over: Fila = {}) => ({
  id,
  apartment_id: PISO,
  title,
  description: null,
  duration_minutes: 30,
  points: PUNTOS,
  status: 'assigned',
  category: 'cleaning',
  priority: 'medium',
  frequency: 'none',
  ...over,
});
const nuevaAsignacion = (id: string, task_id: string, user_id: string, due_time: string, over: Fila = {}) => ({
  id,
  task_id,
  user_id,
  status: 'pending',
  due_date: new Date('2026-11-12T00:00:00.000Z'),
  start_minute: 540,
  due_time,
  verifier_id: null,
  verification_deadline: null,
  rejection_reason: null,
  ...over,
});

// La tarea de A está pendiente; la de B (otro compañero) también. `asignacion` y `tarea`
// permiten sobrescribir lo que cada PA necesita en sus CONDICIONES
function sembrar(asignacion: Fila = {}, tarea: Fila = {}) {
  db.cargar({
    User: [nuevoUsuario(A, 'Ana'), nuevoUsuario(B, 'Beto'), nuevoUsuario(C, 'Carla'), nuevoUsuario(X, 'Xavi')],
    Apartment: [nuevoPiso(PISO, 'Calle Mayor'), nuevoPiso(OTRA_CASA, 'Calle Luna')],
    UserApartment: [
      { user_id: A, apartment_id: PISO },
      { user_id: B, apartment_id: PISO },
      { user_id: C, apartment_id: PISO },
      { user_id: X, apartment_id: OTRA_CASA },
    ],
    Task: [nuevaTarea(TAREA_A, 'Limpiar el baño', tarea), nuevaTarea(TAREA_B, 'Sacar la basura')],
    TaskAssignment: [
      nuevaAsignacion(ASIG_A, TAREA_A, A, '10:00', asignacion),
      nuevaAsignacion(ASIG_B, TAREA_B, B, '18:00'),
    ],
  });
}

// "pendiente_verificacion" con C como verificador y plazo vigente
const enVerificacionConC = (over: Fila = {}): Fila => ({
  status: 'waiting_verification',
  verifier_id: C,
  verification_deadline: new Date(Date.now() + 24 * HORA),
  ...over,
});

const ledger = () => db.filasDe('TaskPoints');
const asignacion = (id: string) => db.filasDe('TaskAssignment').find((a) => a.id === id);
const avisosDe = (id: string) =>
  db
    .filasDe('Notification')
    .filter((aviso) => aviso.assignment_id === id || aviso.reference_id === id);

const auth = {
  userIdForToken: jest.fn((token: string) => Promise.resolve(USUARIO_DEL_TOKEN[token] ?? null)),
};

@Module({
  imports: [EventEmitterModule.forRoot()],
  controllers: [TaskVerificationsController],
  providers: [
    TaskVerificationsService,
    NotificationsService,
    NotificationsListener,
    AuthMiddleware,
    { provide: PrismaService, useValue: db.prisma },
    { provide: AuthService, useValue: auth },
  ],
})
class ModuloDePrueba implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}

describe('UT 1021 · Sistema de verificación de tareas (pruebas de aceptación)', () => {
  let app: INestApplication<App>;
  let servicio: TaskVerificationsService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [ModuloDePrueba] }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    servicio = module.get(TaskVerificationsService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    sembrar();
  });

  const como = (usuario: string) => ({
    post: (url: string, body: object = {}) =>
      request(app.getHttpServer()).post(url).set('Authorization', `Bearer ${TOKENS[usuario]}`).send(body),
  });
  const marcarHecha = (usuario: string, id = ASIG_A, body: object = {}) =>
    como(usuario).post(`/tasks/assignments/${id}/submit`, body);
  const confirmar = (usuario: string, id = ASIG_A) => como(usuario).post(`/tasks/assignments/${id}/verify`);
  const rechazar = (usuario: string, id = ASIG_A, body: object = { reason: 'El baño no está limpio' }) =>
    como(usuario).post(`/tasks/assignments/${id}/reject`, body);

  describe('PA-1021.01 · Marcar tarea como hecha y asignar verificador aleatorio (flujo ideal)', () => {
    // CONDICIONES: A vive con al menos otros dos miembros (B y C) y tiene una tarea "pendiente"

    it('la tarea pasa a "pendiente de verificación"', async () => {
      const respuesta = await marcarHecha(A);

      expect(respuesta.status).toBe(201);
      expect(asignacion(ASIG_A)?.status).toBe('waiting_verification');
    });

    it('el verificador se elige entre los demás miembros de la casa, nunca es A ni alguien de fuera', async () => {
      const elegidos = new Set<unknown>();
      for (let intento = 0; intento < 25; intento++) {
        sembrar();
        await marcarHecha(A);
        elegidos.add(asignacion(ASIG_A)?.verifier_id);
      }

      expect([...elegidos].every((id) => id === B || id === C)).toBe(true);
    });

    it('se crea una única solicitud de revisión, con el verificador elegido', async () => {
      await marcarHecha(A);

      const enRevision = db.filasDe('TaskAssignment').filter((a) => a.status === 'waiting_verification');
      expect(enRevision).toHaveLength(1);
      expect([B, C]).toContain(enRevision[0].verifier_id);
    });

    it('el cliente no puede indicar quién verifica', async () => {
      const respuesta = await marcarHecha(A, ASIG_A, { verifier_id: A });

      // Se rechaza el campo (400) o se ignora, pero nunca se obedece
      if (respuesta.status < 300) {
        expect(asignacion(ASIG_A)?.verifier_id).not.toBe(A);
      } else {
        expect(respuesta.status).toBe(400);
        expect(asignacion(ASIG_A)?.status).toBe('pending');
      }
    });

    it('solo el verificador elegido recibe un aviso; el otro compañero y A no reciben nada', async () => {
      await marcarHecha(A);

      const verificador = asignacion(ASIG_A)?.verifier_id;
      const otro = verificador === B ? C : B;
      const avisos = avisosDe(ASIG_A);
      expect(avisos.filter((aviso) => aviso.user_id === verificador)).toHaveLength(1);
      expect(avisos.filter((aviso) => aviso.user_id === otro)).toHaveLength(0);
      expect(avisos.filter((aviso) => aviso.user_id === A)).toHaveLength(0);
    });
  });

  describe('PA-1021.02 · Confirmación por el verificador asignado (tarea completada)', () => {
    // CONDICIONES: la tarea está "pendiente de verificación" con la solicitud a nombre de C
    beforeEach(() => sembrar(enVerificacionConC()));

    it('el estado pasa a "completada" y A la ve completada', async () => {
      const respuesta = await confirmar(C);

      expect(respuesta.status).toBe(201);
      expect(asignacion(ASIG_A)?.status).toBe('completed');
    });

    it.todo('se registra la fecha de finalización');

    it('la solicitud queda confirmada con el id de C', async () => {
      await confirmar(C);

      expect(asignacion(ASIG_A)?.verifier_id).toBe(C);
    });

    it('los puntos de la tarea se suman a A, no al verificador', async () => {
      await confirmar(C);

      expect(ledger()).toHaveLength(1);
      expect(ledger()[0]).toMatchObject({ user_id: A, assignment_id: ASIG_A, points: PUNTOS });
    });

    it('el cambio de estado y la suma de puntos van en la misma transacción: si fallan los puntos, no cambia nada', async () => {
      (db.prisma.taskPoints.create as unknown as jest.Mock).mockRejectedValueOnce(new Error('fallo al guardar los puntos'));

      const respuesta = await confirmar(C);

      expect(respuesta.status).toBe(500);
      expect(asignacion(ASIG_A)?.status).toBe('waiting_verification');
      expect(ledger()).toHaveLength(0);
    });
  });

  describe('PA-1021.03 · Rechazo por el verificador asignado (tarea devuelta a pendiente)', () => {
    beforeEach(() => sembrar(enVerificacionConC()));

    it('vuelve a "pendiente", sigue asignada a A y se guarda el motivo', async () => {
      const respuesta = await rechazar(C, ASIG_A, { reason: 'El baño no está limpio' });

      expect(respuesta.status).toBe(201);
      expect(asignacion(ASIG_A)).toMatchObject({
        status: 'pending',
        user_id: A,
        rejection_reason: 'El baño no está limpio',
      });
    });

    it('no se suman puntos', async () => {
      await rechazar(C);

      expect(ledger()).toHaveLength(0);
    });

    it('el motivo es obligatorio: sin él da 400 y la tarea sigue en verificación', async () => {
      const respuesta = await rechazar(C, ASIG_A, {});

      expect(respuesta.status).toBe(400);
      expect(asignacion(ASIG_A)?.status).toBe('waiting_verification');
      expect(ledger()).toHaveLength(0);
    });

    it('A recibe un aviso con el motivo del rechazo', async () => {
      await rechazar(C, ASIG_A, { reason: 'El baño no está limpio' });

      const avisosDeA = avisosDe(ASIG_A).filter((aviso) => aviso.user_id === A);
      expect(avisosDeA).toHaveLength(1);
      expect(String(avisosDeA[0].body)).toContain('El baño no está limpio');
    });

    it('A puede volver a marcarla como hecha', async () => {
      await rechazar(C);

      const respuesta = await marcarHecha(A);

      expect(respuesta.status).toBe(201);
      expect(asignacion(ASIG_A)?.status).toBe('waiting_verification');
    });
  });

  describe('PA-1021.04 · Intento de marcar como hecha una tarea ajena', () => {
    // CONDICIONES: la tarea es de B; A está autenticado en la misma casa

    it('devuelve 403 y no modifica nada', async () => {
      const antes = { ...asignacion(ASIG_B) };

      const respuesta = await marcarHecha(A, ASIG_B);

      expect(respuesta.status).toBe(403);
      expect(asignacion(ASIG_B)).toEqual(antes);
      expect(ledger()).toHaveLength(0);
    });

    it('la comprobación usa el usuario del token, no uno enviado por el cliente', async () => {
      const respuesta = await marcarHecha(A, ASIG_B, { user_id: B });

      expect(respuesta.status).toBeGreaterThanOrEqual(400);
      expect(asignacion(ASIG_B)?.status).toBe('pending');
    });

  });

  describe('PA-1021.05 · Veredicto de un usuario que no es el verificador asignado', () => {
    // CONDICIONES: pendiente de verificación con C como verificador; B es de la misma casa
    beforeEach(() => sembrar(enVerificacionConC()));

    it('B no puede confirmar: 403, sin voto y sin cambio de estado', async () => {
      const respuesta = await confirmar(B);

      expect(respuesta.status).toBe(403);
      expect(asignacion(ASIG_A)).toMatchObject({ status: 'waiting_verification', verifier_id: C });
      expect(ledger()).toHaveLength(0);
    });

    it('B tampoco puede rechazar', async () => {
      const respuesta = await rechazar(B);

      expect(respuesta.status).toBe(403);
      expect(asignacion(ASIG_A)).toMatchObject({ status: 'waiting_verification', verifier_id: C });
    });

  });

  describe('PA-1021.06 · Veredicto de un usuario ajeno al hogar', () => {
    // CONDICIONES: tarea pendiente de verificación en la casa A; X pertenece a otra casa
    beforeEach(() => sembrar(enVerificacionConC()));

    it('X no puede confirmar: 403, sin voto y sin cambio de estado', async () => {
      const respuesta = await confirmar(X);

      expect(respuesta.status).toBe(403);
      expect(asignacion(ASIG_A)).toMatchObject({ status: 'waiting_verification', verifier_id: C });
      expect(ledger()).toHaveLength(0);
    });

    it('X tampoco puede rechazar', async () => {
      const respuesta = await rechazar(X);

      expect(respuesta.status).toBe(403);
      expect(asignacion(ASIG_A)?.status).toBe('waiting_verification');
    });

    it('X no puede marcar como hecha una tarea de la otra casa', async () => {
      sembrar();

      const respuesta = await marcarHecha(X);

      expect(respuesta.status).toBe(403);
      expect(asignacion(ASIG_A)?.status).toBe('pending');
    });
  });

  describe('PA-1021.07 · Segundo veredicto sobre una solicitud ya resuelta', () => {
    // CONDICIONES: la solicitud ya está confirmada y C todavía tiene la notificación abierta
    beforeEach(async () => {
      sembrar(enVerificacionConC());
      await confirmar(C);
    });

    it('confirmar otra vez da 409 y no suma puntos ni registra otro voto', async () => {
      const respuesta = await confirmar(C);

      expect(respuesta.status).toBe(409);
      expect(ledger()).toHaveLength(1);
      expect(asignacion(ASIG_A)?.status).toBe('completed');
    });

    it('rechazar una solicitud ya confirmada también da 409', async () => {
      const respuesta = await rechazar(C);

      expect(respuesta.status).toBe(409);
      expect(asignacion(ASIG_A)?.status).toBe('completed');
      expect(ledger()).toHaveLength(1);
    });

    it('dos confirmaciones a la vez: solo una prospera y los puntos se suman una vez (comprobación dentro de la transacción)', async () => {
      sembrar(enVerificacionConC());

      const [primera, segunda] = await Promise.all([confirmar(C), confirmar(C)]);

      expect([primera.status, segunda.status].sort()).toEqual([201, 409]);
      expect(ledger()).toHaveLength(1);
    });
  });

  describe('PA-1021.08 · El verificador no responde en el plazo (reasignación)', () => {
    // CONDICIONES: pendiente de verificación con C como verificador y el plazo ya pasado
    const caducada = () => sembrar(enVerificacionConC({ verification_deadline: new Date(Date.now() - HORA) }));
    beforeEach(caducada);

    // Caso 1: hay otro candidato (A, B y C en la casa) -> no se repite al que no respondió
    it('con otro candidato disponible, el nuevo verificador nunca es A ni C, el que no respondió', async () => {
      const elegidos = new Set<unknown>();
      for (let intento = 0; intento < 25; intento++) {
        caducada();
        await servicio.reassignExpired(PISO);
        elegidos.add(asignacion(ASIG_A)?.verifier_id);
      }

      expect([...elegidos]).toEqual([B]);
    });

    it('la tarea sigue pendiente de verificación y con un plazo nuevo', async () => {
      await servicio.reassignExpired(PISO);

      expect(asignacion(ASIG_A)?.status).toBe('waiting_verification');
      expect((asignacion(ASIG_A)?.verification_deadline as Date).getTime()).toBeGreaterThan(Date.now());
    });

    it('solo el nuevo verificador recibe un aviso; C, el que no respondió, no recibe otro', async () => {
      await servicio.reassignExpired(PISO);

      const avisos = avisosDe(ASIG_A);
      expect(avisos.filter((aviso) => aviso.user_id === B)).toHaveLength(1);
      expect(avisos.filter((aviso) => aviso.user_id === C)).toHaveLength(0);
    });

    it('el verificador que no respondió ya no puede confirmar', async () => {
      await servicio.reassignExpired(PISO);

      const respuesta = await confirmar(C);

      expect(respuesta.status).toBe(403);
      expect(ledger()).toHaveLength(0);
    });

    it('no reasigna si el plazo no ha vencido', async () => {
      sembrar(enVerificacionConC());

      const reasignadas = await servicio.reassignExpired(PISO);

      expect(reasignadas).toBe(0);
      expect(asignacion(ASIG_A)?.verifier_id).toBe(C);
    });

    // Caso 2: solo quedan A y C en la casa -> no hay otro candidato. Se queda C con un plazo
    // nuevo y A nunca verifica su propia tarea
    it('en una casa de dos, se queda con C con un plazo nuevo y nunca pasa a A', async () => {
      await db.prisma.userApartment.deleteMany({ where: { user_id: B } });

      await servicio.reassignExpired(PISO);

      expect(asignacion(ASIG_A)).toMatchObject({ status: 'waiting_verification', verifier_id: C });
      expect((asignacion(ASIG_A)?.verification_deadline as Date).getTime()).toBeGreaterThan(Date.now());
      expect(ledger()).toHaveLength(0);
    });
  });

  describe('PA-1021.09 · Acción sobre una tarea en estado no activo', () => {
    describe('la tarea ya está completada', () => {
      beforeEach(() => sembrar({ status: 'completed', verifier_id: C }));

      it('marcarla como hecha de nuevo da 409 y no modifica la base de datos', async () => {
        const antes = { ...asignacion(ASIG_A) };

        const respuesta = await marcarHecha(A);

        expect(respuesta.status).toBe(409);
        expect(asignacion(ASIG_A)).toEqual(antes);
        expect(ledger()).toHaveLength(0);
      });

      it('el verificador no puede confirmarla: 409 y sin cambios', async () => {
        const antes = { ...asignacion(ASIG_A) };

        const respuesta = await confirmar(C);

        expect(respuesta.status).toBe(409);
        expect(asignacion(ASIG_A)).toEqual(antes);
        expect(ledger()).toHaveLength(0);
      });

    });

    describe('la tarea ha sido anulada', () => {
      beforeEach(() => sembrar({}, { status: 'cancelled' }));

      it('no se puede marcar como hecha: 409 o 400, y sin cambios', async () => {
        const respuesta = await marcarHecha(A);

        expect([400, 409]).toContain(respuesta.status);
        expect(asignacion(ASIG_A)?.status).toBe('pending');
        expect(ledger()).toHaveLength(0);
      });
    });

    describe('la asignación fue rechazada', () => {
      beforeEach(() => sembrar({ status: 'rejected' }));

      it('no se puede marcar como hecha: 409 o 400, y sin cambios', async () => {
        const respuesta = await marcarHecha(A);

        expect([400, 409]).toContain(respuesta.status);
        expect(asignacion(ASIG_A)?.status).toBe('rejected');
      });
    });

    it('las transiciones permitidas son pendiente → en verificación → completada o pendiente', async () => {
      await marcarHecha(A);
      expect(asignacion(ASIG_A)?.status).toBe('waiting_verification');

      const verificador = String(asignacion(ASIG_A)?.verifier_id);
      await rechazar(verificador);
      expect(asignacion(ASIG_A)?.status).toBe('pending');

      await marcarHecha(A);
      const otroVerificador = String(asignacion(ASIG_A)?.verifier_id);
      await confirmar(otroVerificador);
      expect(asignacion(ASIG_A)?.status).toBe('completed');
      expect(ledger()).toHaveLength(1);
    });
  });
});
