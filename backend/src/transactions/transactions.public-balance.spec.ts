import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../app.setup';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

describe('GET /transactions/public-balance/:inviteCode (PA-997.01)', () => {
  let app: INestApplication<App>;

  const prisma = {
    apartment: { findUnique: jest.fn() },
    transaction: {
      findMany: jest.fn(),
      aggregate: jest.fn(),
    },
  };
  const usersService = { getUserNames: jest.fn() };
  const inviteCode = '3f0c9a4e-8b1d-4c2a-9e7f-5a6b7c8d9e0f';

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [TransactionsController],
      providers: [
        TransactionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
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

  it('devuelve el nombre del apartamento y el balance público sin sesión de usuario', async () => {
    prisma.apartment.findUnique.mockResolvedValue({
      id: 'apartment-id',
      name: 'Piso Centro',
    });
    prisma.transaction.findMany.mockResolvedValue([]);
    usersService.getUserNames.mockResolvedValue({});

    const response = await request(app.getHttpServer())
      .get(`/transactions/public-balance/${inviteCode}`)
      .expect(200);

    expect(response.body).toEqual({
      apartment: { name: 'Piso Centro' },
      globalPayments: [],
    });
    expect(prisma.apartment.findUnique).toHaveBeenCalledWith({
      where: { invite_code: inviteCode },
      select: { id: true, name: true },
    });
  });

  it('devuelve 404 para un código de invitación inválido', async () => {
    const response = await request(app.getHttpServer())
      .get('/transactions/public-balance/not-a-code')
      .expect(404);

    expect(response.body.message).toBe(
      'El código introducido no es válido o ha caducado',
    );
    expect(prisma.apartment.findUnique).not.toHaveBeenCalled();
    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
  });
});
