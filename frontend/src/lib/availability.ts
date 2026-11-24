export type Day =
  'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export const DAYS: { key: Day; short: string; long: string }[] = [
  { key: 'monday', short: 'L', long: 'Lunes' },
  { key: 'tuesday', short: 'M', long: 'Martes' },
  { key: 'wednesday', short: 'X', long: 'Miércoles' },
  { key: 'thursday', short: 'J', long: 'Jueves' },
  { key: 'friday', short: 'V', long: 'Viernes' },
  { key: 'saturday', short: 'S', long: 'Sábado' },
  { key: 'sunday', short: 'D', long: 'Domingo' },
];

export type MyBlock = { day_of_week: Day; start: string; end: string; label: string | null };
export type HouseBlock = { day_of_week: Day; start: string; end: string };
export type HouseMember = {
  id: string;
  full_name: string;
  avatar_url?: string | null;
  isCurrentUser: boolean;
  blocks: HouseBlock[];
};

const HORA = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/;

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Acepta "9:00" y lo normaliza a "09:00"; devuelve null si no es una hora válida
export function normalizeTime(text: string): string | null {
  const t = text.trim();
  const padded = /^\d:\d\d$/.test(t) ? `0${t}` : t;
  return HORA.test(padded) ? padded : null;
}

// Devuelve el mensaje de error de la semana o null si todo es correcto.
// `saved` son las franjas ya guardadas: como se guarda la semana entera de una vez, una franja
// de hoy que ya existía y empieza antes de ahora no debe impedir guardar las demás
export function validateBlocks(blocks: MyBlock[], saved: MyBlock[] = []): string | null {
  const now = new Date();
  const today = DAYS[(now.getDay() + 6) % 7].key;
  const currentMinute = now.getHours() * 60 + now.getMinutes();
  const alreadySaved = (b: MyBlock) =>
    saved.some(
      (s) =>
        s.day_of_week === b.day_of_week &&
        normalizeTime(s.start) === normalizeTime(b.start) &&
        normalizeTime(s.end) === normalizeTime(b.end),
    );
  for (const b of blocks) {
    if (!normalizeTime(b.start) || !normalizeTime(b.end))
      return 'Usa el formato HH:mm (por ejemplo 09:30)';
    if (toMinutes(b.end) <= toMinutes(b.start))
      return 'La hora de fin debe ser posterior a la de inicio';
    if (b.day_of_week === today && toMinutes(b.start) < currentMinute && !alreadySaved(b))
      return 'No puedes guardar una franja que empieza en el pasado';
  }
  for (const day of DAYS) {
    const sorted = blocks
      .filter((b) => b.day_of_week === day.key)
      .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    for (let i = 1; i < sorted.length; i++) {
      if (toMinutes(sorted[i].start) < toMinutes(sorted[i - 1].end))
        return `Hay franjas solapadas el ${day.long.toLowerCase()}`;
    }
  }
  return null;
}
