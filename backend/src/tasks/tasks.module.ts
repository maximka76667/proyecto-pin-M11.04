import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TaskSwapsService } from './task-swaps.service';

@Module({
  // GoogleCalendarService: sincroniza el calendario de quien recibe la tarea antes de comprobarlo
  // NotificationsService: avisa de las asignaciones y de los intercambios (UT1019)
  imports: [AvailabilityModule, NotificationsModule],
  controllers: [TasksController],
  providers: [TasksService, TaskSwapsService],
})
export class TasksModule {}
