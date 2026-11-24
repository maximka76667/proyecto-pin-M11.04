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
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

// RNF-01 · Seguridad y aislamiento por hogar. Ana vive en el piso A y no tiene ninguna relación
// con el piso B. Cada test manda una petición de Ana contra un dato del piso B y comprueba que
// el servidor la bloquea (403 o 404), que la respuesta no cuenta nada del piso B y, tras
// cada petición, que los datos del piso B siguen exactamente igual.
//
// Se prueba por HTTP con los servicios de verdad y el AuthMiddleware real. La base de datos es
// el Prisma en memoria de test/prisma-en-memoria.ts, no Postgres: la lectura posterior prueba
// que el servicio no escribió, no que Postgres no cambió.

const db = crearPrismaEnMemoria();

const PISO_A = 'a0a0a0a0-0000-4000-8000-00000000000a';
const PISO_B = 'b0b0b0b0-0000-4000-8000-00000000000b';

// Ana y Beto viven en el piso A; Carla y Dani, en el B
const ANA = 'a1a1a1a1-1111-4111-8111-111111111111';
const BETO = 'b2b2b2b2-2222-4222-8222-222222222222';
const CARLA = 'c3c3c3c3-3333-4333-8333-333333333333';
const DANI = 'd4d4d4d4-4444-4444-8444-444444444444';

// Datos del piso B: un gasto manual, un ticket con un producto y un aviso de pago pendiente
const GASTO_B = 'e0e0e0e0-0000-4000-8000-0000000000b1';
const DEUDA_GASTO_B = 'f0f0f0f0-0000-4000-8000-0000000000b1';
const TICKET_B = 'e1e1e1e1-0000-4000-8000-0000000000b2';
const PRODUCTO_B = 'e0e0e0e0-0000-4000-8000-0000000000b2';
const DEUDA_PRODUCTO_B = 'f0f0f0f0-0000-4000-8000-0000000000b2';
const PAGO_B = 'e0e0e0e0-0000-4000-8000-0000000000b3';
const AVISO_B = 'f0f0f0f0-0000-4000-8000-0000000000b3';

// Lo que no puede aparecer en ninguna respuesta a Ana
// (42 es lo que Dani debe en total a Carla: 30,00 + 12,00; en los balances sale como número)
const SECRETOS_DE_B = ['Carla', 'Dani', 'Compra secreta de B', '30.00', '12.00', '10.00', '42'];

const TOKENS: Record<string, string> = {
  [ANA]: 'token-de-ana',
  [BETO]: 'token-de-beto',
  [CARLA]: 'token-de-carla',
  [DANI]: 'token-de-dani',
};
const USUARIO_DEL_TOKEN = Object.fromEntries(
  Object.entries(TOKENS).map(([id, token]) => [token, id]),
);

const auth = {
  userIdForToken: jest.fn((token: string) =>
    Promise.resolve(USUARIO_DEL_TOKEN[token] ?? null),
  ),
};

@Module({
  controllers: [ExpensesController, TransactionsController],
  providers: [
    ExpensesService,
    TransactionsService,
    AuthMiddleware,
    { provide: PrismaService, useValue: db.prisma },
    { provide: AuthService, useValue: auth },
    // El de verdad: los balances sacan los nombres de aquí, y con `{}` el endpoint fallaba
    // con un 500 por culpa del test, no del código
    UsersService,
  ],
})
class ModuloDePrueba implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}

const nuevoUsuario = (id: string, full_name: string) => ({
  id,
  email: `${full_name.toLowerCase()}@ejemplo.com`,
  full_name,
  is_landlord: false,
  password_hash: null,
  google_subject: null,
});
const nuevoPiso = (id: string, name: string, invite_code: string) => ({
  id,
  address: `${name}, 1`,
  name,
  invite_code,
  landlord_id: null,
});
const nuevoGasto = (
  id: string,
  apartment_id: string,
  payer_id: string,
  total_amount: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  apartment_id,
  payer_id,
  receipt_id: null,
  type: 'EXPENSE',
  total_amount,
  concept: 'Gasto',
  category: 'supplies',
  payer_participates: false,
  version: 1,
  ...extra,
});
const nuevaDeuda = (
  id: string,
  expense_id: string,
  apartment_id: string,
  from_user_id: string,
  to_user_id: string,
  amount: string,
  category = 'supplies',
) => ({ id, expense_id, apartment_id, from_user_id, to_user_id, amount, concept: 'Gasto', category });

function sembrar() {
  db.cargar({
    User: [
      nuevoUsuario(ANA, 'Ana'),
      nuevoUsuario(BETO, 'Beto'),
      nuevoUsuario(CARLA, 'Carla'),
      nuevoUsuario(DANI, 'Dani'),
    ],
    Apartment: [
      nuevoPiso(PISO_A, 'Calle Mayor', '11111111-1111-4111-8111-11111111111a'),
      nuevoPiso(PISO_B, 'Calle Luna', '22222222-2222-4222-8222-22222222222b'),
    ],
    UserApartment: [
      { user_id: ANA, apartment_id: PISO_A },
      { user_id: BETO, apartment_id: PISO_A },
      { user_id: CARLA, apartment_id: PISO_B },
      { user_id: DANI, apartment_id: PISO_B },
    ],
    Receipt: [
      { id: TICKET_B, apartment_id: PISO_B, payer_id: CARLA, total_amount: '12.00', version: 1 },
    ],
    Expense: [
      // Gasto manual de Carla: Dani le debe 30,00
      nuevoGasto(GASTO_B, PISO_B, CARLA, '30.00', { concept: 'Compra secreta de B' }),
      // Producto de un ticket de Carla: Dani le debe 12,00
      nuevoGasto(PRODUCTO_B, PISO_B, CARLA, '12.00', { receipt_id: TICKET_B }),
      // Aviso de pago de Dani a Carla, pendiente de que ella lo confirme
      nuevoGasto(PAGO_B, PISO_B, DANI, '10.00', {
        type: 'SETTLEMENT',
        category: 'pending',
        concept: null,
      }),
    ],
    Transaction: [
      nuevaDeuda(DEUDA_GASTO_B, GASTO_B, PISO_B, CARLA, DANI, '30.00'),
      nuevaDeuda(DEUDA_PRODUCTO_B, PRODUCTO_B, PISO_B, CARLA, DANI, '12.00'),
      nuevaDeuda(AVISO_B, PAGO_B, PISO_B, DANI, CARLA, '10.00', 'pending'),
    ],
  });
}

// Todo lo financiero del piso B, para comparar antes y después de cada petición
const datosDeB = () =>
  structuredClone({
    Receipt: db.filasDe('Receipt').filter((f) => f.apartment_id === PISO_B),
    Expense: db.filasDe('Expense').filter((f) => f.apartment_id === PISO_B),
    Transaction: db.filasDe('Transaction').filter((f) => f.apartment_id === PISO_B),
  });

// Registro de todas las peticiones de Ana contra el piso B, para el informe
const registro: { endpoint: string; status: number }[] = [];
const esBloqueo = (status: number) => status === 403 || status === 404;

describe('RNF-01 · Aislamiento por hogar (Ana, del piso A, contra datos del piso B)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [ModuloDePrueba] }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    const bloqueadas = registro.filter(({ status }) => esBloqueo(status)).length;
    const vacias = registro.filter(({ status }) => status === 200).length;
    const estados = registro.map(({ endpoint, status }) => `${endpoint} → ${status}`);
    console.info(
      `[RNF-01] peticiones=${registro.length}, bloqueadas con 403/404=${bloqueadas}, aisladas con 200 []=${vacias}\n${estados.join('\n')}`,
    );
  });

  beforeEach(() => {
    sembrar();
  });

  const comoAna = () => {
    const autorizacion = `Bearer ${TOKENS[ANA]}`;
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

  // Lo común a los 12 endpoints: la petición se anota, se bloquea, la respuesta no cuenta nada
  // del piso B y los datos del piso B no han cambiado. Se bloquea con 403/404, salvo en las dos
  // listas «mías» (GET /expenses y GET /transactions), que filtran por usuario y responden
  // 200 con una lista vacía: igual que a un miembro sin gastos, así que no revelan nada
  async function comprobarBloqueo(
    endpoint: string,
    enviar: () => Promise<request.Response>,
    { esLista = false } = {},
  ) {
    const antes = datosDeB();

    const respuesta = await enviar();
    registro.push({ endpoint, status: respuesta.status });

    // Primero lo que importa de verdad: si algo cambió en B, el fallo enseña las filas de más
    expect(datosDeB()).toEqual(antes);

    // Luego lo que cuenta la respuesta, antes del código: si algo se filtra, el fallo lo enseña
    const cuerpo = JSON.stringify(respuesta.body);
    for (const secreto of SECRETOS_DE_B) {
      expect(cuerpo).not.toContain(secreto);
    }

    if (esLista) {
      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual([]);
    } else {
      expect([403, 404]).toContain(respuesta.status);
    }
  }

  // ─── Lecturas ────────────────────────────────────────────────────────────────────────

  it('GET /expenses?apartment_id=<piso B> no devuelve los gastos de otro hogar', async () => {
    await comprobarBloqueo(
      'GET /expenses',
      () => comoAna().get(`/expenses?apartment_id=${PISO_B}`),
      { esLista: true },
    );
  });

  it('GET /transactions/:apartmentId/settle-up no enseña las deudas de otro hogar', async () => {
    await comprobarBloqueo('GET /transactions/:apartmentId/settle-up', () =>
      comoAna().get(`/transactions/${PISO_B}/settle-up`),
    );
  });

  it('GET /transactions?apartment_id=<piso B> no devuelve las deudas de otro hogar', async () => {
    await comprobarBloqueo(
      'GET /transactions',
      () => comoAna().get(`/transactions?apartment_id=${PISO_B}`),
      { esLista: true },
    );
  });

  // ─── Escrituras ──────────────────────────────────────────────────────────────────────

  it('PATCH /expenses/:id no deja editar un gasto de otro hogar', async () => {
    await comprobarBloqueo('PATCH /expenses/:id', () =>
      comoAna().patch(`/expenses/${GASTO_B}`, {
        version: 1,
        amount: '5.00',
        concept: 'Editado por Ana',
      }),
    );
  });

  it('DELETE /expenses/:id no deja borrar un gasto de otro hogar', async () => {
    await comprobarBloqueo('DELETE /expenses/:id', () =>
      comoAna().delete(`/expenses/${GASTO_B}?version=1`),
    );
  });

  it('DELETE /receipts/:id no deja borrar un ticket de otro hogar', async () => {
    await comprobarBloqueo('DELETE /receipts/:id', () =>
      comoAna().delete(`/receipts/${TICKET_B}?version=1`),
    );
  });

  it('GET /transactions/:apartmentId/my-summary no enseña los balances de otro hogar', async () => {
    await comprobarBloqueo('GET /transactions/:apartmentId/my-summary', () =>
      comoAna().get(`/transactions/${PISO_B}/my-summary`),
    );
  });

  it('POST /transactions/:apartmentId/settle no deja avisar de un pago en otro hogar', async () => {
    // Ana dice que ha pagado a Carla los 42,00 que se deben en el piso B
    await comprobarBloqueo('POST /transactions/:apartmentId/settle', () =>
      comoAna().post(`/transactions/${PISO_B}/settle`, {
        acreedor_id: CARLA,
        amount: '42.00',
      }),
    );
  });

  it('POST /transactions/:id/confirm no deja confirmar un pago de otro hogar', async () => {
    // El aviso de Dani a Carla sigue pendiente: solo Carla puede confirmarlo
    await comprobarBloqueo('POST /transactions/:id/confirm', () =>
      comoAna().post(`/transactions/${AVISO_B}/confirm`),
    );
  });

  it('POST /transactions/:id/reject no deja rechazar un pago de otro hogar', async () => {
    // Rechazar borra el aviso y su liquidación: la comparación con B enseñaría el borrado
    await comprobarBloqueo('POST /transactions/:id/reject', () =>
      comoAna().post(`/transactions/${AVISO_B}/reject`),
    );
  });

  it('POST /transactions/from-receipt no deja crear un ticket en otro hogar', async () => {
    // Ana apunta al piso B y reparte el ticket entre Carla y Dani, que son de B
    await comprobarBloqueo('POST /transactions/from-receipt', () =>
      comoAna().post('/transactions/from-receipt', {
        apartment_id: PISO_B,
        participant_ids: [CARLA, DANI],
        items: [{ name: 'Producto falso de Ana', unit_price: '7.77', quantity: 1 }],
        category: 'supplies',
      }),
    );
  });

  it('POST /transactions no deja crear un gasto en otro hogar haciéndose pasar por su pagador', async () => {
    // Ana apunta al piso B, con Carla como pagadora y Dani como deudor: los tres son de B
    await comprobarBloqueo('POST /transactions', () =>
      comoAna().post('/transactions', {
        apartment_id: PISO_B,
        from_user_id: CARLA,
        to_user_id: DANI,
        amount: '99.00',
        concept: 'Gasto falso de Ana',
        category: 'supplies',
      }),
    );
  });
});
