import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../app.setup';
import { PrismaService } from '../prisma/prisma.service';
import { ApartmentsController } from './apartments.controller';
import { ApartmentsService } from './apartments.service';

describe('Invitaciones de apartamentos (PA-997.01 y PA-997.02)', () => {
  let app: INestApplication<App>;

  const prisma = {
    apartment: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const inviteCode = '3f0c9a4e-8b1d-4c2a-9e7f-5a6b7c8d9e0f';
  const apartment = {
    id: '8b7c6d5e-4f3a-4210-9b8c-7d6e5f4a3210',
    name: 'Piso Centro',
    address: 'Calle Mayor 3',
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ApartmentsController],
      providers: [
        ApartmentsService,
        { provide: PrismaService, useValue: prisma },
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

  it('genera un código de invitación UUID para el apartamento seleccionado', async () => {
    prisma.apartment.update.mockImplementation(({ where, data }) => ({
      id: where.id,
      invite_code: data.invite_code,
    }));

    const response = await request(app.getHttpServer())
      .post(`/apartments/${apartment.id}/invitation`)
      .expect(201);

    expect(prisma.apartment.update).toHaveBeenCalledWith({
      where: { id: apartment.id },
      data: { invite_code: expect.stringMatching(/^[0-9a-f-]{36}$/i) },
      select: { id: true, invite_code: true },
    });
    expect(response.body.id).toBe(apartment.id);
    expect(response.body.invite_code).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('devuelve 404 para un código desconocido y no crea usuario ni pertenencia', async () => {
    prisma.apartment.findUnique.mockResolvedValue(null);

    const response = await request(app.getHttpServer())
      .post('/apartments/join')
      .send({ invite_code: inviteCode, full_name: 'Alex' })
      .expect(404);

    expect(response.body.message).toBe(
      'El código introducido no es válido o ha caducado',
    );
    expect(prisma.apartment.findUnique).toHaveBeenCalledWith({
      where: { invite_code: inviteCode },
      select: { id: true, name: true, address: true },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('devuelve 404 para un UUID mal escrito después de consultar la base de datos', async () => {
    prisma.apartment.findUnique.mockResolvedValue(null);

    const response = await request(app.getHttpServer())
      .post('/apartments/join')
      .send({
        invite_code: '3f0c9a4e-8b1d-4c2a-9e7f-5a6b7c8d9e01',
        full_name: 'Alex',
      })
      .expect(404);

    expect(response.body.message).toBe(
      'El código introducido no es válido o ha caducado',
    );
    expect(prisma.apartment.findUnique).toHaveBeenCalledWith({
      where: { invite_code: '3f0c9a4e-8b1d-4c2a-9e7f-5a6b7c8d9e01' },
      select: { id: true, name: true, address: true },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('añade un usuario invitado al apartamento cuando el código es válido', async () => {
    const user = {
      id: '6c5d4e3f-2a19-4876-9b0c-1d2e3f4a5b6c',
      full_name: 'Alex',
    };
    const createUser = jest.fn().mockResolvedValue(user);
    const createMembership = jest.fn().mockResolvedValue({
      user_id: user.id,
      apartment_id: apartment.id,
    });

    prisma.apartment.findUnique.mockResolvedValue(apartment);
    prisma.$transaction.mockImplementation((callback) =>
      callback({
        user: { create: createUser },
        userApartment: { create: createMembership },
      }),
    );

    const response = await request(app.getHttpServer())
      .post('/apartments/join')
      .send({ invite_code: inviteCode, full_name: 'Alex' })
      .expect(201);

    expect(createUser).toHaveBeenCalledWith({
      data: {
        full_name: 'Alex',
        email: null,
        is_landlord: false,
      },
      select: { id: true, full_name: true },
    });
    expect(createMembership).toHaveBeenCalledWith({
      data: { user_id: user.id, apartment_id: apartment.id },
    });
    expect(response.body).toEqual({ apartment, user });
  });
});
