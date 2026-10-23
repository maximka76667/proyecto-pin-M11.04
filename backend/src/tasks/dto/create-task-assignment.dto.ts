import { IsDateString, IsUUID } from 'class-validator';

export class CreateTaskAssignmentDto {
  @IsUUID()
  user_id: string;

  @IsDateString()
  due_date: string;
}
