import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TaskPlannerService } from './task-planner.service';

const APARTMENT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ANA = '11111111-1111-1111-1111-111111111111';
const LUIS = '22222222-2222-2222-2222-222222222222';
const TASK = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
// Sábado: la semana a repartir es del lunes 16 al domingo 22 de noviembre de 2026
const TODAY = '2026-11-14';
const ALL_DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

describe('TaskPlannerService', () => {
  let service: TaskPlannerService;
  const prisma = {
    userApartment: { findUnique: jest.fn(), findMany: jest.fn() },
    taskPoints: { groupBy: jest.fn() },
    task: { findMany: jest.fn(), updateMany: jest.fn() },
    taskAssignment: { findMany: jest.fn(), create: jest.fn() },
    user: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };

  const tarea = (overrides: Record<string, unknown> = {}) => ({
    id: TASK,
    title: 'Limpiar el baño',
    points: 30,
    duration_minutes: 45,
    frequency: 'weekly',
    ...overrides,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.userApartment.findUnique.mockResolvedValue({ user_id: ANA });
    prisma.userApartment.findMany.mockResolvedValue([
      { user: { id: ANA, full_name: 'Ana' } },
      { user: { id: LUIS, full_name: 'Luis' } },
    ]);
    prisma.taskPoints.groupBy.mockResolvedValue([
      { user_id: ANA, _sum: { points: 60 } },
    ]);
    prisma.task.findMany.mockResolvedValue([tarea()]);
    prisma.taskAssignment.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([
      { id: ANA, availability_blocks: [], google_busy_blocks: [] },
      { id: LUIS, availability_blocks: [], google_busy_blocks: [] },
    ]);
    prisma.task.updateMany.mockResolvedValue({ count: 1 });
    prisma.taskAssignment.create.mockResolvedValue({});
    prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) =>
      Promise.all(ops),
    );
    service = new TaskPlannerService(prisma as never);
  });

  describe('preview', () => {
    it('rechaza a quien no es del piso', async () => {
      prisma.userApartment.findUnique.mockResolvedValue(null);

      await expect(
        service.preview(APARTMENT, ANA, TODAY),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('da la tarea a quien tiene menos puntos y devuelve la semana siguiente', async () => {
      const plan = await service.preview(APARTMENT, ANA, TODAY);

      expect(plan.week).toEqual({ from: '2026-11-16', to: '2026-11-22' });
      expect(plan.assignments).toHaveLength(1);
      expect(plan.assignments[0]).toMatchObject({
        task_id: TASK,
        task_title: 'Limpiar el baño',
        user_id: LUIS,
        user_name: 'Luis',
        points: 30,
      });
      expect(plan.points).toEqual([
        { user_id: ANA, user_name: 'Ana', before: 60, after: 60 },
        { user_id: LUIS, user_name: 'Luis', before: 0, after: 30 },
      ]);
    });

    it('no guarda nada', async () => {
      await service.preview(APARTMENT, ANA, TODAY);

      expect(prisma.taskAssignment.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('no vuelve a repartir una tarea semanal que ya tiene asignación esa semana', async () => {
      // Se usa en las dos consultas: la de la semana y la de "alguna vez asignada"
      prisma.taskAssignment.findMany.mockResolvedValue([
        {
          task_id: TASK,
          user_id: ANA,
          status: 'pending',
          due_date: new Date('2026-11-18T00:00:00.000Z'),
          due_time: '10:00',
          start_minute: 540,
          task: { apartment_id: APARTMENT, duration_minutes: 45 },
        },
      ]);

      const plan = await service.preview(APARTMENT, ANA, TODAY);

      expect(plan.assignments).toHaveLength(0);
      expect(plan.unassigned).toHaveLength(0);
    });

    it('no asigna a quien tiene ocupada toda la semana en su disponibilidad', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: ANA, availability_blocks: [], google_busy_blocks: [] },
        {
          id: LUIS,
          availability_blocks: ALL_DAYS.map((day) => ({
            day_of_week: day,
            start_minute: 0,
            end_minute: 1440,
          })),
          google_busy_blocks: [],
        },
      ]);

      const plan = await service.preview(APARTMENT, ANA, TODAY);

      // Luis tiene menos puntos, pero no tiene ningún hueco
      expect(plan.assignments[0].user_id).toBe(ANA);
    });

    it('informa de las tareas que no caben en lugar de fallar', async () => {
      const ocupado = ALL_DAYS.map((day) => ({
        day_of_week: day,
        start_minute: 0,
        end_minute: 1440,
      }));
      prisma.user.findMany.mockResolvedValue([
        { id: ANA, availability_blocks: ocupado, google_busy_blocks: [] },
        { id: LUIS, availability_blocks: ocupado, google_busy_blocks: [] },
      ]);

      const plan = await service.preview(APARTMENT, ANA, TODAY);

      expect(plan.assignments).toHaveLength(0);
      expect(plan.unassigned).toEqual([
        expect.objectContaining({ task_id: TASK, task_title: 'Limpiar el baño' }),
      ]);
    });
  });

  describe('apply', () => {
    it('crea las asignaciones como pendientes y marca la tarea como asignada', async () => {
      const result = await service.apply(APARTMENT, ANA, TODAY);

      expect(result.created).toBe(1);
      expect(prisma.taskAssignment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          task_id: TASK,
          user_id: LUIS,
          status: 'pending',
          due_time: expect.stringMatching(/^\d{2}:\d{2}$/),
        }),
      });
      expect(prisma.task.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [TASK] }, status: 'pending' },
        data: { status: 'assigned' },
      });
    });

    it('no hace nada si no hay nada que repartir', async () => {
      prisma.task.findMany.mockResolvedValue([]);

      const result = await service.apply(APARTMENT, ANA, TODAY);

      expect(result.created).toBe(0);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rechaza a quien no es del piso', async () => {
      prisma.userApartment.findUnique.mockResolvedValue(null);

      await expect(
        service.apply(APARTMENT, ANA, TODAY),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.taskAssignment.create).not.toHaveBeenCalled();
    });

    it('si alguien ocupó el hueco mientras tanto, pide recalcular', async () => {
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.apply(APARTMENT, ANA, TODAY),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
