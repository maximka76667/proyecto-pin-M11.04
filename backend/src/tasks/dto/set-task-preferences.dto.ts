import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum TaskPreferenceType {
  prefer = 'prefer',
  indifferent = 'indifferent',
  avoid = 'avoid',
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TaskPreferenceItemDto {
  @Matches(UUID_REGEX, { message: 'task_id must be a UUID' })
  @IsNotEmpty()
  task_id: string;

  @IsEnum(TaskPreferenceType, {
    message: 'preference must be one of: prefer, indifferent, avoid',
  })
  preference: TaskPreferenceType;
}

export class SetTaskPreferencesDto {
  @Matches(UUID_REGEX, { message: 'apartment_id must be a UUID' })
  @IsNotEmpty()
  apartment_id: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty({ message: 'preferences array cannot be empty' })
  @ValidateNested({ each: true })
  @Type(() => TaskPreferenceItemDto)
  preferences?: TaskPreferenceItemDto[];

  // Soporte directo para enviar una única preferencia en el cuerpo
  @IsOptional()
  @Matches(UUID_REGEX, { message: 'task_id must be a UUID' })
  task_id?: string;

  @IsOptional()
  @IsEnum(TaskPreferenceType, {
    message: 'preference must be one of: prefer, indifferent, avoid',
  })
  preference?: TaskPreferenceType;
}
