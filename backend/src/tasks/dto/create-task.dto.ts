import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { TaskCategory, TaskFrequency } from '@prisma/client';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CreateTaskDto {
  @Matches(UUID_REGEX, {
    message: 'apartment_id must be a UUID-like identifier',
  })
  apartment_id: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsEnum(TaskFrequency)
  frequency: TaskFrequency;

  @IsOptional()
  @IsEnum(TaskCategory)
  category?: TaskCategory;
}
