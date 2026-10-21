import { IsEnum, IsNotEmpty, IsOptional, Matches, MaxLength } from 'class-validator';
import { TaskCategory, TaskFrequency } from '@prisma/client';

export class CreateTaskDto {
  @Matches(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    { message: 'apartment_id must be a UUID-like identifier' },
  )
  apartment_id: string;

  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @IsEnum(TaskFrequency)
  frequency: TaskFrequency;

  @IsOptional()
  @IsEnum(TaskCategory)
  category?: TaskCategory;
}
