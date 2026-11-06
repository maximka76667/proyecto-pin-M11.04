import { IsEmail, IsNotEmpty, IsString, MinLength, MaxLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  full_name!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
