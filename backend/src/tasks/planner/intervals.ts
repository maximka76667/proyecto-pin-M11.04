import { DateKey, Interval, IntervalsByUserAndDate } from './types';

// Solape real: que una termine justo cuando empieza la otra no es solape
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

// Con el borde incluido: terminar justo cuando empieza una franja ocupada tampoco vale
export function touches(a: Interval, b: Interval): boolean {
  return a.start <= b.end && b.start <= a.end;
}

export function intervalsOf(
  source: IntervalsByUserAndDate,
  userId: string,
  date: DateKey,
): Interval[] {
  return source[userId]?.[date] ?? [];
}
