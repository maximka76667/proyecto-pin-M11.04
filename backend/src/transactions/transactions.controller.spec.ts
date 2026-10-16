import { Test, TestingModule } from '@nestjs/testing';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

// El mismo usuario que el controlador tiene fijado mientras no haya autenticación
const USUARIO_LOGUEADO = '22222222-2222-2222-2222-222222222222';

describe('TransactionsController', () => {
  let controller: TransactionsController;

  const transactionsService = {
    getPersonalSummary: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransactionsController],
      providers: [{ provide: TransactionsService, useValue: transactionsService }],
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

  // PA-1002.01 y PA-1002.02: "el usuario entra a la vista de saldos"
  it('pide el resumen del hogar de la ruta para el usuario logueado', async () => {
    const resumen = { mensaje: 'Estás al día en tus pagos.' };
    transactionsService.getPersonalSummary.mockResolvedValue(resumen);

    await expect(controller.getMyPersonalSummary('piso-pin-01')).resolves.toBe(resumen);
    expect(transactionsService.getPersonalSummary).toHaveBeenCalledWith(
      'piso-pin-01',
      USUARIO_LOGUEADO,
    );
  });
});
