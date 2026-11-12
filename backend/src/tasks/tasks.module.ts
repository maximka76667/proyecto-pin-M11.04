import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  // GoogleCalendarService: sincroniza el calendario de quien recibe la tarea antes de comprobarlo
  imports: [AvailabilityModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
