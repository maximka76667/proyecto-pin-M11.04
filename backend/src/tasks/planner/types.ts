// Tipos del planificador de reparto automático. Todo son datos simples (sin Prisma ni Nest)
// para que el algoritmo sea una función pura y fácil de probar.

// Fechas "AAAA-MM-DD"; las horas son minutos desde medianoche, como en el resto del backend
export type DateKey = string;

export type Preference = 'prefer' | 'indifferent' | 'avoid';

export interface Interval {
  start: number;
  end: number;
}

export interface PlannerMember {
  id: string;
  // Puntos acumulados (suma del ledger TaskPoints): es la carga de partida
  points: number;
}

export interface PlannerTask {
  id: string;
  title: string;
  points: number;
  durationMinutes: number;
  frequency: 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly';
}

// Una cosa concreta que hay que repartir: una tarea diaria genera una por día,
// una semanal genera una que puede caer en cualquier día de la semana
export interface Occurrence {
  taskId: string;
  title: string;
  points: number;
  durationMinutes: number;
  days: DateKey[];
}

// usuario -> fecha -> franjas
export type IntervalsByUserAndDate = Record<
  string,
  Record<DateKey, Interval[]>
>;

export interface PlanOptions {
  // Ventana del día en la que se pueden poner tareas (minutos desde medianoche)
  dayStart: number;
  dayEnd: number;
  // Cada cuántos minutos puede empezar una tarea
  step: number;
  // Nadie debería superar esta proporción de la media de puntos proyectados
  maxOverMeanRatio: number;
  // Cuánto pesa una preferencia, como fracción de los puntos de la tarea. Es pequeño a
  // propósito: la reputación manda, y la preferencia solo desempata entre cargas parecidas
  preferenceWeight: number;
}

export const DEFAULT_PLAN_OPTIONS: PlanOptions = {
  dayStart: 8 * 60,
  dayEnd: 22 * 60,
  step: 30,
  maxOverMeanRatio: 1.5,
  preferenceWeight: 0.25,
};

export interface PlanInput {
  members: PlannerMember[];
  occurrences: Occurrence[];
  // Franjas ocupadas por su calendario (disponibilidad semanal y Google): el borde cuenta
  // como ocupado, igual que al asignar a mano (PA-1524.03)
  busy: IntervalsByUserAndDate;
  // Tareas que esas personas ya tienen asignadas: aquí solo cuenta el solape real
  taken: IntervalsByUserAndDate;
  // clave `${userId}|${taskId}`
  preferences?: Record<string, Preference>;
  options?: Partial<PlanOptions>;
}

export interface PlannedAssignment {
  taskId: string;
  userId: string;
  date: DateKey;
  // "HH:mm"
  time: string;
  points: number;
}

export interface UnassignedOccurrence {
  taskId: string;
  title: string;
  days: DateKey[];
  reason: string;
}

export interface PlanResult {
  assignments: PlannedAssignment[];
  unassigned: UnassignedOccurrence[];
  // Puntos de cada persona tras el reparto (acumulados + lo repartido)
  projectedPoints: Record<string, number>;
}
