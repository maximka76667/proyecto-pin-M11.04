import { INestApplication, ValidationPipe } from '@nestjs/common';

// Shared by main.ts and the tests so both validate requests the same way
export function configureApp(app: INestApplication) {
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
