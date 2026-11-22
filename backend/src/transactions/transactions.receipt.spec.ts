import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { CreateReceiptTransactionDto } from './dto/create-receipt-transaction.dto';
import { TransactionsService } from './transactions.service';

// createFromReceipt: el que paga el ticket reparte cada producto entre las personas que lo
// comparten; cada una le debe su parte. El ticket (Receipt) guarda el total y cada producto
// es un gasto (Expense) con sus deudas (Transaction).
describe('TransactionsService.createFromReceipt', () => {
  let service: TransactionsService;

  const PISO = 'piso-1';
  // Por orden de id: ANA < BRUNO < PAGADOR. Los céntimos sobrantes van a las primeras personas
  const PAGADOR = 'user-pagador';
  const ANA = 'user-ana';
  const BRUNO = 'user-bruno';
  const LUIS = 'user-luis';
  const MARTA = 'user-marta';
  const AJENO = 'user-ajeno';

  const prisma = {
    apartment: { findUnique: jest.fn() },
    receipt: { create: jest.fn() },
    expense: { createMany: jest.fn() },
    transaction: { createMany: jest.fn() },
    $transaction: jest.fn(),
  };

  const ticket = (
    items: { unit_price: string; quantity: number }[],
    participant_ids = [ANA, BRUNO],
  ): CreateReceiptTransactionDto => ({
    apartment_id: PISO,
    participant_ids,
    items: items.map((item, i) => ({ name: `Producto ${i}`, ...item })),
    category: 'supplies',
  });

  type DeudaCreada = {
    id: string;
    expense_id: string;
    to_user_id: string;
    amount: string;
    concept: string;
  };
  type GastoCreado = {
    id: string;
    receipt_id: string;
    total_amount: string;
    concept: string;
    payer_participates: boolean;
  };

  const deudasCreadas = (): DeudaCreada[] =>
    prisma.transaction.createMany.mock.calls.flatMap(([{ data }]) => data);
  const gastosCreados = (): GastoCreado[] =>
    prisma.expense.createMany.mock.calls.flatMap(([{ data }]) => data);

  // Lo que debe cada deudor en total (suma de todos los productos), en euros
  const deudas = () => {
    const centimos: Record<string, number> = {};
    for (const { to_user_id, amount } of deudasCreadas()) {
      centimos[to_user_id] =
        (centimos[to_user_id] ?? 0) + Math.round(Number(amount) * 100);
    }
    return Object.fromEntries(
      Object.entries(centimos).map(([id, cents]) => [id, (cents / 100).toFixed(2)]),
    );
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.apartment.findUnique.mockResolvedValue({
      user_apartments: [PAGADOR, ANA, BRUNO, LUIS, MARTA].map((user_id) => ({ user_id })),
    });
    prisma.receipt.create.mockImplementation(({ data }) => Promise.resolve(data));
    prisma.expense.createMany.mockImplementation(({ data }) =>
      Promise.resolve({ count: data.length }),
    );
    prisma.transaction.createMany.mockImplementation(({ data }) =>
      Promise.resolve({ count: data.length }),
    );
    // La transacción interactiva recibe el cliente; en el test es el propio mock
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));

    const module = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: {} },
      ],
    }).compile();
    service = module.get(TransactionsService);
  });

  it('reparte el importe exacto: los céntimos sobrantes van a las primeras personas por id', async () => {
    // 10,00 € entre 3 personas = 3,33 y sobra 1 céntimo: lo paga Ana, la primera por id.
    // Lo que deben los demás más la parte del pagador suma siempre los 10,00 €
    const resultado = await service.createFromReceipt(
      ticket([{ unit_price: '10.00', quantity: 1 }]),
      PAGADOR,
    );

    expect(resultado.total).toBe('10.00');
    expect(resultado.participant_count).toBe(3);
    expect(deudas()).toEqual({ [ANA]: '3.34', [BRUNO]: '3.33' });
  });

  it('no redondea cuando el reparto es exacto', async () => {
    // 2 x 4,50 = 9,00 € entre 3 personas = 3,00 cada uno
    await service.createFromReceipt(ticket([{ unit_price: '4.50', quantity: 2 }]), PAGADOR);

    expect(deudas()).toEqual({ [ANA]: '3.00', [BRUNO]: '3.00' });
  });

  it('suma precio x cantidad de todos los productos en céntimos, sin errores de coma flotante', async () => {
    // 0,10 + 0,20 da 0,30000000000000004 con números normales
    const resultado = await service.createFromReceipt(
      ticket(
        [
          { unit_price: '0.10', quantity: 1 },
          { unit_price: '0.20', quantity: 1 },
        ],
        [ANA],
      ),
      PAGADOR,
    );

    expect(resultado.total).toBe('0.30');
    expect(deudas()).toEqual({ [ANA]: '0.15' });
  });

  it('no crea una deuda del que paga consigo mismo aunque venga en participant_ids', async () => {
    await service.createFromReceipt(
      ticket([{ unit_price: '6.00', quantity: 1 }], [PAGADOR, ANA, ANA]),
      PAGADOR,
    );

    // Repetidos y el propio pagador se quitan: 6,00 entre el pagador y Ana
    expect(deudas()).toEqual({ [ANA]: '3.00' });
  });

  it('rechaza participantes que no son del piso sin guardar nada', async () => {
    await expect(
      service.createFromReceipt(ticket([{ unit_price: '6.00', quantity: 1 }], [ANA, AJENO]), PAGADOR),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.transaction.createMany).not.toHaveBeenCalled();
  });

  // Cada producto se asigna por separado: unos entre dos, otro entero a una persona y otro
  // solo para quien pagó (sin marcar)
  describe('asignación por producto', () => {
    const porProducto = (
      items: { unit_price: string; quantity: number; assigned_to?: string[] }[],
    ): CreateReceiptTransactionDto => ({
      apartment_id: PISO,
      items: items.map((item, i) => ({ name: `Producto ${i}`, ...item })),
      category: 'supplies',
    });

    it('PA · mantiene en el total el producto sin asignar y no crea deuda por él', async () => {
      const resultado = await service.createFromReceipt(
        porProducto([
          { unit_price: '5.00', quantity: 1, assigned_to: [] },
          { unit_price: '2.00', quantity: 1, assigned_to: [ANA] },
        ]),
        PAGADOR,
      );

      expect(resultado.total).toBe('7.00');
      expect(resultado.unassigned_total).toBe('5.00');
      expect(deudas()).toEqual({ [ANA]: '2.00' });
    });

    it('PA · asigna cada producto solo a la persona seleccionada y conserva el total del ticket', async () => {
      const resultado = await service.createFromReceipt(
        porProducto([
          { unit_price: '6.00', quantity: 1, assigned_to: [LUIS] },
          { unit_price: '10.00', quantity: 1, assigned_to: [MARTA] },
        ]),
        PAGADOR,
      );

      expect(resultado.total).toBe('16.00');
      expect(deudas()).toEqual({ [LUIS]: '6.00', [MARTA]: '10.00' });
    });

    it('PA · reparte un producto por igual entre Ana y Luis sin imputarlo a otros integrantes', async () => {
      const resultado = await service.createFromReceipt(
        porProducto([{ unit_price: '8.00', quantity: 1, assigned_to: [ANA, LUIS] }]),
        PAGADOR,
      );

      expect(resultado.total).toBe('8.00');
      expect(deudas()).toEqual({ [ANA]: '4.00', [LUIS]: '4.00' });
    });

    it('PA · imputa el producto únicamente a Luis y conserva correctamente el importe total', async () => {
      const resultado = await service.createFromReceipt(
        porProducto([{ unit_price: '6.00', quantity: 1, assigned_to: [LUIS] }]),
        PAGADOR,
      );

      expect(resultado.total).toBe('6.00');
      expect(deudas()).toEqual({ [LUIS]: '6.00' });
    });

    it('cada uno debe solo lo de los productos que tiene asignados', async () => {
      const resultado = await service.createFromReceipt(
        porProducto([
          { unit_price: '6.00', quantity: 1, assigned_to: [PAGADOR, ANA] }, // 3,00 cada uno
          { unit_price: '4.00', quantity: 1, assigned_to: [BRUNO] }, // entero para Bruno
          { unit_price: '5.00', quantity: 1, assigned_to: [] }, // a cuenta del pagador
        ]),
        PAGADOR,
      );

      expect(deudas()).toEqual({ [ANA]: '3.00', [BRUNO]: '4.00' });
      // El ticket sigue sumando su total completo
      expect(resultado.total).toBe('15.00');
      expect(resultado.unassigned_total).toBe('5.00');
    });

    it('un producto sin marcar no genera deuda aunque sea el único con precio alto', async () => {
      await service.createFromReceipt(
        porProducto([
          { unit_price: '100.00', quantity: 1 },
          { unit_price: '2.00', quantity: 1, assigned_to: [ANA] },
        ]),
        PAGADOR,
      );

      expect(deudas()).toEqual({ [ANA]: '2.00' });
    });

    it('suma lo que una misma persona debe de varios productos', async () => {
      await service.createFromReceipt(
        porProducto([
          { unit_price: '2.00', quantity: 1, assigned_to: [ANA, BRUNO] },
          { unit_price: '3.00', quantity: 1, assigned_to: [ANA] },
        ]),
        PAGADOR,
      );

      expect(deudas()).toEqual({ [ANA]: '4.00', [BRUNO]: '1.00' });
      // Una deuda por producto y persona: Ana debe de los dos productos
      expect(deudasCreadas()).toHaveLength(3);
    });

    it('rechaza si ningún producto está asignado a otra persona', async () => {
      await expect(
        service.createFromReceipt(
          porProducto([{ unit_price: '5.00', quantity: 1, assigned_to: [PAGADOR] }]),
          PAGADOR,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rechaza asignar un producto a alguien que no es del piso', async () => {
      await expect(
        service.createFromReceipt(
          porProducto([{ unit_price: '5.00', quantity: 1, assigned_to: [AJENO] }]),
          PAGADOR,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // El ticket y sus productos se guardan como Receipt y Expense, enlazados con las deudas
  describe('ticket y gastos', () => {
    const conProductos = (
      items: { unit_price: string; quantity: number; assigned_to?: string[] }[],
    ): CreateReceiptTransactionDto => ({
      apartment_id: PISO,
      items: items.map((item, i) => ({ name: `Producto ${i}`, ...item })),
      category: 'supplies',
    });

    it('guarda el ticket con su total y un gasto por producto', async () => {
      const resultado = await service.createFromReceipt(
        conProductos([
          { unit_price: '6.00', quantity: 1, assigned_to: [PAGADOR, ANA] },
          { unit_price: '4.00', quantity: 2, assigned_to: [BRUNO] },
          { unit_price: '5.00', quantity: 1, assigned_to: [] },
        ]),
        PAGADOR,
      );

      expect(prisma.receipt.create).toHaveBeenCalledTimes(1);
      const { data: ticketGuardado } = prisma.receipt.create.mock.calls[0][0];
      expect(ticketGuardado).toEqual(
        expect.objectContaining({
          id: resultado.receipt_id,
          apartment_id: PISO,
          payer_id: PAGADOR,
          total_amount: '19.00',
        }),
      );

      // Un gasto por producto, con el importe de ese producto (precio x cantidad)
      expect(gastosCreados()).toEqual([
        expect.objectContaining({
          receipt_id: resultado.receipt_id,
          concept: 'Producto 0',
          total_amount: '6.00',
          payer_participates: true,
        }),
        expect.objectContaining({
          receipt_id: resultado.receipt_id,
          concept: 'Producto 1',
          total_amount: '8.00',
          payer_participates: false,
        }),
        // Sin repartir: gasto sin deudas, del que paga
        expect.objectContaining({
          concept: 'Producto 2',
          total_amount: '5.00',
          payer_participates: true,
        }),
      ]);
    });

    it('cada deuda apunta al gasto de su producto', async () => {
      await service.createFromReceipt(
        conProductos([
          { unit_price: '6.00', quantity: 1, assigned_to: [PAGADOR, ANA] },
          { unit_price: '4.00', quantity: 1, assigned_to: [BRUNO] },
        ]),
        PAGADOR,
      );

      const [leche, pan] = gastosCreados();
      expect(deudasCreadas()).toEqual([
        expect.objectContaining({ expense_id: leche.id, to_user_id: ANA, concept: 'Producto 0' }),
        expect.objectContaining({ expense_id: pan.id, to_user_id: BRUNO, concept: 'Producto 1' }),
      ]);
    });

    it('guarda el ticket, los gastos y las deudas en una sola transacción', async () => {
      prisma.transaction.createMany.mockRejectedValueOnce(new Error('fallo de la base de datos'));

      await expect(
        service.createFromReceipt(ticket([{ unit_price: '6.00', quantity: 1 }]), PAGADOR),
      ).rejects.toThrow('fallo de la base de datos');

      // Todo va dentro de $transaction, así que el fallo revierte también el ticket y los gastos
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.receipt.create).toHaveBeenCalledTimes(1);
    });
  });
});
