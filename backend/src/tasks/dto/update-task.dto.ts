import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateTaskDto } from './create-task.dto';

// Sin apartment_id: una tarea no se puede mover a otro piso
export class UpdateTaskDto extends PartialType(
  OmitType(CreateTaskDto, ['apartment_id'] as const),
) {}
