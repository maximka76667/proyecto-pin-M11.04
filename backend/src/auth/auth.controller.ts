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
