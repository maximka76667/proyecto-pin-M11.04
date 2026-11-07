import { createParamDecorator, UnauthorizedException } from '@nestjs/common';
import { USER_ID } from './dev-session';

export const SESSION_EXPIRED = 'Tu sesión ha caducado. Vuelve a iniciar sesión';

// Devuelve el usuario verificado por AuthMiddleware. Sin token, en los tests o con
// ALLOW_DEV_SESSION=true usa el usuario de desarrollo, pero nunca en producción y nunca
// si llegó un token inválido: ese caso es una sesión caducada o revocada (p. ej. tras
// cambiar la contraseña en otro dispositivo) y tiene que dar 401 (PA-1015.02).
export const CurrentUser = createParamDecorator((_data, context): string => {
  const request = context
    .switchToHttp()
    .getRequest<{ userId?: string; authError?: boolean }>();
  if (request.userId) return request.userId;
  if (request.authError) throw new UnauthorizedException(SESSION_EXPIRED);

  const devSessionAllowed =
    process.env.NODE_ENV !== 'production' &&
    (process.env.NODE_ENV === 'test' || process.env.ALLOW_DEV_SESSION === 'true');
  if (devSessionAllowed) return USER_ID;
  throw new UnauthorizedException('Necesitas iniciar sesión');
});
