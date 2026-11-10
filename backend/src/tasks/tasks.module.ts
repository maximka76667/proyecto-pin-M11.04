import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TaskSwapsService } from './task-swaps.service';

@Module({
  controllers: [TasksController],
  providers: [TasksService, TaskSwapsService],
})
export class TasksModule {}
