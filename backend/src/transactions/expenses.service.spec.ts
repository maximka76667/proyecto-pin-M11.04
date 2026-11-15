import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ExpensesService } from './expenses.service';

// Editar y borrar gastos: solo quien pagó, con la versión que cargó, reescribiendo las deudas
// en el sitio y recalculando el total del ticket cuando el gasto es un producto de un ticket.
describe('ExpensesService', () => {
  let service: ExpensesService;

  const PISO = 'piso-1';
  // Por orden de id: ANA < BRUNO < CARLA < PAGADOR
  const PAGADOR = 'user-pagador';
  const ANA = 'user-ana';
  const BRUNO = 'user-bruno';
  const CARLA = 'user-carla';
  const AJENO = 'user-ajeno';

  const prisma = {
    expense: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
      aggregate: jest.fn(),
      count: jest.fn(),
    },
    transaction: {
      update: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    receipt: {
      findUnique: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    userApartment: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };

  // 9,00 € entre el pagador, Ana y Bruno: 3,00 cada uno
  const gasto = (cambios: object = {}) => ({
    id: 'gasto-1',
    apartment_id: PISO,
    payer_id: PAGADOR,
    receipt_id: null,
    type: 'EXPENSE',
    version: 3,
    total_amount: '9.00',
    concept: 'Pizza',
    category: 'supplies',
    date: new Date('2026-11-01'),
    payer_participates: true,
    transactions: [
      { id: 'deuda-ana', to_user_id: ANA },
      { id: 'deuda-bruno', to_user_id: BRUNO },
    ],
    ...cambios,
  });

  const cambios = (dto: Partial<UpdateExpenseDto> = {}): UpdateExpenseDto => ({
    version: 3,
    ...dto,
  });

  // El orden en que se llamaron dos mocks
  const antes = (primero: jest.Mock, segundo: jest.Mock) =>
    expect(Math.min(...primero.mock.invocationCallOrder)).toBeLessThan(
      Math.min(...segundo.mock.invocationCallOrder),
    );

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.expense.findUnique.mockResolvedValue(gasto());
    prisma.expense.updateMany.mockResolvedValue({ count: 1 });
    prisma.expense.deleteMany.mockResolvedValue({ count: 1 });
    prisma.expense.aggregate.mockResolvedValue({ _sum: { total_amount: '9.00' } });
    prisma.expense.count.mockResolvedValue(1);
    prisma.transaction.update.mockResolvedValue({});
    prisma.transaction.deleteMany.mockResolvedValue({ count: 1 });
    prisma.transaction.createMany.mockResolvedValue({ count: 1 });
    prisma.receipt.update.mockResolvedValue({});
    prisma.receipt.deleteMany.mockResolvedValue({ count: 1 });
    prisma.userApartment.findMany.mockImplementation(
      ({ where }: { where: { user_id: { in: string[] } } }) =>
        Promise.resolve(
          where.user_id.in.filter((id) => id !== AJENO).map((user_id) => ({ user_id })),
        ),
    );
    // La transacción interactiva recibe el cliente; en el test es el propio mock
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));

    const module = await Test.createTestingModule({
      providers: [ExpensesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ExpensesService);
  });

  describe('update', () => {
    it('devuelve 404 cuando el gasto no existe', async () => {
      prisma.expense.findUnique.mockResolvedValue(null);

      await expect(service.update('x', cambios(), PAGADOR)).rejects.toThrow(NotFoundException);
    });

    it('solo deja editar a quien pagó', async () => {
      await expect(service.update('gasto-1', cambios(), ANA)).rejects.toThrow(ForbiddenException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('no deja editar una liquidación', async () => {
      prisma.expense.findUnique.mockResolvedValue(gasto({ type: 'SETTLEMENT' }));

      await expect(service.update('gasto-1', cambios(), PAGADOR)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('da 409 sin escribir nada si la versión que envía ya no es la actual', async () => {
      await expect(
        service.update('gasto-1', cambios({ version: 2, amount: '12.00' }), PAGADOR),
      ).rejects.toThrow(ConflictException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('da 409 y no toca las deudas si otra edición se adelanta entre la lectura y la escritura', async () => {
      // La versión coincidía al leer, pero otra petición la cambió antes de escribir
      prisma.expense.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.update('gasto-1', cambios({ amount: '12.00' }), PAGADOR),
      ).rejects.toThrow(ConflictException);

      expect(prisma.transaction.update).not.toHaveBeenCalled();
      expect(prisma.transaction.deleteMany).not.toHaveBeenCalled();
      expect(prisma.transaction.createMany).not.toHaveBeenCalled();
    });

    it('escribe con la versión en el where y la incrementa', async () => {
      await service.update('gasto-1', cambios({ amount: '12.00' }), PAGADOR);

      expect(prisma.expense.updateMany).toHaveBeenCalledWith({
        where: { id: 'gasto-1', version: 3 },
        data: expect.objectContaining({
          total_amount: '12.00',
          version: { increment: 1 },
        }),
      });
    });

    it('al cambiar el importe recalcula las deudas en el sitio, sin borrar ni crear filas', async () => {
      await service.update('gasto-1', cambios({ amount: '12.00' }), PAGADOR);

      // 12,00 entre 3 = 4,00 cada uno; las deudas conservan su id
      expect(prisma.transaction.update).toHaveBeenCalledTimes(2);
      expect(prisma.transaction.update).toHaveBeenCalledWith({
        where: { id: 'deuda-ana' },
        data: expect.objectContaining({ amount: '4.00' }),
      });
      expect(prisma.transaction.update).toHaveBeenCalledWith({
        where: { id: 'deuda-bruno' },
        data: expect.objectContaining({ amount: '4.00' }),
      });
      expect(prisma.transaction.deleteMany).not.toHaveBeenCalled();
      expect(prisma.transaction.createMany).not.toHaveBeenCalled();
    });

    it('reparte los céntimos sobrantes por orden de id, igual que al crear', async () => {
      await service.update('gasto-1', cambios({ amount: '10.00' }), PAGADOR);

      // 10,00 entre 3 = 3,33 y sobra 1 céntimo: se lo lleva Ana, la primera por id
      expect(prisma.transaction.update).toHaveBeenCalledWith({
        where: { id: 'deuda-ana' },
        data: expect.objectContaining({ amount: '3.34' }),
      });
      expect(prisma.transaction.update).toHaveBeenCalledWith({
        where: { id: 'deuda-bruno' },
        data: expect.objectContaining({ amount: '3.33' }),
      });
    });

    it('al cambiar las personas actualiza las que siguen, borra las que salen y crea las nuevas', async () => {
      await service.update(
        'gasto-1',
        cambios({ participant_ids: [ANA, CARLA, PAGADOR] }),
        PAGADOR,
      );

      expect(prisma.transaction.update).toHaveBeenCalledTimes(1);
      expect(prisma.transaction.update).toHaveBeenCalledWith({
        where: { id: 'deuda-ana' },
        data: expect.objectContaining({ amount: '3.00' }),
      });
      expect(prisma.transaction.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['deuda-bruno'] } },
      });
      expect(prisma.transaction.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            expense_id: 'gasto-1',
            apartment_id: PISO,
            from_user_id: PAGADOR,
            to_user_id: CARLA,
            amount: '3.00',
            concept: 'Pizza',
            category: 'supplies',
          }),
        ],
      });
    });

    it('si el pagador deja de repartir, los demás se reparten todo el importe', async () => {
      await service.update('gasto-1', cambios({ participant_ids: [ANA, BRUNO] }), PAGADOR);

      expect(prisma.expense.updateMany).toHaveBeenCalledWith({
        where: expect.anything(),
        data: expect.objectContaining({ payer_participates: false }),
      });
      expect(prisma.transaction.update).toHaveBeenCalledWith({
        where: { id: 'deuda-ana' },
        data: expect.objectContaining({ amount: '4.50' }),
      });
    });

    it('aplica concepto, categoría y fecha a las deudas que se mantienen', async () => {
      await service.update(
        'gasto-1',
        cambios({ concept: 'Cena', category: 'entertainment', date: '2026-11-10' }),
        PAGADOR,
      );

      expect(prisma.transaction.update).toHaveBeenCalledWith({
        where: { id: 'deuda-ana' },
        data: expect.objectContaining({
          amount: '3.00',
          concept: 'Cena',
          category: 'entertainment',
          date: new Date('2026-11-10'),
        }),
      });
    });

    it('rechaza participantes que no son del piso sin escribir nada', async () => {
      await expect(
        service.update('gasto-1', cambios({ participant_ids: [ANA, AJENO] }), PAGADOR),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('un gasto manual no puede quedarse sin ningún deudor', async () => {
      await expect(
        service.update('gasto-1', cambios({ participant_ids: [PAGADOR] }), PAGADOR),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('devuelve el gasto actualizado con sus deudas', async () => {
      const actualizado = { id: 'gasto-1', version: 4, transactions: [] };
      prisma.expense.findUnique
        .mockResolvedValueOnce(gasto())
        .mockResolvedValueOnce(actualizado);

      await expect(
        service.update('gasto-1', cambios({ amount: '12.00' }), PAGADOR),
      ).resolves.toBe(actualizado);
    });

    describe('producto de un ticket', () => {
      beforeEach(() => {
        prisma.expense.findUnique.mockResolvedValue(gasto({ receipt_id: 'ticket-1' }));
      });

      it('recalcula el total del ticket sumando sus productos', async () => {
        prisma.expense.aggregate.mockResolvedValue({ _sum: { total_amount: '24.50' } });

        await service.update('gasto-1', cambios({ amount: '12.00' }), PAGADOR);

        expect(prisma.expense.aggregate).toHaveBeenCalledWith({
          _sum: { total_amount: true },
          where: { receipt_id: 'ticket-1' },
        });
        expect(prisma.receipt.update).toHaveBeenLastCalledWith({
          where: { id: 'ticket-1' },
          data: { total_amount: '24.50' },
        });
      });

      it('bloquea la fila del ticket antes de sumar, para que dos ediciones simultáneas se turnen', async () => {
        await service.update('gasto-1', cambios({ amount: '12.00' }), PAGADOR);

        // La primera escritura sobre el ticket sube su versión (y toma el bloqueo);
        // solo después se suman los productos
        expect(prisma.receipt.update).toHaveBeenNthCalledWith(1, {
          where: { id: 'ticket-1' },
          data: { version: { increment: 1 } },
        });
        antes(prisma.receipt.update, prisma.expense.aggregate);
      });

      it('rechaza una edición que haga pasar el ticket de 10.000,00 €', async () => {
        prisma.expense.aggregate.mockResolvedValue({ _sum: { total_amount: '10000.01' } });

        await expect(
          service.update('gasto-1', cambios({ amount: '9000.00' }), PAGADOR),
        ).rejects.toThrow(BadRequestException);
      });

      it('permite dejar un producto a cuenta del que paga, sin ninguna deuda', async () => {
        await service.update('gasto-1', cambios({ participant_ids: [] }), PAGADOR);

        expect(prisma.transaction.deleteMany).toHaveBeenCalledWith({
          where: { id: { in: ['deuda-ana', 'deuda-bruno'] } },
        });
        expect(prisma.expense.updateMany).toHaveBeenCalledWith({
          where: expect.anything(),
          data: expect.objectContaining({ payer_participates: true }),
        });
      });

      it('un gasto manual no toca ningún ticket', async () => {
        prisma.expense.findUnique.mockResolvedValue(gasto());

        await service.update('gasto-1', cambios({ amount: '12.00' }), PAGADOR);

        expect(prisma.receipt.update).not.toHaveBeenCalled();
        expect(prisma.expense.aggregate).not.toHaveBeenCalled();
      });
    });
  });

  describe('remove', () => {
    it('devuelve 404 cuando el gasto no existe', async () => {
      prisma.expense.findUnique.mockResolvedValue(null);

      await expect(service.remove('x', 3, PAGADOR)).rejects.toThrow(NotFoundException);
    });

    it('solo deja borrar a quien pagó', async () => {
      await expect(service.remove('gasto-1', 3, ANA)).rejects.toThrow(ForbiddenException);
    });

    it('no deja borrar una liquidación', async () => {
      prisma.expense.findUnique.mockResolvedValue(gasto({ type: 'SETTLEMENT' }));

      await expect(service.remove('gasto-1', 3, PAGADOR)).rejects.toThrow(ConflictException);
      expect(prisma.expense.deleteMany).not.toHaveBeenCalled();
    });

    it('da 409 sin borrar nada si la versión ya no es la actual', async () => {
      await expect(service.remove('gasto-1', 2, PAGADOR)).rejects.toThrow(ConflictException);

      expect(prisma.expense.deleteMany).not.toHaveBeenCalled();
    });

    it('da 409 si otra edición se adelanta entre la lectura y el borrado', async () => {
      prisma.expense.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.remove('gasto-1', 3, PAGADOR)).rejects.toThrow(ConflictException);
    });

    it('borra el gasto con la versión en el where; las deudas caen en cascada', async () => {
      await expect(service.remove('gasto-1', 3, PAGADOR)).resolves.toEqual({ id: 'gasto-1' });

      expect(prisma.expense.deleteMany).toHaveBeenCalledWith({
        where: { id: 'gasto-1', version: 3 },
      });
      expect(prisma.transaction.deleteMany).not.toHaveBeenCalled();
      expect(prisma.receipt.update).not.toHaveBeenCalled();
    });

    it('al borrar un producto recalcula el total del ticket', async () => {
      prisma.expense.findUnique.mockResolvedValue(gasto({ receipt_id: 'ticket-1' }));
      prisma.expense.count.mockResolvedValue(2);
      prisma.expense.aggregate.mockResolvedValue({ _sum: { total_amount: '15.00' } });

      await service.remove('gasto-1', 3, PAGADOR);

      expect(prisma.receipt.deleteMany).not.toHaveBeenCalled();
      expect(prisma.receipt.update).toHaveBeenLastCalledWith({
        where: { id: 'ticket-1' },
        data: { total_amount: '15.00' },
      });
    });

    it('al borrar el último producto el ticket también desaparece', async () => {
      prisma.expense.findUnique.mockResolvedValue(gasto({ receipt_id: 'ticket-1' }));
      prisma.expense.count.mockResolvedValue(0);

      await service.remove('gasto-1', 3, PAGADOR);

      expect(prisma.receipt.deleteMany).toHaveBeenCalledWith({ where: { id: 'ticket-1' } });
      expect(prisma.receipt.update).not.toHaveBeenCalled();
    });
  });

  describe('removeReceipt', () => {
    beforeEach(() => {
      prisma.receipt.findUnique.mockResolvedValue({ payer_id: PAGADOR, version: 5 });
    });

    it('devuelve 404 cuando el ticket no existe', async () => {
      prisma.receipt.findUnique.mockResolvedValue(null);

      await expect(service.removeReceipt('x', 5, PAGADOR)).rejects.toThrow(NotFoundException);
    });

    it('solo deja borrar a quien pagó', async () => {
      await expect(service.removeReceipt('ticket-1', 5, ANA)).rejects.toThrow(ForbiddenException);
    });

    it('da 409 sin borrar nada si el ticket ha cambiado desde que se cargó', async () => {
      await expect(service.removeReceipt('ticket-1', 4, PAGADOR)).rejects.toThrow(
        ConflictException,
      );

      expect(prisma.receipt.deleteMany).not.toHaveBeenCalled();
    });

    it('da 409 si otra edición se adelanta entre la lectura y el borrado', async () => {
      prisma.receipt.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.removeReceipt('ticket-1', 5, PAGADOR)).rejects.toThrow(
        ConflictException,
      );
    });

    it('borra el ticket con la versión en el where; productos y deudas caen en cascada', async () => {
      await expect(service.removeReceipt('ticket-1', 5, PAGADOR)).resolves.toEqual({
        id: 'ticket-1',
      });

      expect(prisma.receipt.deleteMany).toHaveBeenCalledWith({
        where: { id: 'ticket-1', version: 5 },
      });
      expect(prisma.expense.deleteMany).not.toHaveBeenCalled();
    });
  });
});
