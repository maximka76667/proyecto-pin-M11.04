import { Test } from '@nestjs/testing';
import { TasksService } from './tasks.service';
import { PrismaService } from '../prisma/prisma.service';

describe('Pruebas de aceptación de disponibilidad al asignar tareas', () => {
  const hogarId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const usuarioActualId = '11111111-1111-1111-1111-111111111111';
  const usuarioOcupadoId = '22222222-2222-2222-2222-222222222222';
  const usuarioLibreId = '33333333-3333-3333-3333-333333333333';
  const tareaId = '44444444-4444-4444-4444-444444444444';
  const martes = '2026-11-10';

  const prisma = {
    task: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    userApartment: {
      findUnique: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
    taskAssignment: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  let tasks: TasksService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    tasks = module.get(TasksService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.task.findFirst.mockResolvedValue(null);
    prisma.task.findUnique.mockResolvedValue({
      apartment_id: hogarId,
      status: 'pending',
      duration_minutes: 30,
    });
    prisma.task.create.mockResolvedValue({
      id: tareaId,
      apartment_id: hogarId,
      title: 'Limpiar cocina',
      frequency: 'none',
      duration_minutes: 30,
    });
    prisma.userApartment.findUnique.mockResolvedValue({ user_id: usuarioActualId });
    prisma.taskAssignment.findFirst.mockResolvedValue(null);
    prisma.taskAssignment.findMany.mockResolvedValue([]);
    prisma.taskAssignment.create.mockImplementation(({ data }: { data: object }) => ({
      id: 'asignacion-1',
      ...data,
      user: { id: usuarioLibreId, full_name: 'Persona libre' },
    }));
    prisma.task.update.mockResolvedValue({});
    prisma.$transaction.mockImplementation((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    );
    prisma.user.findMany.mockImplementation(
      ({ where }: { where: { id?: { in: string[] } } }) => {
        const ids = where.id?.in ?? [usuarioOcupadoId, usuarioLibreId];
        return Promise.resolve(
          ids.map((id) => ({
            id,
            full_name: id === usuarioOcupadoId ? 'Persona ocupada' : 'Persona libre',
            availability_blocks:
              id === usuarioOcupadoId
                ? [{ day_of_week: 'tuesday', start_minute: 540, end_minute: 660 }]
                : [],
            google_busy_blocks: [],
          })),
        );
      },
    );
  });

  async function comprobarDisponibilidad(
    userId: string,
    dueTime: string,
    durationMinutes = 30,
  ) {
    prisma.task.findUnique.mockResolvedValue({
      apartment_id: hogarId,
      status: 'pending',
      duration_minutes: durationMinutes,
    });
    return tasks.membersAvailability(
      tareaId,
      { due_date: martes, due_time: dueTime },
      usuarioActualId,
    ).then((result) => result.members.find((member) => member.id === userId));
  }

  it('PA-1524.01 crea la tarea del martes y la asigna al integrante disponible aunque otro esté ocupado', async () => {
    const tarea = await tasks.create({
      apartment_id: hogarId,
      title: 'Limpiar cocina',
      frequency: 'none',
      duration_minutes: 30,
    });
    const disponibilidad = await comprobarDisponibilidad(usuarioLibreId, '09:30');
    const asignacion = await tasks.createAssignment(
      tareaId,
      {
        user_ids: [usuarioLibreId],
        due_date: martes,
        due_time: '09:30',
      },
      usuarioActualId,
    );

    expect(tarea.id).toBe(tareaId);
    expect(disponibilidad).toMatchObject({ available: true, busy: null });
    expect(asignacion).toEqual([
      expect.objectContaining({
        task_id: tareaId,
        user_id: usuarioLibreId,
        due_time: '09:30',
      }),
    ]);
    expect(prisma.taskAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ user_id: usuarioLibreId, due_time: '09:30' }),
      }),
    );
  });

  it.each([
    ['09:00', 30, 'al comenzar exactamente cuando empieza la clase'],
    ['10:30', 30, 'al terminar exactamente cuando termina la clase'],
  ])(
    'PA-1524.02 impide asignar una tarea que toca el límite de la clase (%s): %s',
    async (dueTime, durationMinutes) => {
      const disponibilidad = await comprobarDisponibilidad(
        usuarioOcupadoId,
        dueTime,
        durationMinutes,
      );

      expect(disponibilidad).toMatchObject({
        available: false,
        busy: { start: '09:00', end: '11:00' },
      });
      await expect(
        tasks.createAssignment(
          tareaId,
          {
            user_ids: [usuarioOcupadoId],
            due_date: martes,
            due_time: dueTime,
          },
          usuarioActualId,
        ),
      ).rejects.toMatchObject({
        response: { statusCode: 409 },
      });
    },
  );

  it('PA-1524.03 permite crear la tarea pero rechaza asignarla al integrante ocupado en una franja interior', async () => {
    const disponibilidad = await comprobarDisponibilidad(
      usuarioOcupadoId,
      '10:00',
      30,
    );

    expect(disponibilidad?.available).toBe(false);
    await expect(
      tasks.createAssignment(
        tareaId,
        {
          user_ids: [usuarioOcupadoId],
          due_date: martes,
          due_time: '10:00',
        },
        usuarioActualId,
      ),
    ).rejects.toMatchObject({
      response: {
        statusCode: 409,
        message: 'Persona ocupada no está disponible en esa franja: tiene ocupado de 09:00 a 11:00',
      },
    });
    expect(prisma.taskAssignment.create).not.toHaveBeenCalled();
  });

  it('PA-1524.04 permite asignar al integrante ocupado cuando la tarea empieza después de su clase y respeta su duración', async () => {
    const disponibilidad = await comprobarDisponibilidad(
      usuarioOcupadoId,
      '11:01',
      59,
    );
    const asignacion = await tasks.createAssignment(
      tareaId,
      {
        user_ids: [usuarioOcupadoId],
        due_date: martes,
        due_time: '11:01',
      },
      usuarioActualId,
    );

    expect(disponibilidad).toMatchObject({ available: true, busy: null });
    expect(asignacion).toEqual([
      expect.objectContaining({
        task_id: tareaId,
        user_id: usuarioOcupadoId,
        due_time: '11:01',
      }),
    ]);
  });
});
