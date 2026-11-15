import { randomUUID } from 'node:crypto';
import { ExpenseType, Prisma, TransactionCategory } from '@prisma/client';
import { centsToAmount, ExpenseSplit, splitExpense } from './expense-split';

export interface ExpenseInput {
  apartmentId: string;
  payerId: string;
  // Solo los productos de un ticket escaneado; null en gastos manuales y liquidaciones
  receiptId?: string;
  type?: ExpenseType;
  totalCents: number;
  concept?: string | null;
  category: TransactionCategory;
  date?: Date;
  // Quién reparte el gasto; puede incluir al que paga. Vacío = queda a cuenta del que paga
  participantIds: string[];
}

export interface ExpenseRows {
  expense: Prisma.ExpenseCreateManyInput & { id: string };
  // Una fila por deudor: el que paga nunca tiene fila propia
  transactions: (Prisma.TransactionCreateManyInput & { id: string })[];
  split: ExpenseSplit;
}

// Único sitio que construye un gasto y sus deudas. Lo usan los tickets escaneados, los gastos
// manuales y las liquidaciones, así todos reparten y redondean igual. No toca la base de datos:
// quien llama guarda las filas con createMany dentro de su propia transacción.
export function buildExpenseRows(input: ExpenseInput): ExpenseRows {
  const split = splitExpense(
    input.totalCents,
    input.payerId,
    input.participantIds,
  );
  const expenseId = randomUUID();

  const expense = {
    id: expenseId,
    apartment_id: input.apartmentId,
    payer_id: input.payerId,
    receipt_id: input.receiptId,
    type: input.type,
    total_amount: centsToAmount(input.totalCents),
    concept: input.concept,
    category: input.category,
    date: input.date,
    payer_participates: split.payerParticipates,
  };

  const transactions = [...split.debts].map(([debtorId, cents]) => ({
    id: randomUUID(),
    expense_id: expenseId,
    apartment_id: input.apartmentId,
    from_user_id: input.payerId,
    to_user_id: debtorId,
    amount: centsToAmount(cents),
    concept: input.concept,
    category: input.category,
    date: input.date,
  }));

  return { expense, transactions, split };
}
