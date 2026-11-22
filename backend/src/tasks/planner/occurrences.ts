import { DateKey, Occurrence, PlannerTask } from './types';

// Los siete días de la semana siguiente (lunes a domingo) a partir de `today` ("AAAA-MM-DD").
// Si hoy es lunes, la semana siguiente empieza dentro de siete días
export function nextWeekDays(today: DateKey): DateKey[] {
  const date = new Date(`${today}T00:00:00.000Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday + 7);

  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(date);
    day.setUTCDate(date.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
}

export interface ExistingAssignment {
  taskId: string;
  date: DateKey;
}

// Convierte las tareas en cosas que repartir esa semana:
// - daily: una por cada día que aún no tenga a alguien
// - weekly: una, salvo que ya tenga una asignación esa semana
// - none: una sola vez en la vida, salvo que ya se haya asignado alguna vez
// biweekly y monthly no se reparten todavía
export function buildOccurrences(
  tasks: PlannerTask[],
  days: DateKey[],
  existingThisWeek: ExistingAssignment[],
  taskIdsEverAssigned: ReadonlySet<string>,
): Occurrence[] {
  const occurrences: Occurrence[] = [];

  for (const task of tasks) {
    const base = {
      taskId: task.id,
      title: task.title,
      points: task.points,
      durationMinutes: task.durationMinutes,
    };
    const existingDays = new Set(
      existingThisWeek
        .filter((assignment) => assignment.taskId === task.id)
        .map((assignment) => assignment.date),
    );

    if (task.frequency === 'daily') {
      for (const day of days) {
        if (!existingDays.has(day)) occurrences.push({ ...base, days: [day] });
      }
    } else if (task.frequency === 'weekly') {
      if (existingDays.size === 0) occurrences.push({ ...base, days });
    } else if (task.frequency === 'none') {
      if (!taskIdsEverAssigned.has(task.id)) {
        occurrences.push({ ...base, days });
      }
    }
  }

  return occurrences;
}
