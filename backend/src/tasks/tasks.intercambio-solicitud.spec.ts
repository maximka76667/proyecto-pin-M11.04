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
import { TaskSwapsService } from './task-swaps.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

// UT1010 · intercambio (swap) de tareas: pedir el cambio a un compañero (PA-1010.01) y el
// rechazo por falta de disponibilidad (PA-1010.04). Aceptar, rechazar y cancelar una
// solicitud están en tasks.intercambio-respuesta.spec.ts.
//
// Se prueba por HTTP con los servicios de verdad (TasksService y TaskSwapsService) y el
// AuthMiddleware real, para que cada petición vaya como Ana, Beto o Carla según su token.
// La base de datos es el Prisma en memoria de test/prisma-en-memoria.ts, que lee schema.prisma.

const db = crearPrismaEnMemoria();

const PISO = 'a0a0a0a0-0000-4000-8000-000000000001';
const OTRO_PISO = 'a0a0a0a0-0000-4000-8000-000000000002';

// Usuario A (emisor), Usuario B (receptor), otra compañera del piso y alguien de otro piso.
// Ninguno es el USER_ID de desarrollo: así cada petición va de verdad con su token
const ANA = 'a1a1a1a1-1111-4111-8111-111111111111';
const BETO = 'b2b2b2b2-2222-4222-8222-222222222222';
const CARLA = 'c3c3c3c3-3333-4333-8333-333333333333';
const DANI = 'd4d4d4d4-4444-4444-8444-444444444444';

const TAREA_A = 'e0e0e0e0-0000-4000-8000-00000000000a';
const TAREA_B = 'e0e0e0e0-0000-4000-8000-00000000000b';
const TAREA_C = 'e0e0e0e0-0000-4000-8000-00000000000c';
const TAREA_X = 'e0e0e0e0-0000-4000-8000-00000000000d';
const TAREA_EXTRA = 'e0e0e0e0-0000-4000-8000-00000000000e';

const ASIG_A = 'f0f0f0f0-0000-4000-8000-00000000000a';
const ASIG_B = 'f0f0f0f0-0000-4000-8000-00000000000b';
const ASIG_C = 'f0f0f0f0-0000-4000-8000-00000000000c';
const ASIG_X = 'f0f0f0f0-0000-4000-8000-00000000000d';
const ASIG_EXTRA = 'f0f0f0f0-0000-4000-8000-00000000000e';

// Jueves 12 de noviembre de 2026; las horas son de Madrid (UTC+1 en noviembre)
const DIA = new Date('2026-11-12T00:00:00.000Z');
const enMadrid = (hora: string) => new Date(`2026-11-12T${hora}:00+01:00`);
const minutos = (hora: string) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));

const TOKENS: Record<string, string> = {
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
      nuevaTarea(TAREA_X, OTRO_PISO, 'Regar las plantas'),
    ],
    TaskAssignment: [
      nuevaAsignacion(ASIG_A, TAREA_A, ANA, '10:00'),
      nuevaAsignacion(ASIG_B, TAREA_B, BETO, '18:00'),
      nuevaAsignacion(ASIG_C, TAREA_C, CARLA, '12:00'),
      nuevaAsignacion(ASIG_X, TAREA_X, DANI, '10:00'),
    ],
  });
}

function eventoDeGoogle(usuario: string, desde: string, hasta: string) {
  db.filasDe('GoogleBusyBlock').push({
    id: `evento-${randomUUID()}`,
    user_id: usuario,
    event_date: new Date(DIA),
    start_at: enMadrid(desde),
    end_at: enMadrid(hasta),
    title: null,
  });
}

function ocupadoLosJueves(usuario: string, desde: string, hasta: string) {
  db.filasDe('AvailabilityBlock').push({
    id: randomUUID(),
    user_id: usuario,
    day_of_week: 'thursday',
    start_minute: minutos(desde),
    end_minute: minutos(hasta),
    label: null,
  });
}

function otraTareaDe(usuario: string, hora: string) {
  db.filasDe('Task').push(nuevaTarea(TAREA_EXTRA, PISO, 'Poner la lavadora'));
  db.filasDe('TaskAssignment').push(nuevaAsignacion(ASIG_EXTRA, TAREA_EXTRA, usuario, hora));
}

function quitarDelPiso(usuario: string, piso: string) {
  const miembros = db.filasDe('UserApartment');
  miembros.splice(
    miembros.findIndex((m) => m.user_id === usuario && m.apartment_id === piso),
    1,
  );
}

const solicitudes = () => db.filasDe('TaskSwapRequest');
const asignacionGuardada = (id: string) => db.filasDe('TaskAssignment').find((a) => a.id === id);
const tareaGuardada = (id: string) => db.filasDe('Task').find((t) => t.id === id);

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

const google = {
  sync: jest.fn((_usuario: string, _desde: string, _hasta: string) => Promise.resolve()),
};

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

describe('UT1010 · Solicitud de intercambio (POST /tasks/swap-requests)', () => {
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
    sembrar();
    google.sync.mockImplementation(() => Promise.resolve());
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

  async function solicitudDeAnaABeto() {
    const respuesta = await pedirCambio(ANA, ASIG_A, ASIG_B);
    exito(respuesta);
    return (respuesta.body as { id: string }).id;
  }

  async function candidatasPara(usuario: string) {
    const respuesta = await como(usuario).get(`/tasks/swap-requests/candidates?apartment_id=${PISO}`);
    exito(respuesta);
    return respuesta.body as Array<{
      id: string;
      user: { full_name: string };
      task: { title: string };
    }>;
  }

  // PA-1010.01: Solicitud de intercambio (swap) a un compañero válido
  describe('PA-1010.01 · solicitud de intercambio a un compañero válido', () => {
    it('la lista para elegir trae las tareas asignadas de los compañeros del piso, con su nombre', async () => {
      const candidatas = await candidatasPara(ANA);

      expect(candidatas).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: ASIG_B,
            user: expect.objectContaining({ full_name: 'Beto Ruiz' }),
            task: expect.objectContaining({ title: 'Sacar la basura' }),
          }),
          expect.objectContaining({
            id: ASIG_C,
            user: expect.objectContaining({ full_name: 'Carla Gómez' }),
          }),
        ]),
      );
      // Ni las suyas ni las de otro piso
      expect(candidatas.map((c) => c.id)).not.toContain(ASIG_A);
      expect(candidatas.map((c) => c.id)).not.toContain(ASIG_X);
    });

    it('crea una solicitud bidireccional: guarda a los dos usuarios y las dos tareas', async () => {
      exito(await pedirCambio(ANA, ASIG_A, ASIG_B));

      expect(solicitudes()).toEqual([
        expect.objectContaining({
          apartment_id: PISO,
          from_user_id: ANA,
          to_user_id: BETO,
          from_assignment_id: ASIG_A,
          to_assignment_id: ASIG_B,
        }),
      ]);
    });

    it('con las dos tareas a la misma hora, el horario es compatible: cada uno deja libre la suya', async () => {
      asignacionGuardada(ASIG_B)!.due_time = '10:00';

      exito(await pedirCambio(ANA, ASIG_A, ASIG_B));

      expect(solicitudes()).toHaveLength(1);
    });

    it('un evento de Google ese día que no se solapa con la otra tarea no impide el cambio', async () => {
      eventoDeGoogle(BETO, '12:00', '13:00');
      eventoDeGoogle(ANA, '08:00', '09:00');

      exito(await pedirCambio(ANA, ASIG_A, ASIG_B));

      expect(solicitudes()).toHaveLength(1);
    });

    it('mientras se decide, las dos tareas no salen para elegir ni entran en otro intercambio', async () => {
      await solicitudDeAnaABeto();

      const ids = (await candidatasPara(CARLA)).map((c) => c.id);
      expect(ids).not.toContain(ASIG_A);
      expect(ids).not.toContain(ASIG_B);
      rechazo(await pedirCambio(CARLA, ASIG_C, ASIG_B));
      expect(solicitudes()).toHaveLength(1);
    });

    it('Ana y Beto ven la solicitud con las dos tareas, para que la app las marque como «Swap pendiente»', async () => {
      const id = await solicitudDeAnaABeto();

      for (const usuario of [ANA, BETO]) {
        const respuesta = await como(usuario).get(`/tasks/swap-requests?apartment_id=${PISO}`);
        exito(respuesta);
        expect(respuesta.body).toEqual([
          expect.objectContaining({
            id,
            from_assignment: expect.objectContaining({ id: ASIG_A }),
            to_assignment: expect.objectContaining({ id: ASIG_B }),
          }),
        ]);
      }
    });

    // La PA-1010.05 habla de «bloqueo visual y de sistema»: la marca de la app no basta
    describe('las tareas quedan bloqueadas mientras se decide', () => {
      it('no se puede quitar la asignación de ninguna de las dos', async () => {
        await solicitudDeAnaABeto();

        rechazo(await como(ANA).delete(`/tasks/assignments/${ASIG_A}`));
        rechazo(await como(CARLA).delete(`/tasks/assignments/${ASIG_B}`));
        expect(asignacionGuardada(ASIG_A)).toBeDefined();
        expect(asignacionGuardada(ASIG_B)).toBeDefined();
        expect(solicitudes()).toHaveLength(1);
      });

      it('no se puede editar ninguna de las dos tareas', async () => {
        await solicitudDeAnaABeto();

        rechazo(await como(ANA).patch(`/tasks/${TAREA_A}`, { duration_minutes: 60 }));
        rechazo(await como(BETO).patch(`/tasks/${TAREA_B}`, { title: 'Bajar la basura' }));
        expect(tareaGuardada(TAREA_A)?.duration_minutes).toBe(30);
        expect(tareaGuardada(TAREA_B)?.title).toBe('Sacar la basura');
      });

      it('no se puede borrar ninguna de las dos tareas', async () => {
        await solicitudDeAnaABeto();

        rechazo(await como(ANA).delete(`/tasks/${TAREA_A}`));
        rechazo(await como(BETO).delete(`/tasks/${TAREA_B}`));
        expect(tareaGuardada(TAREA_A)).toBeDefined();
        expect(tareaGuardada(TAREA_B)).toBeDefined();
        expect(solicitudes()).toHaveLength(1);
      });
    });

    // Observación: el piso del usuario destino tiene que ser el mismo que el del origen
    describe('solo entre compañeros del mismo piso', () => {
      it('no deja pedir una tarea de otro piso', async () => {
        rechazo(await pedirCambio(ANA, ASIG_A, ASIG_X));

        expect(solicitudes()).toHaveLength(0);
      });

      it('no deja pedir la tarea de alguien que ya no vive en el piso', async () => {
        quitarDelPiso(BETO, PISO);

        rechazo(await pedirCambio(ANA, ASIG_A, ASIG_B));

        expect(solicitudes()).toHaveLength(0);
      });

      it('no deja ofrecer una tarea que no es tuya', async () => {
        rechazo(await pedirCambio(ANA, ASIG_B, ASIG_C));

        expect(solicitudes()).toHaveLength(0);
      });
    });
  });

  // PA-1010.04: Intento de swap rechazado por falta de disponibilidad horaria
  describe('PA-1010.04 · intento de swap sin disponibilidad horaria', () => {
    const AVISO_BETO_SIN_HUECO =
      'No se puede solicitar el cambio. Beto Ruiz no tiene disponibilidad en su calendario para realizar tu tarea';

    it.each<[string, () => void]>([
      ['un evento de Google Calendar', () => eventoDeGoogle(BETO, '09:30', '11:00')],
      ['esa franja ocupada en su disponibilidad semanal', () => ocupadoLosJueves(BETO, '09:00', '12:00')],
      ['otra tarea que se solapa', () => otraTareaDe(BETO, '10:15')],
    ])('Beto tiene a la hora de la tarea de Ana %s: se rechaza y no se crea la solicitud', async (_motivo, ocupar) => {
      ocupar();

      rechazo(await pedirCambio(ANA, ASIG_A, ASIG_B));

      expect(solicitudes()).toHaveLength(0);
    });

    it('viceversa: Ana no tiene hueco para la tarea de Beto: se rechaza y no se crea la solicitud', async () => {
      eventoDeGoogle(ANA, '17:30', '19:00');

      rechazo(await pedirCambio(ANA, ASIG_A, ASIG_B));

      expect(solicitudes()).toHaveLength(0);
    });

    it(`avisa con «${AVISO_BETO_SIN_HUECO}»`, async () => {
      eventoDeGoogle(BETO, '09:30', '11:00');

      const respuesta = await pedirCambio(ANA, ASIG_A, ASIG_B);

      rechazo(respuesta);
      expect((respuesta.body as { message?: unknown }).message).toBe(AVISO_BETO_SIN_HUECO);
    });

    it('viceversa: el aviso empieza por «No se puede solicitar el cambio.» y no culpa a Beto', async () => {
      eventoDeGoogle(ANA, '17:30', '19:00');

      const respuesta = await pedirCambio(ANA, ASIG_A, ASIG_B);

      rechazo(respuesta);
      const mensaje = (respuesta.body as { message?: unknown }).message;
      expect(mensaje).toMatch(/^No se puede solicitar el cambio\./);
      expect(mensaje).not.toContain('Beto Ruiz no tiene disponibilidad');
    });

    // Los eventos de Google solo se guardan cuando cada uno abre la app. Al asignar una tarea se
    // trae antes el calendario de ese día (syncGoogleCalendars) y el cambio tiene que hacer lo mismo
    it('trae el calendario de Google de los dos antes de decidir, como al asignar una tarea', async () => {
      google.sync.mockImplementation((usuario: string) => {
        if (usuario === BETO && db.filasDe('GoogleBusyBlock').length === 0) {
          eventoDeGoogle(BETO, '09:30', '11:00');
        }
        return Promise.resolve();
      });

      rechazo(await pedirCambio(ANA, ASIG_A, ASIG_B));

      expect(solicitudes()).toHaveLength(0);
    });

    it('una tarea que empieza justo cuando acaba la clase de Beto también choca (misma regla que al asignar, PA-1524.03)', async () => {
      eventoDeGoogle(BETO, '09:00', '10:00');

      rechazo(await pedirCambio(ANA, ASIG_A, ASIG_B));

      expect(solicitudes()).toHaveLength(0);
    });
  });
});
