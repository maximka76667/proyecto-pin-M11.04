export type Day = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

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
export type HouseMember = { id: string; full_name: string; isCurrentUser: boolean; blocks: HouseBlock[] };

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

// Devuelve el mensaje de error de la semana o null si todo es correcto
export function validateBlocks(blocks: MyBlock[]): string | null {
    for (const b of blocks) {
        if (!normalizeTime(b.start) || !normalizeTime(b.end)) return 'Usa el formato HH:mm (por ejemplo 09:30)';
        if (toMinutes(b.end) <= toMinutes(b.start)) return 'La hora de fin debe ser posterior a la de inicio';
    }
    for (const day of DAYS) {
        const sorted = blocks
            .filter((b) => b.day_of_week === day.key)
            .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
        for (let i = 1; i < sorted.length; i++) {
            if (toMinutes(sorted[i].start) < toMinutes(sorted[i - 1].end)) return `Hay franjas solapadas el ${day.long.toLowerCase()}`;
        }
    }
    return null;
}
