import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { api } from '@/lib/api';
import { destination, type NotificationType } from '@/lib/notifications';

// Notificaciones push: los mismos avisos del panel (UT1018 y UT1019) llegan al móvil aunque la
// app esté cerrada. El backend las envía por la API de push de Expo al token que registra aquí.
//
// Dónde funcionan:
//   - Expo Go en iPhone y una app instalada (build de EAS) en Android o iPhone: sí.
//   - Expo Go en Android: no (Expo lo quitó en el SDK 53); hace falta un build de desarrollo.
//   - Web: no; Metro usa push.web.ts, que no hace nada, y los avisos se quedan en el panel.
const EXPO_GO_ANDROID =
  Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Con la app abierta, la notificación también se enseña arriba, como con la app cerrada
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// El token que se ha registrado en esta sesión, para quitarlo al cerrarla
let tokenRegistrado: string | null = null;
// Se intenta una vez por sesión: si el usuario no da permiso, no se le vuelve a pedir en cada
// pantalla
let intentado = false;

// Se llama con la sesión ya comprobada, al abrir la app o justo después de iniciar sesión.
// Nunca falla: sin permiso, sin conexión o en un simulador, la app sigue igual con los avisos
// dentro de ella
export async function registrarPush() {
  if (EXPO_GO_ANDROID || !Device.isDevice || intentado) return;
  intentado = true;
  try {
    // En Android 13 o superior no sale la petición de permiso hasta que existe un canal
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Avisos',
        importance: AndroidImportance.HIGH,
      });
    }

    let { granted } = await Notifications.getPermissionsAsync();
    if (!granted) ({ granted } = await Notifications.requestPermissionsAsync());
    if (!granted) {
      console.warn('Notificaciones push desactivadas: el usuario no ha dado permiso');
      return;
    }

    // Lo escribe `eas init` en app.json (extra.eas.projectId)
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) {
      console.warn('Notificaciones push desactivadas: falta el projectId de EAS en app.json');
      return;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api('POST', '/push/tokens', { token });
    tokenRegistrado = token;
  } catch (error) {
    // Sin push: los avisos siguen llegando al panel de la app
    const motivo = error instanceof Error ? error.message : String(error);
    console.warn(`No se han podido activar las notificaciones push: ${motivo}`);
  }
}

// Al cerrar sesión: este móvil deja de recibir las notificaciones de la cuenta. Se llama antes
// de borrar el token de sesión, porque api() lo lee al construir la petición. No se espera la
// respuesta y se ignora cualquier error, igual que con POST /auth/logout
export function quitarPush() {
  const token = tokenRegistrado;
  tokenRegistrado = null;
  intentado = false;
  if (!token) return;
  void api('DELETE', '/push/tokens', { token }).catch(() => undefined);
}

// Al tocar una notificación se abre la misma pantalla que al tocar el aviso en el panel. Cubre
// la app abierta o en segundo plano (listener) y la app cerrada, que arranca por el toque
// (última respuesta). Devuelve la función que deja de escuchar
export function escucharToques() {
  const abrir = (respuesta: Notifications.NotificationResponse) => {
    const data = respuesta.notification.request.content.data as
      { type?: unknown; reference_id?: unknown } | undefined;
    if (typeof data?.type !== 'string') return;
    const destino = destination({
      type: data.type as NotificationType,
      reference_id: typeof data.reference_id === 'string' ? data.reference_id : null,
    });
    if (destino) router.push(destino);
  };

  void Notifications.getLastNotificationResponseAsync()
    .then((respuesta) => {
      if (!respuesta) return;
      abrir(respuesta);
      // Para no volver a abrirla la próxima vez que se monte la app
      return Notifications.clearLastNotificationResponseAsync();
    })
    .catch(() => undefined);

  const suscripcion = Notifications.addNotificationResponseReceivedListener(abrir);
  return () => suscripcion.remove();
}
