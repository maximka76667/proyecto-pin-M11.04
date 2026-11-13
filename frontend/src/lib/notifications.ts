import { Platform } from 'react-native';

import { api } from '@/lib/api';

// Notificaciones de tareas (UT1019)

export type NotificationType =
  | 'task_assigned'
  | 'task_due_soon'
  | 'swap_requested'
  | 'swap_accepted'
  | 'swap_rejected';

// Cada aviso de GET /notifications
export type AppNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  // Lo que se abre al tocar el aviso: la tarea o la petición de intercambio, según el tipo
  reference_id: string | null;
  is_read: boolean;
  created_at: string;
};

// Donde el perfil guarda el interruptor «Recordatorios de tareas» (UT1020)
export const CHORE_REMINDERS_KEY = 'room8_chore_reminders';

// El interruptor solo se guarda en el navegador; en el móvil los recordatorios están encendidos
export function choreRemindersEnabled() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      const saved = window.localStorage.getItem(CHORE_REMINDERS_KEY);
      if (saved !== null) return saved === 'true';
    } catch {
      // Almacenamiento bloqueado: se quedan encendidos
    }
  }
  return true;
}

// Con los recordatorios apagados, el backend ni crea ni devuelve los avisos de vencimiento
function query(apartmentId: string, reminders: boolean) {
  return `apartment_id=${encodeURIComponent(apartmentId)}${reminders ? '' : '&reminders=false'}`;
}

export function fetchNotifications(apartmentId: string, reminders = choreRemindersEnabled()) {
  return api('GET', `/notifications?${query(apartmentId, reminders)}`) as Promise<AppNotification[]>;
}

export async function fetchUnreadCount(apartmentId: string, reminders = choreRemindersEnabled()) {
  const { count } = (await api(
    'GET',
    `/notifications/unread-count?${query(apartmentId, reminders)}`,
  )) as { count: number };
  return count;
}

export function markNotificationRead(id: string) {
  return api('PATCH', `/notifications/${encodeURIComponent(id)}/read`) as Promise<AppNotification>;
}
