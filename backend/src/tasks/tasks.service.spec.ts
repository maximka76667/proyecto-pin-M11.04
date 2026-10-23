import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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
      update: jest.fn(),
      delete: jest.fn(),
    },
    taskAssignment: {
      deleteMany: jest.fn(),
    },
    userApartment: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
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
        description: null,
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

  it('PA edición: actualiza nombre, descripción y frecuencia para un miembro del hogar', async () => {
    prisma.task.findUnique
      .mockResolvedValueOnce({ apartment_id: 'apartment-1' })
      .mockResolvedValueOnce({ id: 'task-1', apartment_id: 'apartment-1' });
    prisma.userApartment.findUnique.mockResolvedValue({ user_id: 'user-1' });
    const updated = {
      id: 'task-1',
      title: 'Clean kitchen',
      description: 'Every Monday',
      frequency: 'weekly',
      assignments: [{ id: 'assignment-1', status: 'completed' }],
    };
    prisma.task.update.mockResolvedValue(updated);

    await expect(
      service.update(
        'task-1',
        {
          title: '  Clean kitchen  ',
          description: '  Every Monday  ',
          frequency: 'weekly',
        },
        'user-1',
      ),
    ).resolves.toBe(updated);

    expect(prisma.task.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: {
        title: 'Clean kitchen',
        description: 'Every Monday',
        frequency: 'weekly',
      },
      include: {
        assignments: {
          include: { user: { select: { id: true, full_name: true } } },
          orderBy: { due_date: 'asc' },
        },
      },
    });
  });

  it('PA permisos de edición: rechaza la modificación si el usuario no pertenece al hogar', async () => {
    prisma.task.findUnique.mockResolvedValue({ apartment_id: 'apartment-1' });
    prisma.userApartment.findUnique.mockResolvedValue(null);

    await expect(
      service.update('task-1', { title: 'Changed title' }, 'outsider'),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it('PA eliminación: borra la tarea y todas sus asignaciones en una única transacción', async () => {
    prisma.task.findUnique.mockResolvedValue({ apartment_id: 'apartment-1' });
    prisma.userApartment.findUnique.mockResolvedValue({ user_id: 'user-1' });
    prisma.taskAssignment.deleteMany.mockResolvedValue({ count: 2 });
    prisma.task.delete.mockResolvedValue({ id: 'task-1', title: 'Old task' });
    prisma.$transaction.mockResolvedValue([
      { count: 2 },
      { id: 'task-1', title: 'Old task' },
    ]);

    await expect(service.remove('task-1', 'user-1')).resolves.toEqual({
      id: 'task-1',
      title: 'Old task',
    });

    expect(prisma.$transaction).toHaveBeenCalledWith([
      expect.any(Promise),
      expect.any(Promise),
    ]);
    expect(prisma.taskAssignment.deleteMany).toHaveBeenCalledWith({
      where: { task_id: 'task-1' },
    });
    expect(prisma.task.delete).toHaveBeenCalledWith({
      where: { id: 'task-1' },
    });
  });

  it('PA atomicidad de eliminación: no continúa con un borrado parcial si falla la transacción', async () => {
    prisma.task.findUnique.mockResolvedValue({ apartment_id: 'apartment-1' });
    prisma.userApartment.findUnique.mockResolvedValue({ user_id: 'user-1' });
    prisma.$transaction.mockRejectedValue(new Error('database unavailable'));

    await expect(service.remove('task-1', 'user-1')).rejects.toThrow(
      'database unavailable',
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
