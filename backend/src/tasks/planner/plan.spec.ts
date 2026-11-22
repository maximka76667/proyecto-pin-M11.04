import { buildOccurrences, nextWeekDays } from './occurrences';
import { planAssignments } from './plan';
import { Occurrence, PlannerTask } from './types';

// Desde el sábado 14 de noviembre de 2026: del lunes 16 al domingo 22
const WEEK = nextWeekDays('2026-11-14');

function weeklyOccurrence(
  taskId: string,
  points = 30,
  durationMinutes = 30,
): Occurrence {
  return { taskId, title: taskId, points, durationMinutes, days: WEEK };
}

function countByUser(assignments: { userId: string }[]) {
  const counts: Record<string, number> = {};
  for (const { userId } of assignments) {
    counts[userId] = (counts[userId] ?? 0) + 1;
  }
  return counts;
}

describe('nextWeekDays', () => {
  it('desde un sábado devuelve de lunes a domingo de la semana siguiente', () => {
    expect(nextWeekDays('2026-11-14')).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ]);
  });

  it('desde un lunes salta a la semana siguiente, no a la actual', () => {
    expect(nextWeekDays('2026-11-16')[0]).toBe('2026-11-23');
  });

  it('desde un domingo devuelve el lunes siguiente', () => {
    expect(nextWeekDays('2026-11-22')[0]).toBe('2026-11-23');
  });

  it('cruza el cambio de año', () => {
    expect(nextWeekDays('2026-12-30')[0]).toBe('2027-01-04');
  });
});

describe('buildOccurrences', () => {
  const task = (
    id: string,
    frequency: PlannerTask['frequency'],
  ): PlannerTask => ({
    id,
    title: id,
    points: 30,
    durationMinutes: 30,
    frequency,
  });

  it('una tarea diaria genera una ocurrencia por día', () => {
    const result = buildOccurrences([task('t', 'daily')], WEEK, [], new Set());
    expect(result).toHaveLength(7);
    expect(result.every((o) => o.days.length === 1)).toBe(true);
  });

  it('una tarea diaria no repite un día que ya tiene asignación', () => {
    const result = buildOccurrences(
      [task('t', 'daily')],
      WEEK,
      [{ taskId: 't', date: WEEK[2] }],
      new Set(),
    );
    expect(result).toHaveLength(6);
    expect(result.some((o) => o.days[0] === WEEK[2])).toBe(false);
  });

  it('una tarea semanal genera una ocurrencia que puede caer cualquier día', () => {
    const result = buildOccurrences([task('t', 'weekly')], WEEK, [], new Set());
    expect(result).toHaveLength(1);
    expect(result[0].days).toEqual(WEEK);
  });

  it('una tarea semanal con asignación esa semana no se vuelve a repartir', () => {
    const result = buildOccurrences(
      [task('t', 'weekly')],
      WEEK,
      [{ taskId: 't', date: WEEK[4] }],
      new Set(['t']),
    );
    expect(result).toHaveLength(0);
  });

  it('una tarea de una sola vez solo se reparte si nunca se asignó', () => {
    expect(
      buildOccurrences([task('t', 'none')], WEEK, [], new Set()),
    ).toHaveLength(1);
    expect(
      buildOccurrences([task('t', 'none')], WEEK, [], new Set(['t'])),
    ).toHaveLength(0);
  });

  it('ignora biweekly y monthly', () => {
    const result = buildOccurrences(
      [task('a', 'biweekly'), task('b', 'monthly')],
      WEEK,
      [],
      new Set(),
    );
    expect(result).toHaveLength(0);
  });
});

describe('planAssignments', () => {
  it('iguala los puntos: con A=120, B=60, C=60 y seis tareas de 30, A=1, B=3, C=2', () => {
    const result = planAssignments({
      members: [
        { id: 'A', points: 120 },
        { id: 'B', points: 60 },
        { id: 'C', points: 60 },
      ],
      occurrences: ['t1', 't2', 't3', 't4', 't5', 't6'].map((id) =>
        weeklyOccurrence(id),
      ),
      busy: {},
      taken: {},
    });

    expect(result.unassigned).toHaveLength(0);
    expect(countByUser(result.assignments)).toEqual({ A: 1, B: 3, C: 2 });
    // C se queda en 120 porque con dos tareas ya está por debajo de los demás
    expect(result.projectedPoints).toEqual({ A: 150, B: 150, C: 120 });
  });

  it('es determinista: la misma entrada da el mismo reparto', () => {
    const input = {
      members: [
        { id: 'A', points: 0 },
        { id: 'B', points: 0 },
        { id: 'C', points: 0 },
      ],
      occurrences: ['t1', 't2', 't3', 't4'].map((id) => weeklyOccurrence(id)),
      busy: {},
      taken: {},
    };
    expect(planAssignments(input)).toEqual(planAssignments(input));
  });

  it('una tarea diaria se reparte entre varias personas, no se la queda una', () => {
    const occurrences = buildOccurrences(
      [
        {
          id: 'basura',
          title: 'Basura',
          points: 10,
          durationMinutes: 15,
          frequency: 'daily',
        },
      ],
      WEEK,
      [],
      new Set(),
    );
    const result = planAssignments({
      members: [
        { id: 'A', points: 0 },
        { id: 'B', points: 0 },
        { id: 'C', points: 0 },
      ],
      occurrences,
      busy: {},
      taken: {},
    });

    const counts = countByUser(result.assignments);
    expect(Object.keys(counts)).toHaveLength(3);
    expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(3);
    expect(Math.min(...Object.values(counts))).toBeGreaterThanOrEqual(2);
  });

  it('no asigna a quien tiene el día ocupado', () => {
    const allDayBusy = Object.fromEntries(WEEK.map((d) => [d, [{ start: 0, end: 1440 }]]));
    const result = planAssignments({
      members: [
        { id: 'A', points: 0 },
        { id: 'B', points: 100 },
      ],
      occurrences: [weeklyOccurrence('t1')],
      busy: { A: allDayBusy },
      taken: {},
    });

    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].userId).toBe('B');
  });

  it('no deja una tarea pegada a una franja ocupada (el borde cuenta)', () => {
    const result = planAssignments({
      members: [{ id: 'A', points: 0 }],
      occurrences: [{ ...weeklyOccurrence('t1'), days: [WEEK[0]] }],
      // ocupado de 8:00 a 9:00: la primera hora válida es 9:30, no 9:00
      busy: { A: { [WEEK[0]]: [{ start: 480, end: 540 }] } },
      taken: {},
    });

    expect(result.assignments[0].time).toBe('09:30');
  });

  it('permite empezar justo cuando termina otra tarea ya asignada', () => {
    const result = planAssignments({
      members: [{ id: 'A', points: 0 }],
      occurrences: [{ ...weeklyOccurrence('t1'), days: [WEEK[0]] }],
      busy: {},
      taken: { A: { [WEEK[0]]: [{ start: 480, end: 540 }] } },
    });

    expect(result.assignments[0].time).toBe('09:00');
  });

  it('esquiva lo que la persona ya tiene asignado ese día', () => {
    const result = planAssignments({
      members: [{ id: 'A', points: 0 }],
      occurrences: [{ ...weeklyOccurrence('t1', 30, 60), days: [WEEK[0]] }],
      busy: {},
      // ya tiene algo de 8:00 a 10:00: la nueva (60 min) no puede empezar antes de las 10:00
      taken: { A: { [WEEK[0]]: [{ start: 480, end: 600 }] } },
    });

    expect(result.assignments[0].time).toBe('10:00');
  });

  it('con lo ya asignado ocupando todo el día, la tarea queda sin asignar', () => {
    const result = planAssignments({
      members: [{ id: 'A', points: 0 }],
      occurrences: [{ ...weeklyOccurrence('t1', 30, 60), days: [WEEK[0]] }],
      busy: {},
      taken: { A: { [WEEK[0]]: [{ start: 0, end: 1440 }] } },
    });

    expect(result.assignments).toHaveLength(0);
    expect(result.unassigned).toHaveLength(1);
  });

  it('no solapa dos tareas de la misma persona', () => {
    const result = planAssignments({
      members: [{ id: 'A', points: 0 }],
      occurrences: [
        { ...weeklyOccurrence('t1', 30, 60), days: [WEEK[0]] },
        { ...weeklyOccurrence('t2', 20, 60), days: [WEEK[0]] },
      ],
      busy: {},
      taken: {},
    });

    const times = result.assignments.map((a) => a.time).sort();
    expect(times).toEqual(['08:00', '09:00']);
  });

  it('informa de lo que no cabe en lugar de fallar', () => {
    const allDayBusy = Object.fromEntries(WEEK.map((d) => [d, [{ start: 0, end: 1440 }]]));
    const result = planAssignments({
      members: [{ id: 'A', points: 0 }],
      occurrences: [weeklyOccurrence('t1')],
      busy: { A: allDayBusy },
      taken: {},
    });

    expect(result.assignments).toHaveLength(0);
    expect(result.unassigned).toHaveLength(1);
    expect(result.unassigned[0].taskId).toBe('t1');
  });

  it('una persona que prefiere evitar la tarea la recibe solo si compensa', () => {
    const base = {
      members: [
        { id: 'A', points: 0 },
        { id: 'B', points: 0 },
      ],
      occurrences: [weeklyOccurrence('t1')],
      busy: {},
      taken: {},
    };

    // A empata con B y gana por id...
    expect(planAssignments(base).assignments[0].userId).toBe('A');
    // ...pero si A prefiere evitarla, se la lleva B
    expect(
      planAssignments({ ...base, preferences: { 'A|t1': 'avoid' } })
        .assignments[0].userId,
    ).toBe('B');
  });

  it('una preferencia positiva atrae la tarea aunque la persona vaya algo más cargada', () => {
    const base = {
      members: [
        { id: 'A', points: 100 },
        { id: 'B', points: 102 },
      ],
      occurrences: [weeklyOccurrence('t1', 10)],
      busy: {},
      taken: {},
    };

    // Sin preferencia, la persona con menos puntos se la queda
    expect(planAssignments(base).assignments[0].userId).toBe('A');
    // B va 2 puntos por detrás, pero prefiere la tarea (-2,5)
    expect(
      planAssignments({ ...base, preferences: { 'B|t1': 'prefer' } })
        .assignments[0].userId,
    ).toBe('B');
  });

  it('la reputación pesa más que la preferencia: quien va por detrás compensa', () => {
    const result = planAssignments({
      members: [
        { id: 'A', points: 100 },
        { id: 'B', points: 110 },
      ],
      occurrences: [weeklyOccurrence('t1', 30)],
      busy: {},
      taken: {},
      // B prefiere la tarea (-7,5), pero A tiene 10 puntos menos
      preferences: { 'B|t1': 'prefer' },
    });

    expect(result.assignments[0].userId).toBe('A');
  });

  it('con una sola tarea el tope no deja fuera a quien la prefiere', () => {
    const result = planAssignments({
      members: [
        { id: 'A', points: 0 },
        { id: 'B', points: 5 },
      ],
      occurrences: [weeklyOccurrence('t1', 30)],
      busy: {},
      taken: {},
      // A puntúa 30 y B 35 - 7,5 = 27,5, así que gana B. Sin el margen de una tarea el tope
      // sería (0 + 5 + 30) / 2 x 1,5 = 26,25 y B (35) quedaría descartado
      preferences: { 'B|t1': 'prefer' },
    });

    expect(result.assignments[0].userId).toBe('B');
  });

  it('con muchas tareas, si una persona las prefiere todas igualmente se reparten por igual', () => {
    const result = planAssignments({
      members: [
        { id: 'A', points: 0 },
        { id: 'B', points: 0 },
      ],
      occurrences: Array.from({ length: 10 }, (_, i) =>
        weeklyOccurrence(`t${i}`, 10),
      ),
      busy: {},
      taken: {},
      preferences: Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [`B|t${i}`, 'prefer' as const]),
      ),
    });

    expect(countByUser(result.assignments)).toEqual({ A: 5, B: 5 });
  });

  it('una preferencia no vence a un desequilibrio grande', () => {
    const result = planAssignments({
      members: [
        { id: 'A', points: 0 },
        { id: 'B', points: 200 },
      ],
      occurrences: [weeklyOccurrence('t1')],
      busy: {},
      taken: {},
      preferences: { 'B|t1': 'prefer' },
    });

    expect(result.assignments[0].userId).toBe('A');
  });

  it('con un solo miembro le asigna todo lo que cabe', () => {
    const result = planAssignments({
      members: [{ id: 'A', points: 0 }],
      occurrences: [weeklyOccurrence('t1'), weeklyOccurrence('t2')],
      busy: {},
      taken: {},
    });

    expect(result.assignments).toHaveLength(2);
  });

  it('sin miembros no asigna nada y lo informa', () => {
    const result = planAssignments({
      members: [],
      occurrences: [weeklyOccurrence('t1')],
      busy: {},
      taken: {},
    });

    expect(result.assignments).toHaveLength(0);
    expect(result.unassigned).toHaveLength(1);
  });
});
