export interface ExpenseSplit {
  // Lo que debe cada persona al que paga, en céntimos. El que paga nunca aparece aquí
  debts: Map<string, number>;
  // La parte del propio pagador, en céntimos. No genera ninguna transacción
  payerCents: number;
  // Si el pagador reparte el gasto. Se guarda en Expense.payer_participates
  payerParticipates: boolean;
}

// Céntimos a importe con dos decimales, como se guarda en las columnas Decimal(12, 2)
export const centsToAmount = (cents: number) => (cents / 100).toFixed(2);

// Reparte un gasto entre las personas que lo comparten (puede incluir al que paga).
// El reparto es exacto: lo que deben los demás más la parte del pagador suman siempre
// `totalCents`. Los céntimos sobrantes van de uno en uno a las primeras personas por orden de
// id, así el resultado es el mismo en el servidor y en la vista previa de la app.
// Sin participantes, el gasto queda entero a cuenta del que paga y no genera deuda.
export function splitExpense(
  totalCents: number,
  payerId: string,
  participantIds: string[],
): ExpenseSplit {
  const people = [...new Set(participantIds)].sort();
  const debts = new Map<string, number>();

  if (people.length === 0) {
    return { debts, payerCents: totalCents, payerParticipates: true };
  }

  const baseCents = Math.floor(totalCents / people.length);
  const remainder = totalCents % people.length;
  let payerCents = 0;
  people.forEach((id, index) => {
    const cents = baseCents + (index < remainder ? 1 : 0);
    if (id === payerId) {
      payerCents += cents;
    } else {
      debts.set(id, cents);
    }
  });

  return { debts, payerCents, payerParticipates: people.includes(payerId) };
}
