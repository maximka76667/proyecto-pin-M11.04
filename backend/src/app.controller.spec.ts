import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
<<<<<<< HEAD
    it('devuelve el mensaje de conexión con el backend', () => {
=======
    it('should return "Hello World!"', () => {
>>>>>>> 7c8f3c6 (UET: Comprobado test generados, cambios pendientes)
      expect(appController.getHello()).toBe(
        '¡Conexión exitosa con el backend del proyecto PIN!',
      );
    });
  });
});
