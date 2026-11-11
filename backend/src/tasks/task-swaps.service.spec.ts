import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from './tasks.service';
import { TaskSwapsService } from './task-swaps.service';

const DUE_DATE = new Date('2026-11-10T00:00:00.000Z');

// Asignación de Ana (emisor A), tarea "Fregar".
function fromAssignment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'assign-A',
    user_id: 'user-A',
    due_date: DUE_DATE,
    due_time: '10:00',
    start_minute: 540,
    user: { id: 'user-A', full_name: 'Ana' },
    task: {
      id: 'task-A',
      title: 'Fregar',
      apartment_id: 'apt-1',
      duration_minutes: 30,
    },
    ...overrides,
  };
}

// Asignación de Beto (receptor B), tarea "Basura".
function toAssignment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'assign-B',
    user_id: 'user-B',
    due_date: DUE_DATE,
    due_time: '12:00',
    start_minute: 720,
    user: { id: 'user-B', full_name: 'Beto' },
    task: {
      id: 'task-B',
      title: 'Basura',
      apartment_id: 'apt-1',
      duration_minutes: 30,
    },
    ...overrides,
  };
}

function pendingRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'swap-1',
    apartment_id: 'apt-1',
    from_user_id: 'user-A',
    to_user_id: 'user-B',
    from_assignment_id: 'assign-A',
    to_assignment_id: 'assign-B',
    status: 'pending',
    from_assignment: fromAssignment(),
    to_assignment: toAssignment(),
    ...overrides,
  };
}

describe('TaskSwapsService', () => {
  let service: TaskSwapsService;

  const prisma = {
    taskAssignment: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    taskSwapRequest: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const tasksService = {
    assertMember: jest.fn(),
    assertUserFreeAt: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    tasksService.assertMember.mockResolvedValue(undefined);
    tasksService.assertUserFreeAt.mockResolvedValue(undefined);
    prisma.taskAssignment.update.mockResolvedValue({});
    prisma.taskSwapRequest.delete.mockResolvedValue({});
    prisma.taskSwapRequest.update.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskSwapsService,
        { provide: PrismaService, useValue: prisma },
        { provide: TasksService, useValue: tasksService },
      ],
    }).compile();

    service = module.get<TaskSwapsService>(TaskSwapsService);
  });

  describe('createSwapRequest (PA-1010.01 / PA-1010.04)', () => {
    it('crea una petición dirigida válida ofreciendo la tarea propia a cambio de otra', async () => {
      prisma.taskAssignment.findUnique
        .mockResolvedValueOnce(fromAssignment())
        .mockResolvedValueOnce(toAssignment());
      prisma.taskSwapRequest.findFirst.mockResolvedValue(null);
      const created = { id: 'swap-1' };
      prisma.taskSwapRequest.create.mockResolvedValue(created);

      await expect(
        service.createSwapRequest('assign-A', 'assign-B', 'user-A'),
      ).resolves.toBe(created);

      expect(prisma.taskSwapRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            apartment_id: 'apt-1',
            from_user_id: 'user-A',
            to_user_id: 'user-B',
            from_assignment_id: 'assign-A',
            to_assignment_id: 'assign-B',
          },
        }),
      );
      // Disponibilidad cruzada: A libre en el hueco de B (ignorando su propia tarea A) y
      // B libre en el hueco de A (ignorando su propia tarea B).
      expect(tasksService.assertUserFreeAt).toHaveBeenCalledWith(
        'user-A',
        DUE_DATE,
        720,
        30,
        'assign-A',
      );
      expect(tasksService.assertUserFreeAt).toHaveBeenCalledWith(
        'user-B',
        DUE_DATE,
        600,
        30,
        'assign-B',
      );
    });

    it('no crea la petición si no hay disponibilidad cruzada (PA-1010.04)', async () => {
      prisma.taskAssignment.findUnique
        .mockResolvedValueOnce(fromAssignment())
        .mockResolvedValueOnce(toAssignment());
      prisma.taskSwapRequest.findFirst.mockResolvedValue(null);
      tasksService.assertUserFreeAt.mockRejectedValue(
        new ConflictException('Beto no tiene disponibilidad'),
      );

      await expect(
        service.createSwapRequest('assign-A', 'assign-B', 'user-A'),
      ).rejects.toThrow(ConflictException);

      expect(prisma.taskSwapRequest.create).not.toHaveBeenCalled();
    });

    it('mensaje PA-1010.04 cuando el compañero no tiene disponibilidad', async () => {
      prisma.taskAssignment.findUnique
        .mockResolvedValueOnce(fromAssignment())
        .mockResolvedValueOnce(toAssignment());
      prisma.taskSwapRequest.findFirst.mockResolvedValue(null);
      // Primera comprobación (emisor A) libre; segunda (compañero B) ocupada.
      tasksService.assertUserFreeAt
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new ConflictException('ocupado'));

      await expect(
        service.createSwapRequest('assign-A', 'assign-B', 'user-A'),
      ).rejects.toThrow(
        'No se puede solicitar el cambio. Beto no tiene disponibilidad en su calendario para realizar tu tarea',
      );
    });

    it('mensaje PA-1010.04 cuando el emisor no tiene disponibilidad', async () => {
      prisma.taskAssignment.findUnique
        .mockResolvedValueOnce(fromAssignment())
        .mockResolvedValueOnce(toAssignment());
      prisma.taskSwapRequest.findFirst.mockResolvedValue(null);
      // Primera comprobación (emisor A) ocupada.
      tasksService.assertUserFreeAt.mockRejectedValueOnce(
        new ConflictException('ocupado'),
      );

      await expect(
        service.createSwapRequest('assign-A', 'assign-B', 'user-A'),
      ).rejects.toThrow(
        'No se puede solicitar el cambio. No tienes disponibilidad en tu calendario para realizar la tarea de Beto',
      );
    });

    it('rechaza ofrecer una tarea que no es del emisor', async () => {
      prisma.taskAssignment.findUnique
        .mockResolvedValueOnce(fromAssignment({ user_id: 'otro' }))
        .mockResolvedValueOnce(toAssignment());

      await expect(
        service.createSwapRequest('assign-A', 'assign-B', 'user-A'),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.taskSwapRequest.create).not.toHaveBeenCalled();
    });

    it('rechaza intercambiar tareas de pisos distintos', async () => {
      prisma.taskAssignment.findUnique
        .mockResolvedValueOnce(fromAssignment())
        .mockResolvedValueOnce(
          toAssignment({
            task: {
              id: 'task-B',
              title: 'Basura',
              apartment_id: 'apt-2',
              duration_minutes: 30,
            },
          }),
        );

      await expect(
        service.createSwapRequest('assign-A', 'assign-B', 'user-A'),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.taskSwapRequest.create).not.toHaveBeenCalled();
    });

    it('rechaza si una de las tareas ya está en un intercambio pendiente', async () => {
      prisma.taskAssignment.findUnique
        .mockResolvedValueOnce(fromAssignment())
        .mockResolvedValueOnce(toAssignment());
      prisma.taskSwapRequest.findFirst.mockResolvedValue({ id: 'otra' });

      await expect(
        service.createSwapRequest('assign-A', 'assign-B', 'user-A'),
      ).rejects.toThrow(ConflictException);

      expect(prisma.taskSwapRequest.create).not.toHaveBeenCalled();
    });
  });

  describe('acceptSwapRequest (PA-1010.02)', () => {
    it('intercambia los dueños en una transacción (sin duplicado intermedio) y borra la petición', async () => {
      prisma.taskSwapRequest.findUnique.mockResolvedValue(pendingRequest());
      prisma.$transaction.mockResolvedValue([{}, {}, {}, {}]);

      await expect(service.acceptSwapRequest('swap-1', 'user-B')).resolves.toEqual(
        { status: 'accepted' },
      );

      // Se aparca la hora de la tarea de A para evitar el duplicado transitorio con la restricción única.
      expect(prisma.taskAssignment.update).toHaveBeenCalledWith({
        where: { id: 'assign-A' },
        data: { due_time: null },
      });
      // La tarea de B pasa a A.
      expect(prisma.taskAssignment.update).toHaveBeenCalledWith({
        where: { id: 'assign-B' },
        data: { user_id: 'user-A' },
      });
      // La tarea de A pasa a B y recupera su hora original.
      expect(prisma.taskAssignment.update).toHaveBeenCalledWith({
        where: { id: 'assign-A' },
        data: { user_id: 'user-B', due_time: '10:00' },
      });
      // La petición se conserva como completada, no se borra (PA-1010.02).
      expect(prisma.taskSwapRequest.update).toHaveBeenCalledWith({
        where: { id: 'swap-1' },
        data: { status: 'completed', resolved_at: expect.any(Date) },
      });
      expect(prisma.taskSwapRequest.delete).not.toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(4);
    });

    it('solo el receptor puede aceptar', async () => {
      prisma.taskSwapRequest.findUnique.mockResolvedValue(pendingRequest());

      await expect(
        service.acceptSwapRequest('swap-1', 'user-A'),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('rejectSwapRequest (PA-1010.03)', () => {
    it('el receptor rechaza: borra la petición sin tocar las tareas', async () => {
      prisma.taskSwapRequest.findUnique.mockResolvedValue(pendingRequest());

      await expect(service.rejectSwapRequest('swap-1', 'user-B')).resolves.toEqual(
        { status: 'rejected' },
      );

      expect(prisma.taskSwapRequest.delete).toHaveBeenCalledWith({
        where: { id: 'swap-1' },
      });
      expect(prisma.taskAssignment.update).not.toHaveBeenCalled();
    });

    it('un usuario que no es el receptor no puede rechazar', async () => {
      prisma.taskSwapRequest.findUnique.mockResolvedValue(pendingRequest());

      await expect(
        service.rejectSwapRequest('swap-1', 'user-A'),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.taskSwapRequest.delete).not.toHaveBeenCalled();
    });
  });

  describe('cancelSwapRequest (PA-1010.05)', () => {
    it('el emisor cancela su propia petición pendiente', async () => {
      prisma.taskSwapRequest.findUnique.mockResolvedValue(pendingRequest());

      await expect(service.cancelSwapRequest('swap-1', 'user-A')).resolves.toEqual(
        { status: 'cancelled' },
      );

      expect(prisma.taskSwapRequest.delete).toHaveBeenCalledWith({
        where: { id: 'swap-1' },
      });
    });

    it('un usuario que no es el emisor no puede cancelar', async () => {
      prisma.taskSwapRequest.findUnique.mockResolvedValue(pendingRequest());

      await expect(
        service.cancelSwapRequest('swap-1', 'user-B'),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.taskSwapRequest.delete).not.toHaveBeenCalled();
    });
  });

  it('createSwapRequest rechaza intercambiar una tarea consigo misma', async () => {
    await expect(
      service.createSwapRequest('assign-A', 'assign-A', 'user-A'),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.taskAssignment.findUnique).not.toHaveBeenCalled();
  });
});
