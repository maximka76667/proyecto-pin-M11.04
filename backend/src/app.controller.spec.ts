import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('Controlador principal de la aplicación', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('ruta raíz', () => {
    it('devuelve el mensaje de conexión del backend', () => {
      expect(appController.getHello()).toBe(
        '¡Conexión exitosa con el backend del proyecto PIN!',
      );
    });
  });
});
