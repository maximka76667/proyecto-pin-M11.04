import { createParamDecorator } from '@nestjs/common';

// Mientras no haya autenticación, todas las peticiones actúan como este usuario.
// Cuando exista login, este decorador leerá el usuario verificado de la petición
// (request.user) y ningún controlador ni servicio tendrá que cambiar.
const USUARIO_DE_PRUEBA_ID = '22222222-2222-2222-2222-222222222222';

export const CurrentUser = createParamDecorator((): string => USUARIO_DE_PRUEBA_ID);
