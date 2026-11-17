import { Test, TestingModule } from '@nestjs/testing';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

// En la app lo inyecta @CurrentUser(), pero los decoradores no se ejecutan cuando un
// test llama directamente al método del controlador, así que se pasa a mano
const USUARIO_LOGUEADO = '11111111-1111-1111-1111-111111111111';

describe('Controlador de transacciones', () => {
  let controller: TransactionsController;

  const transactionsService = {
    getPersonalSummary: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransactionsController],
      providers: [
        { provide: TransactionsService, useValue: transactionsService },
      ],
    }).compile();

    controller = module.get<TransactionsController>(TransactionsController);
  });

  // PA-1002.01 y PA-1002.02: "el usuario entra a la vista de saldos"
  it('pide el resumen del hogar de la ruta para el usuario logueado', async () => {
    const resumen = { mensaje: 'Estás al día en tus pagos.' };
    transactionsService.getPersonalSummary.mockResolvedValue(resumen);

    await expect(
      controller.getMyPersonalSummary('piso-pin-01', USUARIO_LOGUEADO),
    ).resolves.toBe(resumen);
    expect(transactionsService.getPersonalSummary).toHaveBeenCalledWith(
      'piso-pin-01',
      USUARIO_LOGUEADO,
    );
  });
});
