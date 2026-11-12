import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class JoinApartmentDto {
  @IsString()
  invite_code!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  full_name?: string;
}
