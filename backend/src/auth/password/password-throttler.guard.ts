import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Clave con la que se cuentan los intentos del limitador "account" de auth.module.ts:
//  - con sesión (cambiar la contraseña), por usuario: quien robe una sesión no se libra
//    del límite cambiando de IP;
//  - sin sesión (recuperación), por el email del cuerpo. Es lo que evita que el abuso de una
//    cuenta deje a las demás sin recuperación, que es lo que pasaría contando por IP detrás
//    de un proxy, donde todos los usuarios comparten la misma;
//  - si no hay ninguna de las dos cosas, por IP.
// El limitador "sweep" tiene su propio getTracker por IP y hace de red de seguridad.
@Injectable()
export class PasswordThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    if (req.userId) return `user:${String(req.userId)}`;

    const email = (req.body as { email?: unknown } | undefined)?.email;
    if (typeof email === 'string' && email.trim()) {
      return `email:${email.trim().toLowerCase()}`;
    }
    return `ip:${String(req.ip)}`;
  }
}
