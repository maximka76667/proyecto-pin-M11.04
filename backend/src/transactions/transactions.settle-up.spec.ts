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
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

// RF-02 · Pantalla de saldar deudas (GET /transactions/:apartmentId/settle-up) para quien vive en
// el piso: qué debe cada uno, a quién, y qué puede hacer cada persona con cada deuda (marcar
// pagado, confirmar o rechazar). Quien no es del piso recibe un 403: eso está en
// transactions.aislamiento.spec.ts.
//
// Por HTTP, con los servicios de verdad y el Prisma en memoria de test/prisma-en-memoria.ts.

const db = crearPrismaEnMemoria();

const PISO = 'a0a0a0a0-0000-4000-8000-00000000000a';

// Carla paga, Dani le debe y Beto vive en el piso pero no tiene nada que ver con esa deuda
const CARLA = 'c3c3c3c3-3333-4333-8333-333333333333';
const DANI = 'd4d4d4d4-4444-4444-8444-444444444444';
const BETO = 'b2b2b2b2-2222-4222-8222-222222222222';

const GASTO = 'e0e0e0e0-0000-4000-8000-000000000001';
const DEUDA = 'f0f0f0f0-0000-4000-8000-000000000001';

const TOKENS: Record<string, string> = {
  [CARLA]: 'token-de-carla',
  [DANI]: 'token-de-dani',
  [BETO]: 'token-de-beto',
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
  controllers: [TransactionsController],
  providers: [
    TransactionsService,
    UsersService,
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

const nuevoUsuario = (id: string, full_name: string) => ({
  id,
  email: `${full_name.toLowerCase()}@ejemplo.com`,
  full_name,
  is_landlord: false,
  password_hash: null,
  google_subject: null,
});

const PAGO = 'e0e0e0e0-0000-4000-8000-000000000002';
const AVISO = 'f0f0f0f0-0000-4000-8000-000000000002';

// Dani avisa de que ha pagado 10,00 a Carla: queda pendiente hasta que ella lo confirme. Todo
// aviso pertenece a una liquidación (un Expense de tipo SETTLEMENT)
const avisoDeDani = {
  Expense: [
    {
      id: PAGO,
      apartment_id: PISO,
      payer_id: DANI,
      receipt_id: null,
      type: 'SETTLEMENT',
      total_amount: '10.00',
      concept: null,
      category: 'pending',
      payer_participates: false,
      version: 1,
    },
  ],
  Transaction: [
    {
      id: AVISO,
      expense_id: PAGO,
      apartment_id: PISO,
      from_user_id: DANI,
      to_user_id: CARLA,
      amount: '10.00',
      concept: null,
      category: 'pending',
    },
  ],
};

// Carla adelanta 30,00 y Dani se los debe. Sin más, no hay ningún aviso de pago
function sembrar(
  extra: { Expense?: Record<string, unknown>[]; Transaction?: Record<string, unknown>[] } = {},
) {
  db.cargar({
    User: [
      nuevoUsuario(CARLA, 'Carla'),
      nuevoUsuario(DANI, 'Dani'),
      nuevoUsuario(BETO, 'Beto'),
    ],
    Apartment: [
      {
        id: PISO,
        address: 'Calle Mayor, 1',
        name: 'Calle Mayor',
        invite_code: '11111111-1111-4111-8111-11111111111a',
        landlord_id: null,
      },
    ],
    UserApartment: [
      { user_id: CARLA, apartment_id: PISO },
      { user_id: DANI, apartment_id: PISO },
      { user_id: BETO, apartment_id: PISO },
    ],
    Expense: [
      {
        id: GASTO,
        apartment_id: PISO,
        payer_id: CARLA,
        receipt_id: null,
        type: 'EXPENSE',
        total_amount: '30.00',
        concept: 'Compra',
        category: 'supplies',
        payer_participates: false,
        version: 1,
      },
      ...(extra.Expense ?? []),
    ],
    Transaction: [
      {
        id: DEUDA,
        expense_id: GASTO,
        apartment_id: PISO,
        from_user_id: CARLA,
        to_user_id: DANI,
        amount: '30.00',
        concept: 'Compra',
        category: 'supplies',
      },
      ...(extra.Transaction ?? []),
    ],
  });
}

describe('RF-02 · Saldar deudas (GET /transactions/:apartmentId/settle-up)', () => {
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
    sembrar();
  });

  const verComo = (usuario: string) =>
    request(app.getHttpServer())
      .get(`/transactions/${PISO}/settle-up`)
      .set('Authorization', `Bearer ${TOKENS[usuario]}`);

  // La misma deuda, vista por cada persona del piso: solo el deudor puede marcarla como pagada
  it.each([
    ['el deudor puede marcarla como pagada', DANI, 'deudor', ['marcar_pagado']],
    ['el acreedor no tiene nada que hacer todavía', CARLA, 'acreedor', []],
    ['alguien ajeno a la deuda no tiene nada que hacer', BETO, 'ajeno', []],
  ])('con una deuda sin pagar, %s', async (_, usuario, rol, acciones) => {
    const respuesta = await verComo(usuario).expect(200);

    expect(respuesta.body).toEqual([
      {
        deudorId: DANI,
        deudor: 'Dani',
        acreedorId: CARLA,
        acreedor: 'Carla',
        monto: 30,
        estado: 'por_pagar',
        pagoPendienteId: null,
        rol,
        acciones,
      },
    ]);
  });

  // El aviso pendiente sustituye al importe de la deuda y reparte las acciones: solo el acreedor
  // puede confirmarlo o rechazarlo, y el deudor ya no puede avisar otra vez
  it.each([
    ['el acreedor puede confirmar o rechazar el aviso', CARLA, 'acreedor', ['confirmar_pago', 'rechazar_pago']],
    ['el deudor ya no puede hacer nada hasta que se confirme', DANI, 'deudor', []],
    ['alguien ajeno a la deuda sigue sin poder hacer nada', BETO, 'ajeno', []],
  ])('con un aviso de pago pendiente, %s', async (_, usuario, rol, acciones) => {
    sembrar(avisoDeDani);

    const respuesta = await verComo(usuario).expect(200);

    expect(respuesta.body).toEqual([
      {
        deudorId: DANI,
        deudor: 'Dani',
        acreedorId: CARLA,
        acreedor: 'Carla',
        // El importe es el del aviso (10,00), no el de la deuda entera (30,00)
        monto: 10,
        estado: 'pendiente_confirmacion',
        pagoPendienteId: AVISO,
        rol,
        acciones,
      },
    ]);
  });

  // Un aviso sin deuda detrás (p. ej. la deuda ya se compensó con otro gasto) no se pierde:
  // sale como una fila más, detrás de las deudas, para que su acreedor pueda atenderlo
  it('un aviso de pago sin deuda correspondiente sale como una fila más', async () => {
    const PAGO_DE_BETO = 'e0e0e0e0-0000-4000-8000-000000000003';
    const AVISO_DE_BETO = 'f0f0f0f0-0000-4000-8000-000000000003';
    sembrar({
      Expense: [
        {
          id: PAGO_DE_BETO,
          apartment_id: PISO,
          payer_id: BETO,
          receipt_id: null,
          type: 'SETTLEMENT',
          total_amount: '5.00',
          concept: null,
          category: 'pending',
          payer_participates: false,
          version: 1,
        },
      ],
      Transaction: [
        {
          id: AVISO_DE_BETO,
          expense_id: PAGO_DE_BETO,
          apartment_id: PISO,
          from_user_id: BETO,
          to_user_id: CARLA,
          amount: '5.00',
          concept: null,
          category: 'pending',
        },
      ],
    });

    const respuesta = await verComo(CARLA).expect(200);

    expect(respuesta.body).toEqual([
      {
        deudorId: DANI,
        deudor: 'Dani',
        acreedorId: CARLA,
        acreedor: 'Carla',
        monto: 30,
        estado: 'por_pagar',
        pagoPendienteId: null,
        rol: 'acreedor',
        acciones: [],
      },
      {
        deudorId: BETO,
        deudor: 'Beto',
        acreedorId: CARLA,
        acreedor: 'Carla',
        monto: 5,
        estado: 'pendiente_confirmacion',
        pagoPendienteId: AVISO_DE_BETO,
        rol: 'acreedor',
        acciones: ['confirmar_pago', 'rechazar_pago'],
      },
    ]);
  });

  // Confirmar y rechazar solo valen para un aviso pendiente que existe. Si no, no tocan nada
  describe.each(['confirm', 'reject'])('POST /transactions/:id/%s sin un aviso pendiente', (accion) => {
    const filasDeDeudas = () => structuredClone(db.filasDe('Transaction'));

    it('de un aviso que no existe responde 404 y no cambia nada', async () => {
      const antes = filasDeDeudas();

      const respuesta = await request(app.getHttpServer())
        .post(`/transactions/f0f0f0f0-0000-4000-8000-0000000000ff/${accion}`)
        .set('Authorization', `Bearer ${TOKENS[CARLA]}`)
        .expect(404);

      expect(respuesta.body.message).toBe('Transaction not found');
      expect(filasDeDeudas()).toEqual(antes);
    });

    it('de una deuda que no es un aviso pendiente responde 409 y no cambia nada', async () => {
      const antes = filasDeDeudas();

      // La deuda de Dani con Carla ya está confirmada: no se puede confirmar ni rechazar de nuevo
      const respuesta = await request(app.getHttpServer())
        .post(`/transactions/${DEUDA}/${accion}`)
        .set('Authorization', `Bearer ${TOKENS[DANI]}`)
        .expect(409);

      expect(respuesta.body.message).toBe('Este pago ya no está pendiente de confirmar');
      expect(filasDeDeudas()).toEqual(antes);
    });
  });
});
