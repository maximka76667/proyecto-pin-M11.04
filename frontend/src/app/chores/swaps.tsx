import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Snackbar } from 'react-native-paper';
import { Palette, Radius } from '@/constants/onboarding';
import { APARTMENT_ID, USER_ID } from '@/constants/dev-session';
import { api, errorMessage } from '@/lib/api';

type SwapAssignment = {
  id: string;
  due_date: string;
  due_time: string | null;
  user: { id: string; full_name: string };
  task: { id: string; title: string };
};

type SwapRequest = {
  id: string;
  status: 'pending' | 'completed';
  from_user_id: string;
  to_user_id: string;
  from_user: { id: string; full_name: string };
  to_user: { id: string; full_name: string };
  from_assignment: SwapAssignment;
  to_assignment: SwapAssignment;
};

function slot(assignment: SwapAssignment) {
  const day = new Date(`${assignment.due_date.slice(0, 10)}T00:00:00`).toLocaleDateString(
    'es-ES',
    { month: 'short', day: 'numeric' },
  );
  return `${day}${assignment.due_time ? ` · ${assignment.due_time}` : ''}`;
}

export default function SwapsInboxScreen() {
  const { noticeText } = useLocalSearchParams<{ noticeText?: string }>();
  const [requests, setRequests] = useState<SwapRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actingId, setActingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = (await api(
        'GET',
        `/tasks/swap-requests?apartment_id=${encodeURIComponent(APARTMENT_ID)}`,
      )) as SwapRequest[];
      setRequests(data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const act = async (
    id: string,
    method: 'POST' | 'DELETE',
    suffix: string,
    successMessage: string,
  ) => {
    setActingId(id);
    setError('');
    try {
      await api(method, `/tasks/swap-requests/${encodeURIComponent(id)}${suffix}`);
      setMessage(successMessage);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setActingId(null);
    }
  };

  const received = requests.filter(
    (r) => r.status === 'pending' && r.to_user_id === USER_ID,
  );
  const sentPending = requests.filter(
    (r) => r.status === 'pending' && r.from_user_id === USER_ID,
  );
  const sentCompleted = requests.filter(
    (r) => r.status === 'completed' && r.from_user_id === USER_ID,
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.topBar}>
          <Text style={styles.title}>Intercambios de tareas</Text>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Cerrar">
            <MaterialCommunityIcons name="close" size={23} color={Palette.text} />
          </Pressable>
        </View>

        {loading ? <ActivityIndicator color={Palette.primary} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.sectionLabel}>PETICIONES RECIBIDAS</Text>
        {!loading && received.length === 0 ? (
          <Text style={styles.muted}>No tienes peticiones de intercambio pendientes.</Text>
        ) : null}
        {received.map((request) => (
          <View key={request.id} style={styles.card}>
            <Text style={styles.cardText}>
              <Text style={styles.strong}>{request.from_user.full_name}</Text> te ofrece{' '}
              <Text style={styles.strong}>{request.from_assignment.task.title}</Text> (
              {slot(request.from_assignment)}) a cambio de tu{' '}
              <Text style={styles.strong}>{request.to_assignment.task.title}</Text> (
              {slot(request.to_assignment)}).
            </Text>
            <View style={styles.actions}>
              <Pressable
                disabled={actingId !== null}
                onPress={() =>
                  void act(
                    request.id,
                    'POST',
                    '/accept',
                    'Intercambio realizado con éxito',
                  )
                }
                style={[styles.actionButton, styles.accept]}>
                {actingId === request.id ? (
                  <ActivityIndicator color={Palette.onPrimary} />
                ) : (
                  <Text style={styles.acceptText}>Aceptar</Text>
                )}
              </Pressable>
              <Pressable
                disabled={actingId !== null}
                onPress={() =>
                  void act(
                    request.id,
                    'POST',
                    '/reject',
                    'Solicitud de intercambio rechazada',
                  )
                }
                style={[styles.actionButton, styles.reject]}>
                <Text style={styles.rejectText}>Rechazar</Text>
              </Pressable>
            </View>
          </View>
        ))}

        <Text style={styles.sectionLabel}>PETICIONES ENVIADAS</Text>
        {!loading && sentPending.length === 0 && sentCompleted.length === 0 ? (
          <Text style={styles.muted}>No has enviado ninguna petición.</Text>
        ) : null}
        {sentPending.map((request) => (
          <View key={request.id} style={styles.card}>
            <Text style={styles.cardText}>
              Ofreces <Text style={styles.strong}>{request.from_assignment.task.title}</Text> (
              {slot(request.from_assignment)}) a cambio de{' '}
              <Text style={styles.strong}>{request.to_assignment.task.title}</Text> de{' '}
              <Text style={styles.strong}>{request.to_user.full_name}</Text>.
            </Text>
            <View style={styles.actions}>
              <Pressable
                disabled={actingId !== null}
                onPress={() =>
                  void act(
                    request.id,
                    'DELETE',
                    '',
                    'Solicitud de intercambio cancelada',
                  )
                }
                style={[styles.actionButton, styles.reject]}>
                {actingId === request.id ? (
                  <ActivityIndicator color={Palette.error} />
                ) : (
                  <Text style={styles.rejectText}>Cancelar</Text>
                )}
              </Pressable>
            </View>
          </View>
        ))}
        {/* Aviso pasivo al emisor de que su petición fue aceptada (PA-1010.02) */}
        {sentCompleted.map((request) => (
          <View key={request.id} style={[styles.card, styles.cardDone]}>
            <View style={styles.doneHeader}>
              <MaterialCommunityIcons name="check-circle" size={18} color={Palette.primary} />
              <Text style={styles.doneLabel}>Aceptada — intercambio realizado</Text>
            </View>
            <Text style={styles.cardText}>
              <Text style={styles.strong}>{request.to_user.full_name}</Text> aceptó cambiar su{' '}
              <Text style={styles.strong}>{request.to_assignment.task.title}</Text> por tu{' '}
              <Text style={styles.strong}>{request.from_assignment.task.title}</Text>.
            </Text>
          </View>
        ))}
      </ScrollView>
      <Snackbar
        visible={Boolean(message) || Boolean(noticeText)}
        onDismiss={() => {
          setMessage('');
          if (noticeText) router.setParams({ noticeText: undefined });
        }}
        duration={4000}
        style={styles.snackbar}>
        {message || noticeText || ''}
      </Snackbar>
    </SafeAreaView>
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
  sectionLabel: {
    marginTop: 10,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    color: Palette.primary,
  },
  error: { fontSize: 14, textAlign: 'center', color: Palette.error },
  muted: { fontSize: 14, color: Palette.textSecondary },
  card: {
    gap: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.input,
    backgroundColor: Palette.surface,
  },
  cardDone: { backgroundColor: Palette.mint },
  doneHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  doneLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, color: Palette.primary },
  cardText: { fontSize: 14, lineHeight: 20, color: Palette.text },
  strong: { fontWeight: '800' },
  snackbar: { backgroundColor: Palette.primary },
  actions: { flexDirection: 'row', gap: 10 },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: Radius.button,
    borderWidth: 1,
  },
  accept: { backgroundColor: Palette.primary, borderColor: Palette.primary },
  acceptText: { fontSize: 14, fontWeight: '800', color: Palette.onPrimary },
  reject: { backgroundColor: Palette.surface, borderColor: Palette.error },
  rejectText: { fontSize: 14, fontWeight: '800', color: Palette.error },
});
