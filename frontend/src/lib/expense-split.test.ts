import { splitExpense } from './expense-split';

// Same cases as backend/src/transactions/expense-split.spec.ts. By id: ANA < BRUNO < PAGADOR
const PAGADOR = 'user-pagador';
const ANA = 'user-ana';
const BRUNO = 'user-bruno';

const debts = (split: ReturnType<typeof splitExpense>) => Object.fromEntries(split.debts);

describe('splitExpense', () => {
  it('splits evenly when the amount is exact', () => {
    const split = splitExpense(900, PAGADOR, [PAGADOR, ANA, BRUNO]);

    expect(debts(split)).toEqual({ [ANA]: 300, [BRUNO]: 300 });
    expect(split.payerCents).toBe(300);
    expect(split.payerParticipates).toBe(true);
  });

  it('gives the leftover cents to the first people by id', () => {
    const split = splitExpense(1000, PAGADOR, [PAGADOR, BRUNO, ANA]);

    expect(debts(split)).toEqual({ [ANA]: 334, [BRUNO]: 333 });
    expect(split.payerCents).toBe(333);
  });

  it('does not depend on the order of the participants', () => {
    const a = splitExpense(1001, PAGADOR, [PAGADOR, ANA, BRUNO]);
    const b = splitExpense(1001, PAGADOR, [BRUNO, PAGADOR, ANA]);

    expect(debts(a)).toEqual(debts(b));
    expect(a.payerCents).toBe(b.payerCents);
  });

  it('keeps the leftover cents when the payer sorts first', () => {
    const split = splitExpense(1000, 'a-pagador', ['a-pagador', ANA, BRUNO]);

    expect(split.payerCents).toBe(334);
    expect(debts(split)).toEqual({ [ANA]: 333, [BRUNO]: 333 });
  });

  it('splits everything between the others when the payer does not share', () => {
    const split = splitExpense(1000, PAGADOR, [ANA, BRUNO]);

    expect(debts(split)).toEqual({ [ANA]: 500, [BRUNO]: 500 });
    expect(split.payerCents).toBe(0);
    expect(split.payerParticipates).toBe(false);
  });

  it('leaves an unassigned item with the payer and creates no debt', () => {
    const split = splitExpense(500, PAGADOR, []);

    expect(split.debts.size).toBe(0);
    expect(split.payerCents).toBe(500);
    expect(split.payerParticipates).toBe(true);
  });

  it('ignores repeated participants', () => {
    const split = splitExpense(600, PAGADOR, [ANA, ANA, PAGADOR, PAGADOR]);

    expect(debts(split)).toEqual({ [ANA]: 300 });
    expect(split.payerCents).toBe(300);
  });

  it("debts plus the payer's share always add up to the exact amount", () => {
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
    for (let total = 1; total <= 2000; total += 7) {
      for (let n = 1; n <= ids.length; n++) {
        const split = splitExpense(total, 'p3', ids.slice(0, n));
        const owed = [...split.debts.values()].reduce((a, b) => a + b, 0);

        expect(owed + split.payerCents).toBe(total);
      }
    }
  });
});
