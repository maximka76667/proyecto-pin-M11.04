import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
    ActivityIndicator,
    NativeScrollEvent,
    NativeSyntheticEvent,
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Snackbar } from 'react-native-paper';

import { choreCategories, type ChoreCategory, type ChoreFrequency } from '@/components/chore-form';
import { DeleteChoreDialog } from '@/components/delete-chore-dialog';
import { Palette, Radius } from '@/constants/onboarding';
import { api, errorMessage } from '@/lib/api';
import { APARTMENT_ID } from '@/constants/dev-session';
// Aviso que se muestra después de crear, editar o borrar una tarea
const notices: Record<string, string> = {
    created: 'Tarea creada correctamente.',
    updated: 'Tarea actualizada correctamente.',
    deleted: 'Tarea eliminada correctamente.',
};




type Task = {
    id: string;
    title: string;
    description: string | null;
    category: ChoreCategory;
    frequency: ChoreFrequency;
    status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
    assignments: {
        user_id: string;
        status: string;
        due_date: string;
        user: { full_name: string };
    }[];
};

type ApartmentTaskRow = {
    task: Task;
    assignment: Task['assignments'][number] | null;
};

const dayLabels = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

const frequencyLabels: Record<ChoreFrequency, string> = {
    none: 'Una vez',
    daily: 'Diaria',
    weekly: 'Semanal',
    biweekly: 'Cada 2 semanas',
    monthly: 'Mensual',
};

function startOfWeek(date: Date) {
    const result = new Date(date);
    const day = result.getDay();
    const daysFromMonday = day === 0 ? 6 : day - 1;
    result.setHours(0, 0, 0, 0);
    result.setDate(result.getDate() - daysFromMonday);
    return result;
}

function addDays(date: Date, amount: number) {
    const result = new Date(date);
    result.setDate(result.getDate() + amount);
    return result;
}

function dateKey(date: Date | string) {
    if (typeof date === 'string') return date.slice(0, 10);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// "Sep 21 – 27", o "Sep 28 – Oct 4" cuando la semana cambia de mes
function formatWeekTitle(weekStart: Date) {
    const weekEnd = addDays(weekStart, 6);
    const start = weekStart.toLocaleDateString('es-ES', { month: 'short', day: 'numeric' });
    const end = weekEnd.getMonth() === weekStart.getMonth()
        ? weekEnd.getDate()
        : weekEnd.toLocaleDateString('es-ES', { month: 'short', day: 'numeric' });
    return `${start} – ${end}`;
}

// "MON 21": se usa solo la fecha de due_date para que la zona horaria no la cambie de día
function formatDueDay(dueDate: string) {
    const date = new Date(`${dateKey(dueDate)}T00:00:00`);
    const weekday = date.toLocaleDateString('es-ES', { weekday: 'short' }).toUpperCase();
    return `${weekday} ${date.getDate()}`;
}

export default function ChoresScreen() {
    const { notice } = useLocalSearchParams<{ notice?: string }>();
    const today = new Date();
    const [weekStart, setWeekStart] = useState(() => startOfWeek(today));
    const [selectedDay, setSelectedDay] = useState(() => dateKey(today));
    const [tasks, setTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [pageWidth, setPageWidth] = useState(0);
    // la tarea se conserva al cerrar el diálogo para que su texto no cambie mientras se desvanece
    const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
    const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState('');
    // Al volver de otra pantalla la lista conserva su scroll, así que el aviso flota sobre ella.
    // Al cerrarse se quita el parámetro, para que no vuelva a salir al recargar la página, y se
    // guarda el texto para que no desaparezca mientras se desvanece
    const noticeText = notice ? notices[notice] : undefined;
    const [lastNoticeText, setLastNoticeText] = useState('');
    const calendarRef = useRef<ScrollView>(null);

    const dismissNotice = () => {
        setLastNoticeText(noticeText ?? '');
        router.setParams({ notice: undefined });
    };

    const loadTasks = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const data = await api(
                'GET',
                `/tasks?apartment_id=${encodeURIComponent(APARTMENT_ID)}`,
            ) as Task[];
            setTasks(data);
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useFocusEffect(
        useCallback(() => {
            void loadTasks();
        }, [loadTasks]),
    );

    const openDeleteDialog = (task: Task) => {
        setTaskToDelete(task);
        setDeleteError('');
        setDeleteDialogVisible(true);
    };

    const closeDeleteDialog = () => {
        setDeleteDialogVisible(false);
    };

    const deleteTask = async () => {
        if (!taskToDelete) return;

        const deletedId = taskToDelete.id;
        setDeleting(true);
        setDeleteError('');
        try {
            await api('DELETE', `/tasks/${encodeURIComponent(deletedId)}`);
            setTasks((current) => current.filter(({ id }) => id !== deletedId));
            setDeleteDialogVisible(false);
            router.setParams({ notice: 'deleted' });
        } catch (e) {
            setDeleteError(errorMessage(e));
        } finally {
            setDeleting(false);
        }
    };

    const changeWeek = (amount: number) => {
        const nextWeek = addDays(weekStart, amount * 7);
        setWeekStart(nextWeek);
        setSelectedDay(dateKey(nextWeek));
    };

    const handleCalendarScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        if (!pageWidth) return;

        const page = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
        if (page === 1) return;

        changeWeek(page - 1);
        calendarRef.current?.scrollTo({ x: pageWidth, animated: false });
    };

    const weeks = [-1, 0, 1].map((offset) => addDays(weekStart, offset * 7));
    const apartmentTasks = tasks.reduce<ApartmentTaskRow[]>((rows, task) => {
        if (task.assignments.length > 0) {
            rows.push(...task.assignments.map((assignment) => ({ task, assignment })));
        } else {
            rows.push({ task, assignment: null });
        }
        return rows;
    }, []);

    // key por posición: si fuera la fecha, al cambiar de semana se moverían los nodos y en web
    // el scroll-snap volvería a encajar en la página movida, saltando a otra semana
    const renderWeek = (week: Date, position: number) => (
        <View key={position} style={[styles.weekPage, pageWidth ? { width: pageWidth } : null]}>
            <View style={styles.weekHeader}>
                <Pressable accessibilityLabel="Semana anterior" hitSlop={10} onPress={() => changeWeek(-1)}>
                    <MaterialCommunityIcons name="chevron-left" size={20} color={Palette.primary} />
                </Pressable>
                <Text style={styles.weekTitle}>{formatWeekTitle(week)}</Text>
                <Pressable accessibilityLabel="Semana siguiente" hitSlop={10} onPress={() => changeWeek(1)}>
                    <MaterialCommunityIcons name="chevron-right" size={20} color={Palette.primary} />
                </Pressable>
            </View>

            <View style={styles.daysRow}>
                {dayLabels.map((label, index) => {
                    const day = addDays(week, index);
                    const dayKey = dateKey(day);
                    const selected = dayKey === selectedDay;
                    const hasTasks = tasks.some((task) =>
                        task.assignments.some((assignment) => dateKey(assignment.due_date) === dayKey),
                    );

                    return (
                        <Pressable
                            key={dayKey}
                            onPress={() => setSelectedDay(dayKey)}
                            style={[styles.day, selected && styles.daySelected]}>
                            <Text style={[styles.dayLabel, selected && styles.daySelectedText]}>{label}</Text>
                            <Text style={[styles.dayDate, selected && styles.daySelectedText]}>{day.getDate()}</Text>
                            <View style={[styles.dayDot, hasTasks && styles.dayDotBusy, selected && styles.dayDotSelected]} />
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );

    return (
        <SafeAreaView style={styles.safeArea}>
            <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
                <View style={styles.topBar}>
                    <View>
                        <Text style={styles.eyebrow}>MAPLE HOUSE</Text>
                        <Text style={styles.title}>Plan de tareas</Text>
                    </View>
                    <Pressable
                        style={styles.addButton}
                        accessibilityLabel="Añadir una tarea"
                        onPress={() => router.push('/chores/create')}>
                        <MaterialCommunityIcons name="plus" size={25} color={Palette.onPrimary} />
                    </Pressable>
                </View>

                <Pressable style={styles.availabilityButton} onPress={() => router.push('/availability')}>
                    <MaterialCommunityIcons name="calendar-clock" size={18} color={Palette.primary} />
                    <Text style={styles.availabilityButtonText}>Mi disponibilidad y la de la casa</Text>
                </Pressable>

                <View style={styles.segmented}>
                    <View style={styles.segmentSelected}>
                        <Text style={styles.segmentSelectedText}>Semana</Text>
                    </View>
                    <Pressable style={styles.segment}>
                        <Text style={styles.segmentText}>Balance</Text>
                    </Pressable>
                </View>

                <View style={styles.weekCard}>
                    {/* En web se ignoran contentOffset y onMomentumScrollEnd: la semana actual se centra al
                        tener ancho las páginas, y onScroll llega al empezar y al terminar de deslizar */}
                    <ScrollView
                        ref={calendarRef}
                        horizontal
                        pagingEnabled
                        showsHorizontalScrollIndicator={false}
                        onLayout={(event) => setPageWidth(event.nativeEvent.layout.width)}
                        contentOffset={{ x: pageWidth, y: 0 }}
                        onContentSizeChange={() => calendarRef.current?.scrollTo({ x: pageWidth, animated: false })}
                        onMomentumScrollEnd={handleCalendarScrollEnd}
                        onScroll={Platform.OS === 'web' ? handleCalendarScrollEnd : undefined}>
                        {weeks.map(renderWeek)}
                    </ScrollView>
                </View>

                <View style={styles.legend}>
                    <View style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: Palette.border }]} />
                        <Text style={styles.legendText}>Tiempo libre</Text>
                    </View>
                    <View style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: Palette.peach }]} />
                        <Text style={styles.legendText}>Ocupado</Text>
                    </View>
                    <Text style={styles.privateText}>Bloques privados</Text>
                </View>

                {loading ? <ActivityIndicator color={Palette.primary} /> : null}
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <View style={styles.choreList}>
                    {apartmentTasks.map(({ task, assignment }) => {
                        const category = choreCategories.find(({ value }) => value === task.category);

                        return (
                            <View
                                key={`${task.id}-${assignment?.user_id ?? 'unassigned'}-${assignment?.due_date ?? ''}`}
                                style={styles.choreCard}>
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={() =>
                                        router.push({
                                            pathname: '/chores/details',
                                            params: {
                                                taskId: task.id,
                                            },
                                        })
                                    }
                                    style={({ pressed }) => [styles.choreMain, pressed && styles.pressed]}>
                                    <View style={[styles.choreIcon, { backgroundColor: category?.tint ?? Palette.mint }]}>
                                        <MaterialCommunityIcons
                                            name={category?.icon ?? 'format-list-checks'}
                                            size={22}
                                            color={Palette.primary}
                                        />
                                    </View>
                                    <View style={styles.choreCopy}>
                                        <Text style={styles.choreDay}>
                                            {assignment ? formatDueDay(assignment.due_date) : 'ANYTIME'}
                                        </Text>
                                        <Text style={styles.choreTitle}>{task.title}</Text>
                                        <Text style={styles.choreMeta}>
                                            {assignment?.user.full_name ?? 'Unassigned'} · {frequencyLabels[task.frequency]}
                                        </Text>
                                        {task.description ? (
                                            <Text style={styles.choreDescription} numberOfLines={1}>
                                                {task.description}
                                            </Text>
                                        ) : null}
                                    </View>
                                </Pressable>
                                <View style={styles.choreActions}>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={`Eliminar ${task.title}`}
                                        hitSlop={8}
                                        onPress={() => openDeleteDialog(task)}
                                        style={({ pressed }) => [styles.choreAction, pressed && styles.pressed]}>
                                        <MaterialCommunityIcons name="trash-can-outline" size={22} color={Palette.text} />
                                    </Pressable>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={`Editar ${task.title}`}
                                        hitSlop={8}
                                        onPress={() =>
                                            router.push({
                                                pathname: '/chores/edit',
                                                params: {
                                                    taskId: task.id,
                                                },
                                            })
                                        }
                                        style={({ pressed }) => [styles.choreAction, pressed && styles.pressed]}>
                                        <MaterialCommunityIcons name="pencil-outline" size={22} color={Palette.text} />
                                    </Pressable>
                                </View>
                            </View>
                        );
                    })}
                </View>
                {!loading && !error && apartmentTasks.length === 0 ? (
                    <Text style={styles.muted}>Todavía no se ha creado ninguna tarea.</Text>
                ) : null}
            </ScrollView>
            <DeleteChoreDialog
                visible={deleteDialogVisible}
                chore={taskToDelete}
                deleting={deleting}
                error={deleteError}
                onCancel={closeDeleteDialog}
                onConfirm={() => void deleteTask()}
            />
            <Snackbar
                visible={Boolean(noticeText)}
                onDismiss={dismissNotice}
                duration={3000}
                style={styles.snackbar}>
                {noticeText ?? lastNoticeText}
            </Snackbar>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: Palette.background },
    container: {
        width: '100%',
        maxWidth: 560,
        alignSelf: 'center',
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 24,
        gap: 16,
    },
    topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: Palette.primary },
    title: { marginTop: 2, fontSize: 28, fontWeight: '800', color: Palette.text },
    addButton: {
        width: 40,
        height: 40,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: Palette.primary,
    },
    availabilityButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 11, borderRadius: Radius.input, borderWidth: 1, borderColor: Palette.border, backgroundColor: Palette.surface },
    availabilityButtonText: { fontSize: 13, fontWeight: '700', color: Palette.primary },
    segmented: { flexDirection: 'row', padding: 3, borderRadius: Radius.input, backgroundColor: Palette.segment },
    segment: { flex: 1, alignItems: 'center', paddingVertical: 9 },
    segmentSelected: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9, backgroundColor: Palette.surface },
    segmentText: { fontSize: 13, fontWeight: '600', color: Palette.textSecondary },
    segmentSelectedText: { fontSize: 13, fontWeight: '700', color: Palette.text },
    weekCard: { padding: 12, borderRadius: Radius.input, borderWidth: 1, borderColor: Palette.border, backgroundColor: Palette.surface },
    weekPage: { flexGrow: 1 },
    weekHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2, marginBottom: 12 },
    weekTitle: { fontSize: 13, fontWeight: '700', color: Palette.text },
    daysRow: { flexDirection: 'row', justifyContent: 'space-between' },
    day: { width: 36, minHeight: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 10, gap: 2 },
    daySelected: { backgroundColor: Palette.primary },
    dayLabel: { fontSize: 9, fontWeight: '700', color: Palette.textSecondary },
    dayDate: { fontSize: 14, fontWeight: '800', color: Palette.text },
    daySelectedText: { color: Palette.onPrimary },
    dayDot: { width: 4, height: 4, borderRadius: 2, marginTop: 2, backgroundColor: Palette.border },
    dayDotBusy: { backgroundColor: Palette.peach },
    dayDotSelected: { backgroundColor: Palette.peach },
    legend: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    legendDot: { width: 5, height: 5, borderRadius: 3 },
    legendText: { fontSize: 10, color: Palette.textSecondary },
    privateText: { marginLeft: 'auto', fontSize: 10, color: Palette.textSecondary },
    choreList: { gap: 10 },
    error: { fontSize: 14, color: Palette.error },
    snackbar: { backgroundColor: Palette.primary },
    muted: { fontSize: 14, color: Palette.textSecondary, textAlign: 'center' },
    choreCard: { flexDirection: 'row', alignItems: 'center', paddingRight: 14, borderRadius: 18, borderWidth: 1, borderColor: Palette.border, backgroundColor: Palette.surface },
    choreMain: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 78, padding: 14 },
    choreIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
    choreCopy: { flex: 1, marginLeft: 14, gap: 2 },
    choreDay: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: Palette.primary },
    choreTitle: { fontSize: 16, fontWeight: '800', color: Palette.text },
    choreMeta: { fontSize: 12, color: Palette.textSecondary },
    choreDescription: { marginTop: 2, fontSize: 11, color: Palette.textSecondary },
    choreActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    choreAction: { padding: 4, borderRadius: 10 },
    pressed: { opacity: 0.75 },
});
