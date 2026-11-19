import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TaskSwapsService } from './task-swaps.service';
import { TaskPlannerController } from './planner/task-planner.controller';
import { TaskPlannerService } from './planner/task-planner.service';

@Module({
  // GoogleCalendarService: sincroniza el calendario de quien recibe la tarea antes de comprobarlo.
  // Los avisos de UT1019 no se piden aquí: los servicios emiten eventos (task.events.ts)
  imports: [AvailabilityModule],
  controllers: [TasksController, TaskPlannerController],
  providers: [TasksService, TaskSwapsService, TaskPlannerService],
})
export class TasksModule {}
