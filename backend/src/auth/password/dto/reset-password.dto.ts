import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';
import { Match } from '../../../common/validators/match.validator';
import { MatchesIfPresent } from '../../../common/validators/matches-if-present.validator';
import { MaxBytes } from '../../../common/validators/max-bytes.validator';
import { IsRequiredText } from '../../../common/validators/required-text.validator';
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MESSAGES,
  PASSWORD_PATTERN,
  RESET_CODE_PATTERN,
} from '../password-policy';
import { normalizeEmail } from './forgot-password.dto';

// POST /auth/reset-password: el código de 6 dígitos que llega por email sustituye a la
// contraseña actual. Que la nueva no sea igual a la anterior lo comprueba el servicio con el hash
export class ResetPasswordDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: PASSWORD_MESSAGES.invalidEmail })
  @MaxLength(254, { message: PASSWORD_MESSAGES.invalidEmail })
  email!: string;

  @IsRequiredText({ message: PASSWORD_MESSAGES.required })
  @MatchesIfPresent(RESET_CODE_PATTERN, { message: PASSWORD_MESSAGES.invalidCode })
  code!: string;

  @IsRequiredText({ message: PASSWORD_MESSAGES.required })
  @MatchesIfPresent(PASSWORD_PATTERN, { message: PASSWORD_MESSAGES.policy })
  @MaxBytes(PASSWORD_MAX_BYTES, { message: PASSWORD_MESSAGES.tooLong })
  new_password!: string;

  @IsRequiredText({ message: PASSWORD_MESSAGES.required })
  @Match('new_password', { message: PASSWORD_MESSAGES.mismatch })
  confirm_password!: string;
}
