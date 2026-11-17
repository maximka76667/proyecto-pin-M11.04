import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { AssignmentStatus, Prisma, TaskStatus } from '@prisma/client';
import { GoogleCalendarService } from '../../availability/google-calendar.service';
import { PrismaService } from '../../prisma/prisma.service';
import { minuteOfDay, todayKey, toMinutes, weekdayOf } from './calendar-time';
import { buildOccurrences, nextWeekDays } from './occurrences';
import { planAssignments } from './plan';
import {
  DateKey,
  IntervalsByUserAndDate,
  PlanResult,
  Preference,
  PlannerTask,
} from './types';

const PLANNABLE_STATUSES: TaskStatus[] = [
  TaskStatus.pending,
  TaskStatus.assigned,
  TaskStatus.in_progress,
];

export interface WeekPlan {
  week: { from: DateKey; to: DateKey };
  assignments: {
    task_id: string;
    task_title: string;
    user_id: string;
    user_name: string;
    date: DateKey;
    time: string;
    points: number;
  }[];
  unassigned: {
    task_id: string;
    task_title: string;
    days: DateKey[];
    reason: string;
  }[];
  // Puntos de cada persona antes y después del reparto
  points: { user_id: string; user_name: string; before: number; after: number }[];
}

@Injectable()
export class TaskPlannerService {
  private readonly logger = new Logger(TaskPlannerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly googleCalendar?: GoogleCalendarService,
  ) {}

  // Calcula el reparto de la semana siguiente sin guardar nada
  async preview(apartmentId: string, userId: string, today?: DateKey) {
    await this.assertMember(apartmentId, userId);
    const { plan, context } = await this.compute(apartmentId, today);
    return this.describe(plan, context);
  }

  // Calcula el reparto otra vez con los datos de ahora y crea las asignaciones.
  // No se fía de lo que el cliente viera en la vista previa: puede haber cambiado
  async apply(apartmentId: string, userId: string, today?: DateKey) {
    await this.assertMember(apartmentId, userId);
    const { plan, context } = await this.compute(apartmentId, today);

    if (plan.assignments.length > 0) {
      const taskIds = [...new Set(plan.assignments.map((a) => a.taskId))];
      try {
        await this.prisma.$transaction([
          ...plan.assignments.map((assignment) =>
            this.prisma.taskAssignment.create({
              data: {
                task_id: assignment.taskId,
                user_id: assignment.userId,
                due_date: new Date(`${assignment.date}T00:00:00.000Z`),
                due_time: assignment.time,
                status: AssignmentStatus.pending,
              },
            }),
          ),
          this.prisma.task.updateMany({
            where: { id: { in: taskIds }, status: TaskStatus.pending },
            data: { status: TaskStatus.assigned },
          }),
        ]);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException(
            'El reparto ha cambiado mientras se aplicaba. Vuelve a calcularlo',
          );
        }
        throw error;
      }
    }

    return { ...this.describe(plan, context), created: plan.assignments.length };
  }

  private async assertMember(apartmentId: string, userId: string) {
    const membership = await this.prisma.userApartment.findUnique({
      where: {
        user_id_apartment_id: { user_id: userId, apartment_id: apartmentId },
      },
      select: { user_id: true },
    });
    if (!membership) throw new ForbiddenException('No perteneces a este piso');
  }

  private async compute(apartmentId: string, today?: DateKey) {
    const days = nextWeekDays(today ?? todayKey());
    const from = new Date(`${days[0]}T00:00:00.000Z`);
    const after = new Date(`${days[6]}T00:00:00.000Z`);
    after.setUTCDate(after.getUTCDate() + 1);
    const dayAfterLast = after.toISOString().slice(0, 10);

    const memberships = await this.prisma.userApartment.findMany({
      where: { apartment_id: apartmentId },
      select: { user: { select: { id: true, full_name: true } } },
    });
    const users = memberships.map((membership) => membership.user);
    const userIds = users.map((user) => user.id);

    const [pointRows, tasks, weekAssignments, everAssigned] = await Promise.all([
      this.prisma.taskPoints.groupBy({
        by: ['user_id'],
        where: { apartment_id: apartmentId },
        _sum: { points: true },
      }),
      this.prisma.task.findMany({
        where: { apartment_id: apartmentId, status: { in: PLANNABLE_STATUSES } },
        select: {
          id: true,
          title: true,
          points: true,
          duration_minutes: true,
          frequency: true,
        },
        orderBy: { title: 'asc' },
      }),
      // Todo lo que esas personas ya tienen esa semana, también en otros pisos
      this.prisma.taskAssignment.findMany({
        where: {
          user_id: { in: userIds },
          due_date: { gte: from, lt: after },
        },
        select: {
          task_id: true,
          user_id: true,
          status: true,
          due_date: true,
          due_time: true,
          start_minute: true,
          task: { select: { apartment_id: true, duration_minutes: true } },
        },
      }),
      this.prisma.taskAssignment.findMany({
        where: { task: { apartment_id: apartmentId } },
        select: { task_id: true },
        distinct: ['task_id'],
      }),
    ]);

    const pointsByUser = new Map(
      pointRows.map((row) => [row.user_id, row._sum.points ?? 0]),
    );
    const members = users.map((user) => ({
      id: user.id,
      points: pointsByUser.get(user.id) ?? 0,
    }));

    const plannerTasks: PlannerTask[] = tasks.map((task) => ({
      id: task.id,
      title: task.title,
      points: task.points,
      durationMinutes: task.duration_minutes,
      frequency: task.frequency,
    }));

    // Lo ya asignado en este piso esa semana (una asignación rechazada no cuenta: esa
    // tarea se puede volver a repartir)
    const existingThisWeek = weekAssignments
      .filter(
        (assignment) =>
          assignment.task.apartment_id === apartmentId &&
          assignment.status !== AssignmentStatus.rejected,
      )
      .map((assignment) => ({
        taskId: assignment.task_id,
        date: assignment.due_date.toISOString().slice(0, 10),
      }));

    const occurrences = buildOccurrences(
      plannerTasks,
      days,
      existingThisWeek,
      new Set(everAssigned.map((row) => row.task_id)),
    );

    const taken: IntervalsByUserAndDate = {};
    for (const assignment of weekAssignments) {
      const date = assignment.due_date.toISOString().slice(0, 10);
      const start = assignment.due_time
        ? toMinutes(assignment.due_time)
        : assignment.start_minute;
      ((taken[assignment.user_id] ??= {})[date] ??= []).push({
        start,
        end: start + (assignment.task.duration_minutes ?? 30),
      });
    }

    const busy = await this.loadBusy(userIds, days, from, after, dayAfterLast);
    const preferences = await this.loadPreferences(apartmentId, userIds);

    const plan = planAssignments({
      members,
      occurrences,
      busy,
      taken,
      preferences,
    });

    return {
      plan,
      context: {
        days,
        users,
        before: Object.fromEntries(members.map((m) => [m.id, m.points])),
        taskTitles: new Map(plannerTasks.map((task) => [task.id, task.title])),
      },
    };
  }

  // Franjas ocupadas de la semana: bloques semanales de "Tu disponibilidad" y eventos de
  // Google Calendar. Las mismas fuentes que usa la asignación manual
  private async loadBusy(
    userIds: string[],
    days: DateKey[],
    from: Date,
    after: Date,
    dayAfterLast: DateKey,
  ): Promise<IntervalsByUserAndDate> {
    // Los eventos de Google solo se guardan cuando cada persona abre la app: se trae su
    // calendario de la semana antes de comprobar. Si falla, se sigue con lo guardado
    const googleCalendar = this.googleCalendar;
    if (googleCalendar) {
      await Promise.all(
        userIds.map(async (id) => {
          try {
            await googleCalendar.sync(id, days[0], dayAfterLast);
          } catch (error) {
            const reason =
              error instanceof Error ? error.message : 'error desconocido';
            this.logger.warn(
              `No se ha podido sincronizar Google Calendar del usuario ${id}: ${reason}`,
            );
          }
        }),
      );
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        availability_blocks: {
          select: { day_of_week: true, start_minute: true, end_minute: true },
        },
        google_busy_blocks: {
          where: { event_date: { gte: from, lt: after } },
          select: { event_date: true, start_at: true, end_at: true },
        },
      },
    });

    const busy: IntervalsByUserAndDate = {};
    for (const user of users) {
      const byDate: IntervalsByUserAndDate[string] = {};
      busy[user.id] = byDate;
      for (const date of days) {
        const weekday = weekdayOf(date);
        byDate[date] = [
          ...user.availability_blocks
            .filter((block) => block.day_of_week === weekday)
            .map((block) => ({
              start: block.start_minute,
              end: block.end_minute,
            })),
          ...user.google_busy_blocks
            .filter((block) => block.event_date.toISOString().slice(0, 10) === date)
            .map((block) => ({
              start: minuteOfDay(block.start_at, date),
              end: minuteOfDay(block.end_at, date),
            })),
        ];
      }
    }
    return busy;
  }

  // Preferencias de tareas (UT1020). Hasta que esa funcionalidad esté en la rama principal
  // no hay de dónde leerlas y el reparto solo usa puntos y disponibilidad
  private async loadPreferences(
    _apartmentId: string,
    _userIds: string[],
  ): Promise<Record<string, Preference>> {
    return {};
  }

  private describe(
    plan: PlanResult,
    context: {
      days: DateKey[];
      users: { id: string; full_name: string }[];
      before: Record<string, number>;
      taskTitles: Map<string, string>;
    },
  ): WeekPlan {
    const names = new Map(context.users.map((user) => [user.id, user.full_name]));
    const title = (taskId: string) => context.taskTitles.get(taskId) ?? '';

    return {
      week: { from: context.days[0], to: context.days[6] },
      assignments: plan.assignments.map((assignment) => ({
        task_id: assignment.taskId,
        task_title: title(assignment.taskId),
        user_id: assignment.userId,
        user_name: names.get(assignment.userId) ?? '',
        date: assignment.date,
        time: assignment.time,
        points: assignment.points,
      })),
      unassigned: plan.unassigned.map((item) => ({
        task_id: item.taskId,
        task_title: item.title,
        days: item.days,
        reason: item.reason,
      })),
      points: context.users.map((user) => ({
        user_id: user.id,
        user_name: user.full_name,
        before: context.before[user.id] ?? 0,
        after: plan.projectedPoints[user.id] ?? 0,
      })),
    };
  }
}
