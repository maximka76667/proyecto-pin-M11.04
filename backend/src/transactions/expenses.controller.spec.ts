import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../app.setup';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

// Peticiones HTTP reales con la misma validación que la app: lo que no llega bien formado se
// rechaza antes de tocar el servicio.
describe('Expenses controller', () => {
  let app: INestApplication<App>;

  const expensesService = {
    update: jest.fn(),
    remove: jest.fn(),
    removeReceipt: jest.fn(),
  };

  const ID = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ExpensesController],
      providers: [{ provide: ExpensesService, useValue: expensesService }],
    }).compile();

    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    expensesService.update.mockResolvedValue({ id: ID });
    expensesService.remove.mockResolvedValue({ id: ID });
    expensesService.removeReceipt.mockResolvedValue({ id: ID });
  });

  describe('PATCH /expenses/:id', () => {
    it('pasa los cambios y la versión al servicio', async () => {
      await request(app.getHttpServer())
        .patch(`/expenses/${ID}`)
        .send({ version: 3, amount: '12.50', concept: '  Cena  ' })
        .expect(200);

      expect(expensesService.update).toHaveBeenCalledWith(
        ID,
        expect.objectContaining({ version: 3, amount: '12.50', concept: 'Cena' }),
        expect.any(String),
      );
    });

    it.each([
      ['falta la versión', { amount: '12.50' }, 'version'],
      ['la versión es 0', { version: 0 }, 'version'],
      ['la versión no es un número entero', { version: 1.5 }, 'version'],
      ['el importe es cero', { version: 1, amount: '0' }, 'amount'],
      ['el importe supera el máximo', { version: 1, amount: '10000.01' }, 'amount'],
      ['el importe tiene más de 2 decimales', { version: 1, amount: '12.999' }, 'amount'],
      ['el concepto está vacío', { version: 1, concept: '   ' }, 'concept'],
      ['la categoría es de liquidación', { version: 1, category: 'payment' }, 'category'],
      ['un participante no es un uuid', { version: 1, participant_ids: ['abc'] }, 'participant_ids'],
    ])('responde 400 si %s, sin llegar al servicio', async (_, cuerpo, campo) => {
      const response = await request(app.getHttpServer())
        .patch(`/expenses/${ID}`)
        .send(cuerpo)
        .expect(400);

      expect(response.body.message.join(' ')).toContain(campo);
      expect(expensesService.update).not.toHaveBeenCalled();
    });

    it('responde 400 si el id no es un uuid', async () => {
      await request(app.getHttpServer()).patch('/expenses/abc').send({ version: 1 }).expect(400);

      expect(expensesService.update).not.toHaveBeenCalled();
    });
  });

  describe.each([
    ['DELETE /expenses/:id', 'expenses', 'remove'],
    ['DELETE /receipts/:id', 'receipts', 'removeReceipt'],
  ] as const)('%s', (_, ruta, metodo) => {
    it('pasa la versión de la query al servicio', async () => {
      await request(app.getHttpServer()).delete(`/${ruta}/${ID}?version=4`).expect(200);

      expect(expensesService[metodo]).toHaveBeenCalledWith(ID, 4, expect.any(String));
    });

    it('responde 400 si falta la versión', async () => {
      await request(app.getHttpServer()).delete(`/${ruta}/${ID}`).expect(400);

      expect(expensesService[metodo]).not.toHaveBeenCalled();
    });

    it('responde 400 si la versión no es un número', async () => {
      await request(app.getHttpServer()).delete(`/${ruta}/${ID}?version=abc`).expect(400);

      expect(expensesService[metodo]).not.toHaveBeenCalled();
    });

    it('responde 400 si el id no es un uuid', async () => {
      await request(app.getHttpServer()).delete(`/${ruta}/abc?version=1`).expect(400);

      expect(expensesService[metodo]).not.toHaveBeenCalled();
    });
  });
});
