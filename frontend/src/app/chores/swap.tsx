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
import { Palette, Radius } from '@/constants/onboarding';
import { APARTMENT_ID } from '@/constants/dev-session';
import { api, errorMessage } from '@/lib/api';

type Candidate = {
  id: string;
  user_id: string;
  due_date: string;
  due_time: string | null;
  user: { id: string; full_name: string };
  task: { id: string; title: string };
};

function formatDay(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('es-ES', {
    month: 'short',
    day: 'numeric',
  });
}

export default function RequestSwapScreen() {
  const { assignmentId, taskId } = useLocalSearchParams<{
    assignmentId?: string;
    taskId?: string;
  }>();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  // sin assignmentId no hay nada que cargar: el error se muestra desde el principio
  const [loading, setLoading] = useState(Boolean(assignmentId));
  const [error, setError] = useState(assignmentId ? '' : 'No se encontró tu tarea.');
  const [sendingId, setSendingId] = useState<string | null>(null);

  const loadCandidates = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = (await api(
        'GET',
        `/tasks/swap-requests/candidates?apartment_id=${encodeURIComponent(APARTMENT_ID)}`,
      )) as Candidate[];
      setCandidates(data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!assignmentId) return;
      void loadCandidates();
    }, [assignmentId, loadCandidates]),
  );

  const requestSwap = async (candidate: Candidate) => {
    if (!assignmentId) return;

    setSendingId(candidate.id);
    setError('');
    try {
      await api('POST', '/tasks/swap-requests', {
        from_assignment_id: assignmentId,
        to_assignment_id: candidate.id,
      });
      // PA-1010.01: confirmación nombrando al compañero, en la bandeja de intercambios.
      router.replace({
        pathname: '/chores/swaps',
        params: {
          noticeText: `Solicitud de intercambio enviada a ${candidate.user.full_name}`,
        },
      });
    } catch (e) {
      // PA-1010.04: se muestra el aviso y se vuelve a la pantalla anterior (el detalle de la tarea).
      if (taskId) {
        router.replace({
          pathname: '/chores/details',
          params: { taskId, swapNotice: errorMessage(e) },
        });
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setSendingId(null);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.topBar}>
          <Text style={styles.title}>Solicitar un cambio</Text>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Cerrar">
            <MaterialCommunityIcons name="close" size={23} color={Palette.text} />
          </Pressable>
        </View>

        <Text style={styles.description}>
          Elige la tarea de un compañero por la que quieres intercambiar la tuya. Se enviará una
          petición y, si la acepta, se cambiarán los responsables.
        </Text>

        {loading ? <ActivityIndicator color={Palette.primary} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {!loading && candidates.length === 0 && !error ? (
          <Text style={styles.muted}>
            No hay tareas de compañeros disponibles para intercambiar ahora mismo.
          </Text>
        ) : null}

        <View style={styles.list}>
          {candidates.map((candidate) => (
            <Pressable
              key={candidate.id}
              disabled={sendingId !== null}
              onPress={() => void requestSwap(candidate)}
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
              <View style={styles.cardIcon}>
                <MaterialCommunityIcons name="swap-horizontal" size={20} color={Palette.primary} />
              </View>
              <View style={styles.cardCopy}>
                <Text style={styles.cardTitle}>{candidate.task.title}</Text>
                <Text style={styles.cardMeta}>
                  {candidate.user.full_name} · {formatDay(candidate.due_date)}
                  {candidate.due_time ? ` · ${candidate.due_time}` : ''}
                </Text>
              </View>
              {sendingId === candidate.id ? (
                <ActivityIndicator color={Palette.primary} />
              ) : (
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={22}
                  color={Palette.textSecondary}
                />
              )}
            </Pressable>
          ))}
        </View>
      </ScrollView>
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
    gap: 16,
  },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '800', color: Palette.text },
  description: { fontSize: 14, color: Palette.textSecondary },
  error: { fontSize: 14, textAlign: 'center', color: Palette.error },
  muted: { fontSize: 14, color: Palette.textSecondary, textAlign: 'center' },
  list: { gap: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.input,
    backgroundColor: Palette.surface,
  },
  cardIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: Palette.mint,
  },
  cardCopy: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: Palette.text },
  cardMeta: { fontSize: 12, color: Palette.textSecondary },
  pressed: { opacity: 0.75 },
});
