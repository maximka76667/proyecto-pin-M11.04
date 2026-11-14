import { TaskPriority } from '@prisma/client';

// Peso de la prioridad en el valor por defecto de una tarea
const PRIORITY_FACTOR: Record<TaskPriority, number> = {
  low: 1,
  medium: 1.5,
  high: 2,
};

// Puntos por defecto de una tarea: duración x factor de prioridad (misma fórmula que el
// relleno de la migración task_points). El usuario puede cambiarlos al crear o editar la tarea
export function defaultTaskPoints(
  durationMinutes: number,
  priority: TaskPriority,
): number {
  return Math.round(durationMinutes * PRIORITY_FACTOR[priority]);
}
