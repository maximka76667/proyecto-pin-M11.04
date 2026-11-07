import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { SESSION_EXPIRED } from '../../common/current-user.decorator';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth.service';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { ResetPasswordDto } from './dto/reset-password.dto';
import {
  PASSWORD_MESSAGES,
  PASSWORD_UPDATED,
  RESET_CODE_COOLDOWN_SECONDS,
  RESET_CODE_MAX_ATTEMPTS,
  RESET_CODE_TTL_MINUTES,
  RESET_DONE,
  RESET_REQUESTED,
} from './password-policy';

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  // Cambio desde "Mi cuenta" (PA-1015.01, .02 y .03). El usuario sale del token, nunca del cuerpo
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, full_name: true, password_hash: true },
    });
    if (!user) throw new UnauthorizedException(SESSION_EXPIRED);
    if (!user.password_hash) throw new BadRequestException(PASSWORD_MESSAGES.googleAccount);

    // 400 y no 401: la app trata el 401 como sesión caducada y cerraría la sesión (PA-1015.03)
    if (!(await this.auth.verifyPassword(dto.current_password, user.password_hash))) {
      throw new BadRequestException(PASSWORD_MESSAGES.currentIncorrect);
    }

    const passwordHash = await this.auth.hashPassword(dto.new_password);
    // Borrar todas las sesiones invalida los tokens de los demás dispositivos (PA-1015.02);
    // este dispositivo recibe uno nuevo justo después
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { password_hash: passwordHash } }),
      this.prisma.authSession.deleteMany({ where: { user_id: user.id } }),
      this.prisma.passwordResetCode.deleteMany({ where: { user_id: user.id } }),
    ]);

    const { token } = await this.auth.withToken({
      id: user.id,
      email: user.email,
      full_name: user.full_name,
    });
    return { message: PASSWORD_UPDATED, token };
  }

  // "¿Has olvidado tu contraseña?". Responde lo mismo y en el mismo tiempo exista o no la
  // cuenta: el trabajo (consultas y email) sigue en segundo plano después de responder
  requestReset(email: string) {
    void this.issueResetCode(email).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : 'error desconocido';
      this.logger.error(`No se ha podido generar el código de recuperación: ${reason}`);
    });
    return { message: RESET_REQUESTED };
  }

  async issueResetCode(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, password_hash: true },
    });
    // Las cuentas de Google no tienen contraseña que restablecer
    if (!user?.email || !user.password_hash) return;

    const cooldownStart = new Date(Date.now() - RESET_CODE_COOLDOWN_SECONDS * 1000);
    const recent = await this.prisma.passwordResetCode.findFirst({
      where: { user_id: user.id, created_at: { gt: cooldownStart } },
      select: { id: true },
    });
    if (recent) return;

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.$transaction([
      this.prisma.passwordResetCode.deleteMany({ where: { user_id: user.id } }),
      this.prisma.passwordResetCode.create({
        data: {
          id: randomUUID(),
          user_id: user.id,
          code_hash: this.hashCode(user.id, code),
          expires_at: new Date(Date.now() + RESET_CODE_TTL_MINUTES * 60 * 1000),
        },
      }),
    ]);
    void this.mail.sendPasswordResetCode(user.email, code, RESET_CODE_TTL_MINUTES);
  }

  async resetPassword(dto: ResetPasswordDto) {
    // El mismo mensaje para email desconocido, cuenta de Google, código caducado o incorrecto
    const invalid = new BadRequestException(PASSWORD_MESSAGES.invalidOrExpiredCode);

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, password_hash: true },
    });
    if (!user?.password_hash) throw invalid;

    const record = await this.prisma.passwordResetCode.findFirst({
      where: { user_id: user.id },
      orderBy: { created_at: 'desc' },
    });
    if (!record) throw invalid;

    // Gasta un intento antes de comparar, en una sola operación: aunque lleguen muchas
    // peticiones a la vez, nunca se prueban más de 5 códigos
    const consumed = await this.prisma.passwordResetCode.updateMany({
      where: {
        id: record.id,
        attempts: { lt: RESET_CODE_MAX_ATTEMPTS },
        expires_at: { gt: new Date() },
      },
      data: { attempts: { increment: 1 } },
    });
    if (consumed.count === 0 || !this.codeMatches(user.id, dto.code, record.code_hash)) {
      throw invalid;
    }

    // Solo con el código ya validado: antes, esta respuesta dejaría probar contraseñas
    if (await this.auth.verifyPassword(dto.new_password, user.password_hash)) {
      throw new BadRequestException(PASSWORD_MESSAGES.sameAsCurrent);
    }

    const passwordHash = await this.auth.hashPassword(dto.new_password);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { password_hash: passwordHash } }),
      this.prisma.authSession.deleteMany({ where: { user_id: user.id } }),
      this.prisma.passwordResetCode.deleteMany({ where: { user_id: user.id } }),
    ]);
    return { message: RESET_DONE };
  }

  // HMAC con un secreto del servidor: si se filtra la tabla, los códigos no se pueden
  // sacar probando el millón de combinaciones. Sin PASSWORD_RESET_SECRET usa JWT_SECRET,
  // separado con el prefijo para que la misma clave no sirva para las dos cosas
  private hashCode(userId: string, code: string) {
    const secret =
      this.config.get<string>('PASSWORD_RESET_SECRET') || this.config.getOrThrow<string>('JWT_SECRET');
    return createHmac('sha256', secret).update(`password-reset:${userId}:${code}`).digest('hex');
  }

  private codeMatches(userId: string, code: string, storedHash: string) {
    const expected = Buffer.from(storedHash, 'hex');
    const actual = Buffer.from(this.hashCode(userId, code), 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
