import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../app.setup';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

// PA-1000.03: modifying an expense with invalid data is blocked.
// Sends real HTTP requests through the same validation as the real app,
// with a fake database so we can check it is never touched.
describe('PATCH /transactions/:id validation (PA-1000.03)', () => {
  let app: INestApplication<App>;

  const prisma = {
    transaction: {
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  // A real random (v4) uuid, like the ones Prisma generates
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
  });

  it('modifies the expense when the data is valid', async () => {
    prisma.transaction.update.mockResolvedValue({ id, amount: '12.50', category: 'utilities' });

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
    ['an amount with more than 6 integer digits', { amount: '1000000' }, 'amount'],
    ['an amount with more than 2 decimals', { amount: '12.999' }, 'amount'],
    ['an amount that is not a number', { amount: 'abc' }, 'amount'],
    ['an unknown category', { category: 'food' }, 'category'],
    ['a user id that is not a uuid', { to_user_id: 'abc' }, 'to_user_id'],
    ['a field that does not exist', { description: 'Pizza' }, 'description'],
  ])('blocks %s with 400 and does not touch the database', async (_, body, field) => {
    const response = await request(app.getHttpServer())
      .patch(`/transactions/${id}`)
      .send(body)
      .expect(400);

    // The message tells which field was wrong
    expect(response.body.message.join(' ')).toContain(field);
    expect(prisma.transaction.update).not.toHaveBeenCalled();
  });

  it('blocks an id that is not a uuid with 400', async () => {
    await request(app.getHttpServer())
      .patch('/transactions/abc')
      .send({ amount: '12.50' })
      .expect(400);

    expect(prisma.transaction.update).not.toHaveBeenCalled();
  });

  it('returns 404 when the expense does not exist', async () => {
    prisma.transaction.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: Prisma.prismaVersion.client,
      }),
    );

    const response = await request(app.getHttpServer())
      .patch(`/transactions/${id}`)
      .send({ amount: '12.50' })
      .expect(404);

    expect(response.body.message).toBe('Transaction not found');
  });

  it('DELETE blocks an id that is not a uuid with 400', async () => {
    await request(app.getHttpServer()).delete('/transactions/abc').expect(400);

    expect(prisma.transaction.delete).not.toHaveBeenCalled();
  });
});
