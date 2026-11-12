import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/current-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PasswordThrottlerGuard } from './password-throttler.guard';
import { PasswordService } from './password.service';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

// Los límites de @Throttle son del limitador "account" (por usuario o por email);
// el limitador "sweep" de auth.module.ts cuenta aparte, por IP
@Controller('auth')
@UseGuards(PasswordThrottlerGuard)
export class PasswordController {
  constructor(private readonly passwords: PasswordService) {}

  // 5 intentos cada 15 min por usuario: frena a quien pruebe contraseñas con una sesión robada
  @Post('change-password')
  @HttpCode(200)
  @Throttle({ account: { limit: 5, ttl: FIFTEEN_MINUTES } })
  changePassword(@CurrentUser() userId: string, @Body() dto: ChangePasswordDto) {
    return this.passwords.changePassword(userId, dto);
  }

  // 5 códigos cada 15 min por email, además de la espera de 60 s que aplica el servicio
  @Post('forgot-password')
  @HttpCode(200)
  @Throttle({ account: { limit: 5, ttl: FIFTEEN_MINUTES } })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.passwords.requestReset(dto.email);
  }

  // Cada código admite 5 intentos; este límite por email corta el goteo entre códigos
  @Post('reset-password')
  @HttpCode(200)
  @Throttle({ account: { limit: 10, ttl: FIFTEEN_MINUTES } })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.passwords.resetPassword(dto);
  }
}
