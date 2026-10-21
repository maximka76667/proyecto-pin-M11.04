export interface BalanceUsuario {
  userId: string;
  balanceNeto: number;
}

export interface Pago {
  deudorId: string;
  acreedorId: string;
  monto: number;
}

export function calcularMinimosPagos(balances: BalanceUsuario[]): Pago[] {
  const acreedores = balances
    .filter((usuario) => usuario.balanceNeto > 0.01)
    .map((usuario) => ({
      ...usuario,
      montoRestante: usuario.balanceNeto,
    }));
  const deudores = balances
    .filter((usuario) => usuario.balanceNeto < -0.01)
    .map((usuario) => ({
      ...usuario,
      montoRestante: Math.abs(usuario.balanceNeto),
    }));

  acreedores.sort((a, b) => b.montoRestante - a.montoRestante);
  deudores.sort((a, b) => b.montoRestante - a.montoRestante);

  const pagos: Pago[] = [];
  let acreedorIndex = 0;
  let deudorIndex = 0;

  while (acreedorIndex < acreedores.length && deudorIndex < deudores.length) {
    const acreedor = acreedores[acreedorIndex];
    const deudor = deudores[deudorIndex];
    const monto = Math.min(
      acreedor.montoRestante,
      deudor.montoRestante,
    );

    if (monto > 0.01) {
      pagos.push({
        deudorId: deudor.userId,
        acreedorId: acreedor.userId,
        monto: parseFloat(monto.toFixed(2)),
      });
    }

    acreedor.montoRestante -= monto;
    deudor.montoRestante -= monto;

    if (acreedor.montoRestante <= 0.01) acreedorIndex++;
    if (deudor.montoRestante <= 0.01) deudorIndex++;
  }

  return pagos;
}
