import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { CreateReceiptTransactionDto } from './dto/create-receipt-transaction.dto';
import { TransactionsService } from './transactions.service';

// createFromReceipt: el que paga el ticket reparte el total de los productos
// compartidos entre él y los participantes; cada participante le debe su parte.
describe('TransactionsService.createFromReceipt', () => {
  let service: TransactionsService;

  const PISO = 'piso-1';
  const PAGADOR = 'user-pagador';
  const ANA = 'user-ana';
  const BRUNO = 'user-bruno';
  const AJENO = 'user-ajeno';

  const prisma = {
    apartment: { findUnique: jest.fn() },
    transaction: { create: jest.fn() },
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

  // Importe de cada deuda creada, por deudor
  const deudas = () =>
    Object.fromEntries(
      prisma.transaction.create.mock.calls.map(([{ data }]) => [data.to_user_id, data.amount]),
    );

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.apartment.findUnique.mockResolvedValue({
      user_apartments: [{ user_id: PAGADOR }, { user_id: ANA }, { user_id: BRUNO }],
    });
    prisma.transaction.create.mockImplementation(({ data }) => data);
    prisma.$transaction.mockImplementation((operaciones: unknown[]) => Promise.all(operaciones));

    const module = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: {} },
      ],
    }).compile();
    service = module.get(TransactionsService);
  });

  it('redondea hacia arriba la parte de cada uno para que el que paga no pierda céntimos', async () => {
    // 10,00 € entre 3 personas = 3,333... → cada participante debe 3,34
    const resultado = await service.createFromReceipt(
      ticket([{ unit_price: '10.00', quantity: 1 }]),
      PAGADOR,
    );

    expect(resultado.total).toBe('10.00');
    expect(resultado.participant_count).toBe(3);
    expect(deudas()).toEqual({ [ANA]: '3.34', [BRUNO]: '3.34' });
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

  it('rechaza participantes que no son del piso sin crear ninguna deuda', async () => {
    await expect(
      service.createFromReceipt(ticket([{ unit_price: '6.00', quantity: 1 }], [ANA, AJENO]), PAGADOR),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.transaction.create).not.toHaveBeenCalled();
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
      expect(prisma.transaction.create).toHaveBeenCalledTimes(2);
    });

    it('rechaza si ningún producto está asignado a otra persona', async () => {
      await expect(
        service.createFromReceipt(
          porProducto([{ unit_price: '5.00', quantity: 1, assigned_to: [PAGADOR] }]),
          PAGADOR,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it('rechaza asignar un producto a alguien que no es del piso', async () => {
      await expect(
        service.createFromReceipt(
          porProducto([{ unit_price: '5.00', quantity: 1, assigned_to: [AJENO] }]),
          PAGADOR,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });
  });
});
