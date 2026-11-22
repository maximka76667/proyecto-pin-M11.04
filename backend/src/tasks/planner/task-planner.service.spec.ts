import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
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
    taskPreference: { findMany: jest.fn() },
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
    prisma.taskPreference.findMany.mockResolvedValue([]);
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

    it('con los mismos puntos, da la tarea a quien la prefiere', async () => {
      prisma.taskPoints.groupBy.mockResolvedValue([]);
      // Sin preferencias el empate lo gana Ana (por id)
      expect((await service.preview(APARTMENT, ANA, TODAY)).assignments[0].user_id).toBe(ANA);

      prisma.taskPreference.findMany.mockResolvedValue([
        { user_id: LUIS, task_id: TASK, preference: 'prefer' },
      ]);

      const plan = await service.preview(APARTMENT, ANA, TODAY);

      expect(plan.assignments[0].user_id).toBe(LUIS);
    });

    it('con los mismos puntos, se la quita a quien la evita', async () => {
      prisma.taskPoints.groupBy.mockResolvedValue([]);
      prisma.taskPreference.findMany.mockResolvedValue([
        { user_id: ANA, task_id: TASK, preference: 'avoid' },
      ]);

      const plan = await service.preview(APARTMENT, ANA, TODAY);

      expect(plan.assignments[0].user_id).toBe(LUIS);
    });

    it('lee solo las preferencias de este hogar y de sus miembros', async () => {
      await service.preview(APARTMENT, ANA, TODAY);

      expect(prisma.taskPreference.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            user_id: { in: [ANA, LUIS] },
            task: { apartment_id: APARTMENT },
          },
        }),
      );
    });

    it('no guarda nada', async () => {
      await service.preview(APARTMENT, ANA, TODAY);

      expect(prisma.taskAssignment.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('cuenta como carga lo que ya tienen asignado esa semana', async () => {
      // Sin puntos acumulados: sin lo asignado, Ana ganaría el empate por id
      prisma.taskPoints.groupBy.mockResolvedValue([]);
      prisma.taskAssignment.findMany.mockResolvedValue([
        {
          task_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
          user_id: ANA,
          status: 'pending',
          due_date: new Date('2026-11-17T00:00:00.000Z'),
          due_time: '10:00',
          start_minute: 540,
          task: { apartment_id: APARTMENT, duration_minutes: 30, points: 40 },
        },
      ]);

      const plan = await service.preview(APARTMENT, ANA, TODAY);

      expect(plan.assignments[0].user_id).toBe(LUIS);
      expect(plan.points).toEqual([
        { user_id: ANA, user_name: 'Ana', before: 40, after: 40 },
        { user_id: LUIS, user_name: 'Luis', before: 0, after: 30 },
      ]);
    });

    it('no cuenta como carga lo rechazado ni lo ya completado', async () => {
      prisma.taskPoints.groupBy.mockResolvedValue([]);
      const asignacion = (status: string, id: string) => ({
        task_id: id,
        user_id: ANA,
        status,
        due_date: new Date('2026-11-17T00:00:00.000Z'),
        due_time: status === 'rejected' ? '10:00' : '12:00',
        start_minute: 540,
        task: { apartment_id: APARTMENT, duration_minutes: 30, points: 40 },
      });
      prisma.taskAssignment.findMany.mockResolvedValue([
        asignacion('rejected', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
        asignacion('completed', 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
      ]);

      const plan = await service.preview(APARTMENT, ANA, TODAY);

      expect(plan.points[0]).toMatchObject({ user_id: ANA, before: 0 });
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

  describe('validate y apply con asignaciones editadas', () => {
    const TASK2 = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const MONDAY = '2026-11-16';
    const item = (overrides: Record<string, unknown> = {}) => ({
      task_id: TASK,
      user_id: LUIS,
      date: '2026-11-17',
      time: '18:00',
      ...overrides,
    });

    beforeEach(() => {
      prisma.task.findMany.mockResolvedValue([
        tarea(),
        tarea({ id: TASK2, title: 'Fregar el suelo', duration_minutes: 30 }),
      ]);
    });

    it('acepta una edición válida', async () => {
      const result = await service.validate(APARTMENT, ANA, [item()], TODAY);

      expect(result.valid).toBe(true);
      expect(result.items[0].issues).toEqual([]);
    });

    it('marca las dos tareas que se solapan entre sí', async () => {
      const result = await service.validate(
        APARTMENT,
        ANA,
        [
          item({ date: MONDAY, time: '10:00' }),
          item({ task_id: TASK2, date: MONDAY, time: '10:30' }),
        ],
        TODAY,
      );

      expect(result.valid).toBe(false);
      // Cada una nombra a la otra y dice sus horas (la primera dura 45 min, la segunda 30)
      expect(result.items[0].issues[0]).toContain(
        'Se solapa con «Fregar el suelo» de 10:30 a 11:00',
      );
      expect(result.items[1].issues[0]).toContain(
        'Se solapa con «Limpiar el baño» de 10:00 a 10:45',
      );
    });

    it('permite que una tarea empiece justo cuando acaba otra', async () => {
      const result = await service.validate(
        APARTMENT,
        ANA,
        [
          item({ date: MONDAY, time: '10:00' }), // 10:00 a 10:45
          item({ task_id: TASK2, date: MONDAY, time: '10:45' }),
        ],
        TODAY,
      );

      expect(result.valid).toBe(true);
    });

    it('marca una franja ocupada del calendario con sus horas', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: ANA, availability_blocks: [], google_busy_blocks: [] },
        {
          id: LUIS,
          availability_blocks: [
            { day_of_week: 'monday', start_minute: 540, end_minute: 660 },
          ],
          google_busy_blocks: [],
        },
      ]);

      const result = await service.validate(
        APARTMENT,
        ANA,
        [item({ date: MONDAY, time: '10:00' })],
        TODAY,
      );

      expect(result.valid).toBe(false);
      expect(result.items[0].issues[0]).toContain('09:00 a 11:00');
    });

    it('marca el solape con una tarea que la persona ya tiene asignada', async () => {
      prisma.taskAssignment.findMany.mockResolvedValue([
        {
          task_id: TASK2,
          user_id: LUIS,
          status: 'pending',
          due_date: new Date(`${MONDAY}T00:00:00.000Z`),
          due_time: '10:00',
          start_minute: 540,
          // de otro piso: no cuenta como ya repartida aquí, pero ocupa a Luis
          task: {
            apartment_id: 'otro-piso',
            title: 'Regar plantas',
            duration_minutes: 60,
          },
        },
      ]);

      const result = await service.validate(
        APARTMENT,
        ANA,
        [item({ date: MONDAY, time: '10:30' })],
        TODAY,
      );

      expect(result.valid).toBe(false);
      // Dice cuál es la tarea y en qué horas está, no solo que hay un solape
      expect(result.items[0].issues[0]).toContain(
        'Luis ya tiene «Regar plantas» de 10:00 a 11:00',
      );
    });

    it('marca una tarea semanal que ya está repartida esa semana', async () => {
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

      const result = await service.validate(APARTMENT, ANA, [item()], TODAY);

      expect(result.valid).toBe(false);
      expect(result.items[0].issues[0]).toContain('ya está repartida');
    });

    it('no deja crear dos veces la misma tarea semanal', async () => {
      const result = await service.validate(
        APARTMENT,
        ANA,
        [item({ time: '10:00' }), item({ time: '12:00' })],
        TODAY,
      );

      expect(result.items[0].issues).toEqual([]);
      expect(result.items[1].issues[0]).toContain('ya está repartida');
    });

    it('rechaza un día fuera de la semana que se reparte', async () => {
      const result = await service.validate(
        APARTMENT,
        ANA,
        [item({ date: '2026-11-30' })],
        TODAY,
      );

      expect(result.valid).toBe(false);
      expect(result.items[0].issues[0]).toContain('semana');
    });

    it('rechaza una persona que no es del piso', async () => {
      const result = await service.validate(
        APARTMENT,
        ANA,
        [item({ user_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' })],
        TODAY,
      );

      expect(result.valid).toBe(false);
      expect(result.items[0].issues[0]).toContain('no pertenece');
    });

    it('rechaza una tarea que terminaría después de medianoche', async () => {
      const result = await service.validate(
        APARTMENT,
        ANA,
        [item({ time: '23:30' })],
        TODAY,
      );

      expect(result.valid).toBe(false);
      expect(result.items[0].issues[0]).toContain('medianoche');
    });

    it('apply crea la asignación con la hora que se editó', async () => {
      const result = await service.apply(
        APARTMENT,
        ANA,
        [item({ time: '19:15' })],
        TODAY,
      );

      expect(result.created).toBe(1);
      expect(prisma.taskAssignment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          task_id: TASK,
          user_id: LUIS,
          due_time: '19:15',
          status: 'pending',
        }),
      });
    });

    it('apply no guarda nada si alguna asignación editada es inválida', async () => {
      await expect(
        service.apply(
          APARTMENT,
          ANA,
          [
            item({ date: MONDAY, time: '10:00' }),
            item({ task_id: TASK2, date: MONDAY, time: '10:30' }),
          ],
          TODAY,
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(prisma.taskAssignment.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('si el reparto automático saliera incoherente, devuelve un error y no lo enseña', async () => {
      jest.spyOn(service as unknown as { plan: () => unknown }, 'plan').mockReturnValue({
        assignments: [
          {
            taskId: TASK,
            userId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
            date: MONDAY,
            time: '10:00',
            points: 30,
          },
        ],
        unassigned: [],
        projectedPoints: {},
      });

      await expect(
        service.preview(APARTMENT, ANA, TODAY),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      await expect(
        service.apply(APARTMENT, ANA, undefined, TODAY),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(prisma.taskAssignment.create).not.toHaveBeenCalled();
    });
  });

  describe('repartir dos veces la misma semana', () => {
    const TASK2 = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

    // Una "base de datos" mínima: lo que crea la primera pasada lo ve la segunda
    let stored: Record<string, unknown>[];

    beforeEach(() => {
      stored = [];
      prisma.taskAssignment.findMany.mockImplementation(() =>
        Promise.resolve(stored),
      );
      prisma.taskAssignment.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => {
          stored.push({
            task_id: data.task_id,
            user_id: data.user_id,
            status: 'pending',
            due_date: data.due_date,
            due_time: data.due_time,
            start_minute: 540,
            task: { apartment_id: APARTMENT, duration_minutes: 45, points: 30 },
          });
          return Promise.resolve({});
        },
      );
    });

    // Aplica el reparto de una sola tarea y devuelve lo que se guardó
    async function primeraPasada() {
      await service.apply(APARTMENT, ANA, undefined, TODAY);
      return stored[0] as { user_id: string; due_date: Date; due_time: string };
    }

    it('al editar la tarea nueva, avisa de que solapa con lo repartido la primera vez', async () => {
      const primera = await primeraPasada();
      const date = primera.due_date.toISOString().slice(0, 10);

      // Segunda pasada: aparece una tarea nueva
      prisma.task.findMany.mockResolvedValue([
        tarea(),
        tarea({ id: TASK2, title: 'Fregar el suelo', duration_minutes: 30 }),
      ]);

      const result = await service.validate(
        APARTMENT,
        ANA,
        [{ task_id: TASK2, user_id: primera.user_id, date, time: primera.due_time }],
        TODAY,
      );

      expect(result.valid).toBe(false);
      expect(result.items[0].issues[0]).toContain('ya tiene otra tarea');
    });

    it('apply rechaza la tarea nueva si se solapa con lo repartido la primera vez', async () => {
      const primera = await primeraPasada();
      const date = primera.due_date.toISOString().slice(0, 10);
      prisma.task.findMany.mockResolvedValue([
        tarea(),
        tarea({ id: TASK2, title: 'Fregar el suelo', duration_minutes: 30 }),
      ]);
      prisma.taskAssignment.create.mockClear();

      await expect(
        service.apply(
          APARTMENT,
          ANA,
          [{ task_id: TASK2, user_id: primera.user_id, date, time: primera.due_time }],
          TODAY,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.taskAssignment.create).not.toHaveBeenCalled();
    });

    it('la segunda propuesta automática no pisa lo repartido la primera vez', async () => {
      const primera = await primeraPasada();
      const date = primera.due_date.toISOString().slice(0, 10);
      prisma.task.findMany.mockResolvedValue([
        tarea(),
        tarea({ id: TASK2, title: 'Fregar el suelo', duration_minutes: 30 }),
      ]);

      const plan = await service.preview(APARTMENT, ANA, TODAY);

      // Solo propone la tarea nueva: la primera ya está repartida
      expect(plan.assignments).toHaveLength(1);
      expect(plan.assignments[0].task_id).toBe(TASK2);
      const nueva = plan.assignments[0];
      if (nueva.user_id === primera.user_id && nueva.date === date) {
        // La primera dura 45 minutos desde su hora: la nueva empieza cuando acaba o después
        const [h, m] = primera.due_time.split(':').map(Number);
        const fin = h * 60 + m + 45;
        const [nh, nm] = nueva.time.split(':').map(Number);
        expect(nh * 60 + nm).toBeGreaterThanOrEqual(fin);
      }
    });
  });

  describe('apply', () => {
    it('crea las asignaciones como pendientes y marca la tarea como asignada', async () => {
      const result = await service.apply(APARTMENT, ANA, undefined, TODAY);

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

      const result = await service.apply(APARTMENT, ANA, undefined, TODAY);

      expect(result.created).toBe(0);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rechaza a quien no es del piso', async () => {
      prisma.userApartment.findUnique.mockResolvedValue(null);

      await expect(
        service.apply(APARTMENT, ANA, undefined, TODAY),
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
        service.apply(APARTMENT, ANA, undefined, TODAY),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
