import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class JoinApartmentDto {
  @IsString()
  invite_code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  full_name!: string;
}
