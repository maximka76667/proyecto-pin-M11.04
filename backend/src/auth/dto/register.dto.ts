import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { MaxBytes } from '../../common/validators/max-bytes.validator';
import { PASSWORD_MAX_BYTES, PASSWORD_MESSAGES, PASSWORD_PATTERN } from '../password/password-policy';

export class RegisterDto {
  @IsEmail({}, { message: PASSWORD_MESSAGES.invalidEmail })
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  full_name!: string;

  // La misma regla que la app y que el cambio de contraseña de la UT1015:
  // 8 caracteres o más, con una letra y un número (PA-1014.05)
  @IsString()
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_MESSAGES.policy })
  // bcrypt ignora lo que pase de 72 bytes: con más, dos contraseñas distintas valdrían igual
  @MaxBytes(PASSWORD_MAX_BYTES, { message: PASSWORD_MESSAGES.tooLong })
  password!: string;
}
