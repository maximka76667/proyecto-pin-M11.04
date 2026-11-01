import {
  BadRequestException,
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
      create: jest.fn(),
      findFirst: jest.fn(),
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

  it('crea una tarea pendiente con valores predeterminados seguros', async () => {
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

  it('rechaza un título compuesto solo por espacios antes de acceder a la base de datos', async () => {
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

  it('rechaza un nombre de tarea existente antes de insertar un duplicado', async () => {
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

  it('convierte los nombres de tarea duplicados en un conflicto', async () => {
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

  it('devuelve los detalles de la tarea con sus asignaciones', async () => {
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
          orderBy: [{ due_date: 'asc' }, { due_time: 'asc' }],
        },
      },
    });
  });

  it('devuelve no encontrado cuando los detalles de la tarea no existen', async () => {
    prisma.task.findUnique.mockResolvedValue(null);

    await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('no consulta la tarea ni escribe si no se selecciona ningún responsable', async () => {
    await expect(
      service.createAssignment(
        'task-1',
        { user_ids: [], due_date: '2026-10-28' },
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.task.findUnique).not.toHaveBeenCalled();
    expect(prisma.taskAssignment.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('asigna una tarea a un miembro para el día y hora elegidos y actualiza su estado', async () => {
    prisma.task.findUnique.mockResolvedValue({
      apartment_id: 'apartment-1',
      status: 'pending',
    });
    prisma.userApartment.findUnique.mockResolvedValue({ user_id: 'user-1' });
    const assignment = {
      id: 'assignment-1',
      task_id: 'task-1',
      user_id: 'user-2',
      due_date: new Date('2026-10-28T00:00:00.000Z'),
      due_time: '10:00',
      status: 'pending',
      user: { id: 'user-2', full_name: 'Alex' },
    };
    prisma.taskAssignment.create.mockResolvedValue(assignment);
    prisma.task.update.mockResolvedValue({ status: 'assigned' });
    prisma.$transaction.mockImplementation((operations) =>
      Promise.all(operations),
    );

    await expect(
      service.createAssignment(
        'task-1',
        { user_id: 'user-2', due_date: '2026-10-28', due_time: '10:00' },
        'user-1',
      ),
    ).resolves.toBe(assignment);

    expect(prisma.taskAssignment.create).toHaveBeenCalledWith({
      data: {
        task_id: 'task-1',
        user_id: 'user-2',
        due_date: new Date('2026-10-28T00:00:00.000Z'),
        due_time: '10:00',
        status: 'pending',
      },
      include: { user: { select: { id: true, full_name: true } } },
    });
    expect(prisma.task.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { status: 'assigned' },
    });
    expect(prisma.taskAssignment.findFirst).toHaveBeenCalledWith({
      where: {
        user_id: { in: ['user-2'] },
        due_date: new Date('2026-10-28T00:00:00.000Z'),
        due_time: '10:00',
      },
      include: { user: { select: { full_name: true } } },
    });
  });

  it('asigna la tarea a varios miembros en una sola transacción', async () => {
    prisma.task.findUnique.mockResolvedValue({
      apartment_id: 'apartment-1',
      status: 'pending',
    });
    prisma.userApartment.findUnique.mockResolvedValue({ user_id: 'member' });
    const assignments = [
      { id: 'assignment-1', user_id: 'user-2' },
      { id: 'assignment-2', user_id: 'user-3' },
    ];
    prisma.taskAssignment.create
      .mockResolvedValueOnce(assignments[0])
      .mockResolvedValueOnce(assignments[1]);
    prisma.task.update.mockResolvedValue({ status: 'assigned' });
    prisma.$transaction.mockImplementation((operations) =>
      Promise.all(operations),
    );

    await expect(
      service.createAssignment(
        'task-1',
        {
          user_ids: ['user-2', 'user-3'],
          due_date: '2026-10-28',
          due_time: '10:00',
        },
        'member',
      ),
    ).resolves.toEqual(assignments);

    expect(prisma.userApartment.findUnique).toHaveBeenCalledTimes(3);
    expect(prisma.taskAssignment.create).toHaveBeenCalledTimes(2);
    expect(prisma.taskAssignment.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          task_id: 'task-1',
          user_id: 'user-2',
          due_date: new Date('2026-10-28T00:00:00.000Z'),
          due_time: '10:00',
        }),
      }),
    );
    expect(prisma.taskAssignment.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          task_id: 'task-1',
          user_id: 'user-3',
          due_date: new Date('2026-10-28T00:00:00.000Z'),
          due_time: '10:00',
        }),
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(3);
  });

  it('no crea una asignación si la persona elegida no pertenece al hogar', async () => {
    prisma.task.findUnique.mockResolvedValue({
      apartment_id: 'apartment-1',
      status: 'pending',
    });
    prisma.userApartment.findUnique
      .mockResolvedValueOnce({ user_id: 'user-1' })
      .mockResolvedValueOnce(null);

    await expect(
      service.createAssignment(
        'task-1',
        { user_id: 'outsider', due_date: '2026-10-28', due_time: '10:00' },
        'user-1',
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.taskAssignment.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('no crea ninguna asignación si uno de los miembros elegidos no pertenece al hogar', async () => {
    prisma.task.findUnique.mockResolvedValue({
      apartment_id: 'apartment-1',
      status: 'pending',
    });
    prisma.userApartment.findUnique
      .mockResolvedValueOnce({ user_id: 'member' })
      .mockResolvedValueOnce({ user_id: 'user-2' })
      .mockResolvedValueOnce(null);

    await expect(
      service.createAssignment(
        'task-1',
        {
          user_ids: ['user-2', 'outsider'],
          due_date: '2026-10-28',
          due_time: '10:00',
        },
        'member',
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.taskAssignment.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('permite que el miembro que solicita la asignación se la asigne a sí mismo', async () => {
    prisma.task.findUnique.mockResolvedValue({
      apartment_id: 'apartment-1',
      status: 'pending',
    });
    prisma.userApartment.findUnique.mockResolvedValue({ user_id: 'user-1' });
    prisma.taskAssignment.create.mockResolvedValue({ id: 'assignment-1' });
    prisma.task.update.mockResolvedValue({ status: 'assigned' });
    prisma.$transaction.mockImplementation((operations) =>
      Promise.all(operations),
    );

    await expect(
      service.createAssignment(
        'task-1',
        { user_id: 'user-1', due_date: '2026-10-28', due_time: '10:00' },
        'user-1',
      ),
    ).resolves.toEqual({ id: 'assignment-1' });
    expect(prisma.userApartment.findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.taskAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ user_id: 'user-1' }),
      }),
    );
  });

  it('rechaza una hora ocupada antes de insertar asignaciones', async () => {
    prisma.task.findUnique.mockResolvedValue({
      apartment_id: 'apartment-1',
      status: 'pending',
    });
    prisma.userApartment.findUnique.mockResolvedValue({ user_id: 'member' });
    prisma.taskAssignment.findFirst.mockResolvedValue({
      user: { full_name: 'Joan Martí' },
    });

    await expect(
      service.createAssignment(
        'task-2',
        {
          user_ids: ['user-2', 'user-3'],
          due_date: '2026-10-28',
          due_time: '10:00',
        },
        'member',
      ),
    ).rejects.toThrow(
      'Joan Martí ya tiene una tarea asignada en ese horario',
    );

    expect(prisma.taskAssignment.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('convierte un conflicto de unicidad concurrente en HTTP 409', async () => {
    prisma.task.findUnique.mockResolvedValue({
      apartment_id: 'apartment-1',
      status: 'pending',
    });
    prisma.userApartment.findUnique.mockResolvedValue({ user_id: 'member' });
    prisma.taskAssignment.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockRejectedValue(prismaError('P2002'));

    await expect(
      service.createAssignment(
        'task-2',
        {
          user_ids: ['user-2'],
          due_date: '2026-10-28',
          due_time: '10:00',
        },
        'member',
      ),
    ).rejects.toThrow(ConflictException);
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
