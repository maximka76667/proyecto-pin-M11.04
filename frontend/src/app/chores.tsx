import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
    ActivityIndicator,
    NativeScrollEvent,
    NativeSyntheticEvent,
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

type Task = {
    id: string;
    title: string;
    description: string | null;
    frequency: 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly';
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

const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

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

function formatWeekTitle(weekStart: Date) {
    const weekEnd = addDays(weekStart, 6);
    return `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

export default function ChoresScreen() {
    const { created } = useLocalSearchParams<{ created?: string }>();
    const today = new Date();
    const [weekStart, setWeekStart] = useState(() => startOfWeek(today));
    const [selectedDay, setSelectedDay] = useState(() => dateKey(today));
    const [tasks, setTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [calendarWidth, setCalendarWidth] = useState(0);
    const calendarRef = useRef<ScrollView>(null);

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

    const changeWeek = (amount: number) => {
        const nextWeek = addDays(weekStart, amount * 7);
        setWeekStart(nextWeek);
        setSelectedDay(dateKey(nextWeek));
    };

    const handleCalendarScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        if (!calendarWidth) return;

        const page = Math.round(event.nativeEvent.contentOffset.x / calendarWidth);
        if (page === 1) return;

        changeWeek(page - 1);
        calendarRef.current?.scrollTo({ x: calendarWidth, animated: false });
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

    const renderWeek = (week: Date) => (
        <View key={dateKey(week)} style={[styles.weekPage, calendarWidth ? { width: calendarWidth - 24 } : null]}>
            <View style={styles.weekHeader}>
                <Pressable accessibilityLabel="Previous week" hitSlop={10} onPress={() => changeWeek(-1)}>
                    <MaterialCommunityIcons name="chevron-left" size={20} color={Palette.primary} />
                </Pressable>
                <Text style={styles.weekTitle}>{formatWeekTitle(week)}</Text>
                <Pressable accessibilityLabel="Next week" hitSlop={10} onPress={() => changeWeek(1)}>
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
                        <Text style={styles.title}>Chore plan</Text>
                    </View>
                    <Pressable
                        style={styles.addButton}
                        accessibilityLabel="Add a chore"
                        onPress={() => router.push('/chores/create')}>
                        <MaterialCommunityIcons name="plus" size={25} color={Palette.onPrimary} />
                    </Pressable>
                </View>

                <View style={styles.segmented}>
                    <View style={styles.segmentSelected}>
                        <Text style={styles.segmentSelectedText}>Week</Text>
                    </View>
                    <Pressable style={styles.segment}>
                        <Text style={styles.segmentText}>Balance</Text>
                    </Pressable>
                </View>

                {created === '1' ? <Text style={styles.success}>Chore created successfully.</Text> : null}

                <View
                    style={styles.weekCard}
                    onLayout={(event) => setCalendarWidth(event.nativeEvent.layout.width)}>
                    <ScrollView
                        ref={calendarRef}
                        horizontal
                        pagingEnabled
                        showsHorizontalScrollIndicator={false}
                        contentOffset={{ x: calendarWidth, y: 0 }}
                        onMomentumScrollEnd={handleCalendarScrollEnd}>
                        {weeks.map(renderWeek)}
                    </ScrollView>
                </View>

                <View style={styles.legend}>
                    <View style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: Palette.border }]} />
                        <Text style={styles.legendText}>free time</Text>
                    </View>
                    <View style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: Palette.peach }]} />
                        <Text style={styles.legendText}>busy</Text>
                    </View>
                    <Text style={styles.privateText}>Private blocks</Text>
                </View>

                {loading ? <ActivityIndicator color={Palette.primary} /> : null}
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <View style={styles.choreList}>
                    {apartmentTasks.map(({ task, assignment }) => (
                        (() => {
                            const assignee = assignment?.user.full_name ?? 'Unassigned';

                            return (
                                <Pressable
                                    key={`${task.id}-${assignment?.due_date ?? 'unassigned'}`}
                                    onPress={() =>
                                        router.push({
                                            pathname: '/chores/details',
                                            params: {
                                                taskId: task.id,
                                            },
                                        })
                                    }
                                    style={({ pressed }) => [styles.choreCard, pressed && styles.pressed]}>
                                    <View style={[styles.choreIcon, { backgroundColor: Palette.mint }]}>
                                        <MaterialCommunityIcons name="format-list-checks" size={21} color={Palette.primary} />
                                    </View>
                                    <View style={styles.choreCopy}>
                                        <Text style={styles.choreDay}>{task.frequency}</Text>
                                        <Text style={styles.choreTitle}>{task.title}</Text>
                                        <Text style={styles.choreMeta}>{assignee}</Text>
                                        {task.description ? <Text style={styles.choreDescription}>{task.description}</Text> : null}
                                    </View>
                                    <MaterialCommunityIcons name="chevron-right" size={20} color={Palette.textSecondary} />
                                </Pressable>
                            );
                        })()
                    ))}
                </View>
                {!loading && !error && apartmentTasks.length === 0 ? (
                    <Text style={styles.muted}>No chores have been created yet.</Text>
                ) : null}
            </ScrollView>
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
    success: { padding: 12, borderRadius: Radius.input, backgroundColor: Palette.mint, color: Palette.primary, fontSize: 14, fontWeight: '700' },
    muted: { fontSize: 14, color: Palette.textSecondary, textAlign: 'center' },
    choreCard: { flexDirection: 'row', alignItems: 'center', minHeight: 78, padding: 12, borderRadius: Radius.input, borderWidth: 1, borderColor: Palette.border, backgroundColor: Palette.surface },
    choreIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
    choreCopy: { flex: 1, marginLeft: 12, gap: 2 },
    choreDay: { fontSize: 9, fontWeight: '700', letterSpacing: 1, color: Palette.primary },
    choreTitle: { fontSize: 15, fontWeight: '700', color: Palette.text },
    choreMeta: { fontSize: 11, color: Palette.textSecondary },
    choreDescription: { marginTop: 2, fontSize: 11, color: Palette.textSecondary },
    pressed: { opacity: 0.75 },
});