import { Module } from '@nestjs/common';
import { MailService } from './mail.service';

// Se importará desde el módulo de recuperación de contraseña (UT1015, fase 2)
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
