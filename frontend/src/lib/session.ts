import { router, type Href } from 'expo-router';
import { Platform } from 'react-native';

import { setAuthToken } from '@/lib/api';

// Ids de la sesión que guarda constants/dev-session.ts en la web
const STORED_SESSION_KEYS = ['room8_user_id', 'room8_apartment_id'];

// Cierre de sesión (PA-1015.05 y PA-1015.06). Solo borra datos locales y no llama a la API,
// así que funciona igual aunque el token ya haya caducado y nunca muestra un error.
// Siempre termina en el login, pase lo que pase al borrar.
export function logout() {
  try {
    setAuthToken(null);
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      for (const key of STORED_SESSION_KEYS) window.localStorage.removeItem(key);
    }
  } catch {
    // Un almacenamiento bloqueado (p. ej. modo privado) no debe impedir salir
  } finally {
    // Vacía la pila para que "atrás" no vuelva a una pantalla de la sesión
    if (router.canDismiss()) router.dismissAll();
    router.replace('/auth' as Href);
  }
}
