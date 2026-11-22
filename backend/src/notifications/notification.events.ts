import { NotificationType } from '@prisma/client';

// Evento que anuncia NotificationsService después de guardar avisos nuevos (patrón Observer, en
// cadena: tareas y gastos → avisos → push). El observador es PushListener, que los manda al
// móvil. NotificationsService no sabe que existe.
//
// Se emite con emit() y no con emitAsync(): la petición no espera a la API de push de Expo, y
// un envío lento o caído nunca retrasa la acción que creó el aviso.
//
// Los recordatorios de vencimiento (task_due_soon) no se anuncian: se crean al abrir la lista
// de avisos, cuando el usuario ya está dentro de la app.
export const AVISOS_CREADOS = 'avisos.creados';

export type AvisoCreado = {
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  reference_id?: string | null;
};

export class AvisosCreados {
  constructor(readonly avisos: AvisoCreado[]) {}
}
