// Hora de inicio de una tarea (UT1524): "9:30" y "09:30" son la misma hora y se guarda
// siempre como HH:mm, también para que @@unique([user_id, due_date, due_time]) las vea iguales
export const TASK_TIME_PATTERN = /^(?:[01]?\d|2[0-3]):[0-5]\d$/;
export const TASK_TIME_MESSAGE = 'La hora debe tener el formato HH:mm, por ejemplo 09:30';

// Para @Transform: normaliza antes de validar; lo que no es una hora se deja igual
// para que @Matches lo rechace con su mensaje
export const normalizeTaskTime = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const time = value.trim();
  return /^\d:\d\d$/.test(time) ? `0${time}` : time;
};
