import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../app.setup';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

// PA-1000.03: se bloquea la modificación de un gasto con datos inválidos.
// Envía peticiones HTTP reales usando la misma validación que la aplicación,
// con una base de datos simulada para comprobar que nunca se toca.
describe('Validación de PATCH /transactions/:id (PA-1000.03)', () => {
  let app: INestApplication<App>;

  const prisma = {
    transaction: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  // Un UUID aleatorio real (v4), como los que genera Prisma.
  const id = '3f0c9a4e-8b1d-4c2a-9e7f-5a6b7c8d9e0f';

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
    // Gasto editable por defecto; se establece aquí porque clearAllMocks conserva los valores simulados.
    prisma.transaction.findUnique.mockResolvedValue({
      apartment_id: 'apt-1',
      category: 'utilities',
      from_user_id: '22222222-2222-2222-2222-222222222222',
      to_user_id: '33333333-3333-4333-8333-333333333333',
      created_at: new Date('2026-10-01T10:00:00.000Z'),
    });
    prisma.transaction.findFirst.mockResolvedValue(null);
  });

  it('modifica el gasto cuando los datos son válidos', async () => {
    prisma.transaction.update.mockResolvedValue({
      id,
      amount: '12.50',
      category: 'utilities',
    });

    await request(app.getHttpServer())
      .patch(`/transactions/${id}`)
      .send({ amount: '12.50', category: 'utilities' })
      .expect(200);

    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { id },
      data: { amount: '12.50', category: 'utilities' },
    });
  });

  it.each([
    ['a negative amount', { amount: '-5' }, 'amount'],
    ['a zero amount', { amount: '0' }, 'amount'],
    [
      'an amount with more than 6 integer digits',
      { amount: '1000000' },
      'amount',
    ],
    ['an amount with more than 2 decimals', { amount: '12.999' }, 'amount'],
    ['an amount that is not a number', { amount: 'abc' }, 'amount'],
    ['an empty concept', { concept: '' }, 'concept'],
    ['a whitespace-only concept', { concept: '   ' }, 'concept'],
    ['an unknown category', { category: 'food' }, 'category'],
    ['a user id that is not a uuid', { to_user_id: 'abc' }, 'to_user_id'],
    ['a field that does not exist', { description: 'Pizza' }, 'description'],
  ])(
    'blocks %s with 400 and does not touch the database',
    async (_, body, field) => {
      const response = await request(app.getHttpServer())
        .patch(`/transactions/${id}`)
        .send(body)
        .expect(400);

      // El mensaje indica qué campo era incorrecto.
      expect(response.body.message.join(' ')).toContain(field);
      expect(prisma.transaction.update).not.toHaveBeenCalled();
    },
  );

  it('bloquea con 400 un identificador que no es un UUID', async () => {
    await request(app.getHttpServer())
      .patch('/transactions/abc')
      .send({ amount: '12.50' })
      .expect(400);

    expect(prisma.transaction.update).not.toHaveBeenCalled();
  });

  it('devuelve 404 cuando el gasto no existe', async () => {
    prisma.transaction.findUnique.mockResolvedValue(null);

    const response = await request(app.getHttpServer())
      .patch(`/transactions/${id}`)
      .send({ amount: '12.50' })
      .expect(404);

    expect(response.body.message).toBe('Transaction not found');
  });

  it('DELETE bloquea con 400 un identificador que no es un UUID', async () => {
    await request(app.getHttpServer()).delete('/transactions/abc').expect(400);

    expect(prisma.transaction.delete).not.toHaveBeenCalled();
  });

  it('DELETE elimina un gasto válido', async () => {
    prisma.transaction.delete.mockResolvedValue({ id });

    await request(app.getHttpServer())
      .delete(`/transactions/${id}`)
      .expect(200);

    expect(prisma.transaction.delete).toHaveBeenCalledWith({
      where: { id },
    });
  });
});
