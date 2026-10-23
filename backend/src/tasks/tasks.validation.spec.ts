import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../app.setup';
import { PrismaService } from '../prisma/prisma.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

describe('Validación de tareas', () => {
  let app: INestApplication<App>;

  const prisma = {
    task: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    userApartment: {
      findUnique: jest.fn(),
    },
    taskAssignment: {
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        TasksService,
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

  it.each([
    ['sin apartamento', { title: 'Clean bathroom', frequency: 'weekly' }, 'apartment_id'],
    ['sin nombre', {
      apartment_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      frequency: 'weekly',
    }, 'title'],
    ['sin frecuencia', {
      apartment_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      title: 'Clean bathroom',
    }, 'frequency'],
    ['frecuencia inválida', {
      apartment_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      title: 'Clean bathroom',
      frequency: 'every-five-days',
    }, 'frequency'],
  ])('rechaza %s antes de acceder a Prisma', async (_, body, field) => {
    const response = await request(app.getHttpServer())
      .post('/tasks')
      .send(body)
      .expect(400);

    const message = Array.isArray(response.body.message)
      ? response.body.message.join(' ')
      : response.body.message;
    expect(message).toContain(field);
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('rechaza un identificador de apartamento con formato inválido', async () => {
    await request(app.getHttpServer())
      .post('/tasks')
      .send({
        apartment_id: 'not-an-id',
        title: 'Clean bathroom',
        frequency: 'weekly',
      })
      .expect(400);

    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('rechaza campos desconocidos', async () => {
    await request(app.getHttpServer())
      .post('/tasks')
      .send({
        apartment_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        title: 'Clean bathroom',
        frequency: 'weekly',
        category: 'cleaning',
        // la prioridad la decide el servidor, no el cliente
        priority: 'high',
      })
      .expect(400);

    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('PA validación de edición: rechaza un nombre vacío antes de acceder a Prisma', async () => {
    const response = await request(app.getHttpServer())
      .patch('/tasks/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
      .send({ title: '   ' })
      .expect(400);

    const message = Array.isArray(response.body.message)
      ? response.body.message.join(' ')
      : response.body.message;
    expect(message).toContain('nombre');
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it('PA validación de edición: rechaza una frecuencia inválida antes de acceder a Prisma', async () => {
    const response = await request(app.getHttpServer())
      .patch('/tasks/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
      .send({ frequency: 'never' })
      .expect(400);

    const message = Array.isArray(response.body.message)
      ? response.body.message.join(' ')
      : response.body.message;
    expect(message).toContain('frequency');
    expect(prisma.task.update).not.toHaveBeenCalled();
  });
});
