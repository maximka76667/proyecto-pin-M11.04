import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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

import { APARTMENT_ID } from '@/constants/dev-session';
import { Palette, Radius } from '@/constants/onboarding';
import { api, errorMessage } from '@/lib/api';
import { normalizeTime, toMinutes } from '@/lib/availability';

// GET /tasks/plan/preview: propuesta de reparto de la semana siguiente
type PlannedItem = {
  task_id: string;
  task_title: string;
  user_id: string;
  user_name: string;
  date: string;
  time: string;
  duration_minutes: number;
  points: number;
};

type WeekPlan = {
  week: { from: string; to: string };
  assignments: PlannedItem[];
  unassigned: { task_id: string; task_title: string; days: string[]; reason: string }[];
  points: { user_id: string; user_name: string; before: number; after: number }[];
};

// Una fila de la propuesta con la hora tal como se está escribiendo
type EditableItem = PlannedItem & { timeText: string };

// POST /tasks/plan/validate: los problemas de cada asignación, en el mismo orden que se envían
type ValidationResponse = { valid: boolean; items: { index: number; issues: string[] }[] };

const TIME_FORMAT_ERROR = 'Usa el formato HH:mm (por ejemplo 09:30)';

// "lunes, 16 de noviembre"
function dayLabel(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function endTime(item: EditableItem, time: string) {
  const end = toMinutes(time) + item.duration_minutes;
  const hours = String(Math.floor(end / 60)).padStart(2, '0');
  const minutes = String(end % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

// La hora normalizada, o null si no es una hora válida para una tarea ("24:00" no lo es)
function validTime(text: string) {
  const time = normalizeTime(text);
  return time && time !== '24:00' ? time : null;
}

export default function PlanScreen() {
  const [plan, setPlan] = useState<WeekPlan | null>(null);
  const [items, setItems] = useState<EditableItem[]>([]);
  const [validated, setValidated] = useState<{ signature: string; result: ValidationResponse } | null>(null);
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
          if (!active) return;
          setPlan(result);
          setItems(result.assignments.map((item) => ({ ...item, timeText: item.time })));
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

  // Errores de formato que se ven sin preguntar al servidor
  const localErrors = items.map((item) => (validTime(item.timeText) ? null : TIME_FORMAT_ERROR));
  const allFormatsValid = localErrors.every((message) => message === null);

  // Lo que se envía al servidor; cambia cada vez que se edita algo
  const signature = allFormatsValid
    ? JSON.stringify(
        items.map((item) => ({
          task_id: item.task_id,
          user_id: item.user_id,
          date: item.date,
          time: validTime(item.timeText),
        })),
      )
    : null;

  // Valida lo editado en el servidor (solapes con otras tareas, calendarios...) un momento
  // después de dejar de escribir
  useEffect(() => {
    if (!signature) return;
    // Si se edita otra vez, esta comprobación queda obsoleta: se cancela el temporizador y
    // se ignora la respuesta si ya había salido, para que una respuesta lenta no pise la nueva
    let stale = false;
    const timer = setTimeout(() => {
      const assignments = JSON.parse(signature) as unknown[];
      if (assignments.length === 0) return;
      void (api('POST', '/tasks/plan/validate', {
        apartment_id: APARTMENT_ID,
        assignments,
      }) as Promise<ValidationResponse>)
        .then((result) => {
          if (!stale) setValidated({ signature, result });
        })
        .catch((e) => {
          if (!stale) setError(errorMessage(e));
        });
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [signature]);

  const serverChecked = signature !== null && validated?.signature === signature;
  const serverIssues = (index: number) =>
    serverChecked ? (validated?.result.items[index]?.issues ?? []) : [];
  const hasProblems =
    !allFormatsValid || (serverChecked && validated?.result.valid === false);
  const checking = allFormatsValid && !serverChecked && items.length > 0;
  const canApply = !applying && !hasProblems && serverChecked && items.length > 0;

  const setTime = (index: number, timeText: string) => {
    setError('');
    setItems((current) =>
      current.map((item, position) => (position === index ? { ...item, timeText } : item)),
    );
  };

  const apply = async () => {
    if (!signature) return;
    setApplying(true);
    setError('');
    try {
      await api('POST', '/tasks/plan/apply', {
        apartment_id: APARTMENT_ID,
        assignments: JSON.parse(signature),
      });
      router.dismissTo('/chores');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setApplying(false);
    }
  };

  const byDate = new Map<string, number[]>();
  items.forEach((item, index) => {
    byDate.set(item.date, [...(byDate.get(item.date) ?? []), index]);
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
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
            puntos de cada persona y su disponibilidad. Puedes cambiar las horas antes de aplicar.
          </Text>
        ) : null}

        {loading ? <ActivityIndicator color={Palette.primary} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {!loading && plan ? (
          <>
            {items.length === 0 && plan.unassigned.length === 0 ? (
              <Text style={styles.muted}>No hay tareas pendientes de repartir esta semana.</Text>
            ) : null}

            {[...byDate.entries()].map(([date, indexes]) => (
              <View key={date} style={styles.section}>
                <Text style={styles.sectionTitle}>{dayLabel(date)}</Text>
                {indexes.map((index) => {
                  const item = items[index];
                  const issues = [
                    ...(localErrors[index] ? [localErrors[index] as string] : []),
                    ...serverIssues(index),
                  ];
                  const time = validTime(item.timeText);
                  return (
                    <View key={`${item.task_id}-${date}-${index}`} style={styles.rowWrap}>
                      <View style={[styles.row, issues.length > 0 && styles.rowInvalid]}>
                        <TextInput
                          value={item.timeText}
                          onChangeText={(text) => setTime(index, text)}
                          onBlur={() => {
                            const normalized = validTime(item.timeText);
                            if (normalized) setTime(index, normalized);
                          }}
                          style={[styles.timeInput, issues.length > 0 && styles.timeInputInvalid]}
                          accessibilityLabel={`Hora de ${item.task_title}`}
                          placeholder="09:00"
                          placeholderTextColor={Palette.textSecondary}
                          keyboardType="numbers-and-punctuation"
                          maxLength={5}
                        />
                        <View style={styles.rowText}>
                          <Text style={styles.name}>{item.task_title}</Text>
                          <Text style={styles.person}>
                            {item.user_name}
                            {time ? ` · hasta las ${endTime(item, time)}` : ''}
                          </Text>
                        </View>
                        <Text style={styles.points}>+{item.points} pts</Text>
                      </View>
                      {issues.map((issue) => (
                        <Text key={issue} style={styles.issue}>
                          {issue}
                        </Text>
                      ))}
                    </View>
                  );
                })}
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

            {items.length > 0 ? (
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

            {plan.unassigned.length > 0 && items.length > 0 ? (
              <Text style={styles.warning}>
                {plan.unassigned.length === 1
                  ? 'Hay 1 tarea que no se ha podido repartir y quedará sin asignar.'
                  : `Hay ${plan.unassigned.length} tareas que no se han podido repartir y quedarán sin asignar.`}
              </Text>
            ) : null}

            {items.length > 0 ? (
              <>
                {hasProblems ? (
                  <Text style={styles.error}>
                    Corrige las horas marcadas en rojo para poder aplicar el reparto.
                  </Text>
                ) : null}
                <Pressable
                  onPress={() => void apply()}
                  disabled={!canApply}
                  style={[styles.primaryButton, !canApply && styles.disabled]}>
                  <Text style={styles.primaryButtonText}>
                    {applying
                      ? 'Aplicando...'
                      : checking
                        ? 'Comprobando...'
                        : `Aplicar reparto (${items.length} tareas)`}
                  </Text>
                </Pressable>
              </>
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
  rowWrap: { gap: 6 },
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
  rowInvalid: { borderColor: Palette.error },
  timeInput: {
    width: 64,
    paddingVertical: 8,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '800',
    color: Palette.primary,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.input,
    backgroundColor: Palette.background,
  },
  timeInputInvalid: { borderColor: Palette.error, color: Palette.error },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '800', color: Palette.text },
  person: { fontSize: 12, color: Palette.textSecondary },
  points: { fontSize: 14, fontWeight: '800', color: Palette.primary },
  issue: { fontSize: 12, color: Palette.error, paddingHorizontal: 4 },
  warning: { fontSize: 13, lineHeight: 18, color: Palette.textSecondary },
  primaryButton: {
    alignItems: 'center',
    paddingVertical: 15,
    borderRadius: Radius.button,
    backgroundColor: Palette.primary,
  },
  primaryButtonText: { fontSize: 15, fontWeight: '800', color: Palette.onPrimary },
  disabled: { opacity: 0.5 },
  error: { fontSize: 14, textAlign: 'center', color: Palette.error },
  muted: { fontSize: 14, textAlign: 'center', color: Palette.textSecondary },
});
