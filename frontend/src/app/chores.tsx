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

import { Palette, Radius } from '@/constants/onboarding';
import { api, errorMessage } from '@/lib/api';

const APARTMENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

type Task = {
    id: string;
    title: string;
    frequency: 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly';
    status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
    assignments: {
        status: string;
        due_date: string;
        user: { full_name: string };
    }[];
};

const days = [
    { label: 'M', date: '21' },
    { label: 'T', date: '22' },
    { label: 'W', date: '23' },
    { label: 'T', date: '24' },
    { label: 'F', date: '25' },
    { label: 'S', date: '26' },
    { label: 'S', date: '27' },
];

export default function ChoresScreen() {
    const [selectedDay, setSelectedDay] = useState('21');
    const [tasks, setTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

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

                <View style={styles.weekCard}>
                    <View style={styles.weekHeader}>
                        <Pressable accessibilityLabel="Previous week" hitSlop={10}>
                            <MaterialCommunityIcons name="chevron-left" size={20} color={Palette.primary} />
                        </Pressable>
                        <Text style={styles.weekTitle}>Sep 21 - 27</Text>
                        <Pressable accessibilityLabel="Next week" hitSlop={10}>
                            <MaterialCommunityIcons name="chevron-right" size={20} color={Palette.primary} />
                        </Pressable>
                    </View>

                    <View style={styles.daysRow}>
                        {days.map((day) => {
                            const selected = day.date === selectedDay;
                            return (
                                <Pressable
                                    key={`${day.label}-${day.date}`}
                                    onPress={() => setSelectedDay(day.date)}
                                    style={[styles.day, selected && styles.daySelected]}>
                                    <Text style={[styles.dayLabel, selected && styles.daySelectedText]}>{day.label}</Text>
                                    <Text style={[styles.dayDate, selected && styles.daySelectedText]}>{day.date}</Text>
                                    <View style={[styles.dayDot, selected && styles.dayDotSelected]} />
                                </Pressable>
                            );
                        })}
                    </View>
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
                    {tasks.map((task) => (
                        (() => {
                            const assignment = task.assignments[0];
                            // Assignment is intentionally optional until the scheduler module exists.
                            const assignee = assignment?.user.full_name ?? 'Unassigned';
                            const dueDate = assignment
                                ? new Date(`${assignment.due_date}T00:00:00`).toLocaleDateString(
                                    'en-US',
                                    { month: 'short', day: 'numeric' },
                                )
                                : 'Anytime';

                            return (
                        <Pressable
                            key={task.id}
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
                                <Text style={styles.choreMeta}>{assignee} · {dueDate}</Text>
                            </View>
                            <MaterialCommunityIcons name="chevron-right" size={20} color={Palette.textSecondary} />
                        </Pressable>
                            );
                        })()
                    ))}
                </View>
                {!loading && !error && tasks.length === 0 ? (
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
    weekHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2, marginBottom: 12 },
    weekTitle: { fontSize: 13, fontWeight: '700', color: Palette.text },
    daysRow: { flexDirection: 'row', justifyContent: 'space-between' },
    day: { width: 36, minHeight: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 10, gap: 2 },
    daySelected: { backgroundColor: Palette.primary },
    dayLabel: { fontSize: 9, fontWeight: '700', color: Palette.textSecondary },
    dayDate: { fontSize: 14, fontWeight: '800', color: Palette.text },
    daySelectedText: { color: Palette.onPrimary },
    dayDot: { width: 4, height: 4, borderRadius: 2, marginTop: 2, backgroundColor: Palette.border },
    dayDotSelected: { backgroundColor: Palette.peach },
    legend: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    legendDot: { width: 5, height: 5, borderRadius: 3 },
    legendText: { fontSize: 10, color: Palette.textSecondary },
    privateText: { marginLeft: 'auto', fontSize: 10, color: Palette.textSecondary },
    choreList: { gap: 10 },
    error: { fontSize: 14, color: Palette.error },
    muted: { fontSize: 14, color: Palette.textSecondary, textAlign: 'center' },
    choreCard: { flexDirection: 'row', alignItems: 'center', minHeight: 78, padding: 12, borderRadius: Radius.input, borderWidth: 1, borderColor: Palette.border, backgroundColor: Palette.surface },
    choreIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
    choreCopy: { flex: 1, marginLeft: 12, gap: 2 },
    choreDay: { fontSize: 9, fontWeight: '700', letterSpacing: 1, color: Palette.primary },
    choreTitle: { fontSize: 15, fontWeight: '700', color: Palette.text },
    choreMeta: { fontSize: 11, color: Palette.textSecondary },
    pressed: { opacity: 0.75 },
});