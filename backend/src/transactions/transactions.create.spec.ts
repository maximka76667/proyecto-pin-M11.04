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

// UT998: un estudiante registra un gasto (importe, concepto y quién lo debe).
// Envía peticiones HTTP reales usando la misma validación que la aplicación,
// con una base de datos simulada para comprobar qué se guarda y qué no.
describe('POST /transactions (UT998)', () => {
  let app: INestApplication<App>;

  const prisma = {
    transaction: {
      create: jest.fn(),
    },
  };

  const payer = '3f0c9a4e-8b1d-4c2a-9e7f-5a6b7c8d9e0f';
  const debtor = '8b7c6d5e-4f3a-4210-9b8c-7d6e5f4a3210';
  const apartment = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';

  const validBody = {
    apartment_id: apartment,
    from_user_id: payer,
    to_user_id: debtor,
    amount: '18.40',
    concept: 'Compra del súper',
    category: 'supplies',
  };

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

  it('guarda el gasto con su concepto', async () => {
    prisma.transaction.create.mockResolvedValue({ id: 'new-id', ...validBody });

    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send(validBody)
      .expect(201);

    expect(prisma.transaction.create).toHaveBeenCalledWith({
      data: {
        apartment_id: apartment,
        from_user_id: payer,
        to_user_id: debtor,
        amount: '18.40',
        concept: 'Compra del súper',
        category: 'supplies',
      },
    });
    expect(response.body.concept).toBe('Compra del súper');
  });

  it('elimina los espacios alrededor del concepto', async () => {
    prisma.transaction.create.mockResolvedValue({ id: 'new-id' });

    await request(app.getHttpServer())
      .post('/transactions')
      .send({ ...validBody, concept: '  Internet  ' })
      .expect(201);

    expect(prisma.transaction.create.mock.calls[0][0].data.concept).toBe('Internet');
  });

  it('acepta el importe máximo de 10000.00', async () => {
    prisma.transaction.create.mockResolvedValue({ id: 'new-id' });

    await request(app.getHttpServer())
      .post('/transactions')
      .send({ ...validBody, amount: '10000.00' })
      .expect(201);

    expect(prisma.transaction.create.mock.calls[0][0].data.amount).toBe('10000.00');
  });

  it('acepta entertainment como categoría de gasto', async () => {
    prisma.transaction.create.mockResolvedValue({ id: 'new-id' });

    await request(app.getHttpServer())
      .post('/transactions')
      .send({ ...validBody, category: 'entertainment' })
      .expect(201);

    expect(prisma.transaction.create.mock.calls[0][0].data.category).toBe('entertainment');
  });

  it('sigue aceptando un gasto sin concepto para clientes antiguos', async () => {
    prisma.transaction.create.mockResolvedValue({ id: 'new-id' });
    const { concept: _concept, ...withoutConcept } = validBody;

    await request(app.getHttpServer()).post('/transactions').send(withoutConcept).expect(201);

    expect(prisma.transaction.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an empty concept', { concept: '   ' }, 'concept'],
    ['a concept longer than 100 characters', { concept: 'a'.repeat(101) }, 'concept'],
    ['a zero amount', { amount: '0' }, 'amount'],
    ['a negative amount', { amount: '-5' }, 'amount'],
    ['an amount over the maximum', { amount: '10000.01' }, 'amount'],
    ['an amount with more than 2 decimals', { amount: '12.999' }, 'amount'],
    ['an unknown category', { category: 'food' }, 'category'],
    ['a debtor id that is not a uuid', { to_user_id: 'abc' }, 'to_user_id'],
  ])('blocks %s with 400 and does not touch the database', async (_, change, field) => {
    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send({ ...validBody, ...change })
      .expect(400);

    expect(response.body.message.join(' ')).toContain(field);
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it('no crea una deuda cuando el pagador es la única persona seleccionada', async () => {
    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send({ ...validBody, to_user_id: payer })
      .expect(201);

    expect(response.body).toEqual([]);
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it('divide el gasto a partes iguales entre varias personas seleccionadas (UT998 varios deudores)', async () => {
    const debtor2 = '9c6c7f97-5938-4d4f-8920-9921a9f873fc';
    prisma.transaction.create.mockImplementation(({ data }) => Promise.resolve({ id: 'id', ...data }));

    const { to_user_id: _single, ...bodyWithoutSingle } = validBody;
    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send({
        ...bodyWithoutSingle,
        amount: '30.00',
        to_user_ids: [debtor, debtor2],
      })
      .expect(201);

    expect(prisma.transaction.create).toHaveBeenCalledTimes(2);
    expect(prisma.transaction.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        to_user_id: debtor,
        amount: '15.00',
      }),
    });
    expect(prisma.transaction.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        to_user_id: debtor2,
        amount: '15.00',
      }),
    });
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('crea una deuda independiente por cada persona seleccionada', async () => {
    const jose = '9c6c7f97-5938-4d4f-8920-9921a9f873fc';
    prisma.transaction.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'id', ...data }),
    );

    const { to_user_id: _single, ...bodyWithoutSingle } = validBody;
    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send({
        ...bodyWithoutSingle,
        amount: '2.00',
        to_user_ids: [debtor, jose],
      })
      .expect(201);

    expect(prisma.transaction.create).toHaveBeenCalledTimes(2);
    expect(prisma.transaction.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        from_user_id: payer,
        to_user_id: debtor,
        amount: '1.00',
      }),
    });
    expect(prisma.transaction.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        from_user_id: payer,
        to_user_id: jose,
        amount: '1.00',
      }),
    });
    expect(response.body).toHaveLength(2);
  });

  it('incluye al pagador en el reparto pero no crea una deuda consigo mismo', async () => {
    const { to_user_id: _single, ...bodyWithoutSingle } = validBody;
    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send({
        ...bodyWithoutSingle,
        amount: '2.00',
        to_user_ids: [debtor, payer],
      })
      .expect(201);

    expect(prisma.transaction.create).toHaveBeenCalledTimes(1);
    expect(prisma.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        to_user_id: debtor,
        amount: '1.00',
      }),
    });
    expect(response.body).toHaveLength(1);
  });

  it('devuelve 400 cuando el apartamento o un usuario no existe', async () => {
    prisma.transaction.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Foreign key failed', {
        code: 'P2003',
        clientVersion: Prisma.prismaVersion.client,
      }),
    );

    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send(validBody)
      .expect(400);

    expect(response.body.message).toBe('Apartment or user not found');
  });
});
