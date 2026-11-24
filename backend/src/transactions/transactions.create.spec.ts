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
// Un gasto manual es un Expense sin ticket (receipt_id vacío) y una deuda por persona.
describe('POST /transactions (UT998)', () => {
  let app: INestApplication<App>;

  const prisma = {
    expense: { create: jest.fn() },
    transaction: { createMany: jest.fn() },
    userApartment: { findUnique: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  };

  // Por orden de id: payer < debtor < debtor2
  const payer = '3f0c9a4e-8b1d-4c2a-9e7f-5a6b7c8d9e0f';
  const debtor = '8b7c6d5e-4f3a-4210-9b8c-7d6e5f4a3210';
  const debtor2 = '9c6c7f97-5938-4d4f-8920-9921a9f873fc';
  const apartment = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';

  const validBody = {
    apartment_id: apartment,
    from_user_id: payer,
    to_user_id: debtor,
    amount: '18.40',
    concept: 'Compra del súper',
    category: 'supplies',
  };

  // Lo que se guarda: el gasto y sus deudas
  const gastoGuardado = () => prisma.expense.create.mock.calls[0][0].data;
  const deudasGuardadas = () =>
    prisma.transaction.createMany.mock.calls.flatMap(([{ data }]) => data);

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
    // Todos los usuarios del test viven en el piso: quien llama y los ids que se piden
    prisma.userApartment.findUnique.mockResolvedValue({ user_id: payer });
    prisma.userApartment.findMany.mockImplementation(
      ({ where }: { where: { user_id: { in: string[] } } }) =>
        Promise.resolve(where.user_id.in.map((user_id) => ({ user_id }))),
    );
    prisma.expense.create.mockResolvedValue({});
    prisma.transaction.createMany.mockResolvedValue({ count: 1 });
    // La transacción interactiva recibe el cliente; en el test es el propio mock
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  });

  it('guarda el gasto con su concepto', async () => {
    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send(validBody)
      .expect(201);

    expect(gastoGuardado()).toEqual(
      expect.objectContaining({
        apartment_id: apartment,
        payer_id: payer,
        total_amount: '18.40',
        concept: 'Compra del súper',
        category: 'supplies',
      }),
    );
    expect(deudasGuardadas()).toEqual([
      expect.objectContaining({
        expense_id: gastoGuardado().id,
        apartment_id: apartment,
        from_user_id: payer,
        to_user_id: debtor,
        amount: '18.40',
        concept: 'Compra del súper',
        category: 'supplies',
      }),
    ]);
    expect(response.body.concept).toBe('Compra del súper');
  });

  it('un gasto manual no pertenece a ningún ticket', async () => {
    await request(app.getHttpServer()).post('/transactions').send(validBody).expect(201);

    expect(gastoGuardado().receipt_id).toBeUndefined();
  });

  it('guarda el gasto y sus deudas en una sola transacción', async () => {
    await request(app.getHttpServer()).post('/transactions').send(validBody).expect(201);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('elimina los espacios alrededor del concepto', async () => {
    await request(app.getHttpServer())
      .post('/transactions')
      .send({ ...validBody, concept: '  Internet  ' })
      .expect(201);

    expect(gastoGuardado().concept).toBe('Internet');
    expect(deudasGuardadas()[0].concept).toBe('Internet');
  });

  it('acepta el importe máximo de 10000.00', async () => {
    await request(app.getHttpServer())
      .post('/transactions')
      .send({ ...validBody, amount: '10000.00' })
      .expect(201);

    expect(gastoGuardado().total_amount).toBe('10000.00');
    expect(deudasGuardadas()[0].amount).toBe('10000.00');
  });

  it('acepta entertainment como categoría de gasto', async () => {
    await request(app.getHttpServer())
      .post('/transactions')
      .send({ ...validBody, category: 'entertainment' })
      .expect(201);

    expect(gastoGuardado().category).toBe('entertainment');
  });

  it('sigue aceptando un gasto sin concepto para clientes antiguos', async () => {
    const { concept: _concept, ...withoutConcept } = validBody;

    await request(app.getHttpServer()).post('/transactions').send(withoutConcept).expect(201);

    expect(prisma.expense.create).toHaveBeenCalledTimes(1);
    expect(prisma.transaction.createMany).toHaveBeenCalledTimes(1);
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
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  // RF-01 PA-04: el pagador es obligatorio
  it('rechaza con 400 un gasto sin pagador (from_user_id) y no toca la base de datos', async () => {
    const { from_user_id: _pagador, ...sinPagador } = validBody;

    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send(sinPagador)
      .expect(400);

    expect(response.body.message).toContain('from_user_id must be a UUID');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  it('rechaza con 400 un gasto sin ningún deudor y no toca la base de datos', async () => {
    const { to_user_id: _deudor, ...sinDeudor } = validBody;

    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send(sinDeudor)
      .expect(400);

    expect(response.body.message).toBe('At least one debtor must be specified');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  it('no crea una deuda cuando el pagador es la única persona seleccionada', async () => {
    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send({ ...validBody, to_user_id: payer })
      .expect(201);

    expect(response.body).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  it('divide el gasto a partes iguales entre varias personas seleccionadas (UT998 varios deudores)', async () => {
    const { to_user_id: _single, ...bodyWithoutSingle } = validBody;
    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send({
        ...bodyWithoutSingle,
        amount: '30.00',
        to_user_ids: [debtor, debtor2],
      })
      .expect(201);

    // Un solo gasto de 30,00 con una deuda por persona; el pagador no reparte
    expect(prisma.expense.create).toHaveBeenCalledTimes(1);
    expect(gastoGuardado()).toEqual(
      expect.objectContaining({ total_amount: '30.00', payer_participates: false }),
    );
    expect(deudasGuardadas()).toEqual([
      expect.objectContaining({ to_user_id: debtor, amount: '15.00' }),
      expect.objectContaining({ to_user_id: debtor2, amount: '15.00' }),
    ]);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('crea una deuda independiente por cada persona seleccionada', async () => {
    const { to_user_id: _single, ...bodyWithoutSingle } = validBody;
    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send({
        ...bodyWithoutSingle,
        amount: '2.00',
        to_user_ids: [debtor, debtor2],
      })
      .expect(201);

    expect(deudasGuardadas()).toEqual([
      expect.objectContaining({ from_user_id: payer, to_user_id: debtor, amount: '1.00' }),
      expect.objectContaining({ from_user_id: payer, to_user_id: debtor2, amount: '1.00' }),
    ]);
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

    expect(gastoGuardado().payer_participates).toBe(true);
    expect(deudasGuardadas()).toEqual([
      expect.objectContaining({ to_user_id: debtor, amount: '1.00' }),
    ]);
    expect(response.body).toHaveLength(1);
  });

  it('reparte el importe exacto: los céntimos sobrantes van a las primeras personas por id', async () => {
    // 10,00 € entre 3 = 3,33 y sobra 1 céntimo. El pagador tiene el id más bajo y se lo queda,
    // así que los demás deben 3,33 y la parte del pagador es 3,34: suman los 10,00 €
    const { to_user_id: _single, ...bodyWithoutSingle } = validBody;
    await request(app.getHttpServer())
      .post('/transactions')
      .send({
        ...bodyWithoutSingle,
        amount: '10.00',
        to_user_ids: [payer, debtor, debtor2],
      })
      .expect(201);

    expect(gastoGuardado().total_amount).toBe('10.00');
    expect(deudasGuardadas()).toEqual([
      expect.objectContaining({ to_user_id: debtor, amount: '3.33' }),
      expect.objectContaining({ to_user_id: debtor2, amount: '3.33' }),
    ]);
  });

  it('devuelve 400 cuando el apartamento o un usuario no existe', async () => {
    prisma.expense.create.mockRejectedValue(
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
