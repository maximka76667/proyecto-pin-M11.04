import {
  ExpenseItem,
  ExpenseListEntry,
  findExpense,
  myBalanceCents,
  myReceiptBalanceCents,
  ReceiptEntry,
  sharingIds,
} from './expenses';

const ME = { id: 'me', full_name: 'Yo' };
const ANA = { id: 'ana', full_name: 'Ana' };
const BRUNO = { id: 'bruno', full_name: 'Bruno' };

const item = (cambios: Partial<ExpenseItem> = {}): ExpenseItem => ({
  id: 'gasto-1',
  version: 1,
  type: 'EXPENSE',
  concept: 'Pizza',
  category: 'supplies',
  total_amount: '9.00',
  date: '2026-11-01',
  payer_participates: true,
  payer: ME,
  paidByCurrentUser: true,
  canEdit: true,
  shares: [
    { transaction_id: 't-ana', user: ANA, amount: '3.00' },
    { transaction_id: 't-bruno', user: BRUNO, amount: '3.00' },
  ],
  ...cambios,
});

describe('myBalanceCents', () => {
  it('the payer is owed the sum of every share', () => {
    expect(myBalanceCents(item(), 'me')).toBe(600);
  });

  it('a debtor owes only their own share', () => {
    expect(myBalanceCents(item(), 'ana')).toBe(-300);
  });

  it('someone with no share owes nothing', () => {
    expect(myBalanceCents(item(), 'carla')).toBe(0);
  });

  it('a product kept by the payer owes nothing', () => {
    expect(myBalanceCents(item({ shares: [] }), 'me')).toBe(0);
  });

  it('adds cents without floating point errors', () => {
    const shares = [
      { transaction_id: 'a', user: ANA, amount: '0.10' },
      { transaction_id: 'b', user: BRUNO, amount: '0.20' },
    ];

    expect(myBalanceCents(item({ shares }), 'me')).toBe(30);
  });
});

describe('myReceiptBalanceCents', () => {
  const receipt: ReceiptEntry = {
    kind: 'receipt',
    id: 'ticket-1',
    version: 2,
    total_amount: '24.00',
    date: '2026-11-01',
    payer: ME,
    paidByCurrentUser: true,
    canEdit: true,
    items: [
      item({ id: 'p1' }),
      item({
        id: 'p2',
        shares: [{ transaction_id: 't', user: ANA, amount: '4.00' }],
      }),
    ],
  };

  it('the payer is owed what every item adds up to', () => {
    expect(myReceiptBalanceCents(receipt, 'me')).toBe(1000);
  });

  it('a debtor owes the sum of their shares across the items', () => {
    expect(myReceiptBalanceCents(receipt, 'ana')).toBe(-700);
  });
});

describe('sharingIds', () => {
  it('lists the debtors and the payer when the payer takes part', () => {
    expect(sharingIds(item())).toEqual(['ana', 'bruno', 'me']);
  });

  it('leaves the payer out when they do not take part', () => {
    expect(sharingIds(item({ payer_participates: false }))).toEqual([
      'ana',
      'bruno',
    ]);
  });
});

describe('findExpense', () => {
  const list: ExpenseListEntry[] = [
    { ...item({ id: 'manual' }), kind: 'expense' },
    {
      kind: 'receipt',
      id: 'ticket-1',
      version: 1,
      total_amount: '9.00',
      date: '2026-11-01',
      payer: ME,
      paidByCurrentUser: true,
      canEdit: true,
      items: [item({ id: 'producto' })],
    },
  ];

  it('finds a manual expense', () => {
    expect(findExpense(list, 'manual')?.id).toBe('manual');
  });

  it('finds a product inside a receipt', () => {
    expect(findExpense(list, 'producto')?.id).toBe('producto');
  });

  it('returns null when it is not in the list', () => {
    expect(findExpense(list, 'otro')).toBeNull();
  });
});
