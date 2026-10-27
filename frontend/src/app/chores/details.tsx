import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { DeleteChoreDialog } from '@/components/delete-chore-dialog';
import { Palette, Radius } from '@/constants/onboarding';
import { api, errorMessage } from '@/lib/api';

type TaskDetails = {
  title: string;
  description: string | null;
  frequency: 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly';
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
  assignments: {
    user: { full_name: string };
    due_date: string;
    status: string;
  }[];
};

const frequencyLabels: Record<string, string> = {
  none: 'Una vez',
  daily: 'Diaria',
  weekly: 'Semanal',
  biweekly: 'Cada 2 semanas',
  monthly: 'Mensual',
};

export default function ChoreDetailsScreen() {
  const { taskId } = useLocalSearchParams<{ taskId?: string }>();
  const [task, setTask] = useState<TaskDetails | null>(null);
  const [completed, setCompleted] = useState(false);
  // sin taskId no hay nada que cargar: el error se muestra desde el principio
  const [loading, setLoading] = useState(Boolean(taskId));
  const [error, setError] = useState(taskId ? '' : 'No se encontró la tarea.');
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const openDeleteDialog = () => {
    setDeleteError('');
    setDeleteDialogVisible(true);
  };

  const deleteTask = async () => {
    if (!taskId) return;

    setDeleting(true);
    setDeleteError('');
    try {
      await api('DELETE', `/tasks/${encodeURIComponent(taskId)}`);
      setDeleteDialogVisible(false);
      router.dismissTo({ pathname: '/chores', params: { notice: 'deleted' } });
    } catch (e) {
      setDeleteError(errorMessage(e));
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    if (!taskId) return;

    void (async () => {
      try {
        const loaded = await api(
          'GET',
          `/tasks/${encodeURIComponent(taskId)}`,
        ) as TaskDetails;
        setTask(loaded);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [taskId]);

  const assignment = task?.assignments[0];
  const assignmentDate = assignment
    ? new Date(`${assignment.due_date}T00:00:00`).toLocaleDateString('es-ES', {
      month: 'short',
      day: 'numeric',
    })
    : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.topBar}>
          <Text style={styles.title}>Detalles de la tarea</Text>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Cerrar">
            <MaterialCommunityIcons name="close" size={23} color={Palette.text} />
          </Pressable>
        </View>

        {loading ? <ActivityIndicator color={Palette.primary} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {task ? <View style={styles.hero}>
          <View style={styles.iconCircle}>
            <MaterialCommunityIcons name="format-list-checks" size={24} color={Palette.primary} />
          </View>
          <Text style={styles.choreTitle}>{task.title}</Text>
          <Text style={styles.meta}>
            {frequencyLabels[task.frequency] ?? task.frequency} · {assignmentDate ?? 'En cualquier momento'}
          </Text>
          {task.description ? <Text style={styles.description}>{task.description}</Text> : null}
        </View> : null}

        {task ? <View style={styles.assignmentCard}>
          <MaterialCommunityIcons name="star-outline" size={18} color={Palette.primary} />
          <View style={styles.assignmentList}>
            <Text style={styles.assignmentLabel}>ASIGNACIONES</Text>
            {task.assignments.length > 0 ? (
              task.assignments.map((item) => (
                <Text key={`${item.user.full_name}-${item.due_date}`} style={styles.assignment}>
                  {item.user.full_name} · {new Date(`${item.due_date}T00:00:00`).toLocaleDateString('es-ES', {
                    month: 'short',
                    day: 'numeric',
                  })} · {item.status === 'completed' ? 'completada' : item.status === 'pending' ? 'pendiente' : item.status}
                </Text>
              ))
            ) : (
              <Text style={styles.assignment}>Esta tarea todavía no tiene asignaciones.</Text>
            )}
          </View>
        </View> : null}

        {task ? <>
          <Text style={styles.sectionLabel}>¿QUÉ QUIERES HACER?</Text>
          <Pressable
            onPress={() => setCompleted(true)}
            style={[styles.actionButton, completed && styles.completedButton]}>
            <MaterialCommunityIcons name="check-circle-outline" size={18} color={Palette.onPrimary} />
            <Text style={styles.actionText}>{completed ? 'Marcada como hecha' : 'Marcar como hecha'}</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton}>
            <MaterialCommunityIcons name="swap-horizontal" size={18} color={Palette.primary} />
            <Text style={styles.secondaryText}>Solicitar un cambio</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push({ pathname: '/chores/edit', params: { taskId } })}
            style={styles.secondaryButton}>
            <MaterialCommunityIcons name="pencil-outline" size={18} color={Palette.primary} />
            <Text style={styles.secondaryText}>Editar tarea</Text>
          </Pressable>
          <Pressable onPress={openDeleteDialog} style={[styles.secondaryButton, styles.deleteButton]}>
            <MaterialCommunityIcons name="trash-can-outline" size={18} color={Palette.error} />
            <Text style={[styles.secondaryText, styles.deleteText]}>Eliminar tarea</Text>
          </Pressable>
        </> : null}
      </ScrollView>
      <DeleteChoreDialog
        visible={deleteDialogVisible}
        chore={task}
        deleting={deleting}
        error={deleteError}
        onCancel={() => setDeleteDialogVisible(false)}
        onConfirm={() => void deleteTask()}
      />
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
  hero: {
    alignItems: 'center',
    paddingVertical: 28,
    borderRadius: Radius.input,
    backgroundColor: Palette.mint,
    gap: 6,
  },
  iconCircle: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: Palette.surface,
  },
  choreTitle: { marginTop: 4, fontSize: 20, fontWeight: '800', color: Palette.text },
  meta: { fontSize: 12, color: Palette.textSecondary },
  description: { marginTop: 8, maxWidth: '90%', fontSize: 13, textAlign: 'center', color: Palette.textSecondary },
  error: { fontSize: 14, textAlign: 'center', color: Palette.error },
  assignmentCard: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.input,
    backgroundColor: Palette.surface,
  },
  assignment: { flex: 1, fontSize: 13, lineHeight: 18, color: Palette.text },
  assignmentList: { flex: 1, gap: 4 },
  assignmentLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: Palette.primary },
  sectionLabel: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    color: Palette.primary,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    borderRadius: Radius.button,
    backgroundColor: Palette.primary,
  },
  completedButton: { backgroundColor: '#4C8B6F' },
  actionText: { fontSize: 15, fontWeight: '800', color: Palette.onPrimary },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.button,
    backgroundColor: Palette.surface,
  },
  secondaryText: { fontSize: 15, fontWeight: '700', color: Palette.primary },
  deleteButton: { borderColor: Palette.error },
  deleteText: { color: Palette.error },
});
