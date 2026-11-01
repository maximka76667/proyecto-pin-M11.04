import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  Matches,
  ValidateIf,
} from 'class-validator';

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

  @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/, {
    message: 'due_time must be a valid time in HH:mm format',
  })
  due_time: string;
}
