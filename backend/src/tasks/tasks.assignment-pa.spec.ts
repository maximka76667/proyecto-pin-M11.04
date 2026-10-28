import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from './tasks.service';

describe('PA de asignación de tareas', () => {
  let service: TasksService;

  const prisma = {
    task: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    taskAssignment: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
      delete: jest.fn(),
    },
    userApartment: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };

  const input = { due_date: '2026-10-28', due_time: '12:30' };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [TasksService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<TasksService>(TasksService);
    prisma.task.findUnique.mockResolvedValue({
      apartment_id: 'home-1',
      status: 'pending',
    });
    prisma.userApartment.findUnique.mockResolvedValue({ user_id: 'member-1' });
    prisma.taskAssignment.findFirst.mockResolvedValue(null);
    prisma.taskAssignment.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: `assignment-${data.user_id}`, ...data }),
    );
    prisma.task.update.mockResolvedValue({ status: 'assigned' });
    prisma.$transaction.mockImplementation((operations) =>
      Promise.all(operations),
    );
  });

  it('PA 1: asigna una tarea a un miembro del hogar', async () => {
    await expect(
      service.createAssignment(
        'task-1',
        { ...input, user_id: 'member-2' },
        'member-1',
      ),
    ).resolves.toMatchObject({ task_id: 'task-1', user_id: 'member-2' });
    expect(prisma.taskAssignment.create).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('PA 2: rechaza una tarea inexistente o un miembro ajeno al hogar sin guardar', async () => {
    prisma.task.findUnique.mockResolvedValue(null);
    await expect(
      service.createAssignment(
        'missing',
        { ...input, user_id: 'member-2' },
        'member-1',
      ),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.taskAssignment.create).not.toHaveBeenCalled();

    prisma.task.findUnique.mockResolvedValue({
      apartment_id: 'home-1',
      status: 'pending',
    });
    prisma.userApartment.findUnique
      .mockResolvedValueOnce({ user_id: 'member-1' })
      .mockResolvedValueOnce(null);
    await expect(
      service.createAssignment(
        'task-1',
        { ...input, user_id: 'outsider' },
        'member-1',
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.taskAssignment.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('PA 3: asigna al grupo de miembros de forma independiente y atómica', async () => {
    await expect(
      service.createAssignment(
        'task-1',
        { ...input, user_ids: ['member-2', 'member-3'] },
        'member-1',
      ),
    ).resolves.toHaveLength(2);
    expect(prisma.taskAssignment.create).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('PA 4: rechaza si un miembro ya tiene una tarea a esa hora', async () => {
    prisma.taskAssignment.findFirst.mockResolvedValue({
      user: { full_name: 'Joan Martí' },
    });
    await expect(
      service.createAssignment(
        'task-1',
        { ...input, user_id: 'member-2' },
        'member-1',
      ),
    ).rejects.toThrow(ConflictException);
    expect(prisma.taskAssignment.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('PA 5: rechaza una asignación sin responsables antes de consultar la tarea', async () => {
    await expect(
      service.createAssignment(
        'task-1',
        { ...input, user_ids: [] },
        'member-1',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.task.findUnique).not.toHaveBeenCalled();
    expect(prisma.taskAssignment.create).not.toHaveBeenCalled();
  });

  it('PA 6: eliminar una asignación debe conservar la tarea y sus otras asignaciones', async () => {
    prisma.taskAssignment.findUnique.mockResolvedValue({
      id: 'assignment-1',
      task: { apartment_id: 'home-1' },
    });
    prisma.taskAssignment.delete.mockResolvedValue({ id: 'assignment-1' });

    await (
      service as unknown as {
        removeAssignment: (id: string, userId: string) => Promise<unknown>;
      }
    ).removeAssignment('assignment-1', 'member-1');

    expect(prisma.taskAssignment.delete).toHaveBeenCalledWith({
      where: { id: 'assignment-1' },
    });
    expect(prisma.task.delete).not.toHaveBeenCalled();
    expect(prisma.taskAssignment.deleteMany).not.toHaveBeenCalled();
  });
});
