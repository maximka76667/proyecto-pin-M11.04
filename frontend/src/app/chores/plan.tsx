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
  View,
} from 'react-native';

import { APARTMENT_ID } from '@/constants/dev-session';
import { Palette, Radius } from '@/constants/onboarding';
import { api, errorMessage } from '@/lib/api';

// GET /tasks/plan/preview: propuesta de reparto de la semana siguiente
type PlannedItem = {
  task_id: string;
  task_title: string;
  user_id: string;
  user_name: string;
  date: string;
  time: string;
  points: number;
};

type WeekPlan = {
  week: { from: string; to: string };
  assignments: PlannedItem[];
  unassigned: { task_id: string; task_title: string; days: string[]; reason: string }[];
  points: { user_id: string; user_name: string; before: number; after: number }[];
};

// "lunes, 16 de noviembre"
function dayLabel(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export default function PlanScreen() {
  const [plan, setPlan] = useState<WeekPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setError('');
      void (api('GET', `/tasks/plan/preview?apartment_id=${encodeURIComponent(APARTMENT_ID)}`) as Promise<WeekPlan>)
        .then((result) => {
          if (active) setPlan(result);
        })
        .catch((e) => {
          if (active) setError(errorMessage(e));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, []),
  );

  const apply = async () => {
    setApplying(true);
    setError('');
    try {
      await api('POST', '/tasks/plan/apply', { apartment_id: APARTMENT_ID });
      router.dismissTo('/chores');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setApplying(false);
    }
  };

  const byDate = new Map<string, PlannedItem[]>();
  for (const item of plan?.assignments ?? []) {
    byDate.set(item.date, [...(byDate.get(item.date) ?? []), item]);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.topBar}>
          <Text style={styles.title}>Reparto de la semana</Text>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/chores'))}
            hitSlop={12}
            accessibilityLabel="Cerrar">
            <MaterialCommunityIcons name="close" size={23} color={Palette.text} />
          </Pressable>
        </View>

        {plan ? (
          <Text style={styles.subtitle}>
            Del {dayLabel(plan.week.from)} al {dayLabel(plan.week.to)}. Se reparte según los
            puntos de cada persona y su disponibilidad: quien lleva menos puntos recibe más.
          </Text>
        ) : null}

        {loading ? <ActivityIndicator color={Palette.primary} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {!loading && plan ? (
          <>
            {plan.assignments.length === 0 && plan.unassigned.length === 0 ? (
              <Text style={styles.muted}>No hay tareas pendientes de repartir esta semana.</Text>
            ) : null}

            {[...byDate.entries()].map(([date, items]) => (
              <View key={date} style={styles.section}>
                <Text style={styles.sectionTitle}>{dayLabel(date)}</Text>
                {items.map((item) => (
                  <View key={`${item.task_id}-${date}-${item.time}`} style={styles.row}>
                    <Text style={styles.time}>{item.time}</Text>
                    <View style={styles.rowText}>
                      <Text style={styles.name}>{item.task_title}</Text>
                      <Text style={styles.person}>{item.user_name}</Text>
                    </View>
                    <Text style={styles.points}>+{item.points} pts</Text>
                  </View>
                ))}
              </View>
            ))}

            {plan.unassigned.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Sin asignar</Text>
                {plan.unassigned.map((item) => (
                  <View key={`${item.task_id}-${item.days[0]}`} style={styles.row}>
                    <MaterialCommunityIcons name="alert-circle-outline" size={20} color={Palette.error} />
                    <View style={styles.rowText}>
                      <Text style={styles.name}>{item.task_title}</Text>
                      <Text style={styles.person}>{item.reason}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {plan.assignments.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Puntos tras el reparto</Text>
                {plan.points.map((person) => (
                  <View key={person.user_id} style={styles.row}>
                    <Text style={[styles.name, styles.rowText]}>{person.user_name}</Text>
                    <Text style={styles.person}>
                      {person.before} → {person.after} pts
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {plan.assignments.length > 0 ? (
              <Pressable
                onPress={() => void apply()}
                disabled={applying}
                style={[styles.primaryButton, applying && styles.disabled]}>
                <Text style={styles.primaryButtonText}>
                  {applying ? 'Aplicando...' : `Aplicar reparto (${plan.assignments.length} tareas)`}
                </Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
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
  title: { fontSize: 22, fontWeight: '800', color: Palette.text },
  subtitle: { fontSize: 14, lineHeight: 20, color: Palette.textSecondary },
  section: { gap: 10 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: Palette.text,
    textTransform: 'capitalize',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.input,
    backgroundColor: Palette.surface,
  },
  time: { width: 48, fontSize: 14, fontWeight: '800', color: Palette.primary },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '800', color: Palette.text },
  person: { fontSize: 12, color: Palette.textSecondary },
  points: { fontSize: 14, fontWeight: '800', color: Palette.primary },
  primaryButton: {
    alignItems: 'center',
    paddingVertical: 15,
    borderRadius: Radius.button,
    backgroundColor: Palette.primary,
  },
  primaryButtonText: { fontSize: 15, fontWeight: '800', color: Palette.onPrimary },
  disabled: { opacity: 0.6 },
  error: { fontSize: 14, textAlign: 'center', color: Palette.error },
  muted: { fontSize: 14, textAlign: 'center', color: Palette.textSecondary },
});
