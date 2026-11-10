import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  createHash,
  randomUUID,
  createHmac,
} from 'node:crypto';
import * as bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import type { RegisterDto } from './dto/register.dto';
import type { LoginDto } from './dto/login.dto';

const SESSION_DAYS = 30;
const EMAIL_IN_USE = 'Este correo electrónico ya está en uso';
const INVALID_CREDENTIALS = 'Correo o contraseña incorrectos';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException(EMAIL_IN_USE);

    const passwordHash = await this.hashPassword(dto.password);
    let user: { id: string; email: string | null; full_name: string };
    try {
      user = await this.prisma.user.create({
        data: {
          email,
          full_name: dto.full_name.trim(),
          is_landlord: false,
          password_hash: passwordHash,
        },
        select: { id: true, email: true, full_name: true },
      });
    } catch (error) {
      // Dos registros a la vez con el mismo email pasan los dos la comprobación de arriba;
      // el @unique de la base de datos para al segundo (PA-1014.02)
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(EMAIL_IN_USE);
      }
      throw error;
    }
    return this.withToken(user);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.trim().toLowerCase() } });
    // El mismo mensaje si el email no existe, la contraseña es mala o la cuenta es de Google,
    // para no revelar qué emails están registrados (PA-1014.04)
    if (!user?.password_hash || !(await this.verifyPassword(dto.password, user.password_hash))) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    return this.withToken({ id: user.id, email: user.email, full_name: user.full_name });
  }

  async getUser(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, full_name: true, is_landlord: true, user_apartments: { select: { apartment_id: true } } },
    });
  }

  async userIdForToken(token: string) {
    let payload: jwt.JwtPayload;
    try {
      const verified = jwt.verify(token, this.config.getOrThrow<string>('JWT_SECRET'), {
        algorithms: ['HS256'],
      });
      if (typeof verified === 'string') return null;
      payload = verified;
    } catch (error) {
      if (error instanceof Error && ['JsonWebTokenError', 'TokenExpiredError'].includes(error.name)) {
        return null;
      }
      throw error;
    }
    if (!payload.sub) return null;

    const session = await this.prisma.authSession.findUnique({
      where: { token_hash: this.tokenHash(token) },
      select: { user_id: true, expires_at: true },
    });
    if (!session || session.user_id !== payload.sub || session.expires_at <= new Date()) return null;
    return session.user_id;
  }

  async logout(token: string) {
    await this.prisma.authSession.deleteMany({ where: { token_hash: this.tokenHash(token) } });
    return { success: true };
  }

  googleAuthorizationUrl(callbackUri?: string) {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    const redirectUri = this.config.get<string>('GOOGLE_AUTH_REDIRECT_URI');
    if (!clientId || !redirectUri) throw new ConflictException('Google no está configurado');
    const state = this.signState(`${redirectUri}|${callbackUri ?? ''}|${Date.now()}`);
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', state, access_type: 'offline', prompt: 'select_account' });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
  }

  async googleCallback(code: string, state: string) {
    const [redirectUri, callbackUri] = this.verifyState(state).split('|');
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET');
    if (!clientId || !clientSecret || !redirectUri) throw new ConflictException('Google no está configurado');
    const body = new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' });
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const token = await tokenResponse.json() as { access_token?: string };
    if (!tokenResponse.ok || !token.access_token) throw new UnauthorizedException('No se pudo conectar con Google');
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } });
    const profile = await profileResponse.json() as { sub?: string; email?: string; name?: string };
    if (!profileResponse.ok || !profile.sub || !profile.email) throw new UnauthorizedException('Google no devolvió un perfil válido');
    const user = await this.prisma.user.upsert({
      where: { email: profile.email.toLowerCase() },
      create: { email: profile.email.toLowerCase(), full_name: profile.name?.trim() || profile.email.split('@')[0], is_landlord: false, google_subject: profile.sub },
      update: { google_subject: profile.sub },
      select: { id: true, email: true, full_name: true },
    });
    return { ...(await this.withToken(user)), callbackUri };
  }

  private signState(value: string) {
    const secret = this.config.get<string>('GOOGLE_CLIENT_SECRET');
    if (!secret) throw new ConflictException('Google no está configurado');
    const encoded = Buffer.from(value).toString('base64url');
    return `${encoded}.${createHmac('sha256', secret).update(encoded).digest('base64url')}`;
  }

  private verifyState(state: string) {
    const [encoded, signature] = state.split('.');
    const secret = this.config.get<string>('GOOGLE_CLIENT_SECRET');
    if (!encoded || !signature || !secret || createHmac('sha256', secret).update(encoded).digest('base64url') !== signature) throw new UnauthorizedException('Estado OAuth no válido');
    return Buffer.from(encoded, 'base64url').toString();
  }

  // Públicos para la UT1015: el cambio y la recuperación de contraseña reutilizan
  // el mismo hash y la misma creación de sesiones que el login
  async withToken(user: { id: string; email: string | null; full_name: string }) {
    const token = jwt.sign(
      { sub: user.id, jti: randomUUID() },
      this.config.getOrThrow<string>('JWT_SECRET'),
      { algorithm: 'HS256', expiresIn: SESSION_DAYS * 24 * 60 * 60 },
    );
    await this.prisma.authSession.create({
      data: {
        id: randomUUID(),
        token_hash: this.tokenHash(token),
        user_id: user.id,
        expires_at: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
      },
    });
    return { token, user };
  }

  async hashPassword(password: string) {
    return bcrypt.hash(password, 12);
  }

  async verifyPassword(password: string, stored: string) {
    return bcrypt.compare(password, stored);
  }

  private tokenHash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
