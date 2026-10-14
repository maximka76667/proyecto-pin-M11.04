import { Test, TestingModule } from '@nestjs/testing';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

describe('TransactionsController', () => {
  let controller: TransactionsController;

  const service = {
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransactionsController],
      providers: [{ provide: TransactionsService, useValue: service }],
    }).compile();

    controller = module.get<TransactionsController>(TransactionsController);
  });

  it('PATCH /transactions/:id passes the id and body to the service', async () => {
    const updated = { id: 'tx-1', amount: '20.00', category: 'other' };
    service.update.mockResolvedValue(updated);

    const result = await controller.update('tx-1', { amount: '20.00', category: 'other' });

    expect(service.update).toHaveBeenCalledWith('tx-1', {
      amount: '20.00',
      category: 'other',
    });
    expect(result).toEqual(updated);
  });

  it('DELETE /transactions/:id passes the id to the service', async () => {
    const deleted = { id: 'tx-1' };
    service.remove.mockResolvedValue(deleted);

    const result = await controller.remove('tx-1');

    expect(service.remove).toHaveBeenCalledWith('tx-1');
    expect(result).toEqual(deleted);
  });
});
