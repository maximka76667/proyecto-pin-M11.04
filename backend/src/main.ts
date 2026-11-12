import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);

  // Cuántos proxies hay delante. Sin la variable no se confía en ninguna cabecera, así que
  // nadie puede falsear su IP con X-Forwarded-For y saltarse los límites de intentos.
  // Al desplegar detrás de un proxy hay que poner el número de saltos (normalmente 1):
  // nunca `true`, que acepta la cabecera venga de donde venga. Sin esto, el servidor ve la
  // IP del proxy para todos y los límites por IP se comparten entre todos los usuarios.
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 0));

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
