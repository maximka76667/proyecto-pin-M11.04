import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Snackbar } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { APARTMENT_ID } from '@/constants/dev-session';
import { Palette, Radius } from '@/constants/onboarding';
import { ApiError, errorMessage } from '@/lib/api';
import {
  fetchNotifications,
  markNotificationRead,
  type AppNotification,
  type NotificationType,
} from '@/lib/notifications';

// Notificaciones de tareas (UT1019): asignaciones nuevas, solicitudes de intercambio y sus
// respuestas, y tareas que vencen pronto. Se llega desde «Mi cuenta»

type Look = {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  tint: string;
  color: string;
};

const looks: Record<NotificationType, Look> = {
  task_assigned: { icon: 'clipboard-account-outline', tint: Palette.lavender, color: Palette.text },
  task_due_soon: { icon: 'clock-alert-outline', tint: '#FDF1DB', color: '#D97706' },
  swap_requested: { icon: 'swap-horizontal', tint: Palette.peach, color: Palette.text },
  swap_accepted: { icon: 'check-circle-outline', tint: Palette.mint, color: Palette.primary },
  swap_rejected: { icon: 'close-circle-outline', tint: '#FBE9E7', color: Palette.error },
};
// Por si el backend añade un tipo que esta versión de la app todavía no conoce
const defaultLook: Look = { icon: 'bell-outline', tint: Palette.segment, color: Palette.text };

// A dónde lleva cada aviso al tocarlo. Los de intercambio abren la pantalla de intercambios,
// donde se acepta o se rechaza; el de rechazo abre la tarea que se ofrecía, porque la petición
// ya no existe. Los de tareas abren el detalle de la tarea
function destination(item: AppNotification): Href | null {
  if (item.type === 'swap_requested' || item.type === 'swap_accepted') return '/chores/swaps';
  if (!item.reference_id) return null;
  return { pathname: '/chores/details', params: { taskId: item.reference_id } };
}

// "hace 5 min", "hace 2 h", "ayer"… y, a partir de una semana, la fecha
function timeAgo(createdAt: string, now: number) {
  const created = new Date(createdAt);
  const minutes = Math.floor((now - created.getTime()) / 60_000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days} días`;
  return created.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function unreadSummary(unread: number) {
  if (unread === 0) return 'Estás al día';
  return unread === 1 ? '1 aviso sin leer' : `${unread} avisos sin leer`;
}

export default function NotificationsScreen() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  // Momento de la última carga: con él se calcula el «hace 5 min» de cada aviso
  const [loadedAt, setLoadedAt] = useState(0);

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await fetchNotifications(APARTMENT_ID);
      setItems(data);
      setLoadedAt(Date.now());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Se vuelve a cargar al volver de la tarea o del intercambio que abrió un aviso
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const retry = () => {
    setLoading(true);
    void load();
  };

  const setRead = (id: string, isRead: boolean) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, is_read: isRead } : item)),
    );
  };

  // El aviso pasa a leído al momento, sin esperar la respuesta del servidor. Si al final no se
  // ha podido guardar, vuelve a salir como no leído
  const markAsRead = async (id: string) => {
    setRead(id, true);
    try {
      await markNotificationRead(id);
    } catch (e) {
      // El aviso ya no existe, p. ej. porque el compañero ha cancelado su solicitud
      if (e instanceof ApiError && e.status === 404) {
        setItems((current) => current.filter((item) => item.id !== id));
        return;
      }
      setRead(id, false);
      setMessage('No se ha podido marcar como leída. Inténtalo de nuevo');
    }
  };

  // Tocar un aviso lo marca como leído y abre aquello de lo que habla
  const open = (item: AppNotification) => {
    if (!item.is_read) void markAsRead(item.id);
    const target = destination(item);
    if (target) router.push(target);
  };

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/profile' as Href);
  };

  const unread = items.filter((item) => !item.is_read).length;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.topBar}>
          <Text style={styles.title} accessibilityRole="header">
            Notificaciones
          </Text>
          <Pressable
            onPress={close}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Cerrar">
            <MaterialCommunityIcons name="close" size={23} color={Palette.text} />
          </Pressable>
        </View>

        {loading ? <ActivityIndicator color={Palette.primary} /> : null}

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.error}>{error}</Text>
            <Pressable
              onPress={retry}
              accessibilityRole="button"
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
              <Text style={styles.retryText}>Reintentar</Text>
            </Pressable>
          </View>
        ) : null}

        {!loading && !error && items.length === 0 ? (
          <View style={styles.empty}>
            <MaterialCommunityIcons name="bell-check-outline" size={32} color={Palette.textSecondary} />
            <Text style={styles.emptyTitle}>No tienes notificaciones</Text>
            <Text style={styles.emptyText}>
              Aquí verás las tareas que te asignen, los intercambios que te pidan y las que estén a
              punto de vencer.
            </Text>
          </View>
        ) : null}

        {items.length > 0 ? (
          <Text style={styles.summary} accessibilityLiveRegion="polite">
            {unreadSummary(unread)}
          </Text>
        ) : null}

        {items.map((item) => (
          <NotificationCard
            key={item.id}
            item={item}
            now={loadedAt}
            onOpen={open}
            onMarkRead={(id) => void markAsRead(id)}
          />
        ))}
      </ScrollView>

      <Snackbar
        visible={Boolean(message)}
        onDismiss={() => setMessage('')}
        duration={4000}
        style={styles.snackbar}>
        {/* Con el color fijado: el del tema se lee mal sobre el verde si el sistema está en oscuro */}
        <Text style={styles.snackbarText}>{message}</Text>
      </Snackbar>
    </SafeAreaView>
  );
}

// Un aviso sin leer se distingue por el borde verde, el punto y el título en negrita; uno leído
// queda atenuado. El botón va fuera de la zona que abre el aviso: son dos acciones distintas
function NotificationCard({
  item,
  now,
  onOpen,
  onMarkRead,
}: {
  item: AppNotification;
  now: number;
  onOpen: (item: AppNotification) => void;
  onMarkRead: (id: string) => void;
}) {
  const look = looks[item.type] ?? defaultLook;

  return (
    <View style={[styles.card, item.is_read ? styles.cardRead : styles.cardUnread]}>
      <Pressable
        onPress={() => onOpen(item)}
        accessibilityRole="button"
        accessibilityLabel={`${item.is_read ? 'Leída' : 'Sin leer'}. ${item.title}. ${item.body}`}
        style={({ pressed }) => [styles.cardMain, pressed && styles.pressed]}>
        <View style={[styles.iconTile, { backgroundColor: look.tint }, item.is_read && styles.dimmed]}>
          <MaterialCommunityIcons name={look.icon} size={20} color={look.color} />
        </View>
        <View style={[styles.cardText, item.is_read && styles.dimmed]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, !item.is_read && styles.cardTitleUnread]} numberOfLines={1}>
              {item.title}
            </Text>
            {!item.is_read ? <View style={styles.dot} /> : null}
          </View>
          <Text style={styles.cardBody}>{item.body}</Text>
          <Text style={styles.cardTime}>{timeAgo(item.created_at, now)}</Text>
        </View>
      </Pressable>

      {!item.is_read ? (
        <Pressable
          onPress={() => onMarkRead(item.id)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.markButton, pressed && styles.pressed]}>
          <MaterialCommunityIcons name="check" size={16} color={Palette.primary} />
          <Text style={styles.markText}>Marcar como leída</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Palette.background },
  container: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
    gap: 12,
  },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '800', color: Palette.text },
  summary: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: Palette.primary,
  },
  errorBox: { alignItems: 'center', gap: 12 },
  error: { fontSize: 14, textAlign: 'center', color: Palette.error },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: Radius.button,
    backgroundColor: Palette.primary,
  },
  retryText: { fontSize: 14, fontWeight: '700', color: Palette.onPrimary },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 48, paddingHorizontal: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: Palette.text },
  emptyText: { fontSize: 14, lineHeight: 20, textAlign: 'center', color: Palette.textSecondary },
  card: { borderWidth: 1, borderRadius: Radius.input, overflow: 'hidden' },
  cardUnread: { borderColor: Palette.primary, backgroundColor: '#FFFFFF' },
  cardRead: { borderColor: Palette.border, backgroundColor: Palette.surface },
  cardMain: { flexDirection: 'row', gap: 12, padding: 16 },
  iconTile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardText: { flex: 1, gap: 4 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: Palette.text },
  cardTitleUnread: { fontWeight: '800' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Palette.primary },
  cardBody: { fontSize: 14, lineHeight: 20, color: Palette.text },
  cardTime: { fontSize: 12, color: Palette.textSecondary },
  dimmed: { opacity: 0.6 },
  markButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Palette.border,
  },
  markText: { fontSize: 13, fontWeight: '700', color: Palette.primary },
  pressed: { opacity: 0.6 },
  snackbar: { backgroundColor: Palette.primary },
  snackbarText: { fontSize: 14, color: Palette.onPrimary },
});
