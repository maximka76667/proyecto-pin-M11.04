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
import { api, errorMessage } from '@/lib/api';
import { normalizeTime, toMinutes } from '@/lib/availability';

type TaskDetails = {
  apartment_id: string;
  title: string;
  description: string | null;
  duration_minutes: number;
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

type HouseMember = { id: string; full_name: string; isCurrentUser?: boolean };
const DEFAULT_ASSIGNMENT_TIME = '09:30';

// GET /tasks/:id/availability: quién tiene ocupada la franja de la tarea en ese día y hora
type SlotAvailability = {
  start: string;
  end: string;
  members: {
    id: string;
    full_name: string;
    available: boolean;
    busy: { start: string; end: string } | null;
  }[];
};
// La respuesta se guarda con el día y la hora a los que corresponde ("2026-11-10|09:30")
type AvailabilityResult = { key: string; data: SlotAvailability | null; error: string };

// "9:30" → "09:30". Una tarea no puede empezar a las 24:00
function normalizeStartTime(text: string) {
  const time = normalizeTime(text);
  return time && time !== '24:00' ? time : null;
}

function addMinutes(time: string, minutes: number) {
  const total = toMinutes(time) + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Franja que ocupa una asignación, p. ej. "09:30–10:00"
function formatSlot(dueTime: string | null, durationMinutes: number) {
  const start = dueTime ? normalizeStartTime(dueTime) : null;
  if (!start) return 'hora sin definir';
  return `${start}–${addMinutes(start, durationMinutes)}`;
}

function unavailableMessage(name: string, busy: { start: string; end: string } | null) {
  return busy
    ? `${name} no está disponible en esa franja: tiene ocupado de ${busy.start} a ${busy.end}.`
    : `${name} no está disponible en esa franja.`;
}

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
  const [members, setMembers] = useState<HouseMember[]>([]);
  const [completed, setCompleted] = useState(false);
  // sin taskId no hay nada que cargar: el error se muestra desde el principio
  const [loading, setLoading] = useState(Boolean(taskId));
  const [error, setError] = useState(taskId ? '' : 'No se encontró la tarea.');
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState('');
  const [assignDialogVisible, setAssignDialogVisible] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [assignedDay, setAssignedDay] = useState(todayAsInputDate);
  const [assignedTime, setAssignedTime] = useState(DEFAULT_ASSIGNMENT_TIME);
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const [assignmentError, setAssignmentError] = useState('');
  const [assignmentNotice, setAssignmentNotice] = useState('');
  const [availability, setAvailability] = useState<AvailabilityResult | null>(null);
  const [availabilityWarning, setAvailabilityWarning] = useState('');
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [assignmentToDelete, setAssignmentToDelete] = useState<
    TaskDetails['assignments'][number] | null
  >(null);
  const [assignmentDeleteDialogVisible, setAssignmentDeleteDialogVisible] =
    useState(false);
  const [assignmentDeleting, setAssignmentDeleting] = useState(false);
  const [assignmentDeleteError, setAssignmentDeleteError] = useState('');

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

  const openAssignmentDeleteDialog = (
    assignment: TaskDetails['assignments'][number],
  ) => {
    setAssignmentToDelete(assignment);
    setAssignmentDeleteError('');
    setAssignmentDeleteDialogVisible(true);
  };

  const deleteAssignment = async () => {
    if (!assignmentToDelete || !taskId) return;

    setAssignmentDeleting(true);
    setAssignmentDeleteError('');
    try {
      await api(
        'DELETE',
        `/tasks/assignments/${encodeURIComponent(assignmentToDelete.id)}`,
      );
      setTask((current) =>
        current
          ? {
            ...current,
            assignments: current.assignments.filter(
              ({ id }) => id !== assignmentToDelete.id,
            ),
          }
          : current,
      );
      setAssignmentDeleteDialogVisible(false);
      setAssignmentNotice('Asignación eliminada. La tarea se conserva.');
    } catch (e) {
      setAssignmentDeleteError(errorMessage(e));
    } finally {
      setAssignmentDeleting(false);
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
        ) as HouseMember[];
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

  // Día y hora ya normalizados ("9:30" → "09:30"); null mientras no sean válidos
  const assignmentDay = parseAssignmentDay(assignedDay);
  const assignmentTime = normalizeStartTime(assignedTime);
  const slotEndsAfterMidnight = Boolean(
    task && assignmentTime && toMinutes(assignmentTime) + task.duration_minutes > 24 * 60,
  );
  const availabilityKey =
    assignDialogVisible && assignmentDay && assignmentTime && !slotEndsAfterMidnight
      ? `${assignmentDay}|${assignmentTime}`
      : null;
  // La respuesta solo vale si es del día y la hora que hay ahora en el formulario
  const currentAvailability = availability?.key === availabilityKey ? availability : null;
  const checkingAvailability = Boolean(availabilityKey) && !currentAvailability;
  const busyById = new Map(
    (currentAvailability?.data?.members ?? [])
      .filter((member) => !member.available)
      .map((member) => [member.id, member.busy]),
  );
  const selectedBusy = members.filter(
    (member) => selectedUserIds.includes(member.id) && busyById.has(member.id),
  );

  // Con un día y una hora válidos, pregunta quién tiene esa franja ocupada (400 ms después de
  // dejar de escribir). El estado solo cambia dentro del temporizador y de la promesa
  useEffect(() => {
    if (!availabilityKey || !taskId) return;
    const [day, time] = availabilityKey.split('|');
    let cancelled = false;
    const timer = setTimeout(() => {
      void (api(
        'GET',
        `/tasks/${encodeURIComponent(taskId)}/availability?due_date=${day}&due_time=${encodeURIComponent(time)}`,
      ) as Promise<SlotAvailability>)
        .then((data) => {
          if (!cancelled) setAvailability({ key: availabilityKey, data, error: '' });
        })
        .catch((e) => {
          if (!cancelled) setAvailability({ key: availabilityKey, data: null, error: errorMessage(e) });
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [availabilityKey, taskId]);

  const openAssignmentDialog = () => {
    setSelectedUserIds([]);
    setAssignedDay(todayAsInputDate());
    // 09:30 no debe ser solo un placeholder: la hora mostrada tiene que formar parte
    // del estado para que se consulte disponibilidad y se envíe al asignar.
    setAssignedTime(DEFAULT_ASSIGNMENT_TIME);
    setAssignmentError('');
    setAvailabilityWarning('');
    setAssignDialogVisible(true);
  };

  const changeAssignedDay = (value: string) => {
    setAssignedDay(value);
    setAvailabilityWarning('');
  };

  const changeAssignedTime = (value: string) => {
    setAssignedTime(value);
    setAvailabilityWarning('');
  };

  // Al salir del campo, "9:30" se queda escrito como "09:30"
  const normalizeAssignedTime = () => {
    if (assignmentTime && assignmentTime !== assignedTime) setAssignedTime(assignmentTime);
  };

  const toggleAssignee = (member: HouseMember) => {
    const selected = selectedUserIds.includes(member.id);
    // A quien tiene la franja ocupada no se le puede elegir; sí quitarlo si ya estaba
    if (!selected && busyById.has(member.id)) {
      setAvailabilityWarning(unavailableMessage(member.full_name, busyById.get(member.id) ?? null));
      return;
    }
    setAvailabilityWarning('');
    setSelectedUserIds((current) =>
      selected ? current.filter((id) => id !== member.id) : [...current, member.id],
    );
  };

  const assignTask = async () => {
    if (!taskId || selectedUserIds.length === 0) {
      setAssignmentError('Debes asignar la tarea al menos a una persona.');
      return;
    }

    if (!assignmentDay) {
      setAssignmentError('Introduce un día válido con el formato DD/MM/AAAA.');
      return;
    }
    if (!assignmentTime) {
      setAssignmentError('Introduce una hora válida, por ejemplo 09:30.');
      return;
    }
    if (slotEndsAfterMidnight) {
      setAssignmentError('La tarea no puede terminar después de medianoche.');
      return;
    }
    if (selectedBusy.length > 0) {
      setAssignmentError(unavailableMessage(selectedBusy[0].full_name, busyById.get(selectedBusy[0].id) ?? null));
      return;
    }

    setAssignmentSaving(true);
    setAssignmentError('');
    try {
      const newAssignments = await api(
        'POST',
        `/tasks/${encodeURIComponent(taskId)}/assignments`,
        { user_ids: selectedUserIds, due_date: assignmentDay, due_time: assignmentTime },
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
                <View key={item.id} style={styles.assignmentRow}>
                  <Text style={styles.assignment}>
                    {item.user.full_name} · {formatAssignmentDay(item.due_date, {
                      month: 'short',
                      day: 'numeric',
                    })} · {formatSlot(item.due_time, task.duration_minutes)} · {item.status === 'completed' ? 'completada' : item.status === 'pending' ? 'pendiente' : item.status}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Eliminar asignación de ${item.user.full_name}`}
                    hitSlop={8}
                    onPress={() => openAssignmentDeleteDialog(item)}
                    style={styles.assignmentDeleteButton}>
                    <MaterialCommunityIcons
                      name="trash-can-outline"
                      size={20}
                      color={Palette.error}
                    />
                  </Pressable>
                </View>
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
      <DeleteChoreDialog
        visible={assignmentDeleteDialogVisible}
        chore={task}
        assignmentDescription={
          assignmentToDelete
            ? `${assignmentToDelete.user.full_name} · ${formatAssignmentDay(assignmentToDelete.due_date, {
              month: 'short',
              day: 'numeric',
            })} · ${assignmentToDelete.due_time ?? 'hora sin definir'}`
            : undefined
        }
        deleting={assignmentDeleting}
        error={assignmentDeleteError}
        onCancel={() => setAssignmentDeleteDialogVisible(false)}
        onConfirm={() => void deleteAssignment()}
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
              Elige el día y la hora: quien tenga esa franja ocupada en su calendario no se podrá elegir.
            </Text>
            <View style={styles.scheduleFields}>
              <View style={styles.scheduleField}>
                <Text style={styles.sectionLabel}>DÍA ASIGNADO</Text>
                <TextInput
                  value={assignedDay}
                  onChangeText={changeAssignedDay}
                  placeholder="DD/MM/AAAA"
                  keyboardType="numbers-and-punctuation"
                  maxLength={10}
                  style={styles.dateInput}
                  accessibilityLabel="Día asignado"
                />
              </View>
              <View style={styles.scheduleField}>
                <Text style={styles.sectionLabel}>HORA DE INICIO</Text>
                <TextInput
                  value={assignedTime}
                  onChangeText={changeAssignedTime}
                  onBlur={normalizeAssignedTime}
                  placeholder="09:30"
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                  style={styles.dateInput}
                  accessibilityLabel="Hora de inicio"
                />
              </View>
            </View>
            {task && assignmentTime ? (
              <Text style={slotEndsAfterMidnight ? styles.slotWarning : styles.slotText}>
                {slotEndsAfterMidnight
                  ? 'La tarea terminaría después de medianoche.'
                  : `De ${assignmentTime} a ${addMinutes(assignmentTime, task.duration_minutes)} (${task.duration_minutes} min)`}
              </Text>
            ) : null}
            <Text style={styles.sectionLabel}>PERSONA</Text>
            {membersLoading ? (
              <ActivityIndicator color={Palette.primary} />
            ) : membersError ? (
              <Text style={styles.error}>{membersError}</Text>
            ) : members.length === 0 ? (
              <Text style={styles.assignment}>No hay miembros disponibles en este hogar.</Text>
            ) : (
              <ScrollView style={styles.memberList} keyboardShouldPersistTaps="handled">
                {checkingAvailability ? (
                  <Text style={styles.memberHint}>Comprobando quién está libre en esa franja…</Text>
                ) : currentAvailability?.error ? (
                  <Text style={styles.error}>{currentAvailability.error}</Text>
                ) : !availabilityKey ? (
                  <Text style={styles.memberHint}>Indica el día y la hora para ver quién está libre.</Text>
                ) : null}
                {members.map((member) => {
                  const selected = selectedUserIds.includes(member.id);
                  const busy = busyById.get(member.id);
                  const unavailable = busyById.has(member.id);
                  return (
                    <Pressable
                      key={member.id}
                      onPress={() => toggleAssignee(member)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected, disabled: unavailable && !selected }}
                      style={[
                        styles.memberOption,
                        selected && styles.memberOptionSelected,
                        unavailable && styles.memberOptionBusy,
                      ]}>
                      <MaterialCommunityIcons
                        name={unavailable ? 'calendar-remove-outline' : selected ? 'check-circle' : 'circle-outline'}
                        size={21}
                        color={unavailable ? Palette.error : selected ? Palette.primary : Palette.textSecondary}
                      />
                      <View style={styles.memberText}>
                        <Text style={[styles.memberName, unavailable && styles.memberNameBusy]}>
                          {member.isCurrentUser ? `Yo · ${member.full_name}` : member.full_name}
                        </Text>
                        {unavailable ? (
                          <Text style={styles.memberBusy}>
                            {busy ? `No disponible · ocupado de ${busy.start} a ${busy.end}` : 'No disponible en esa franja'}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
            {availabilityWarning ? (
              <Text style={styles.error} accessibilityLiveRegion="polite">{availabilityWarning}</Text>
            ) : selectedBusy.length > 0 ? (
              <Text style={styles.error} accessibilityLiveRegion="polite">
                {unavailableMessage(selectedBusy[0].full_name, busyById.get(selectedBusy[0].id) ?? null)} Quítalo de la selección o cambia la hora.
              </Text>
            ) : null}
            {assignmentError ? <Text style={styles.error}>{assignmentError}</Text> : null}
            <Pressable
              onPress={() => void assignTask()}
              disabled={
                assignmentSaving ||
                membersLoading ||
                Boolean(membersError) ||
                members.length === 0 ||
                checkingAvailability ||
                selectedBusy.length > 0
              }
              style={[
                styles.actionButton,
                (checkingAvailability || selectedBusy.length > 0) && styles.actionButtonDisabled,
              ]}>
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
  assignmentRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  assignment: { flex: 1, fontSize: 13, lineHeight: 18, color: Palette.text },
  assignmentDeleteButton: { padding: 4 },
  assignmentList: { flex: 1, gap: 4 },
  assignmentLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: Palette.primary },
  scheduleCard: { gap: 12, padding: 16, borderRadius: Radius.input, backgroundColor: Palette.surface, borderWidth: 1, borderColor: Palette.border },
  memberChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  memberChoice: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: Palette.border },
  memberChoiceSelected: { backgroundColor: Palette.primary, borderColor: Palette.primary },
  memberChoiceText: { fontSize: 12, color: Palette.text },
  memberChoiceTextSelected: { color: Palette.onPrimary, fontWeight: '700' },
  scheduleFields: { flexDirection: 'row', gap: 10 },
  scheduleInput: { flex: 1, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: Palette.border, color: Palette.text },
  scheduleButton: { alignItems: 'center', padding: 12, borderRadius: 12, backgroundColor: Palette.primary },
  scheduleButtonText: { color: Palette.onPrimary, fontWeight: '700' },
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
  memberText: { flex: 1, gap: 2 },
  memberOptionBusy: { borderColor: '#F2C4BF', backgroundColor: '#FBF1EF' },
  memberNameBusy: { color: Palette.textSecondary },
  memberBusy: { fontSize: 12, color: Palette.error },
  memberHint: { marginBottom: 8, fontSize: 13, color: Palette.textSecondary },
  scheduleField: { flex: 1, gap: 8 },
  slotText: { fontSize: 13, fontWeight: '700', color: Palette.primary },
  slotWarning: { fontSize: 13, fontWeight: '700', color: Palette.error },
  actionButtonDisabled: { opacity: 0.55 },
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
