import * as fc from 'fast-check';
import { BalanceUsuario, calcularMinimosPagos } from './balance-calculator';

const NUM_RUNS = 500;
const SEED = 42;

// De 2 a 8 usuarios con céntimos enteros en [-100000, 100000]. El último valor se
// fija al opuesto de la suma del resto, así la lista suma cero exactamente
const balancesArb: fc.Arbitrary<BalanceUsuario[]> = fc
  .array(fc.integer({ min: -100000, max: 100000 }), {
    minLength: 1,
    maxLength: 7,
  })
  .map((centimos) => {
    const suma = centimos.reduce((total, c) => total + c, 0);
    return [...centimos, -suma].map((c, i) => ({
      userId: `u${i}`,
      balanceNeto: c / 100,
    }));
  });

describe('calcularMinimosPagos (propiedades)', () => {
  let ejecuciones = 0;

  afterAll(() => {
    console.info(
      `[fast-check] balance-calculator: numRuns=${NUM_RUNS}, seed=${SEED}, ejecuciones=${ejecuciones}`,
    );
  });

  it('los pagos dejan todos los balances exactamente a cero (en céntimos)', () => {
    fc.assert(
      fc.property(balancesArb, (balances) => {
        ejecuciones++;
        const pagos = calcularMinimosPagos(balances);

        return balances.every((usuario) => {
          // Quien debe (balance negativo) paga y sube; quien cobra baja
          const pagado = pagos
            .filter((p) => p.deudorId === usuario.userId)
            .reduce((total, p) => total + Math.round(p.monto * 100), 0);
          const cobrado = pagos
            .filter((p) => p.acreedorId === usuario.userId)
            .reduce((total, p) => total + Math.round(p.monto * 100), 0);
          const resultado =
            Math.round(usuario.balanceNeto * 100) + pagado - cobrado;
          return resultado === 0;
        });
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('hay como máximo n-1 pagos', () => {
    fc.assert(
      fc.property(balancesArb, (balances) => {
        return calcularMinimosPagos(balances).length <= balances.length - 1;
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('no genera pagos de cero ni de menos de un céntimo (todos >= 0,01 €)', () => {
    // Un pago de exactamente 0,01 € es válido: es el resto real de un balance en céntimos.
    // Con el cálculo en coma flotante, [-0.09, -0.05, 0.04, 0.10] fallaba con "> 0,01"
    fc.assert(
      fc.property(balancesArb, (balances) => {
        return calcularMinimosPagos(balances).every((p) => p.monto >= 0.01);
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it('el deudor tiene balance negativo, el acreedor positivo y no son la misma persona', () => {
    fc.assert(
      fc.property(balancesArb, (balances) => {
        const balancePorId = new Map(
          balances.map((b) => [b.userId, b.balanceNeto]),
        );
        return calcularMinimosPagos(balances).every(
          (p) =>
            (balancePorId.get(p.deudorId) ?? 0) < 0 &&
            (balancePorId.get(p.acreedorId) ?? 0) > 0 &&
            p.deudorId !== p.acreedorId,
        );
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });
});
