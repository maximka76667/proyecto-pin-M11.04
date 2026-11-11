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
import { crearPrismaEnMemoria, type Fila } from '../../test/prisma-en-memoria';
import { configureApp } from '../app.setup';
import { AuthMiddleware } from '../auth/auth.middleware';
import { AuthService } from '../auth/auth.service';
import { GoogleCalendarService } from '../availability/google-calendar.service';
import { PrismaService } from '../prisma/prisma.service';
import { TaskSwapsService } from './task-swaps.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

// UT1010 · intercambio (swap) de tareas: qué pasa con una solicitud pendiente. El receptor la
// acepta (PA-1010.02) o la rechaza (PA-1010.03), o el emisor la cancela (PA-1010.05). Cómo se
// pide el cambio está en tasks.intercambio-solicitud.spec.ts.
//
// Se prueba por HTTP con los servicios de verdad (TasksService y TaskSwapsService) y el
// AuthMiddleware real, para que cada petición vaya como Ana, Beto o Carla según su token.
// La base de datos es el Prisma en memoria de test/prisma-en-memoria.ts, que lee schema.prisma.
//
// Supuestos:
// - PA-1010.02: la solicitud aceptada se guarda con una columna `status` que vale
//   «completada» (o «completed», si el enum va en inglés como el resto del esquema).
// - En las pruebas de «a la vez», la solicitud desaparece en cuanto el servicio la toca (justo
//   después de leerla o justo antes de cambiarla o borrarla), como si la otra persona la hubiera
//   resuelto en ese momento. Así vale tanto si el código la lee antes como si no.

const db = crearPrismaEnMemoria();

const PISO = 'a0a0a0a0-0000-4000-8000-000000000001';

// Usuario A (emisor), Usuario B (receptor) y otra compañera del piso.
// Ninguno es el USER_ID de desarrollo: así cada petición va de verdad con su token
const ANA = 'a1a1a1a1-1111-4111-8111-111111111111';
const BETO = 'b2b2b2b2-2222-4222-8222-222222222222';
const CARLA = 'c3c3c3c3-3333-4333-8333-333333333333';

const TAREA_A = 'e0e0e0e0-0000-4000-8000-00000000000a';
const TAREA_B = 'e0e0e0e0-0000-4000-8000-00000000000b';
const TAREA_C = 'e0e0e0e0-0000-4000-8000-00000000000c';

const ASIG_A = 'f0f0f0f0-0000-4000-8000-00000000000a';
const ASIG_B = 'f0f0f0f0-0000-4000-8000-00000000000b';
const ASIG_C = 'f0f0f0f0-0000-4000-8000-00000000000c';

// Jueves 12 de noviembre de 2026
const DIA = new Date('2026-11-12T00:00:00.000Z');

const TOKENS: Record<string, string> = {
  [ANA]: 'token-de-ana',
  [BETO]: 'token-de-beto',
  [CARLA]: 'token-de-carla',
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
const nuevaTarea = (id: string, title: string) => ({
  id,
  apartment_id: PISO,
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
  due_date: new Date(DIA),
  start_minute: 540,
  due_time,
});

// Tarea A de Ana a las 10:00 y Tarea B de Beto a las 18:00: los dos tienen hueco para la otra
function sembrar() {
  db.cargar({
    User: [
      nuevoUsuario(ANA, 'Ana García'),
      nuevoUsuario(BETO, 'Beto Ruiz'),
      nuevoUsuario(CARLA, 'Carla Gómez'),
    ],
    Apartment: [
      { id: PISO, address: 'Calle Mayor, 1', name: 'Calle Mayor', invite_code: randomUUID(), landlord_id: null },
    ],
    UserApartment: [
      { user_id: ANA, apartment_id: PISO },
      { user_id: BETO, apartment_id: PISO },
      { user_id: CARLA, apartment_id: PISO },
    ],
    Task: [
      nuevaTarea(TAREA_A, 'Fregar los platos'),
      nuevaTarea(TAREA_B, 'Sacar la basura'),
      nuevaTarea(TAREA_C, 'Barrer el salón'),
    ],
    TaskAssignment: [
      nuevaAsignacion(ASIG_A, TAREA_A, ANA, '10:00'),
      nuevaAsignacion(ASIG_B, TAREA_B, BETO, '18:00'),
      nuevaAsignacion(ASIG_C, TAREA_C, CARLA, '12:00'),
    ],
  });
}

// Simula que la otra persona resuelve la solicitud en el mismo momento: desaparece en cuanto el
// servicio la lee o va a cambiarla
function desapareceAlTocarla(id: string) {
  db.alTocar((modelo, fila) => {
    if (modelo !== 'TaskSwapRequest' || fila.id !== id) return;
    db.alTocar(undefined);
    const filas = db.filasDe('TaskSwapRequest');
    filas.splice(filas.indexOf(fila), 1);
  });
}

const solicitudGuardada = (id: string): Fila | undefined =>
  db.filasDe('TaskSwapRequest').find((s) => s.id === id);
const asignacionGuardada = (id: string) => db.filasDe('TaskAssignment').find((a) => a.id === id);
const duenoDe = (asignacion: string) => asignacionGuardada(asignacion)?.user_id;

const COMPLETADA = /^(completada|completed)$/i;
const RECHAZADA = /^(rechazada|rejected)$/i;
const textoDe = (valor: unknown) => (typeof valor === 'string' ? valor : undefined);

// Pendiente según su estado: sin columna de estado, o con un estado que no es de resuelta
const pendienteSegunEstado = (estado: unknown) =>
  !/complet|rechaz|reject|cancel|acept|accept/i.test(textoDe(estado) ?? '');

// Sigue ahí y nadie la ha resuelto (con o sin columna de estado)
function sigueSinResolver(id: string) {
  const fila = solicitudGuardada(id);
  return fila !== undefined && pendienteSegunEstado(fila.status);
}

function duenosOriginales() {
  expect(duenoDe(ASIG_A)).toBe(ANA);
  expect(duenoDe(ASIG_B)).toBe(BETO);
}

type Respuesta = { status: number; body: unknown };

function exito(respuesta: Respuesta) {
  if (respuesta.status >= 300) {
    throw new Error(`Se esperaba 2xx y llegó HTTP ${respuesta.status}: ${JSON.stringify(respuesta.body)}`);
  }
}

// La PA no fija el código: basta con que se rechace (4xx) y no sea un error del servidor
function rechazo(respuesta: Respuesta) {
  if (respuesta.status < 400 || respuesta.status >= 500) {
    throw new Error(`Se esperaba un rechazo 4xx y llegó HTTP ${respuesta.status}: ${JSON.stringify(respuesta.body)}`);
  }
}

const auth = {
  userIdForToken: jest.fn((token: string) => Promise.resolve(USUARIO_DEL_TOKEN[token] ?? null)),
};

// Al aceptar se vuelve a comprobar la disponibilidad; Google no trae eventos nuevos
const google = { sync: jest.fn(() => Promise.resolve()) };

// El mismo middleware que usa AppModule: cada petición va como el usuario de su token
@Module({
  controllers: [TasksController],
  providers: [
    TasksService,
    TaskSwapsService,
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

describe('UT1010 · Respuesta a una solicitud de intercambio', () => {
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
    db.alTocar(undefined);
  });

  const como = (usuario: string) => {
    const autorizacion = `Bearer ${TOKENS[usuario]}`;
    const servidor = () => request(app.getHttpServer());
    return {
      get: (url: string) => servidor().get(url).set('Authorization', autorizacion),
      post: (url: string, body: object = {}) =>
        servidor().post(url).set('Authorization', autorizacion).send(body),
      patch: (url: string, body: object) =>
        servidor().patch(url).set('Authorization', autorizacion).send(body),
      delete: (url: string) => servidor().delete(url).set('Authorization', autorizacion),
    };
  };

  const pedirCambio = (usuario: string, deLaTarea: string, porLaTarea: string) =>
    como(usuario).post('/tasks/swap-requests', {
      from_assignment_id: deLaTarea,
      to_assignment_id: porLaTarea,
    });
  const aceptar = (usuario: string, id: string) =>
    como(usuario).post(`/tasks/swap-requests/${id}/accept`);
  const rechazar = (usuario: string, id: string) =>
    como(usuario).post(`/tasks/swap-requests/${id}/reject`);
  const cancelar = (usuario: string, id: string) =>
    como(usuario).delete(`/tasks/swap-requests/${id}`);

  async function solicitudDeAnaABeto() {
    const respuesta = await pedirCambio(ANA, ASIG_A, ASIG_B);
    exito(respuesta);
    return (respuesta.body as { id: string }).id;
  }

  async function candidatasPara(usuario: string) {
    const respuesta = await como(usuario).get(`/tasks/swap-requests/candidates?apartment_id=${PISO}`);
    exito(respuesta);
    return (respuesta.body as Array<{ id: string }>).map((c) => c.id);
  }

  // PA-1010.02: Aceptación de la solicitud de intercambio por el compañero receptor
  describe('PA-1010.02 · aceptación del intercambio por el receptor', () => {
    it('Beto acepta: la Tarea A pasa a Beto y la Tarea B a Ana, cada una con su día y su hora', async () => {
      const id = await solicitudDeAnaABeto();

      exito(await aceptar(BETO, id));

      expect(asignacionGuardada(ASIG_A)).toEqual(
        expect.objectContaining({ user_id: BETO, due_date: DIA, due_time: '10:00' }),
      );
      expect(asignacionGuardada(ASIG_B)).toEqual(
        expect.objectContaining({ user_id: ANA, due_date: DIA, due_time: '18:00' }),
      );
    });

    it('la lista de tareas del piso refleja el cambio', async () => {
      const id = await solicitudDeAnaABeto();
      exito(await aceptar(BETO, id));

      const respuesta = await como(BETO).get(`/tasks?apartment_id=${PISO}`);

      exito(respuesta);
      const tareas = respuesta.body as Array<{ id: string; assignments: Array<{ user_id: string }> }>;
      expect(tareas.find((t) => t.id === TAREA_A)?.assignments.map((a) => a.user_id)).toEqual([BETO]);
      expect(tareas.find((t) => t.id === TAREA_B)?.assignments.map((a) => a.user_id)).toEqual([ANA]);
    });

    it('con las dos tareas a la misma hora también se intercambian, sin chocar con la restricción única', async () => {
      asignacionGuardada(ASIG_B)!.due_time = '10:00';
      const id = await solicitudDeAnaABeto();

      exito(await aceptar(BETO, id));

      expect(asignacionGuardada(ASIG_A)).toEqual(expect.objectContaining({ user_id: BETO, due_time: '10:00' }));
      expect(asignacionGuardada(ASIG_B)).toEqual(expect.objectContaining({ user_id: ANA, due_time: '10:00' }));
    });

    it('la solicitud queda guardada como «completada», no se borra', async () => {
      const id = await solicitudDeAnaABeto();

      exito(await aceptar(BETO, id));

      expect(textoDe(solicitudGuardada(id)?.status)).toMatch(COMPLETADA);
    });

    it('Ana ve en sus solicitudes que Beto aceptó: de ahí sale su aviso de aceptación', async () => {
      const id = await solicitudDeAnaABeto();
      exito(await aceptar(BETO, id));

      const respuesta = await como(ANA).get(`/tasks/swap-requests?apartment_id=${PISO}`);

      exito(respuesta);
      const suya = (respuesta.body as Array<{ id: string; status?: unknown }>).find((s) => s.id === id);
      expect(textoDe(suya?.status)).toMatch(COMPLETADA);
    });

    it('solo Beto puede aceptarla: ni Ana ni Carla, y no cambia nada', async () => {
      const id = await solicitudDeAnaABeto();

      rechazo(await aceptar(ANA, id));
      rechazo(await aceptar(CARLA, id));

      duenosOriginales();
      expect(sigueSinResolver(id)).toBe(true);
    });

    it('una solicitud ya aceptada no se puede aceptar otra vez (no se deshace el cambio)', async () => {
      const id = await solicitudDeAnaABeto();
      exito(await aceptar(BETO, id));

      rechazo(await aceptar(BETO, id));

      expect(duenoDe(ASIG_A)).toBe(BETO);
      expect(duenoDe(ASIG_B)).toBe(ANA);
    });

    // Observación: el cambio de dueños y la resolución de la solicitud van en una transacción
    describe('todo o nada, en una transacción', () => {
      it('si Ana cancela justo a la vez, no queda ningún cambio a medias', async () => {
        const id = await solicitudDeAnaABeto();
        desapareceAlTocarla(id);

        await aceptar(BETO, id);

        duenosOriginales();
        expect(asignacionGuardada(ASIG_A)?.due_time).toBe('10:00');
        expect(asignacionGuardada(ASIG_B)?.due_time).toBe('18:00');
      });

      it('y en ese caso responde que la solicitud ya no está pendiente (4xx), no con un error 500', async () => {
        const id = await solicitudDeAnaABeto();
        desapareceAlTocarla(id);

        rechazo(await aceptar(BETO, id));
      });
    });

    // Hoy la solicitud aceptada se borra. Si se guarda como «completada» (lo que pide esta PA),
    // no puede seguir contando como pendiente: las tareas quedarían marcadas y bloqueadas para
    // siempre. Ojo también con schema.prisma: from_assignment_id es @unique, así que una tarea
    // solo podría ofrecerse una vez en toda su vida (cambiarlo exige una migración)
    describe('después de aceptar, las tareas no se quedan bloqueadas', () => {
      it('vuelven a salir para elegir y ninguna solicitud figura ya como pendiente', async () => {
        const id = await solicitudDeAnaABeto();
        exito(await aceptar(BETO, id));

        expect(await candidatasPara(CARLA)).toEqual(expect.arrayContaining([ASIG_A, ASIG_B]));
        const respuesta = await como(BETO).get(`/tasks/swap-requests?apartment_id=${PISO}`);
        exito(respuesta);
        const pendientes = (respuesta.body as Array<{ id: string; status?: unknown }>).filter((s) =>
          pendienteSegunEstado(s.status),
        );
        expect(pendientes).toEqual([]);
      });

      it('se pueden volver a intercambiar: Beto puede proponer deshacer el cambio con la misma tarea', async () => {
        const id = await solicitudDeAnaABeto();
        exito(await aceptar(BETO, id));

        // La Tarea A ya es de Beto y la B de Ana: Beto ofrece la A a cambio de la B
        const nueva = await pedirCambio(BETO, ASIG_A, ASIG_B);

        exito(nueva);
        expect(sigueSinResolver((nueva.body as { id: string }).id)).toBe(true);
      });
    });
  });

  // PA-1010.03: Rechazo de la solicitud de intercambio por el compañero receptor
  describe('PA-1010.03 · rechazo del intercambio por el receptor', () => {
    it('Beto rechaza: cada tarea sigue con su dueño', async () => {
      const id = await solicitudDeAnaABeto();

      exito(await rechazar(BETO, id));

      duenosOriginales();
    });

    it('la solicitud se borra o queda marcada como «rechazada»', async () => {
      const id = await solicitudDeAnaABeto();

      exito(await rechazar(BETO, id));

      const fila = solicitudGuardada(id);
      expect(fila === undefined || RECHAZADA.test(textoDe(fila.status) ?? '')).toBe(true);
    });

    it('las tareas recuperan su flujo normal: se pueden editar y volver a pedir', async () => {
      const id = await solicitudDeAnaABeto();
      exito(await rechazar(BETO, id));

      exito(await como(ANA).patch(`/tasks/${TAREA_A}`, { description: 'Con agua caliente' }));
      expect(await candidatasPara(CARLA)).toEqual(expect.arrayContaining([ASIG_A, ASIG_B]));
      exito(await pedirCambio(ANA, ASIG_A, ASIG_B));
    });

    it('solo Beto puede rechazarla: ni Ana ni Carla', async () => {
      const id = await solicitudDeAnaABeto();

      rechazo(await rechazar(ANA, id));
      rechazo(await rechazar(CARLA, id));

      expect(sigueSinResolver(id)).toBe(true);
    });

    it('rechazar una solicitud que ya no está pendiente se rechaza y no toca nada', async () => {
      const id = await solicitudDeAnaABeto();
      exito(await cancelar(ANA, id));

      rechazo(await rechazar(BETO, id));

      duenosOriginales();
    });
  });

  // PA-1010.05: Cancelación de la solicitud de intercambio por el usuario emisor
  describe('PA-1010.05 · cancelación de la solicitud por el emisor', () => {
    it('Ana cancela: la solicitud se borra de la base de datos y las tareas siguen con sus dueños', async () => {
      const id = await solicitudDeAnaABeto();

      exito(await cancelar(ANA, id));

      expect(solicitudGuardada(id)).toBeUndefined();
      duenosOriginales();
    });

    it('las dos tareas pierden el bloqueo: se pueden editar y volver a pedir', async () => {
      const id = await solicitudDeAnaABeto();
      exito(await cancelar(ANA, id));

      exito(await como(ANA).patch(`/tasks/${TAREA_A}`, { description: 'Con agua caliente' }));
      expect(await candidatasPara(CARLA)).toEqual(expect.arrayContaining([ASIG_A, ASIG_B]));
      exito(await pedirCambio(ANA, ASIG_A, ASIG_B));
    });

    it('solo Ana puede cancelarla: ni Beto ni Carla', async () => {
      const id = await solicitudDeAnaABeto();

      rechazo(await cancelar(BETO, id));
      rechazo(await cancelar(CARLA, id));

      expect(sigueSinResolver(id)).toBe(true);
    });

    it('no cancela una solicitud que Beto ya aceptó: el intercambio se mantiene', async () => {
      const id = await solicitudDeAnaABeto();
      exito(await aceptar(BETO, id));

      rechazo(await cancelar(ANA, id));

      expect(duenoDe(ASIG_A)).toBe(BETO);
      expect(duenoDe(ASIG_B)).toBe(ANA);
    });

    it('no cancela una solicitud que Beto ya rechazó', async () => {
      const id = await solicitudDeAnaABeto();
      exito(await rechazar(BETO, id));

      rechazo(await cancelar(ANA, id));

      duenosOriginales();
    });

    it('si Beto la acepta justo a la vez, responde que ya no está pendiente (4xx), no con un error 500', async () => {
      const id = await solicitudDeAnaABeto();
      desapareceAlTocarla(id);

      rechazo(await cancelar(ANA, id));
    });
  });
});
