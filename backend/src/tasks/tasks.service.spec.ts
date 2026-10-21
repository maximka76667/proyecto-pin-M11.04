import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from './tasks.service';

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('Prisma error', {
    code,
    clientVersion: Prisma.prismaVersion.client,
  });
}

describe('TasksService', () => {
  let service: TasksService;

  const prisma = {
    task: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
  });

  it('creates a pending task with safe defaults', async () => {
    const created = { id: 'task-1', title: 'Take out recycling' };
    prisma.task.findFirst.mockResolvedValue(null);
    prisma.task.create.mockResolvedValue(created);

    await expect(
      service.create({
        apartment_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        title: '  Take out recycling  ',
        frequency: 'weekly',
        category: 'cleaning',
      }),
    ).resolves.toBe(created);

    expect(prisma.task.create).toHaveBeenCalledWith({
      data: {
        apartment_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        title: 'Take out recycling',
        frequency: 'weekly',
        status: 'pending',
        category: 'cleaning',
        priority: 'medium',
      },
      include: { assignments: true },
    });
  });

  it('rejects a title containing only whitespace before touching the database', async () => {
    await expect(
      service.create({
        apartment_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        title: '   ',
        frequency: 'daily',
        category: 'cleaning',
      }),
    ).rejects.toThrow('El nombre de la tarea es obligatorio');

    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('rejects an existing task name before inserting a duplicate', async () => {
    prisma.task.findFirst.mockResolvedValue({ id: 'existing-task' });

    await expect(
      service.create({
        apartment_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        title: 'Take out recycling',
        frequency: 'weekly',
        category: 'cleaning',
      }),
    ).rejects.toThrow(ConflictException);

    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('maps duplicate task names to a conflict', async () => {
    prisma.task.create.mockRejectedValue(prismaError('P2002'));

    await expect(
      service.create({
        apartment_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        title: 'Take out recycling',
        frequency: 'weekly',
        category: 'cleaning',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('returns task details with assignments', async () => {
    const task = {
      id: 'task-1',
      title: 'Clean bathroom',
      assignments: [],
    };
    prisma.task.findUnique.mockResolvedValue(task);

    await expect(service.findOne('task-1')).resolves.toBe(task);
    expect(prisma.task.findUnique).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      include: {
        assignments: {
          include: { user: { select: { id: true, full_name: true } } },
          orderBy: { due_date: 'asc' },
        },
      },
    });
  });

  it('returns not found when task details do not exist', async () => {
    prisma.task.findUnique.mockResolvedValue(null);

    await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
  });
});
