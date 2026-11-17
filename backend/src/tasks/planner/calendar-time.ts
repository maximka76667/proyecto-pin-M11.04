import { DateKey } from './types';

const DAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

function timeZone() {
  return process.env.CALENDAR_TIME_ZONE ?? 'Europe/Madrid';
}

// "AAAA-MM-DD" de hoy en la zona horaria del calendario (no la del servidor)
export function todayKey(now: Date = new Date()): DateKey {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// Nombre del día de la semana de una fecha, como lo guarda AvailabilityBlock
export function weekdayOf(date: DateKey): string {
  return DAY_NAMES[new Date(`${date}T00:00:00.000Z`).getUTCDay()];
}

// Minuto del día (en la zona del calendario) de un instante, dentro del día `date`.
// Un evento que empieza antes de ese día cuenta desde las 00:00 y uno que acaba después
// cuenta hasta las 24:00
export function minuteOfDay(value: Date, date: DateKey): number {
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
  if (localDate !== date) return localDate < date ? 0 : 24 * 60;

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone(),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  return (
    Number(parts.find((part) => part.type === 'hour')?.value) * 60 +
    Number(parts.find((part) => part.type === 'minute')?.value)
  );
}

export function toMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
}
