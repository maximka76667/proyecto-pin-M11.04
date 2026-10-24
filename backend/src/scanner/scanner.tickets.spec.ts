import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { App } from 'supertest/types';
import { join } from 'node:path';
import { configureApp } from '../app.setup';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { TransactionsController } from '../transactions/transactions.controller';
import { TransactionsService } from '../transactions/transactions.service';
import { ScannerController } from './scanner.controller';
import { ScannerService } from './scanner.service';

const generateContent = jest.fn();
jest.mock('@google/genai', () => ({
  ...jest.requireActual('@google/genai'),
  GoogleGenAI: jest.fn(() => ({ models: { generateContent } })),
}));

const TICKETS = join(__dirname, '../../test/tickets');
const USUARIO = '22222222-2222-2222-2222-222222222222';
const COMPANERO = '3f0c9a4e-8b1d-4c2a-9e7f-5a6b7c8d9e0f';
const PISO = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function respuestaOCR(items: object[], comercio = 'Consum') {
  generateContent.mockResolvedValue({
    text: JSON.stringify({ comercio, items }),
  });
}

describe('Flujo de escaneo de tickets con imágenes reales', () => {
  let app: INestApplication<App>;

  const prisma = {
    apartment: { findUnique: jest.fn() },
    transaction: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ScannerController, TransactionsController],
      providers: [
        ScannerService,
        TransactionsService,
        {
          provide: ConfigService,
          useValue: {
            get: (name: string) =>
              name === 'GEMINI_API_KEY' ? 'clave-de-prueba' : undefined,
          },
        },
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
      user_apartments: [{ user_id: USUARIO }, { user_id: COMPANERO }],
    });
    prisma.transaction.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'transaction-id', ...data }),
    );
    prisma.$transaction.mockImplementation((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    );
  });

  it('rechaza un ticket ilegible sin consultar ni modificar la base de datos', async () => {
    respuestaOCR([]);

    const response = await request(app.getHttpServer())
      .post('/scanner/ticket')
      .attach('image', join(TICKETS, 'invalid-ticket.webp'))
      .expect(400);

    expect(response.body.message).toBe(
      'Ticket no legible. Introduce el gasto manualmente.',
    );
    expect(prisma.apartment.findUnique).not.toHaveBeenCalled();
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it('devuelve los productos reconocidos de un ticket válido sin registrar el gasto', async () => {
    const productos = [
      {
        name: 'Leche entera',
        quantity: 2,
        unit_price: '0.95',
        category: 'supplies',
      },
      {
        name: 'Agua mineral',
        quantity: 1,
        unit_price: '1.20',
        category: 'supplies',
      },
    ];
    respuestaOCR(productos);

    const response = await request(app.getHttpServer())
      .post('/scanner/ticket')
      .attach('image', join(TICKETS, 'consum-1.jpg'))
      .expect(201);

    expect(response.body).toEqual({ comercio: 'Consum', items: productos });
    expect(prisma.apartment.findUnique).not.toHaveBeenCalled();
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it('permite corregir un precio OCR antes de guardar el gasto del ticket dañado', async () => {
    respuestaOCR([
      {
        name: 'Producto arrugado',
        quantity: 1,
        unit_price: '999.00',
        category: 'supplies',
      },
    ]);

    const scanResponse = await request(app.getHttpServer())
      .post('/scanner/ticket')
      .attach('image', join(TICKETS, 'crumpled-1.jpg'))
      .expect(201);

    expect(scanResponse.body.items[0].unit_price).toBe('999.00');

    const saveResponse = await request(app.getHttpServer())
      .post('/transactions/from-receipt')
      .send({
        apartment_id: PISO,
        participant_ids: [COMPANERO],
        items: [
          {
            name: 'Producto arrugado',
            quantity: 1,
            unit_price: '9.99',
          },
        ],
        category: 'supplies',
      })
      .expect(201);

    expect(saveResponse.body.transactions).toHaveLength(1);
    expect(saveResponse.body.transactions[0].amount).toBe('5.00');
    expect(prisma.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        apartment_id: PISO,
        from_user_id: USUARIO,
        to_user_id: COMPANERO,
        amount: '5.00',
        category: 'supplies',
      }),
    });
  });

  it('bloquea precios o cantidades inválidos antes de consultar Prisma', async () => {
    respuestaOCR([
      {
        name: 'Producto',
        quantity: 1,
        unit_price: '1.00',
        category: 'supplies',
      },
    ]);

    await request(app.getHttpServer())
      .post('/scanner/ticket')
      .attach('image', join(TICKETS, 'consum-1.jpg'))
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/transactions/from-receipt')
      .send({
        apartment_id: PISO,
        participant_ids: [COMPANERO],
        items: [
          {
            name: 'Producto',
            quantity: 999999999,
            unit_price: '-5',
          },
        ],
        category: 'supplies',
      })
      .expect(400);

    expect(response.body.message.join(' ')).toMatch(/unit_price|quantity/);
    expect(prisma.apartment.findUnique).not.toHaveBeenCalled();
    expect(prisma.transaction.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
