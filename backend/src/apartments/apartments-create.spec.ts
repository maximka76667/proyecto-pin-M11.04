import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../app.setup';
import { PrismaService } from '../prisma/prisma.service';
import { ApartmentsController } from './apartments.controller';
import { ApartmentsService } from './apartments.service';

describe('Apartment creation', () => {
  let app: INestApplication<App>;

  const prisma = {
    apartment: {
      create: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    userApartment: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const landlordId = '8b7c6d5e-4f3a-4210-9b8c-7d6e5f4a3210';
  const apartment = {
    id: '6c5d4e3f-2a19-4876-9b0c-1d2e3f4a5b6c',
    name: 'PisoCentro',
    address: 'Calle Mayor 3',
    landlord_id: landlordId,
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

  it('rejects an empty name with 400 without writing to the database', async () => {
    const response = await request(app.getHttpServer())
      .post('/apartments')
      .send({ name: '', address: 'Calle Mayor 3', landlord_id: landlordId })
      .expect(400);

    expect(response.body.message).toContain('Nombre obligatorio');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an invalid name with 400 without writing to the database', async () => {
    const response = await request(app.getHttpServer())
      .post('/apartments')
      .send({
        name: 'Piso_Crazy_🔥_2026!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
        address: 'Calle Mayor 3',
        landlord_id: landlordId,
      })
      .expect(400);

    expect(response.body.message).toContain(
      'El nombre debe tener entre 3 y 50 caracteres y solo contener letras y números',
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates the apartment and links the landlord as its organizer', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: landlordId,
      is_landlord: true,
    });
    prisma.apartment.create.mockResolvedValue(apartment);
    prisma.$transaction.mockImplementation((callback) =>
      callback({
        apartment: { create: prisma.apartment.create },
        userApartment: { create: prisma.userApartment.create },
      }),
    );

    const response = await request(app.getHttpServer())
      .post('/apartments')
      .send({
        name: apartment.name,
        address: apartment.address,
        landlord_id: landlordId,
      })
      .expect(201);

    expect(prisma.apartment.create).toHaveBeenCalledWith({
      data: {
        name: apartment.name,
        address: apartment.address,
        landlord_id: landlordId,
      },
    });
    expect(prisma.userApartment.create).toHaveBeenCalledWith({
      data: { user_id: landlordId, apartment_id: apartment.id },
    });
    expect(response.body).toEqual(apartment);
  });
});
