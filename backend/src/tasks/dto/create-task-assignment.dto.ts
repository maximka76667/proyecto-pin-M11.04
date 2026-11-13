import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  Matches,
  ValidateIf,
} from 'class-validator';
import { normalizeTaskTime, TASK_TIME_MESSAGE, TASK_TIME_PATTERN } from './task-time';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CreateTaskAssignmentDto {
  @ValidateIf((dto: CreateTaskAssignmentDto) => dto.user_ids === undefined)
  @Matches(UUID_REGEX, {
    message: 'user_id must be a UUID',
  })
  user_id?: string;

  @ValidateIf((dto: CreateTaskAssignmentDto) => dto.user_id === undefined)
  @IsArray()
  @ArrayNotEmpty()
  @Matches(UUID_REGEX, {
    each: true,
    message: 'user_ids must contain valid UUIDs',
  })
  user_ids?: string[];

  @IsDateString()
  due_date: string;

  // Acepta "9:30" y lo guarda como "09:30"
  @Transform(normalizeTaskTime)
  @Matches(TASK_TIME_PATTERN, { message: TASK_TIME_MESSAGE })
  due_time: string;
}
