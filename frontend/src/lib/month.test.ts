import { currentMonth, monthLabel, shiftMonth } from './month';

describe('month', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('currentMonth devuelve AAAA-MM con el mes de dos cifras', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 2, 15, 12));
    expect(currentMonth()).toBe('2026-03');
  });

  it('shiftMonth avanza y retrocede dentro del año', () => {
    expect(shiftMonth('2026-05', 1)).toBe('2026-06');
    expect(shiftMonth('2026-05', -1)).toBe('2026-04');
    expect(shiftMonth('2026-05', 0)).toBe('2026-05');
  });

  it('shiftMonth cruza el cambio de año', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-01', -13)).toBe('2024-12');
  });

  it('monthLabel escribe el mes en español', () => {
    const label = monthLabel('2026-11');
    expect(label).toContain('noviembre');
    expect(label).toContain('2026');
  });
});
