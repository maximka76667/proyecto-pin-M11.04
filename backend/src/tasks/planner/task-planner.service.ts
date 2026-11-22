import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AssignmentStatus, Prisma, TaskStatus } from '@prisma/client';
import { toHHmm } from '../../availability/availability.service';
import { GoogleCalendarService } from '../../availability/google-calendar.service';
import { PrismaService } from '../../prisma/prisma.service';
import { minuteOfDay, todayKey, toMinutes, weekdayOf } from './calendar-time';
import { intervalsOf, overlaps, touches } from './intervals';
import { buildOccurrences, nextWeekDays } from './occurrences';
import { planAssignments } from './plan';
import {
  DateKey,
  IntervalsByUserAndDate,
  Occurrence,
  PlannedAssignment,
  PlannerMember,
  PlannerTask,
  Preference,
} from './types';

const PLANNABLE_STATUSES: TaskStatus[] = [
  TaskStatus.pending,
  TaskStatus.assigned,
  TaskStatus.in_progress,
];

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

// Una asignación tal como llega del cliente o del planificador
export interface PlanItem {
  task_id: string;
  user_id: string;
  date: DateKey;
  time: string;
}

export interface PlanItemCheck {
  index: number;
  issues: string[];
}

export interface WeekPlan {
  week: { from: DateKey; to: DateKey };
  assignments: {
    task_id: string;
    task_title: string;
    user_id: string;
    user_name: string;
    date: DateKey;
    time: string;
    duration_minutes: number;
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

interface PlanContext {
  days: DateKey[];
  users: { id: string; full_name: string }[];
  members: PlannerMember[];
  tasks: PlannerTask[];
  occurrences: Occurrence[];
  busy: IntervalsByUserAndDate;
  taken: IntervalsByUserAndDate;
  preferences: Record<string, Preference>;
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
    const context = await this.loadContext(apartmentId, today, true);
    const result = this.plan(context);
    this.assertCoherent(context, result);
    return this.describe(context, result);
  }

  // Comprueba las asignaciones tal como están en pantalla (ya editadas). No guarda nada.
  // No sincroniza Google Calendar para ser rápida mientras se edita: usa lo ya guardado;
  // `apply` sí lo sincroniza
  async validate(
    apartmentId: string,
    userId: string,
    items: PlanItem[],
    today?: DateKey,
  ) {
    await this.assertMember(apartmentId, userId);
    const context = await this.loadContext(apartmentId, today, false);
    const checks = this.check(context, items);
    return { valid: checks.every((c) => c.issues.length === 0), items: checks };
  }

  // Crea las asignaciones. Sin `items` aplica el reparto automático. En los dos casos se
  // valida en el servidor con los datos de ahora: nada de lo que mande el cliente se da por
  // bueno, así no se puede crear una asignación que se solape, que esté fuera de la semana
  // o que ya esté repartida
  async apply(
    apartmentId: string,
    userId: string,
    items?: PlanItem[],
    today?: DateKey,
  ) {
    await this.assertMember(apartmentId, userId);
    const context = await this.loadContext(apartmentId, today, true);

    let toCreate: PlanItem[];
    if (items) {
      toCreate = items;
    } else {
      const automatic = this.plan(context);
      this.assertCoherent(context, automatic);
      toCreate = this.toItems(automatic.assignments);
    }

    const problems = items
      ? this.check(context, toCreate).filter((c) => c.issues.length > 0)
      : [];
    if (problems.length > 0) {
      const titles = new Map(context.tasks.map((t) => [t.id, t.title]));
      const first = problems
        .slice(0, 3)
        .map(
          (p) =>
            `${titles.get(toCreate[p.index].task_id) ?? 'Tarea'}: ${p.issues[0]}`,
        );
      const more = problems.length > 3 ? ` (y ${problems.length - 3} más)` : '';
      throw new ConflictException(
        `El reparto no es válido. ${first.join('. ')}${more}`,
      );
    }

    if (toCreate.length > 0) {
      const taskIds = [...new Set(toCreate.map((item) => item.task_id))];
      try {
        await this.prisma.$transaction([
          ...toCreate.map((item) =>
            this.prisma.taskAssignment.create({
              data: {
                task_id: item.task_id,
                user_id: item.user_id,
                due_date: new Date(`${item.date}T00:00:00.000Z`),
                due_time: item.time,
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

    return { created: toCreate.length };
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

  private toItems(assignments: PlannedAssignment[]): PlanItem[] {
    return assignments.map((a) => ({
      task_id: a.taskId,
      user_id: a.userId,
      date: a.date,
      time: a.time,
    }));
  }

  // El reparto automático pasa por las mismas reglas que una edición manual. Si algo no
  // tiene sentido (un solape, una persona fuera del piso...) es un fallo del algoritmo:
  // se registra con detalle y se devuelve un error en lugar de enseñar o guardar un
  // reparto roto
  private assertCoherent(
    context: PlanContext,
    result: ReturnType<typeof planAssignments>,
  ) {
    const items = this.toItems(result.assignments);
    const problems = this.check(context, items).filter(
      (check) => check.issues.length > 0,
    );
    if (problems.length === 0) return;

    this.logger.error(
      `El reparto automático no es coherente: ${JSON.stringify(
        problems.map((p) => ({ item: items[p.index], issues: p.issues })),
      )}`,
    );
    throw new UnprocessableEntityException(
      'No se ha podido calcular un reparto coherente. Inténtalo de nuevo o asigna las tareas a mano',
    );
  }

  private plan(context: PlanContext) {
    return planAssignments({
      members: context.members,
      occurrences: context.occurrences,
      busy: context.busy,
      taken: context.taken,
      preferences: context.preferences,
    });
  }

  // Revisa cada asignación contra las reglas del reparto. Una lista vacía de problemas
  // significa que esa asignación es válida
  private check(context: PlanContext, items: PlanItem[]): PlanItemCheck[] {
    const userIds = new Set(context.users.map((user) => user.id));
    const names = new Map(context.users.map((u) => [u.id, u.full_name]));
    const tasks = new Map(context.tasks.map((task) => [task.id, task]));
    // Cada ocurrencia que hay que repartir solo puede cubrirse una vez
    const free = [...context.occurrences];

    const checks: PlanItemCheck[] = items.map((_, index) => ({
      index,
      issues: [],
    }));
    const placed: {
      index: number;
      userId: string;
      date: DateKey;
      start: number;
      end: number;
      title: string;
    }[] = [];

    items.forEach((item, index) => {
      const issues = checks[index].issues;
      const task = tasks.get(item.task_id);

      if (!task) issues.push('La tarea ya no existe o no se puede repartir');
      if (!userIds.has(item.user_id)) {
        issues.push('La persona no pertenece al piso');
      }
      if (!context.days.includes(item.date)) {
        issues.push('El día no está en la semana que se reparte');
      }
      if (!TIME_PATTERN.test(item.time)) {
        issues.push('La hora debe tener el formato HH:mm, por ejemplo 09:30');
      }

      if (task) {
        const match = free.findIndex(
          (occurrence) =>
            occurrence.taskId === task.id && occurrence.days.includes(item.date),
        );
        if (match === -1) {
          issues.push('Esta tarea ya está repartida o no toca ese día');
        } else {
          free.splice(match, 1);
        }
      }

      if (issues.length === 0 && task) {
        const start = toMinutes(item.time);
        const end = start + task.durationMinutes;
        if (end > 24 * 60) {
          issues.push('La tarea no puede terminar después de medianoche');
        } else {
          placed.push({
            index,
            userId: item.user_id,
            date: item.date,
            start,
            end,
            title: task.title,
          });
        }
      }
    });

    for (const slot of placed) {
      const issues = checks[slot.index].issues;
      const name = names.get(slot.userId) ?? 'Esa persona';
      const interval = { start: slot.start, end: slot.end };

      const busy = intervalsOf(context.busy, slot.userId, slot.date).find(
        (block) => touches(interval, block),
      );
      if (busy) {
        issues.push(
          `${name} tiene ocupado de ${toHHmm(busy.start)} a ${toHHmm(busy.end)} ese día`,
        );
      }

      const alreadyAssigned = intervalsOf(
        context.taken,
        slot.userId,
        slot.date,
      ).find((other) => overlaps(interval, other));
      if (alreadyAssigned) {
        const what = alreadyAssigned.label
          ? `«${alreadyAssigned.label}»`
          : 'otra tarea';
        issues.push(
          `${name} ya tiene ${what} de ${toHHmm(alreadyAssigned.start)} a ${toHHmm(alreadyAssigned.end)}, que se solapa`,
        );
      }

      for (const other of placed) {
        if (
          other.index !== slot.index &&
          other.userId === slot.userId &&
          other.date === slot.date &&
          overlaps(interval, other)
        ) {
          issues.push(
            `Se solapa con «${other.title}» de ${toHHmm(other.start)} a ${toHHmm(other.end)} (${name})`,
          );
        }
      }
    }

    return checks;
  }

  private async loadContext(
    apartmentId: string,
    today: DateKey | undefined,
    syncGoogle: boolean,
  ): Promise<PlanContext> {
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
          task: {
            select: {
              apartment_id: true,
              title: true,
              duration_minutes: true,
              points: true,
            },
          },
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
    // Lo que ya tienen asignado esa semana en este piso (a mano o con un reparto anterior)
    // también es carga: sus puntos todavía no están en el ledger, así que se suman. Lo
    // completado ya está en el ledger y lo rechazado no se va a hacer
    const committedByUser = new Map<string, number>();
    for (const assignment of weekAssignments) {
      if (
        assignment.task.apartment_id !== apartmentId ||
        assignment.status === AssignmentStatus.rejected ||
        assignment.status === AssignmentStatus.completed
      ) {
        continue;
      }
      committedByUser.set(
        assignment.user_id,
        (committedByUser.get(assignment.user_id) ?? 0) +
          (assignment.task.points ?? 0),
      );
    }

    const members = users.map((user) => ({
      id: user.id,
      points:
        (pointsByUser.get(user.id) ?? 0) + (committedByUser.get(user.id) ?? 0),
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
        label: assignment.task.title,
      });
    }

    return {
      days,
      users,
      members,
      tasks: plannerTasks,
      occurrences,
      busy: await this.loadBusy(userIds, days, from, after, dayAfterLast, syncGoogle),
      taken,
      preferences: await this.loadPreferences(apartmentId, userIds),
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
    syncGoogle: boolean,
  ): Promise<IntervalsByUserAndDate> {
    // Los eventos de Google solo se guardan cuando cada persona abre la app: se trae su
    // calendario de la semana antes de comprobar. Si falla, se sigue con lo guardado
    const googleCalendar = this.googleCalendar;
    if (googleCalendar && syncGoogle) {
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
            .filter(
              (block) => block.event_date.toISOString().slice(0, 10) === date,
            )
            .map((block) => ({
              start: minuteOfDay(block.start_at, date),
              end: minuteOfDay(block.end_at, date),
            })),
        ];
      }
    }
    return busy;
  }

  // Preferencias de tareas (UT1020): «prefiero», «evito» o sin marcar (indiferente).
  // La clave es «usuario|tarea», la misma que lee el planificador
  private async loadPreferences(
    apartmentId: string,
    userIds: string[],
  ): Promise<Record<string, Preference>> {
    const rows = await this.prisma.taskPreference.findMany({
      where: { user_id: { in: userIds }, task: { apartment_id: apartmentId } },
      select: { user_id: true, task_id: true, preference: true },
    });
    const preferences: Record<string, Preference> = {};
    for (const row of rows) preferences[`${row.user_id}|${row.task_id}`] = row.preference;
    return preferences;
  }

  private describe(
    context: PlanContext,
    result: ReturnType<typeof planAssignments>,
  ): WeekPlan {
    const names = new Map(context.users.map((user) => [user.id, user.full_name]));
    const tasks = new Map(context.tasks.map((task) => [task.id, task]));
    const before = new Map(context.members.map((m) => [m.id, m.points]));
    const describeItem = (assignment: PlannedAssignment) => {
      const task = tasks.get(assignment.taskId);
      return {
        task_id: assignment.taskId,
        task_title: task?.title ?? '',
        user_id: assignment.userId,
        user_name: names.get(assignment.userId) ?? '',
        date: assignment.date,
        time: assignment.time,
        duration_minutes: task?.durationMinutes ?? 30,
        points: assignment.points,
      };
    };

    return {
      week: { from: context.days[0], to: context.days[6] },
      assignments: result.assignments.map(describeItem),
      unassigned: result.unassigned.map((item) => ({
        task_id: item.taskId,
        task_title: item.title,
        days: item.days,
        reason: item.reason,
      })),
      points: context.users.map((user) => ({
        user_id: user.id,
        user_name: user.full_name,
        before: before.get(user.id) ?? 0,
        after: result.projectedPoints[user.id] ?? 0,
      })),
    };
  }
}
