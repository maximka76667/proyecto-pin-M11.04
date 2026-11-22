import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TaskSwapsService } from './task-swaps.service';
import { TaskPlannerController } from './planner/task-planner.controller';
import { TaskPlannerService } from './planner/task-planner.service';
import { TaskVerificationsController } from './task-verifications.controller';
import { TaskVerificationsService } from './task-verifications.service';

@Module({
  // GoogleCalendarService: sincroniza el calendario de quien recibe la tarea antes de comprobarlo.
  // Los avisos de UT1019 no se piden aquí: los servicios emiten eventos (task.events.ts)
  imports: [AvailabilityModule],
  // Los controladores con rutas fijas (/tasks/verifications, /tasks/plan/...) van antes que
  // TasksController para que no caigan en /tasks/:id
  controllers: [TaskVerificationsController, TaskPlannerController, TasksController],
  providers: [TasksService, TaskSwapsService, TaskVerificationsService, TaskPlannerService],
})
export class TasksModule {}
