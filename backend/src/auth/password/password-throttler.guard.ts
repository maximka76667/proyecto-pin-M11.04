import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Cuenta los intentos por usuario cuando hay sesión (cambiar la contraseña) y por IP cuando
// no (recuperarla). Con sesión, quien la haya robado no puede saltarse el límite cambiando de IP
@Injectable()
export class PasswordThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    return req.userId ? `user:${req.userId}` : `ip:${req.ip}`;
  }
}
