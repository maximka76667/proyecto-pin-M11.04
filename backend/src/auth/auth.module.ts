import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { MailModule } from '../mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordController } from './password/password.controller';
import { TOO_MANY_ATTEMPTS } from './password/password-policy';
import { PasswordService } from './password/password.service';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [
        // Por cuenta (usuario con sesión o email): cada ruta fija su límite con @Throttle.
        // La clave la calcula PasswordThrottlerGuard
        { name: 'account', ttl: FIFTEEN_MINUTES, limit: 5 },
        // Por IP, holgado: frena a quien pruebe muchas cuentas distintas desde una misma
        // máquina (y el gasto de correos que eso supone) sin estorbar al uso normal.
        // Para que sirva detrás de un proxy hay que definir TRUST_PROXY_HOPS (ver main.ts)
        {
          name: 'sweep',
          ttl: FIFTEEN_MINUTES,
          limit: 60,
          getTracker: (req: Record<string, any>) => `ip:${String(req.ip)}`,
        },
      ],
      errorMessage: TOO_MANY_ATTEMPTS,
    }),
    MailModule,
  ],
  controllers: [AuthController, PasswordController],
  providers: [AuthService, PasswordService],
  exports: [AuthService],
})
export class AuthModule {}
