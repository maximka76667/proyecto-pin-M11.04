import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { TransactionsService } from './transactions.service';

// Builds the error Prisma throws, e.g. P2025 = record not found
function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('Prisma error', {
    code,
    clientVersion: Prisma.prismaVersion.client,
  });
}

describe('TransactionsService', () => {
  let service: TransactionsService;

  // Only the Prisma methods used by update/remove are mocked
  const prisma = {
    transaction: {
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  const transaction = {
    id: 'tx-1',
    apartment_id: 'apt-1',
    from_user_id: 'user-1',
    to_user_id: 'user-2',
    amount: '40.00',
    category: 'supplies',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: {} },
      ],
    }).compile();

    service = module.get<TransactionsService>(TransactionsService);
  });

  describe('update (modify expense)', () => {
    it('updates the expense by id with the given data', async () => {
      const updated = { ...transaction, amount: '55.50', category: 'utilities' };
      prisma.transaction.update.mockResolvedValue(updated);

      const result = await service.update('tx-1', {
        amount: '55.50',
        category: 'utilities',
      });

      expect(prisma.transaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-1' },
        data: { amount: '55.50', category: 'utilities' },
      });
      expect(result).toEqual(updated);
    });

    it('only sends the fields that changed', async () => {
      prisma.transaction.update.mockResolvedValue({ ...transaction, amount: '10.00' });

      await service.update('tx-1', { amount: '10.00' });

      expect(prisma.transaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-1' },
        data: { amount: '10.00' },
      });
    });

    it('returns 404 when the expense does not exist', async () => {
      prisma.transaction.update.mockRejectedValue(prismaError('P2025'));

      await expect(service.update('missing', { amount: '10.00' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns 400 when the new apartment or user does not exist', async () => {
      prisma.transaction.update.mockRejectedValue(prismaError('P2003'));

      await expect(
        service.update('tx-1', { to_user_id: '99999999-9999-9999-9999-999999999999' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rethrows unexpected errors', async () => {
      const unexpected = new Error('Database down');
      prisma.transaction.update.mockRejectedValue(unexpected);

      await expect(service.update('tx-1', { amount: '10.00' })).rejects.toBe(unexpected);
    });
  });

  describe('remove (delete expense)', () => {
    it('deletes the expense by id and returns it', async () => {
      prisma.transaction.delete.mockResolvedValue(transaction);

      const result = await service.remove('tx-1');

      expect(prisma.transaction.delete).toHaveBeenCalledWith({
        where: { id: 'tx-1' },
      });
      expect(result).toEqual(transaction);
    });

    it('returns 404 when the expense does not exist', async () => {
      prisma.transaction.delete.mockRejectedValue(prismaError('P2025'));

      await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
