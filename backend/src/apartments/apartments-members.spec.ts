import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../app.setup';
import { PrismaService } from '../prisma/prisma.service';
import { ApartmentsController } from './apartments.controller';
import { ApartmentsService } from './apartments.service';

// GET /apartments/:id/members: lista de convivientes para repartir un ticket.
// Usa la misma regla que createFromReceipt (user_apartments) para que todo el que
// aparece en la pantalla pueda elegirse sin que el backend lo rechace.
describe('GET /apartments/:id/members', () => {
  let app: INestApplication<App>;

  const prisma = {
    apartment: { findUnique: jest.fn() },
    user: { findMany: jest.fn() },
  };

  const piso = '6c5d4e3f-2a19-4876-9b0c-1d2e3f4a5b6c';
  // El usuario que devuelve @CurrentUser() mientras no hay login
  const usuarioActual = '22222222-2222-2222-2222-222222222222';
  const companero = '3f0c9a4e-8b1d-4c2a-9e7f-5a6b7c8d9e0f';

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ApartmentsController],
      providers: [ApartmentsService, { provide: PrismaService, useValue: prisma }],
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
    prisma.apartment.findUnique.mockResolvedValue({ id: piso });
  });

  it('busca solo a los miembros de user_apartments, no al casero por separado', async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await request(app.getHttpServer()).get(`/apartments/${piso}/members`).expect(200);

    const { where } = prisma.user.findMany.mock.calls[0][0];
    expect(where).toEqual({ user_apartments: { some: { apartment_id: piso } } });
  });

  it('marca al usuario actual para que la app lo pueda quitar de la lista', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: companero, full_name: 'Ana' },
      { id: usuarioActual, full_name: 'Bruno' },
    ]);

    const response = await request(app.getHttpServer())
      .get(`/apartments/${piso}/members`)
      .expect(200);

    expect(response.body).toEqual([
      { id: companero, full_name: 'Ana', isCurrentUser: false },
      { id: usuarioActual, full_name: 'Bruno', isCurrentUser: true },
    ]);
  });

  it('devuelve 404 si el piso no existe', async () => {
    prisma.apartment.findUnique.mockResolvedValue(null);

    await request(app.getHttpServer()).get(`/apartments/${piso}/members`).expect(404);

    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
