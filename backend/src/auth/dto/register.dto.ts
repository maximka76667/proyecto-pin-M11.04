import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { MaxBytes } from '../../common/validators/max-bytes.validator';
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MESSAGES,
  PASSWORD_PATTERN,
} from '../password/password-policy';

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

  @IsOptional()
  @IsIn(['create', 'join'])
  household_mode?: 'create' | 'join';

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{3,50}$/)
  household_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  household_address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  invite_code?: string;
}
