import { Match } from '../../../common/validators/match.validator';
import { MatchesIfPresent } from '../../../common/validators/matches-if-present.validator';
import { MaxBytes } from '../../../common/validators/max-bytes.validator';
import { NotEqualTo } from '../../../common/validators/not-equal-to.validator';
import { IsRequiredText } from '../../../common/validators/required-text.validator';
import {
  CURRENT_PASSWORD_MAX_BYTES,
  PASSWORD_MAX_BYTES,
  PASSWORD_MESSAGES,
  PASSWORD_PATTERN,
} from '../password-policy';

// POST /auth/change-password (PA-1015.04). El usuario sale del token, nunca del cuerpo.
// Que la contraseña actual sea la correcta lo comprueba el servicio contra el hash (PA-1015.03)
export class ChangePasswordDto {
  @IsRequiredText({ message: PASSWORD_MESSAGES.required })
  @MaxBytes(CURRENT_PASSWORD_MAX_BYTES, { message: PASSWORD_MESSAGES.tooLong })
  current_password!: string;

  @IsRequiredText({ message: PASSWORD_MESSAGES.required })
  @MatchesIfPresent(PASSWORD_PATTERN, { message: PASSWORD_MESSAGES.policy })
  @MaxBytes(PASSWORD_MAX_BYTES, { message: PASSWORD_MESSAGES.tooLong })
  @NotEqualTo('current_password', { message: PASSWORD_MESSAGES.sameAsCurrent })
  new_password!: string;

  @IsRequiredText({ message: PASSWORD_MESSAGES.required })
  @Match('new_password', { message: PASSWORD_MESSAGES.mismatch })
  confirm_password!: string;
}
