import { splitExpense } from './expense-split';

// Por orden de id: ANA < BRUNO < PAGADOR
const PAGADOR = 'user-pagador';
const ANA = 'user-ana';
const BRUNO = 'user-bruno';

const deudas = (split: ReturnType<typeof splitExpense>) =>
  Object.fromEntries(split.debts);

describe('splitExpense', () => {
  it('reparte a partes iguales cuando es exacto', () => {
    const split = splitExpense(900, PAGADOR, [PAGADOR, ANA, BRUNO]);

    expect(deudas(split)).toEqual({ [ANA]: 300, [BRUNO]: 300 });
    expect(split.payerCents).toBe(300);
    expect(split.payerParticipates).toBe(true);
  });

  it('da los céntimos sobrantes a las primeras personas por orden de id', () => {
    // 10,00 entre 3 = 3,33 y sobra 1 céntimo: se lo lleva Ana, la primera por id
    const split = splitExpense(1000, PAGADOR, [PAGADOR, BRUNO, ANA]);

    expect(deudas(split)).toEqual({ [ANA]: 334, [BRUNO]: 333 });
    expect(split.payerCents).toBe(333);
  });

  it('el resultado no depende del orden en que vienen los participantes', () => {
    const a = splitExpense(1001, PAGADOR, [PAGADOR, ANA, BRUNO]);
    const b = splitExpense(1001, PAGADOR, [BRUNO, PAGADOR, ANA]);

    expect(deudas(a)).toEqual(deudas(b));
    expect(a.payerCents).toBe(b.payerCents);
  });

  it('si el pagador es de los primeros por id, los céntimos sobrantes son suyos', () => {
    // 'a-pagador' < 'user-ana': el pagador es el primero y se queda el céntimo
    const split = splitExpense(1000, 'a-pagador', ['a-pagador', ANA, BRUNO]);

    expect(split.payerCents).toBe(334);
    expect(deudas(split)).toEqual({ [ANA]: 333, [BRUNO]: 333 });
  });

  it('si el pagador no reparte, los demás se reparten todo el importe', () => {
    const split = splitExpense(1000, PAGADOR, [ANA, BRUNO]);

    expect(deudas(split)).toEqual({ [ANA]: 500, [BRUNO]: 500 });
    expect(split.payerCents).toBe(0);
    expect(split.payerParticipates).toBe(false);
  });

  it('un producto entero para una persona se lo debe ella', () => {
    const split = splitExpense(400, PAGADOR, [BRUNO]);

    expect(deudas(split)).toEqual({ [BRUNO]: 400 });
    expect(split.payerParticipates).toBe(false);
  });

  it('sin participantes queda a cuenta del pagador y no genera deuda', () => {
    const split = splitExpense(500, PAGADOR, []);

    expect(split.debts.size).toBe(0);
    expect(split.payerCents).toBe(500);
    expect(split.payerParticipates).toBe(true);
  });

  it('el pagador solo no genera deuda', () => {
    const split = splitExpense(500, PAGADOR, [PAGADOR]);

    expect(split.debts.size).toBe(0);
    expect(split.payerCents).toBe(500);
  });

  it('ignora participantes repetidos', () => {
    const split = splitExpense(600, PAGADOR, [ANA, ANA, PAGADOR, PAGADOR]);

    expect(deudas(split)).toEqual({ [ANA]: 300 });
    expect(split.payerCents).toBe(300);
  });

  it('las deudas y la parte del pagador suman siempre el importe exacto', () => {
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
    for (let total = 1; total <= 2000; total += 7) {
      for (let n = 1; n <= ids.length; n++) {
        const split = splitExpense(total, 'p3', ids.slice(0, n));
        const deudaTotal = [...split.debts.values()].reduce((a, b) => a + b, 0);

        expect(deudaTotal + split.payerCents).toBe(total);
      }
    }
  });

  it('una persona nunca paga más de un céntimo de diferencia respecto a otra', () => {
    const ids = ['p1', 'p2', 'p3', 'p4'];
    const split = splitExpense(1003, 'p9', ids);
    const partes = [...split.debts.values()];

    expect(Math.max(...partes) - Math.min(...partes)).toBeLessThanOrEqual(1);
  });
});
