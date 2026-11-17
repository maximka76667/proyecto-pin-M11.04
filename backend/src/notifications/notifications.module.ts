import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsListener } from './notifications.listener';
import { NotificationsService } from './notifications.service';

// Ningún otro módulo importa este: las tareas y los gastos solo emiten eventos y
// NotificationsListener los escucha (patrón Observer)
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsListener],
})
export class NotificationsModule {}
