import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';
import {
  normalizeTaskTime,
  TASK_TIME_MESSAGE,
  TASK_TIME_PATTERN,
} from '../../dto/task-time';

// Una asignación de la propuesta, ya editada por la persona
export class PlanItemDto {
  @IsUUID()
  task_id: string;

  @IsUUID()
  user_id: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha debe tener el formato AAAA-MM-DD',
  })
  date: string;

  @Transform(normalizeTaskTime)
  @Matches(TASK_TIME_PATTERN, { message: TASK_TIME_MESSAGE })
  time: string;
}

// POST /tasks/plan/validate: las asignaciones tal como están en pantalla
export class ValidatePlanDto {
  @IsUUID()
  apartment_id: string;

  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => PlanItemDto)
  assignments: PlanItemDto[];

  // Ignora la disponibilidad y Google Calendar, pero no las tareas ya asignadas
  @IsOptional()
  @IsBoolean()
  ignore_calendar?: boolean;
}

// POST /tasks/plan/apply: sin `assignments` se aplica el reparto automático tal cual
export class ApplyPlanDto {
  @IsUUID()
  apartment_id: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => PlanItemDto)
  assignments?: PlanItemDto[];

  // Ignora la disponibilidad y Google Calendar, pero no las tareas ya asignadas
  @IsOptional()
  @IsBoolean()
  ignore_calendar?: boolean;
}
