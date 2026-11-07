import { IsEmail, IsNotEmpty, IsString, MinLength, MaxLength } from 'class-validator';
import { MaxBytes } from '../../common/validators/max-bytes.validator';
import { PASSWORD_MAX_BYTES, PASSWORD_MESSAGES } from '../password/password-policy';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  full_name!: string;

  @IsString()
  @MinLength(8)
  // bcrypt ignora lo que pase de 72 bytes: con más, dos contraseñas distintas valdrían igual
  @MaxBytes(PASSWORD_MAX_BYTES, { message: PASSWORD_MESSAGES.tooLong })
  password!: string;
}
