import { createParamDecorator, UnauthorizedException } from '@nestjs/common';
import { USER_ID } from './dev-session';

// Mientras no haya autenticación, todas las peticiones actúan como este usuario.
// Cuando exista login, este decorador leerá el usuario verificado de la petición
// (request.user) y ningún controlador ni servicio tendrá que cambiar.
export const CurrentUser = createParamDecorator((_data, context): string => {
  const request = context.switchToHttp().getRequest<{ userId?: string }>();
  if (request.userId) return request.userId;
  if (process.env.NODE_ENV === 'test' || process.env.ALLOW_DEV_SESSION === 'true') return USER_ID;
  throw new UnauthorizedException('Necesitas iniciar sesión');
});
