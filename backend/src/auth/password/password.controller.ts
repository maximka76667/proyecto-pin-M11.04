import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/current-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PasswordThrottlerGuard } from './password-throttler.guard';
import { PasswordService } from './password.service';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

@Controller('auth')
@UseGuards(PasswordThrottlerGuard)
export class PasswordController {
  constructor(private readonly passwords: PasswordService) {}

  // 5 intentos cada 15 min por usuario: frena a quien pruebe contraseñas con una sesión robada
  @Post('change-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: FIFTEEN_MINUTES } })
  changePassword(@CurrentUser() userId: string, @Body() dto: ChangePasswordDto) {
    return this.passwords.changePassword(userId, dto);
  }

  // 3 peticiones cada 15 min por IP, además de la espera de 60 s por email del servicio
  @Post('forgot-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: FIFTEEN_MINUTES } })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.passwords.requestReset(dto.email);
  }

  // Cada código admite 5 intentos; este límite por IP corta además los barridos entre cuentas
  @Post('reset-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: FIFTEEN_MINUTES } })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.passwords.resetPassword(dto);
  }
}
