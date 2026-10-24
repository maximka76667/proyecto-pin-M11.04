import { createParamDecorator } from '@nestjs/common';
import { USER_ID } from './dev-session';

// Mientras no haya autenticación, todas las peticiones actúan como este usuario.
// Cuando exista login, este decorador leerá el usuario verificado de la petición
// (request.user) y ningún controlador ni servicio tendrá que cambiar.
export const CurrentUser = createParamDecorator((): string => USER_ID);
