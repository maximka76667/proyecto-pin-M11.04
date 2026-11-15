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
