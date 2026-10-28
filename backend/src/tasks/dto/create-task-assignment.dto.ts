import { IsDateString, IsUUID, Matches } from 'class-validator';

export class CreateTaskAssignmentDto {
  @IsUUID()
  user_id: string;

  @IsDateString()
  due_date: string;

  @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
  start_time: string;
}
