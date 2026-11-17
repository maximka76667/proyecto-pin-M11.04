import { intervalsOf, overlaps, touches } from './intervals';
import {
  DEFAULT_PLAN_OPTIONS,
  DateKey,
  Interval,
  IntervalsByUserAndDate,
  Occurrence,
  PlanInput,
  PlanOptions,
  PlanResult,
  PlannedAssignment,
  PlannerMember,
  UnassignedOccurrence,
} from './types';

function toHHmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

interface Slot {
  date: DateKey;
  start: number;
}

interface Candidate {
  member: PlannerMember;
  slot: Slot;
}

// Reparto voraz: las ocurrencias más pesadas primero, cada una a quien tenga menos puntos
// proyectados (los que ya tiene + los que se le han repartido + los de esta tarea), con un
// tope de `maxOverMeanRatio` veces la media para que nadie se lleve demasiado.
// Una preferencia mueve la puntuación `preferenceWeight` × los puntos de la tarea.
// Es determinista: a igualdad gana quien lleva menos veces esa tarea, luego quien lleva
// menos tareas repartidas y, por último, el id.
export function planAssignments(input: PlanInput): PlanResult {
  const options: PlanOptions = { ...DEFAULT_PLAN_OPTIONS, ...input.options };
  const preferences = input.preferences ?? {};

  const projected: Record<string, number> = {};
  for (const member of input.members) projected[member.id] = member.points;

  const totalPoints =
    input.members.reduce((sum, member) => sum + member.points, 0) +
    input.occurrences.reduce((sum, occurrence) => sum + occurrence.points, 0);
  // Margen de una tarea (la más pesada): con pocas tareas la media es tan baja que el tope
  // dejaría fuera a casi todos; con muchas, ese margen pesa poco y el tope manda
  const heaviestTask = input.occurrences.reduce(
    (max, occurrence) => Math.max(max, occurrence.points),
    0,
  );
  const cap =
    input.members.length > 0
      ? (totalPoints / input.members.length) * options.maxOverMeanRatio +
        heaviestTask
      : 0;

  // Lo que se va ocupando al repartir (se copia para no modificar la entrada)
  const planned: IntervalsByUserAndDate = {};
  const plannedCount: Record<string, number> = {};
  const sameTaskCount: Record<string, number> = {};
  const tasksPerDay: Record<string, number> = {};

  const isFree = (userId: string, date: DateKey, interval: Interval) =>
    !intervalsOf(input.busy, userId, date).some((busy) =>
      touches(interval, busy),
    ) &&
    !intervalsOf(input.taken, userId, date).some((taken) =>
      overlaps(interval, taken),
    ) &&
    !intervalsOf(planned, userId, date).some((other) =>
      overlaps(interval, other),
    );

  const findSlot = (userId: string, occurrence: Occurrence): Slot | null => {
    // Si la tarea puede caer en varios días, primero el día en que esa persona tiene menos
    const days = [...occurrence.days].sort(
      (a, b) =>
        (tasksPerDay[`${userId}|${a}`] ?? 0) -
          (tasksPerDay[`${userId}|${b}`] ?? 0) || a.localeCompare(b),
    );
    for (const date of days) {
      for (
        let start = options.dayStart;
        start + occurrence.durationMinutes <= options.dayEnd;
        start += options.step
      ) {
        const interval = { start, end: start + occurrence.durationMinutes };
        if (isFree(userId, date, interval)) return { date, start };
      }
    }
    return null;
  };

  const preferenceAdjustment = (
    userId: string,
    occurrence: Occurrence,
  ): number => {
    const preference = preferences[`${userId}|${occurrence.taskId}`];
    if (preference === 'prefer') {
      return -options.preferenceWeight * occurrence.points;
    }
    if (preference === 'avoid') {
      return options.preferenceWeight * occurrence.points;
    }
    return 0;
  };

  const ordered = [...input.occurrences].sort(
    (a, b) =>
      b.points - a.points ||
      b.durationMinutes - a.durationMinutes ||
      a.taskId.localeCompare(b.taskId) ||
      a.days[0].localeCompare(b.days[0]),
  );

  const assignments: PlannedAssignment[] = [];
  const unassigned: UnassignedOccurrence[] = [];

  for (const occurrence of ordered) {
    const candidates: Candidate[] = [];
    for (const member of input.members) {
      const slot = findSlot(member.id, occurrence);
      if (slot) candidates.push({ member, slot });
    }

    if (candidates.length === 0) {
      unassigned.push({
        taskId: occurrence.taskId,
        title: occurrence.title,
        days: occurrence.days,
        reason: 'Nadie tiene un hueco libre para esta tarea',
      });
      continue;
    }

    const withinCap = candidates.filter(
      ({ member }) => projected[member.id] + occurrence.points <= cap,
    );
    const pool = withinCap.length > 0 ? withinCap : candidates;

    const score = ({ member }: Candidate) =>
      projected[member.id] +
      occurrence.points +
      preferenceAdjustment(member.id, occurrence);

    const chosen = [...pool].sort(
      (a, b) =>
        score(a) - score(b) ||
        (sameTaskCount[`${a.member.id}|${occurrence.taskId}`] ?? 0) -
          (sameTaskCount[`${b.member.id}|${occurrence.taskId}`] ?? 0) ||
        (plannedCount[a.member.id] ?? 0) - (plannedCount[b.member.id] ?? 0) ||
        a.member.id.localeCompare(b.member.id),
    )[0];

    const { member, slot } = chosen;
    const end = slot.start + occurrence.durationMinutes;
    ((planned[member.id] ??= {})[slot.date] ??= []).push({
      start: slot.start,
      end,
    });
    projected[member.id] += occurrence.points;
    plannedCount[member.id] = (plannedCount[member.id] ?? 0) + 1;
    const sameTaskKey = `${member.id}|${occurrence.taskId}`;
    sameTaskCount[sameTaskKey] = (sameTaskCount[sameTaskKey] ?? 0) + 1;
    const dayKey = `${member.id}|${slot.date}`;
    tasksPerDay[dayKey] = (tasksPerDay[dayKey] ?? 0) + 1;

    assignments.push({
      taskId: occurrence.taskId,
      userId: member.id,
      date: slot.date,
      time: toHHmm(slot.start),
      points: occurrence.points,
    });
  }

  assignments.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.time.localeCompare(b.time) ||
      a.userId.localeCompare(b.userId),
  );

  return { assignments, unassigned, projectedPoints: projected };
}
