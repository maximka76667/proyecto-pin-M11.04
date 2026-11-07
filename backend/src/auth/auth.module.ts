import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { MailModule } from '../mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordController } from './password/password.controller';
import { TOO_MANY_ATTEMPTS } from './password/password-policy';
import { PasswordService } from './password/password.service';

@Module({
  imports: [
    // Límites por defecto; cada ruta de PasswordController fija los suyos con @Throttle
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 15 * 60 * 1000, limit: 5 }],
      errorMessage: TOO_MANY_ATTEMPTS,
    }),
    MailModule,
  ],
  controllers: [AuthController, PasswordController],
  providers: [AuthService, PasswordService],
  exports: [AuthService],
})
export class AuthModule {}
