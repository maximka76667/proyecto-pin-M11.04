import { IsDateString, IsNotEmpty, IsUUID } from 'class-validator';

export class CreateTaskAssignmentDto {
  @IsUUID()
  user_id: string;

  @IsNotEmpty()
  @IsDateString({}, { message: 'due_date must be a valid ISO date (YYYY-MM-DD)' })
  due_date: string;
}
