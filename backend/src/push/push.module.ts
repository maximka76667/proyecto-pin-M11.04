import { Module } from '@nestjs/common';
import { PushController } from './push.controller';
import { PushListener } from './push.listener';
import { PushService } from './push.service';

// Notificaciones push al móvil. Ningún otro módulo importa este: NotificationsService anuncia
// los avisos guardados (AVISOS_CREADOS) y PushListener los escucha (patrón Observer)
@Module({
  controllers: [PushController],
  providers: [PushService, PushListener],
})
export class PushModule {}
