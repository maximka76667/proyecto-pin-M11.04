import {
  balanceText,
  categoryLabel,
  describePayerShare,
  describeShare,
  ExpenseItem,
  ExpenseListEntry,
  findExpense,
  myBalanceCents,
  myReceiptBalanceCents,
  payerShareCents,
  ReceiptEntry,
  sharingIds,
  signedAmount,
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

describe('payerShareCents', () => {
  it('is what is left after every debt when the payer also shares', () => {
    expect(payerShareCents(item())).toBe(300);
  });

  it('is zero when the payer does not take part', () => {
    expect(payerShareCents(item({ payer_participates: false }))).toBe(0);
  });

  it('is the whole amount for a product kept by the payer', () => {
    expect(payerShareCents(item({ shares: [] }))).toBe(900);
  });
});

describe('describeShare', () => {
  const [ana] = item().shares;

  it('tells the payer who owes them', () => {
    expect(describeShare(item(), ana, 'me')).toBe('Ana te debe 3.00 €');
  });

  it('tells a debtor what they owe and to whom', () => {
    expect(describeShare(item(), ana, 'ana')).toBe('Debes 3.00 € a Yo');
  });

  it('tells a third person who owes whom', () => {
    expect(describeShare(item(), ana, 'bruno')).toBe('Ana debe 3.00 € a Yo');
  });

  describe('a settlement', () => {
    const pago = item({
      type: 'SETTLEMENT',
      payer_participates: false,
      shares: [{ transaction_id: 't', user: ANA, amount: '42.95' }],
    });

    it('says you paid when you are the payer', () => {
      expect(describeShare(pago, pago.shares[0], 'me')).toBe('Pagaste 42.95 € a Ana');
    });

    it('says they paid you when you are the one receiving', () => {
      expect(describeShare(pago, pago.shares[0], 'ana')).toBe('Yo te pagó 42.95 €');
    });
  });
});

describe('describePayerShare', () => {
  it('shows the payer their own part', () => {
    expect(describePayerShare(item(), 'me')).toBe('Tu parte: 3.00 €');
  });

  it('shows others the part of the payer', () => {
    expect(describePayerShare(item(), 'ana')).toBe('Parte de Yo: 3.00 €');
  });

  it('shows nothing when the payer does not take part', () => {
    expect(describePayerShare(item({ payer_participates: false }), 'me')).toBeNull();
  });
});

describe('signedAmount', () => {
  it('puts a plus sign on what the user gets back', () => {
    expect(signedAmount(600)).toBe('+6.00 €');
  });

  it('puts a minus sign on what the user owes', () => {
    expect(signedAmount(-300)).toBe('-3.00 €');
  });

  it('shows zero without a sign', () => {
    expect(signedAmount(0)).toBe('0.00 €');
  });

  it('keeps the cents', () => {
    expect(signedAmount(-1)).toBe('-0.01 €');
  });
});

describe('balanceText', () => {
  it('says what the user gets back', () => {
    expect(balanceText(600)).toBe('Te deben 6.00 €');
  });

  it('says what the user owes, without a minus sign', () => {
    expect(balanceText(-300)).toBe('Debes 3.00 €');
  });

  it('says there is nothing when the balance is zero', () => {
    expect(balanceText(0)).toBe('Sin deudas contigo');
  });
});

describe('categoryLabel', () => {
  it('translates known categories and keeps unknown ones', () => {
    expect(categoryLabel('supplies')).toBe('Compra');
    expect(categoryLabel('otra')).toBe('otra');
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
