import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MESSAGES } from '../password/password-policy';

export class LoginDto {
  @IsEmail({}, { message: PASSWORD_MESSAGES.invalidEmail })
  email!: string;

  // Sin la regla de letra y número: no debe dejar fuera a quien tenga una contraseña antigua
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
