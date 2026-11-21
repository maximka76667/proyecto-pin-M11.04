import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Snackbar } from 'react-native-paper';

import { APARTMENT_ID } from '@/constants/dev-session';
import { Palette, Radius } from '@/constants/onboarding';
import { api, errorMessage } from '@/lib/api';

// GET /tasks/verifications: tareas de otros compañeros que este usuario tiene que revisar
type Review = {
  id: string;
  due_date: string;
  due_time: string | null;
  verification_deadline: string | null;
  user: { id: string; full_name: string };
  task: { id: string; title: string; description: string | null; points: number };
};

const MIN_REASON = 3;

function formatDeadline(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return `Responde antes del ${date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} a las ${date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
}

export default function VerifyChoresScreen() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  // La tarea que se está rechazando (muestra el campo del motivo) y la que se está enviando
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setReviews(
        (await api(
          'GET',
          `/tasks/verifications?apartment_id=${encodeURIComponent(APARTMENT_ID)}`,
        )) as Review[],
      );
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

  const resolve = async (review: Review, action: 'verify' | 'reject') => {
    if (action === 'reject' && reason.trim().length < MIN_REASON) {
      setError('Escribe el motivo del rechazo (mínimo 3 caracteres).');
      return;
    }
    setBusyId(review.id);
    setError('');
    try {
      await api(
        'POST',
        `/tasks/assignments/${encodeURIComponent(review.id)}/${action}`,
        action === 'reject' ? { reason: reason.trim() } : undefined,
      );
      setReviews((current) => current.filter(({ id }) => id !== review.id));
      setMessage(
        action === 'verify'
          ? `Tarea confirmada: ${review.user.full_name} gana ${review.task.points} puntos.`
          : 'Tarea rechazada. Le hemos enviado tu motivo.',
      );
      setRejectingId(null);
      setReason('');
    } catch (e) {
      setError(errorMessage(e));
      // Si ya no es tuya (p. ej. caducó y pasó a otro compañero), se quita de la lista
      void load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} accessibilityLabel="Volver" style={styles.back}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={Palette.text} />
          </Pressable>
          <View>
            <Text style={styles.eyebrow}>VERIFICACIÓN</Text>
            <Text style={styles.title}>Tareas por revisar</Text>
          </View>
        </View>

        {loading ? <ActivityIndicator color={Palette.primary} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!loading && reviews.length === 0 ? (
          <Text style={styles.empty}>No tienes ninguna tarea pendiente de verificar.</Text>
        ) : null}

        {reviews.map((review) => {
          const rejecting = rejectingId === review.id;
          const busy = busyId === review.id;
          return (
            <View key={review.id} style={styles.card}>
              <Text style={styles.taskTitle}>{review.task.title}</Text>
              <Text style={styles.meta}>
                Hecha por {review.user.full_name} · {review.task.points} puntos
              </Text>
              {review.task.description ? <Text style={styles.description}>{review.task.description}</Text> : null}
              <Text style={styles.deadline}>{formatDeadline(review.verification_deadline)}</Text>

              {rejecting ? (
                <>
                  <TextInput
                    style={styles.reasonInput}
                    value={reason}
                    onChangeText={setReason}
                    placeholder="¿Qué falta o qué está mal? (obligatorio)"
                    multiline
                    maxLength={300}
                    accessibilityLabel="Motivo del rechazo"
                  />
                  <View style={styles.row}>
                    <Pressable
                      disabled={busy}
                      onPress={() => {
                        setRejectingId(null);
                        setReason('');
                        setError('');
                      }}
                      style={styles.secondaryButton}>
                      <Text style={styles.secondaryText}>Cancelar</Text>
                    </Pressable>
                    <Pressable
                      disabled={busy}
                      onPress={() => void resolve(review, 'reject')}
                      style={[styles.rejectButton, styles.flex]}>
                      {busy ? <ActivityIndicator color={Palette.onPrimary} /> : <Text style={styles.buttonText}>Enviar rechazo</Text>}
                    </Pressable>
                  </View>
                </>
              ) : (
                <View style={styles.row}>
                  <Pressable
                    disabled={busy}
                    onPress={() => {
                      setRejectingId(review.id);
                      setReason('');
                      setError('');
                    }}
                    style={[styles.secondaryButton, styles.flex]}>
                    <MaterialCommunityIcons name="close" size={18} color={Palette.error} />
                    <Text style={[styles.secondaryText, { color: Palette.error }]}>Rechazar</Text>
                  </Pressable>
                  <Pressable
                    disabled={busy}
                    onPress={() => void resolve(review, 'verify')}
                    style={[styles.approveButton, styles.flex]}>
                    {busy ? (
                      <ActivityIndicator color={Palette.onPrimary} />
                    ) : (
                      <>
                        <MaterialCommunityIcons name="check" size={18} color={Palette.onPrimary} />
                        <Text style={styles.buttonText}>Aprobar y dar puntos</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
      <Snackbar visible={!!message} onDismiss={() => setMessage('')} duration={4000}>
        {message}
      </Snackbar>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Palette.background },
  container: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32, gap: 14 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: Palette.surface, borderWidth: 1, borderColor: Palette.border },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: Palette.primary },
  title: { marginTop: 2, fontSize: 28, fontWeight: '800', color: Palette.text },
  error: { fontSize: 13, color: Palette.error },
  empty: { fontSize: 14, color: Palette.textSecondary, textAlign: 'center', paddingVertical: 24 },
  card: { gap: 8, padding: 16, borderRadius: Radius.input, borderWidth: 1, borderColor: Palette.border, backgroundColor: Palette.surface },
  taskTitle: { fontSize: 17, fontWeight: '800', color: Palette.text },
  meta: { fontSize: 13, color: Palette.textSecondary },
  description: { fontSize: 14, color: Palette.text },
  deadline: { fontSize: 12, color: Palette.textSecondary },
  row: { flexDirection: 'row', gap: 10, marginTop: 6 },
  flex: { flex: 1 },
  secondaryButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 14, borderRadius: Radius.input, borderWidth: 1, borderColor: Palette.border, backgroundColor: Palette.background },
  secondaryText: { fontSize: 14, fontWeight: '700', color: Palette.text },
  approveButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 14, borderRadius: Radius.input, backgroundColor: Palette.primary },
  rejectButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: Radius.input, backgroundColor: Palette.error },
  buttonText: { fontSize: 14, fontWeight: '800', color: Palette.onPrimary },
  reasonInput: { minHeight: 70, padding: 10, textAlignVertical: 'top', fontSize: 14, color: Palette.text, borderRadius: 10, borderWidth: 1, borderColor: Palette.border, backgroundColor: Palette.background },
});
