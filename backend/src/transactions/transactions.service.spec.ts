import { ConflictException, NotFoundException } from '@nestjs/common';
import { TransactionCategory } from '@prisma/client';
import { TransactionsService, Pago } from './transactions.service';

describe('TransactionsService', () => {
  const prisma = {
    transaction: {
      create: jest.fn(),
    },
  };
  const usersService = {
    getUserNames: jest.fn(),
  };
  let service: TransactionsService;

  const apartmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const deudorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const acreedorId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  const pendingDebt: Pago = {
    deudorId,
    acreedorId,
    monto: 25.5,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TransactionsService(prisma as never, usersService as never);
  });

  it('registra un pago pendiente válido', async () => {
    const payment = {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      apartment_id: apartmentId,
      from_user_id: deudorId,
      to_user_id: acreedorId,
      amount: '25.50',
      category: TransactionCategory.payment,
    };
    jest.spyOn(service, 'getPagoMinimo').mockResolvedValue([pendingDebt]);
    prisma.transaction.create.mockResolvedValue(payment);

    await expect(
      service.settleDebt(apartmentId, acreedorId, {
        deudor_id: deudorId,
        amount: '25.50',
      }),
    ).resolves.toEqual(payment);

    expect(prisma.transaction.create).toHaveBeenCalledWith({
      data: {
        apartment_id: apartmentId,
        from_user_id: deudorId,
        to_user_id: acreedorId,
        amount: '25.50',
        category: TransactionCategory.payment,
      },
    });
  });

  it.each([
    ['La deuda estaba pagada', []],
    [
      'La deuda no es del acreedor logueado',
      [{ ...pendingDebt, acreedorId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }],
    ],
    [
      'La deuda fue eliminada',
      [{ ...pendingDebt, deudorId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }],
    ],
  ])('rejects settlement when %s', async (_reason, currentDebts) => {
    jest.spyOn(service, 'getPagoMinimo').mockResolvedValue(currentDebts);

    await expect(
      service.settleDebt(apartmentId, acreedorId, {
        deudor_id: deudorId,
        amount: '25.50',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it('rechaza la deuda si el monto ha cambiado', async () => {
    jest
      .spyOn(service, 'getPagoMinimo')
      .mockResolvedValue([{ ...pendingDebt, monto: 30 }]);

    await expect(
      service.settleDebt(apartmentId, acreedorId, {
        deudor_id: deudorId,
        amount: '25.50',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });
});
