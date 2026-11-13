import { randomUUID } from 'node:crypto';
import {
  INestApplication,
  Logger,
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
import { TaskSwapsService } from '../tasks/task-swaps.service';
import { TasksController } from '../tasks/tasks.controller';
import { TasksService } from '../tasks/tasks.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

// UT1019 · notificaciones de tareas: consultar los avisos (PA 2248-1), marcarlos como leídos,
// llegar desde el aviso a la solicitud de intercambio (PA 2250-1) y que nadie pueda tocar los
// avisos de otra persona.
//
// Se prueba por HTTP con los servicios de verdad (tareas, intercambios y notificaciones) y el
// AuthMiddleware real, para que cada petición vaya como Ana, Beto, Carla o Dani según su token.
// La base de datos es el Prisma en memoria de test/prisma-en-memoria.ts, que lee schema.prisma:
// así se comprueban también la restricción única de los recordatorios y el borrado en cascada.

const db = crearPrismaEnMemoria();

const PISO = 'a0a0a0a0-0000-4000-8000-000000000001';
const OTRO_PISO = 'a0a0a0a0-0000-4000-8000-000000000002';

// Ana, Beto y Carla viven en el piso; Dani, en otro.
// Ninguno es el USER_ID de desarrollo: así cada petición va de verdad con su token
const ANA = 'a1a1a1a1-1111-4111-8111-111111111111';
const BETO = 'b2b2b2b2-2222-4222-8222-222222222222';
const CARLA = 'c3c3c3c3-3333-4333-8333-333333333333';
const DANI = 'd4d4d4d4-4444-4444-8444-444444444444';

const TAREA_A = 'e0e0e0e0-0000-4000-8000-00000000000a';
const TAREA_B = 'e0e0e0e0-0000-4000-8000-00000000000b';
const TAREA_C = 'e0e0e0e0-0000-4000-8000-00000000000c';
const TAREA_LIBRE = 'e0e0e0e0-0000-4000-8000-00000000000d';
const TAREA_X = 'e0e0e0e0-0000-4000-8000-00000000000e';

const ASIG_A = 'f0f0f0f0-0000-4000-8000-00000000000a';
const ASIG_B = 'f0f0f0f0-0000-4000-8000-00000000000b';
const ASIG_C = 'f0f0f0f0-0000-4000-8000-00000000000c';
const ASIG_X = 'f0f0f0f0-0000-4000-8000-00000000000e';

// Las tareas son el jueves 12 de noviembre de 2026. Las horas son de Madrid (UTC+1 en noviembre)
const JUEVES = '2026-11-12';
const VIERNES = '2026-11-13';
// Dos días antes, a las 9:00: todavía no vence nada, así que no hay recordatorios por medio
const MARTES_9H = new Date('2026-11-10T08:00:00.000Z');
// El mismo jueves a las 9:00: la tarea de Ana (10:00) y la de Beto (18:00) vencen hoy
const JUEVES_9H = new Date('2026-11-12T08:00:00.000Z');

// Solo se falsea Date; los temporizadores de supertest siguen reales (como en availability.spec.ts)
const SOLO_DATE = {
  doNotFake: [
    'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame',
    'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate',
    'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
  ],
} as const;

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
function otraTareaDe(usuario: string, titulo: string, dia: string, hora: string, status = 'pending') {
  const tarea = randomUUID();
  db.filasDe('Task').push(nuevaTarea(tarea, PISO, titulo));
  db.filasDe('TaskAssignment').push(nuevaAsignacion(randomUUID(), tarea, usuario, dia, hora, status));
}

// Un aviso ya guardado, como si el evento hubiera ocurrido antes
function avisoGuardado(datos: Fila & { user_id: string }) {
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

const avisosGuardados = () => db.filasDe('Notification');
const avisoEnBaseDeDatos = (id: string) => avisosGuardados().find((aviso) => aviso.id === id);

type Aviso = {
  id: string;
  type: string;
  title: string;
  body: string;
  reference_id: string | null;
  is_read: boolean;
  created_at: string;
};
type Respuesta = { status: number; body: unknown };

function exito(respuesta: Respuesta) {
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

describe('UT1019 · Notificaciones de tareas', () => {
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

  const como = (usuario: string) => {
    const autorizacion = `Bearer ${TOKENS[usuario]}`;
    const servidor = () => request(app.getHttpServer());
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

  // PA 2248-1: Carga y visualización de notificaciones de tareas
  describe('PA 2248-1 · carga y visualización de notificaciones de tareas', () => {
    it('devuelve los avisos del usuario, del más reciente al más antiguo, y dice cuáles están leídos', async () => {
      const antiguo = avisoGuardado({
        user_id: ANA,
        is_read: true,
        created_at: new Date('2026-11-07T08:00:00.000Z'),
      });
      const reciente = avisoGuardado({
        user_id: ANA,
        type: 'swap_requested',
        title: 'Solicitud de intercambio',
        created_at: new Date('2026-11-10T07:55:00.000Z'),
      });
      const intermedio = avisoGuardado({
        user_id: ANA,
        type: 'swap_rejected',
        title: 'Intercambio rechazado',
        created_at: new Date('2026-11-09T08:00:00.000Z'),
      });

      const avisos = await avisosDe(ANA);

      expect(avisos.map((aviso) => aviso.id)).toEqual([reciente.id, intermedio.id, antiguo.id]);
      expect(avisos.map((aviso) => aviso.is_read)).toEqual([false, false, true]);
      expect(avisos.map((aviso) => aviso.type)).toEqual(['swap_requested', 'swap_rejected', 'task_assigned']);
    });

    it('cada aviso trae lo que la app necesita para pintarlo y saber a dónde lleva', async () => {
      const guardado = avisoGuardado({ user_id: ANA });

      const [aviso] = await avisosDe(ANA);

      expect(aviso).toEqual({
        id: guardado.id,
        type: 'task_assigned',
        title: 'Nueva tarea asignada',
        body: 'Beto Ruiz te ha asignado «Fregar los platos» para el 12 nov a las 10:00.',
        reference_id: TAREA_A,
        is_read: false,
        created_at: '2026-11-09T08:00:00.000Z',
      });
    });

    it('sin avisos devuelve una lista vacía y cero pendientes', async () => {
      expect(await avisosDe(ANA)).toEqual([]);
      expect(await sinLeerDe(ANA)).toBe(0);
    });

    it('el contador dice cuántos avisos quedan sin leer', async () => {
      avisoGuardado({ user_id: ANA });
      avisoGuardado({ user_id: ANA });
      avisoGuardado({ user_id: ANA, is_read: true });

      expect(await sinLeerDe(ANA)).toBe(2);
    });

    describe('tipos de avisos', () => {
      it('asignación: cuando Beto le asigna una tarea a Ana, ella recibe el aviso con quién, qué tarea, el día y la hora', async () => {
        exito(await asignar(BETO, TAREA_LIBRE, [ANA]));

        const avisos = await avisosDe(ANA);

        expect(avisos).toEqual([
          expect.objectContaining({
            type: 'task_assigned',
            is_read: false,
            reference_id: TAREA_LIBRE,
          }),
        ]);
        expect(avisos[0].body).toContain('Beto Ruiz');
        expect(avisos[0].body).toContain('Limpiar el baño');
        expect(avisos[0].body).toContain('13 nov');
        expect(avisos[0].body).toContain('16:00');
      });

      it('asignación a varios: avisa a cada persona asignada, menos a quien hace la asignación', async () => {
        exito(await asignar(BETO, TAREA_LIBRE, [BETO, CARLA, ANA]));

        expect(await avisosDe(BETO)).toEqual([]);
        expect(await avisosDe(CARLA)).toEqual([expect.objectContaining({ type: 'task_assigned' })]);
        expect(await avisosDe(ANA)).toEqual([expect.objectContaining({ type: 'task_assigned' })]);
      });

      it('respuesta a un intercambio: si Beto acepta, Ana recibe el aviso con la tarea que ahora le toca', async () => {
        const id = await solicitudDeAnaABeto();
        exito(await aceptar(BETO, id));

        const avisos = await avisosDe(ANA);

        expect(avisos).toEqual([expect.objectContaining({ type: 'swap_accepted', is_read: false })]);
        expect(avisos[0].body).toContain('Beto Ruiz');
        expect(avisos[0].body).toContain('Sacar la basura');
      });

      it('respuesta a un intercambio: si Beto rechaza, Ana recibe el aviso del rechazo', async () => {
        const id = await solicitudDeAnaABeto();
        exito(await rechazar(BETO, id));

        const avisos = await avisosDe(ANA);

        expect(avisos).toEqual([expect.objectContaining({ type: 'swap_rejected', is_read: false })]);
        expect(avisos[0].body).toContain('Beto Ruiz');
        expect(avisos[0].body).toContain('Fregar los platos');
      });

      it('si el aviso no se puede guardar, la tarea se asigna igual', async () => {
        const registro = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        db.prisma.notification.createMany.mockImplementationOnce(() => {
          throw new Error('la base de datos no responde');
        });

        const respuesta = await asignar(BETO, TAREA_LIBRE, [ANA]);

        exito(respuesta);
        expect(db.filasDe('TaskAssignment')).toContainEqual(
          expect.objectContaining({ task_id: TAREA_LIBRE, user_id: ANA }),
        );
        expect(avisosGuardados()).toEqual([]);
        expect(registro).toHaveBeenCalled();
        registro.mockRestore();
      });
    });

    // Vencimiento próximo: no hay ningún proceso programado, el aviso se crea al consultar
    describe('vencimiento próximo', () => {
      beforeEach(() => {
        jest.setSystemTime(JUEVES_9H);
      });

      it('una tarea que vence hoy más tarde genera el aviso «vence hoy a las 10:00»', async () => {
        const avisos = await avisosDe(ANA);

        expect(avisos).toEqual([
          expect.objectContaining({
            type: 'task_due_soon',
            body: '«Fregar los platos» vence hoy a las 10:00.',
            reference_id: TAREA_A,
            is_read: false,
          }),
        ]);
      });

      it('avisa solo de lo que vence en las próximas 24 horas', async () => {
        otraTareaDe(ANA, 'Poner la lavadora', JUEVES, '08:30'); // ya ha pasado
        otraTareaDe(ANA, 'Tender la ropa', VIERNES, '08:00'); // mañana, antes de esta hora
        otraTareaDe(ANA, 'Limpiar la nevera', VIERNES, '09:30'); // mañana, a más de 24 horas
        otraTareaDe(ANA, 'Bajar el vidrio', '2026-11-14', '08:00'); // pasado mañana
        otraTareaDe(ANA, 'Hacer la compra', JUEVES, '11:00', 'completed'); // ya está hecha

        const cuerpos = (await avisosDe(ANA)).map((aviso) => aviso.body).sort();

        expect(cuerpos).toEqual([
          '«Fregar los platos» vence hoy a las 10:00.',
          '«Tender la ropa» vence mañana a las 08:00.',
        ]);
      });

      it('no avisa a Ana de las tareas de sus compañeros ni de las de otro piso', async () => {
        await avisosDe(ANA);

        expect(avisosGuardados()).toEqual([
          expect.objectContaining({ user_id: ANA, assignment_id: ASIG_A }),
        ]);
      });

      it('cada tarea avisa una sola vez, aunque se consulte varias veces o a la vez', async () => {
        await avisosDe(ANA);
        await sinLeerDe(ANA);
        await Promise.all([avisosDe(ANA), sinLeerDe(ANA), avisosDe(ANA)]);

        expect(avisosGuardados()).toHaveLength(1);
        expect(await sinLeerDe(ANA)).toBe(1);
      });

      it('una tarea nueva que vence pronto se añade a los avisos sin repetir los que ya había', async () => {
        await avisosDe(ANA);
        otraTareaDe(ANA, 'Tender la ropa', JUEVES, '20:00');

        const cuerpos = (await avisosDe(ANA)).map((aviso) => aviso.body).sort();

        expect(cuerpos).toEqual([
          '«Fregar los platos» vence hoy a las 10:00.',
          '«Tender la ropa» vence hoy a las 20:00.',
        ]);
      });

      it('el contador también cuenta el recordatorio, sin haber abierto antes la lista', async () => {
        expect(await sinLeerDe(ANA)).toBe(1);
      });

      it('un recordatorio ya leído no vuelve a salir como nuevo', async () => {
        const [aviso] = await avisosDe(ANA);
        exito(await marcarLeido(ANA, aviso.id));

        expect(await avisosDe(ANA)).toEqual([expect.objectContaining({ id: aviso.id, is_read: true })]);
        expect(await sinLeerDe(ANA)).toBe(0);
      });

      it('con los recordatorios apagados en el perfil (reminders=false) no se crean ni se cuentan', async () => {
        expect(await avisosDe(ANA, PISO, '&reminders=false')).toEqual([]);
        expect(await sinLeerDe(ANA, PISO, '&reminders=false')).toBe(0);
        expect(avisosGuardados()).toEqual([]);
      });

      it('con los recordatorios apagados, los que ya existían se ocultan y el resto de avisos sigue saliendo', async () => {
        await avisosDe(ANA);
        const asignada = avisoGuardado({ user_id: ANA });

        expect(await avisosDe(ANA, PISO, '&reminders=false')).toEqual([
          expect.objectContaining({ id: asignada.id }),
        ]);
        expect(await sinLeerDe(ANA, PISO, '&reminders=false')).toBe(1);
        expect(await sinLeerDe(ANA)).toBe(2);
      });

      it('tras un intercambio aceptado, el recordatorio se va con la tarea a su nuevo dueño', async () => {
        await avisosDe(ANA);
        await avisosDe(BETO);
        const id = await solicitudDeAnaABeto();
        exito(await aceptar(BETO, id));

        const deAna = (await avisosDe(ANA)).filter((aviso) => aviso.type === 'task_due_soon');
        const deBeto = (await avisosDe(BETO)).filter((aviso) => aviso.type === 'task_due_soon');

        expect(deAna.map((aviso) => aviso.body)).toEqual(['«Sacar la basura» vence hoy a las 18:00.']);
        expect(deBeto.map((aviso) => aviso.body)).toEqual(['«Fregar los platos» vence hoy a las 10:00.']);
      });

      it('si se quita la asignación, sus avisos desaparecen con ella', async () => {
        await avisosDe(ANA);
        expect(avisosGuardados()).toHaveLength(1);

        exito(await como(BETO).delete(`/tasks/assignments/${ASIG_A}`));

        expect(await avisosDe(ANA)).toEqual([]);
      });
    });

    // Observación: la consulta lleva siempre el usuario y el piso activo en el WHERE
    describe('solo los avisos del usuario en su piso', () => {
      it('no salen los avisos de un compañero del mismo piso', async () => {
        avisoGuardado({ user_id: CARLA });
        const suyo = avisoGuardado({ user_id: ANA });

        expect((await avisosDe(ANA)).map((aviso) => aviso.id)).toEqual([suyo.id]);
        expect(await sinLeerDe(ANA)).toBe(1);
      });

      it('si vive en dos pisos, en cada uno ve solo los avisos de ese piso', async () => {
        db.filasDe('UserApartment').push({ user_id: ANA, apartment_id: OTRO_PISO });
        const delPiso = avisoGuardado({ user_id: ANA, apartment_id: PISO });
        const delOtro = avisoGuardado({ user_id: ANA, apartment_id: OTRO_PISO, reference_id: TAREA_X });

        expect((await avisosDe(ANA, PISO)).map((aviso) => aviso.id)).toEqual([delPiso.id]);
        expect((await avisosDe(ANA, OTRO_PISO)).map((aviso) => aviso.id)).toEqual([delOtro.id]);
        expect(await sinLeerDe(ANA, PISO)).toBe(1);
        expect(await sinLeerDe(ANA, OTRO_PISO)).toBe(1);
      });

      it('quien no vive en el piso no puede consultar sus avisos (403)', async () => {
        avisoGuardado({ user_id: ANA });

        const lista = await como(DANI).get(`/notifications?apartment_id=${PISO}`);
        const contador = await como(DANI).get(`/notifications/unread-count?apartment_id=${PISO}`);

        expect(lista.status).toBe(403);
        expect(contador.status).toBe(403);
      });

      it.each([
        ['sin apartment_id', ''],
        ['con un apartment_id que no es un UUID', '?apartment_id=mi-piso'],
        ['con un valor de reminders que no es true ni false', `?apartment_id=${PISO}&reminders=quizas`],
      ])('%s responde 400', async (_caso, consulta) => {
        const respuesta = await como(ANA).get(`/notifications${consulta}`);

        expect(respuesta.status).toBe(400);
      });

      it('sin una sesión válida responde 401', async () => {
        const respuesta = await request(app.getHttpServer())
          .get(`/notifications?apartment_id=${PISO}`)
          .set('Authorization', 'Bearer token-caducado');

        expect(respuesta.status).toBe(401);
      });
    });
  });

  // PA: Marcar un aviso de tarea como leído
  describe('PA · marcar un aviso de tarea como leído', () => {
    it('lo guarda como leído en la base de datos y devuelve el aviso ya leído', async () => {
      const guardado = avisoGuardado({ user_id: ANA });

      const respuesta = await marcarLeido(ANA, guardado.id);

      exito(respuesta);
      expect(respuesta.body).toEqual(expect.objectContaining({ id: guardado.id, is_read: true }));
      expect(avisoEnBaseDeDatos(guardado.id)?.is_read).toBe(true);
    });

    it('el contador de avisos pendientes baja en uno y los demás siguen sin leer', async () => {
      const uno = avisoGuardado({ user_id: ANA });
      const otro = avisoGuardado({ user_id: ANA });
      expect(await sinLeerDe(ANA)).toBe(2);

      exito(await marcarLeido(ANA, uno.id));

      expect(await sinLeerDe(ANA)).toBe(1);
      expect(avisoEnBaseDeDatos(otro.id)?.is_read).toBe(false);
    });

    it('en la lista pasa a salir como leído', async () => {
      const guardado = avisoGuardado({ user_id: ANA });

      exito(await marcarLeido(ANA, guardado.id));

      expect(await avisosDe(ANA)).toEqual([expect.objectContaining({ id: guardado.id, is_read: true })]);
    });

    it('marcarlo dos veces no falla: sigue leído', async () => {
      const guardado = avisoGuardado({ user_id: ANA });
      exito(await marcarLeido(ANA, guardado.id));

      exito(await marcarLeido(ANA, guardado.id));

      expect(avisoEnBaseDeDatos(guardado.id)?.is_read).toBe(true);
    });

    it('un aviso que no existe responde 404', async () => {
      const respuesta = await marcarLeido(ANA, randomUUID());

      expect(respuesta.status).toBe(404);
    });

    it('un id que no es un UUID responde 400', async () => {
      const respuesta = await marcarLeido(ANA, 'el-primero');

      expect(respuesta.status).toBe(400);
    });
  });

  // PA 2250-1: Interacción y navegación desde una solicitud de intercambio (Swap)
  describe('PA 2250-1 · interacción y navegación desde una solicitud de intercambio', () => {
    it('la solicitud de Ana crea un aviso para Beto que apunta a esa petición', async () => {
      const id = await solicitudDeAnaABeto();

      const avisos = await avisosDe(BETO);

      expect(avisos).toEqual([
        expect.objectContaining({ type: 'swap_requested', reference_id: id, is_read: false }),
      ]);
      expect(avisos[0].body).toContain('Ana García');
      expect(avisos[0].body).toContain('Fregar los platos');
      expect(avisos[0].body).toContain('Sacar la basura');
    });

    it('solo avisa a quien tiene que responder: ni a Ana, que la envía, ni a Carla', async () => {
      await solicitudDeAnaABeto();

      expect(await avisosDe(ANA)).toEqual([]);
      expect(await avisosDe(CARLA)).toEqual([]);
    });

    it('al tocar el aviso, Beto lo marca como leído', async () => {
      await solicitudDeAnaABeto();
      const [aviso] = await avisosDe(BETO);

      exito(await marcarLeido(BETO, aviso.id));

      expect(avisoEnBaseDeDatos(aviso.id)?.is_read).toBe(true);
      expect(await sinLeerDe(BETO)).toBe(0);
    });

    it.each([
      ['acepta', aceptar],
      ['rechaza', rechazar],
    ])('si Beto %s desde la pantalla de intercambios, su aviso de solicitud deja de estar pendiente', async (_respuesta, responder) => {
      const id = await solicitudDeAnaABeto();
      expect(await sinLeerDe(BETO)).toBe(1);

      exito(await responder(BETO, id));

      expect(await sinLeerDe(BETO)).toBe(0);
      expect(await avisosDe(BETO)).toEqual([
        expect.objectContaining({ type: 'swap_requested', is_read: true }),
      ]);
    });

    it('si Ana cancela la solicitud, el aviso de Beto desaparece: ya no hay nada que responder', async () => {
      const id = await solicitudDeAnaABeto();

      exito(await cancelar(ANA, id));

      expect(await avisosDe(BETO)).toEqual([]);
      expect(await sinLeerDe(BETO)).toBe(0);
    });

    it('el aviso de aceptación apunta a la petición, que sigue guardada como completada', async () => {
      const id = await solicitudDeAnaABeto();
      exito(await aceptar(BETO, id));

      expect(await avisosDe(ANA)).toEqual([
        expect.objectContaining({ type: 'swap_accepted', reference_id: id }),
      ]);
    });

    it('el aviso de rechazo apunta a la tarea que ofrecía Ana, porque la petición ya no existe', async () => {
      const id = await solicitudDeAnaABeto();
      exito(await rechazar(BETO, id));

      expect(await avisosDe(ANA)).toEqual([
        expect.objectContaining({ type: 'swap_rejected', reference_id: TAREA_A }),
      ]);
    });

    it('los avisos de tareas apuntan a la tarea, para abrir su detalle', async () => {
      exito(await asignar(BETO, TAREA_LIBRE, [ANA]));

      expect(await avisosDe(ANA)).toEqual([
        expect.objectContaining({ type: 'task_assigned', reference_id: TAREA_LIBRE }),
      ]);
    });
  });

  // PA: Prevención de manipulación de estado ajeno (Seguridad)
  describe('PA · prevención de manipulación de estado ajeno (seguridad)', () => {
    it('Ana no puede marcar como leído un aviso de Carla: 403 y el aviso no cambia', async () => {
      const deCarla = avisoGuardado({ user_id: CARLA });
      const antes = { ...deCarla };

      const respuesta = await marcarLeido(ANA, deCarla.id);

      expect(respuesta.status).toBe(403);
      expect(avisoEnBaseDeDatos(deCarla.id)).toEqual(antes);
    });

    it('Carla sigue viéndolo sin leer', async () => {
      const deCarla = avisoGuardado({ user_id: CARLA });
      await marcarLeido(ANA, deCarla.id);

      expect(await sinLeerDe(CARLA)).toBe(1);
      expect(await avisosDe(CARLA)).toEqual([expect.objectContaining({ id: deCarla.id, is_read: false })]);
    });

    it('tampoco alguien de otro piso', async () => {
      const deCarla = avisoGuardado({ user_id: CARLA });

      const respuesta = await marcarLeido(DANI, deCarla.id);

      expect(respuesta.status).toBe(403);
      expect(avisoEnBaseDeDatos(deCarla.id)?.is_read).toBe(false);
    });

    it('con un token que no vale responde 401 y el aviso no cambia', async () => {
      const deCarla = avisoGuardado({ user_id: CARLA });

      const respuesta = await request(app.getHttpServer())
        .patch(`/notifications/${deCarla.id}/read`)
        .set('Authorization', 'Bearer token-caducado');

      expect(respuesta.status).toBe(401);
      expect(avisoEnBaseDeDatos(deCarla.id)?.is_read).toBe(false);
    });

    it('quien hace la petición sale del token: enviar el user_id de Carla en el cuerpo no sirve de nada', async () => {
      const deCarla = avisoGuardado({ user_id: CARLA });

      const respuesta = await request(app.getHttpServer())
        .patch(`/notifications/${deCarla.id}/read`)
        .set('Authorization', `Bearer ${TOKENS[ANA]}`)
        .send({ user_id: CARLA });

      expect(respuesta.status).toBe(403);
      expect(avisoEnBaseDeDatos(deCarla.id)?.is_read).toBe(false);
    });
  });
});
