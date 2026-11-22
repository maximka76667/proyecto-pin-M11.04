// En la web no hay notificaciones push (los avisos se ven en el panel de la app). Metro usa este
// archivo en lugar de push.ts al compilar para web, así que expo-notifications ni siquiera entra
// en esa versión. Mismas funciones que push.ts, sin hacer nada
export async function registrarPush() {}

export function quitarPush() {}

export function escucharToques() {
  return () => undefined;
}
