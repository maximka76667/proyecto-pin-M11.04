import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { DeleteChoreDialog } from '@/components/delete-chore-dialog';
import { Palette, Radius } from '@/constants/onboarding';
import { api, errorMessage, Member } from '@/lib/api';

type TaskDetails = {
  apartment_id: string;
  title: string;
  description: string | null;
  frequency: 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly';
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
  assignments: {
    id: string;
    user_id: string;
    user: { full_name: string };
    due_date: string;
    due_time: string | null;
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

function todayAsInputDate() {
  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${today.getFullYear()}`;
}

function parseAssignmentDay(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;

  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return `${yearText}-${monthText}-${dayText}`;
}

function formatAssignmentDay(value: string, options: Intl.DateTimeFormatOptions) {
  const day = value.slice(0, 10);
  return new Date(`${day}T00:00:00`).toLocaleDateString('es-ES', options);
}

export default function ChoreDetailsScreen() {
  const { taskId } = useLocalSearchParams<{ taskId?: string }>();
  const [task, setTask] = useState<TaskDetails | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [completed, setCompleted] = useState(false);
  // sin taskId no hay nada que cargar: el error se muestra desde el principio
  const [loading, setLoading] = useState(Boolean(taskId));
  const [error, setError] = useState(taskId ? '' : 'No se encontró la tarea.');
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState('');
  const [assignDialogVisible, setAssignDialogVisible] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [assignedDay, setAssignedDay] = useState(todayAsInputDate);
  const [assignedTime, setAssignedTime] = useState('');
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const [assignmentError, setAssignmentError] = useState('');
  const [assignmentNotice, setAssignmentNotice] = useState('');
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

    let cancelled = false;
    void (async () => {
      let loadedTask: TaskDetails;
      try {
        loadedTask = await api(
          'GET',
          `/tasks/${encodeURIComponent(taskId)}`,
        ) as TaskDetails;
        if (cancelled) return;
        setTask(loadedTask);
        setLoading(false);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
        return;
      }

      setMembersLoading(true);
      try {
        const householdMembers = await api(
          'GET',
          `/apartments/${encodeURIComponent(loadedTask.apartment_id)}/members`,
        ) as Member[];
        if (cancelled) return;
        setMembers(householdMembers);
      } catch (e) {
        if (!cancelled) setMembersError(errorMessage(e));
      } finally {
        if (!cancelled) setMembersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const openAssignmentDialog = () => {
    setSelectedUserIds([]);
    setAssignedDay(todayAsInputDate());
    setAssignedTime('');
    setAssignmentError('');
    setAssignDialogVisible(true);
  };

  const toggleAssignee = (userId: string) => {
    setSelectedUserIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  };

  const assignTask = async () => {
    if (!taskId || selectedUserIds.length === 0) {
      setAssignmentError('Debes asignar la tarea al menos a una persona.');
      return;
    }

    const day = parseAssignmentDay(assignedDay);
    if (!day) {
      setAssignmentError('Introduce un día válido con el formato DD/MM/AAAA.');
      return;
    }
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(assignedTime)) {
      setAssignmentError('Introduce una hora válida con el formato HH:mm.');
      return;
    }

    setAssignmentSaving(true);
    setAssignmentError('');
    try {
      const newAssignments = await api(
        'POST',
        `/tasks/${encodeURIComponent(taskId)}/assignments`,
        { user_ids: selectedUserIds, due_date: day, due_time: assignedTime },
      ) as TaskDetails['assignments'];
      setTask((current) => current && ({
        ...current,
        status: current.status === 'pending' ? 'assigned' : current.status,
        assignments: [...current.assignments, ...newAssignments].sort(
          (a, b) => a.due_date.localeCompare(b.due_date),
        ),
      }));
      setAssignDialogVisible(false);
      setAssignmentNotice(
        `Tarea asignada a ${newAssignments.length} ${
          newAssignments.length === 1 ? 'persona' : 'personas'
        }.`,
      );
    } catch (e) {
      setAssignmentError(errorMessage(e));
    } finally {
      setAssignmentSaving(false);
    }
  };

  const assignment = task?.assignments[0];
  const assignmentDate = assignment
    ? formatAssignmentDay(assignment.due_date, {
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
                  {item.user.full_name} · {formatAssignmentDay(item.due_date, {
                    month: 'short',
                    day: 'numeric',
                  })} · {item.due_time ?? 'hora sin definir'} · {item.status === 'completed' ? 'completada' : item.status === 'pending' ? 'pendiente' : item.status}
                </Text>
              ))
            ) : (
              <Text style={styles.assignment}>Esta tarea todavía no tiene asignaciones.</Text>
            )}
          </View>
        </View> : null}
        {assignmentNotice ? <Text style={styles.success}>{assignmentNotice}</Text> : null}

        {task ? <>
          <Text style={styles.sectionLabel}>¿QUÉ QUIERES HACER?</Text>
          <Pressable
            onPress={() => setCompleted(true)}
            style={[styles.actionButton, completed && styles.completedButton]}>
            <MaterialCommunityIcons name="check-circle-outline" size={18} color={Palette.onPrimary} />
            <Text style={styles.actionText}>{completed ? 'Marcada como hecha' : 'Marcar como hecha'}</Text>
          </Pressable>
          <Pressable
            disabled={membersLoading}
            onPress={openAssignmentDialog}
            style={styles.secondaryButton}>
            <MaterialCommunityIcons name="account-plus-outline" size={18} color={Palette.primary} />
            <Text style={styles.secondaryText}>Asignar tarea manualmente</Text>
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
      <Modal
        visible={assignDialogVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAssignDialogVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Asignar tarea</Text>
              <Pressable
                onPress={() => setAssignDialogVisible(false)}
                hitSlop={12}
                accessibilityLabel="Cerrar">
                <MaterialCommunityIcons name="close" size={23} color={Palette.text} />
              </Pressable>
            </View>
            <Text style={styles.modalDescription}>
              Elige una o varias personas y el día asignado.
            </Text>
            <Text style={styles.sectionLabel}>PERSONA</Text>
            {membersLoading ? (
              <ActivityIndicator color={Palette.primary} />
            ) : membersError ? (
              <Text style={styles.error}>{membersError}</Text>
            ) : members.length === 0 ? (
              <Text style={styles.assignment}>No hay miembros disponibles en este hogar.</Text>
            ) : (
              <ScrollView style={styles.memberList} keyboardShouldPersistTaps="handled">
                {members.map((member) => {
                  const selected = selectedUserIds.includes(member.id);
                  return (
                    <Pressable
                      key={member.id}
                      onPress={() => toggleAssignee(member.id)}
                      style={[styles.memberOption, selected && styles.memberOptionSelected]}>
                      <MaterialCommunityIcons
                        name={selected ? 'check-circle' : 'circle-outline'}
                        size={21}
                        color={selected ? Palette.primary : Palette.textSecondary}
                      />
                      <Text style={styles.memberName}>
                        {member.isCurrentUser ? `Yo · ${member.full_name}` : member.full_name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
            <Text style={styles.sectionLabel}>DÍA ASIGNADO</Text>
            <TextInput
              value={assignedDay}
              onChangeText={setAssignedDay}
              placeholder="DD/MM/AAAA"
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              style={styles.dateInput}
              accessibilityLabel="Día asignado"
            />
            <Text style={styles.sectionLabel}>HORA ASIGNADA</Text>
            <TextInput
              value={assignedTime}
              onChangeText={setAssignedTime}
              placeholder="HH:mm"
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              style={styles.dateInput}
              accessibilityLabel="Hora asignada"
            />
            {assignmentError ? <Text style={styles.error}>{assignmentError}</Text> : null}
            <Pressable
              onPress={() => void assignTask()}
              disabled={
                assignmentSaving ||
                membersLoading ||
                Boolean(membersError) ||
                members.length === 0
              }
              style={styles.actionButton}>
              {assignmentSaving ? (
                <ActivityIndicator color={Palette.onPrimary} />
              ) : (
                <>
                  <Text style={styles.actionText}>Confirmar asignación</Text>
                  <MaterialCommunityIcons name="check" size={20} color={Palette.onPrimary} />
                </>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
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
  success: { fontSize: 14, textAlign: 'center', color: '#4C8B6F' },
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
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '90%',
    alignSelf: 'center',
    padding: 24,
    gap: 12,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: Palette.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: Palette.text },
  modalDescription: { fontSize: 14, color: Palette.textSecondary },
  memberList: { maxHeight: 220 },
  memberOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 13,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 14,
    backgroundColor: Palette.surface,
  },
  memberOptionSelected: {
    borderColor: Palette.primary,
    backgroundColor: Palette.mint,
  },
  memberName: { flex: 1, fontSize: 14, fontWeight: '700', color: Palette.text },
  dateInput: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.input,
    backgroundColor: Palette.surface,
    fontSize: 15,
    color: Palette.text,
  },
});
