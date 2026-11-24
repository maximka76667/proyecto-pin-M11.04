export interface BalanceUsuario {
  userId: string;
  balanceNeto: number;
}

export interface Pago {
  deudorId: string;
  acreedorId: string;
  monto: number;
}

// Algoritmo voraz: empareja siempre al mayor acreedor con el mayor deudor. Garantiza como
// máximo n-1 pagos (no asegura el mínimo absoluto). Trabaja en céntimos enteros para que no
// haya restos de coma flotante: cada balance se redondea a céntimos al entrar y cualquier
// balance distinto de cero, aunque sea de 1 céntimo, se salda.
export function calcularMinimosPagos(balances: BalanceUsuario[]): Pago[] {
  const aCentimos = (euros: number) => Math.round(euros * 100);

  const acreedores = balances
    .map((usuario) => ({
      userId: usuario.userId,
      restante: aCentimos(usuario.balanceNeto),
    }))
    .filter((usuario) => usuario.restante > 0);
  const deudores = balances
    .map((usuario) => ({
      userId: usuario.userId,
      restante: -aCentimos(usuario.balanceNeto),
    }))
    .filter((usuario) => usuario.restante > 0);

  acreedores.sort((a, b) => b.restante - a.restante);
  deudores.sort((a, b) => b.restante - a.restante);

  const pagos: Pago[] = [];
  let acreedorIndex = 0;
  let deudorIndex = 0;

  while (acreedorIndex < acreedores.length && deudorIndex < deudores.length) {
    const acreedor = acreedores[acreedorIndex];
    const deudor = deudores[deudorIndex];
    const centimos = Math.min(acreedor.restante, deudor.restante);

    pagos.push({
      deudorId: deudor.userId,
      acreedorId: acreedor.userId,
      monto: centimos / 100,
    });

    acreedor.restante -= centimos;
    deudor.restante -= centimos;

    if (acreedor.restante === 0) acreedorIndex++;
    if (deudor.restante === 0) deudorIndex++;
  }

  return pagos;
}
