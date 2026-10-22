import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../app.setup';
import { PrismaService } from '../prisma/prisma.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

describe('POST /tasks validation', () => {
  let app: INestApplication<App>;

  const prisma = {
    task: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
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
    ['missing apartment', { title: 'Clean bathroom', frequency: 'weekly' }, 'apartment_id'],
    ['missing title', {
      apartment_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      frequency: 'weekly',
    }, 'title'],
    ['missing frequency', {
      apartment_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      title: 'Clean bathroom',
    }, 'frequency'],
    ['invalid frequency', {
      apartment_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      title: 'Clean bathroom',
      frequency: 'every-five-days',
    }, 'frequency'],
  ])('rejects %s before reaching Prisma', async (_, body, field) => {
    const response = await request(app.getHttpServer())
      .post('/tasks')
      .send(body)
      .expect(400);

    expect(response.body.message.join(' ')).toContain(field);
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('rejects an apartment identifier with an invalid shape', async () => {
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

  it('rejects unknown fields', async () => {
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
});
