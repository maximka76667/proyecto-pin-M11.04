import * as fc from 'fast-check';
import { splitExpense } from './expense-split';

const NUM_RUNS = 1000;
const SEED = 42;

const POOL = Array.from({ length: 10 }, (_, i) => `u${i}`);
const EXTERNO = 'externo';

// Importe total en céntimos
const totalArb = fc.integer({ min: 0, max: 1000000 });
// De 1 a 10 participantes distintos sacados de un grupo fijo
const participantesArb = fc.uniqueArray(fc.constantFrom(...POOL), {
  minLength: 1,
  maxLength: 10,
});
// El que paga puede estar entre los participantes o no (un id de fuera, o alguien del grupo
// que esta vez no participa)
const pagadorArb = fc.constantFrom(...POOL, EXTERNO);

const suma = (valores: Iterable<number>) =>
  [...valores].reduce((total, v) => total + v, 0);

describe('splitExpense (propiedades)', () => {
  let ejecuciones = 0;

  afterAll(() => {
    console.info(
      `[fast-check] expense-split: numRuns=${NUM_RUNS}, seed=${SEED}, ejecuciones=${ejecuciones}`,
    );
  });

  it('el reparto suma exactamente el total', () => {
    fc.assert(
      fc.property(totalArb, pagadorArb, participantesArb, (total, pagador, ids) => {
        ejecuciones++;
        const { debts, payerCents } = splitExpense(total, pagador, ids);
        return suma(debts.values()) + payerCents === total;
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('el reparto es justo: las partes de quien participa difieren como mucho 1 céntimo', () => {
    fc.assert(
      fc.property(totalArb, pagadorArb, participantesArb, (total, pagador, ids) => {
        const { debts, payerCents, payerParticipates } = splitExpense(
          total,
          pagador,
          ids,
        );
        const partes = [...debts.values()];
        if (payerParticipates) partes.push(payerCents);
        return Math.max(...partes) - Math.min(...partes) <= 1;
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('todas las partes son enteros no negativos', () => {
    fc.assert(
      fc.property(totalArb, pagadorArb, participantesArb, (total, pagador, ids) => {
        const { debts, payerCents } = splitExpense(total, pagador, ids);
        return [...debts.values(), payerCents].every(
          (parte) => Number.isInteger(parte) && parte >= 0,
        );
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('si el pagador no está en la lista, no tiene parte y el total sigue sumando', () => {
    fc.assert(
      fc.property(totalArb, pagadorArb, participantesArb, (total, pagador, ids) => {
        fc.pre(!ids.includes(pagador));
        const { debts, payerCents, payerParticipates } = splitExpense(
          total,
          pagador,
          ids,
        );
        return (
          payerCents === 0 &&
          payerParticipates === false &&
          suma(debts.values()) === total
        );
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('sin participantes, el gasto queda entero a cuenta del que paga y no genera deuda', () => {
    const split = splitExpense(1000, 'u0', []);

    expect(split.debts.size).toBe(0);
    expect(split.payerCents).toBe(1000);
    expect(split.payerParticipates).toBe(true);
  });
});
