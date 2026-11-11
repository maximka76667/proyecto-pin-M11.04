import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';
import { normalizeTaskTime, TASK_TIME_MESSAGE, TASK_TIME_PATTERN } from './task-time';

// GET /tasks/:id/availability: quién del hogar está libre en esa franja
export class TaskAvailabilityQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha debe tener el formato AAAA-MM-DD' })
  due_date: string;

  @Transform(normalizeTaskTime)
  @Matches(TASK_TIME_PATTERN, { message: TASK_TIME_MESSAGE })
  due_time: string;
}
