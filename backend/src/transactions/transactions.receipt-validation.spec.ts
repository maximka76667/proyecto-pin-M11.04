import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../app.setup';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import {
  MAX_CANTIDAD,
  MAX_PRECIO_UNIDAD,
  MAX_PRODUCTOS,
} from './dto/create-receipt-transaction.dto';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

// Editar un ticket con cantidades o precios desorbitados o negativos se bloquea con 400
// en el ValidationPipe, sin llegar a consultar la base de datos (evita desbordamientos).
// Peticiones HTTP reales con la misma validación que la app y una base de datos falsa.
describe('POST /transactions/from-receipt límites de importe y cantidad', () => {
  let app: INestApplication<App>;

  // El usuario que devuelve @CurrentUser() mientras no hay login
  const pagador = '22222222-2222-2222-2222-222222222222';
  const companero = '3f0c9a4e-8b1d-4c2a-9e7f-5a6b7c8d9e0f';
  const piso = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

  const prisma = {
    apartment: { findUnique: jest.fn() },
    transaction: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  const producto = (cambios: object = {}) => ({
    name: 'Leche',
    quantity: 1,
    unit_price: '1.20',
    ...cambios,
  });

  const ticket = (items: object[]) => ({
    apartment_id: piso,
    participant_ids: [companero],
    items,
    category: 'supplies',
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [TransactionsController],
      providers: [
        TransactionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: {} },
      ],
    }).compile();

    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.apartment.findUnique.mockResolvedValue({
      user_apartments: [{ user_id: pagador }, { user_id: companero }],
    });
    prisma.transaction.create.mockImplementation(({ data }) => data);
    prisma.$transaction.mockImplementation((operaciones: unknown[]) => Promise.all(operaciones));
  });

  it('acepta los valores justo en el límite y el reparto cabe en Decimal(12, 2)', async () => {
    const items = Array.from({ length: MAX_PRODUCTOS }, () =>
      producto({ quantity: MAX_CANTIDAD, unit_price: MAX_PRECIO_UNIDAD }),
    );

    const response = await request(app.getHttpServer())
      .post('/transactions/from-receipt')
      .send(ticket(items))
      .expect(201);

    // El peor caso posible: 99.999,99 x 999 x 100 productos
    expect(response.body.total).toBe('9989999001.00');
    const [deuda] = response.body.transactions;
    expect(Number(deuda.amount)).toBeLessThanOrEqual(9999999999.99);
  });

  it.each([
    ['un precio negativo', producto({ unit_price: '-5' }), 'unit_price'],
    ['un precio desorbitado (999.999.999)', producto({ unit_price: '999999999' }), 'unit_price'],
    ['un precio justo por encima del límite', producto({ unit_price: '100000.00' }), 'unit_price'],
    ['una cantidad negativa', producto({ quantity: -1 }), 'quantity'],
    ['una cantidad de cero', producto({ quantity: 0 }), 'quantity'],
    ['una cantidad desorbitada (999.999.999)', producto({ quantity: 999999999 }), 'quantity'],
    ['una cantidad justo por encima del límite', producto({ quantity: MAX_CANTIDAD + 1 }), 'quantity'],
  ])('bloquea %s con 400 sin consultar la base de datos', async (_, item, campo) => {
    const response = await request(app.getHttpServer())
      .post('/transactions/from-receipt')
      .send(ticket([item]))
      .expect(400);

    // El mensaje dice qué campo está mal
    expect(response.body.message.join(' ')).toContain(campo);
    expect(prisma.apartment.findUnique).not.toHaveBeenCalled();
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it('bloquea un ticket con más productos de los permitidos', async () => {
    const items = Array.from({ length: MAX_PRODUCTOS + 1 }, () => producto());

    await request(app.getHttpServer())
      .post('/transactions/from-receipt')
      .send(ticket(items))
      .expect(400);

    expect(prisma.apartment.findUnique).not.toHaveBeenCalled();
  });
});
