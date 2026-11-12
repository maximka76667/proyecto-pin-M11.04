import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';
import { PASSWORD_MESSAGES } from '../password-policy';

export const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

// POST /auth/forgot-password. La respuesta es la misma exista o no la cuenta,
// así que este DTO solo comprueba el formato
export class ForgotPasswordDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: PASSWORD_MESSAGES.invalidEmail })
  @MaxLength(254, { message: PASSWORD_MESSAGES.invalidEmail })
  email!: string;
}
