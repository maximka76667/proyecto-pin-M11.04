import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TaskSwapsService } from './task-swaps.service';
import { TaskVerificationsController } from './task-verifications.controller';
import { TaskVerificationsService } from './task-verifications.service';

@Module({
  // GoogleCalendarService: sincroniza el calendario de quien recibe la tarea antes de comprobarlo.
  // Los avisos de UT1019 no se piden aquí: los servicios emiten eventos (task.events.ts)
  imports: [AvailabilityModule],
  // TaskVerificationsController primero: GET /tasks/verifications no debe caer en GET /tasks/:id
  controllers: [TaskVerificationsController, TasksController],
  providers: [TasksService, TaskSwapsService, TaskVerificationsService],
})
export class TasksModule {}
