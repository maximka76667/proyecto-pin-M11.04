// Types and helpers for GET /expenses: manual expenses, settlements and scanned receipts (with
// their items), as the backend returns them. Amounts arrive as strings ("12.50").

export type Person = { id: string; full_name: string };

// What one person owes for an expense (one debt)
export type ExpenseShare = {
  transaction_id: string;
  user: Person;
  amount: string;
};

// A manual expense, a settlement or one product of a receipt
export type ExpenseItem = {
  id: string;
  version: number;
  type: 'EXPENSE' | 'SETTLEMENT';
  concept: string | null;
  category: string;
  total_amount: string;
  date: string;
  payer_participates: boolean;
  payer: Person;
  paidByCurrentUser: boolean;
  canEdit: boolean;
  shares: ExpenseShare[];
};

export type ExpenseEntry = ExpenseItem & { kind: 'expense' };

export type ReceiptEntry = {
  kind: 'receipt';
  id: string;
  version: number;
  // The sum of all its products, even the ones the current user does not see
  total_amount: string;
  date: string;
  payer: Person;
  paidByCurrentUser: boolean;
  canEdit: boolean;
  items: ExpenseItem[];
};

export type ExpenseListEntry = ExpenseEntry | ReceiptEntry;

const toCents = (amount: string) => Math.round(Number(amount) * 100) || 0;

// What the user gains (positive) or owes (negative) from one expense, in cents. The payer is owed
// the sum of every share; anyone else owes only their own share (nothing if they have none)
export function myBalanceCents(item: ExpenseItem, userId: string): number {
  if (item.payer.id === userId) {
    return item.shares.reduce((sum, share) => sum + toCents(share.amount), 0);
  }
  const mine = item.shares.find((share) => share.user.id === userId);
  return mine ? -toCents(mine.amount) : 0;
}

// The same for a whole receipt: the sum over the items the user can see
export function myReceiptBalanceCents(
  receipt: ReceiptEntry,
  userId: string,
): number {
  return receipt.items.reduce(
    (sum, item) => sum + myBalanceCents(item, userId),
    0,
  );
}

// Everyone who shares an expense, as the edit form needs it: the debtors and, when the payer also
// takes part, the payer
export function sharingIds(item: ExpenseItem): string[] {
  return [
    ...item.shares.map((share) => share.user.id),
    ...(item.payer_participates ? [item.payer.id] : []),
  ];
}

// Finds an expense by id, among the manual ones and inside the receipts
export function findExpense(
  list: ExpenseListEntry[],
  id: string,
): ExpenseItem | null {
  for (const entry of list) {
    if (entry.kind === 'expense') {
      if (entry.id === id) return entry;
    } else {
      const item = entry.items.find((candidate) => candidate.id === id);
      if (item) return item;
    }
  }
  return null;
}

// Finds a top-level entry (a manual expense, a settlement or a whole receipt) by id
export function findEntry(
  list: ExpenseListEntry[],
  id: string,
): ExpenseListEntry | null {
  return list.find((entry) => entry.id === id) ?? null;
}

const euros = (cents: number) => `${(cents / 100).toFixed(2)} €`;

const CATEGORY_LABELS: Record<string, string> = {
  supplies: 'Compra',
  utilities: 'Suministros',
  maintenance: 'Hogar',
  entertainment: 'Ocio',
  other: 'Otro',
  payment: 'Pago',
  pending: 'Pendiente',
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

// What the payer keeps for themselves when they also share the expense: the total minus every
// debt. Zero when they do not take part (and always zero for a settlement)
export function payerShareCents(item: ExpenseItem): number {
  if (!item.payer_participates) return 0;
  const debts = item.shares.reduce((sum, share) => sum + toCents(share.amount), 0);
  return Math.max(0, toCents(item.total_amount) - debts);
}

// One line of the detail screen: who owes what in this expense, from the point of view of the
// user looking at it
export function describeShare(
  item: ExpenseItem,
  share: ExpenseShare,
  userId: string,
): string {
  const amount = euros(toCents(share.amount));
  const debtor = share.user.full_name;
  const payer = item.payer.full_name;

  if (item.type === 'SETTLEMENT') {
    if (item.payer.id === userId) return `Pagaste ${amount} a ${debtor}`;
    if (share.user.id === userId) return `${payer} te pagó ${amount}`;
    return `${payer} pagó ${amount} a ${debtor}`;
  }
  if (item.payer.id === userId) return `${debtor} te debe ${amount}`;
  if (share.user.id === userId) return `Debes ${amount} a ${payer}`;
  return `${debtor} debe ${amount} a ${payer}`;
}

// The payer's own part, when there is one ("Tu parte: 3.00 €")
export function describePayerShare(item: ExpenseItem, userId: string): string | null {
  const cents = payerShareCents(item);
  if (cents <= 0) return null;
  return item.payer.id === userId
    ? `Tu parte: ${euros(cents)}`
    : `Parte de ${item.payer.full_name}: ${euros(cents)}`;
}

