import { Body, Controller, Get, Headers, Post, Query, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) { return this.auth.register(dto); }

  @Get('verify-email')
  async verifyEmail(
    @Query('token') token: string,
    @Query('redirect_uri') redirectUri: string | undefined,
    @Res() response: Response,
  ) {
    const result = token ? await this.auth.verifyEmail(token) : 'invalid';
    if (typeof result === 'object' && redirectUri === this.auth.emailVerificationRedirectUri()) {
      return response.redirect(
        `${redirectUri}?token=${encodeURIComponent(result.token)}&verified=1`,
      );
    }
    response
      .status(200)
      .type('html')
      .send(
        typeof result === 'object' && result.status === 'confirmed'
          ? verificationPage('Email confirmado. Ya puedes volver a Room8')
          : result === 'used'
            ? verificationPage('Este enlace ya se ha usado')
            : verificationPage('Este enlace no es válido o ha caducado'),
      );
  }

  @Post('login')
  login(@Body() dto: LoginDto) { return this.auth.login(dto); }

  @Get('me')
  async me(@CurrentUser() userId: string) {
    const user = await this.auth.getUser(userId);
    if (!user) throw new UnauthorizedException('Sesión no válida');
    return user;
  }

  @Post('logout')
  logout(@Headers('authorization') authorization?: string) {
    const token = authorization?.replace(/^Bearer\s+/i, '');
    return token ? this.auth.logout(token) : { success: true };
  }

  @Get('google/start')
  googleStart(@Query('callback_uri') callbackUri?: string) {
    return this.auth.googleAuthorizationUrl(callbackUri);
  }

  @Get('google/callback')
  async googleCallback(@Query('code') code: string, @Query('state') state: string, @Res() response: Response) {
    try {
      const result = await this.auth.googleCallback(code, state);
      const callbackUri = result.callbackUri || `${process.env.FRONTEND_URL ?? 'http://localhost:8081'}/auth`;
      const separator = callbackUri.includes('?') ? '&' : '?';
      response.redirect(`${callbackUri}${separator}token=${encodeURIComponent(result.token)}`);
    } catch {
      const frontend = process.env.FRONTEND_URL ?? 'http://localhost:8081';
      response.redirect(`${frontend}/auth?google_error=1`);
    }
  }

}

function verificationPage(message: string) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Room8</title></head><body style="font-family:Arial,sans-serif;color:#1F2A24;text-align:center;padding:64px 24px">
<h1>${message}</h1><p>Ya puedes volver a la aplicación de Room8.</p>
</body></html>`;
}
