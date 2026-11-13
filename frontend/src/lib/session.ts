import { router, type Href } from 'expo-router';

import { clearCurrentSessionIds } from '@/constants/dev-session';
import { api, setAuthToken } from '@/lib/api';

// Cierre de sesión (PA-1015.05 y PA-1015.06).
// 1. Avisa al backend para que anule la sesión allí y el token deje de valer aunque alguien lo
//    hubiera copiado. No se espera la respuesta y se ignora cualquier error: con la sesión ya
//    caducada o sin conexión el cierre funciona igual y no muestra nada.
// 2. Borra el token del dispositivo (SecureStore en el móvil) y los ids de la sesión.
// 3. Vacía la pila de pantallas para que "atrás" no vuelva a ninguna pantalla de la sesión.
export function logout() {
  try {
    // api() lee el token al construir la petición, así que sale antes de borrarlo
    void api('POST', '/auth/logout').catch(() => undefined);
    setAuthToken(null);
    clearCurrentSessionIds();
  } catch {
    // Nada debe impedir salir
  } finally {
    if (router.canDismiss()) router.dismissAll();
    router.replace('/auth' as Href);
  }
}
