import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  // Las tareas y los intercambios lo usan para crear los avisos
  exports: [NotificationsService],
})
export class NotificationsModule {}
