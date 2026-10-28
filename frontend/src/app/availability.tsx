import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Snackbar } from 'react-native-paper';

import { PrimaryButton } from '@/components/onboarding';
import { APARTMENT_ID } from '@/constants/dev-session';
import { Palette, Radius } from '@/constants/onboarding';
import { api, errorMessage } from '@/lib/api';
import {
    DAYS,
    normalizeTime,
    toMinutes,
    validateBlocks,
    type Day,
    type HouseMember,
    type MyBlock,
} from '@/lib/availability';

type CalendarEvent = { id: string; user_id: string; person: string; title: string; date: string; start: string; end: string; kind: 'busy' | 'task' };
type MyGoogleEvent = { id: string; date: string; start: string; end: string; title: string };

function dateKey(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function startOfWeek(date: Date) {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
    return result;
}

function addDays(date: Date, days: number) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

function weekdayOf(date: string): Day {
    const dayIndex = new Date(`${date}T00:00:00`).getDay();
    return DAYS[(dayIndex + 6) % 7].key;
}

export default function AvailabilityScreen() {
    const [tab, setTab] = useState<'mine' | 'house'>('mine');
    const [day, setDay] = useState<Day>('monday');
    const [blocks, setBlocks] = useState<MyBlock[]>([]);
    const [members, setMembers] = useState<HouseMember[]>([]);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [googleConnected, setGoogleConnected] = useState(false);
    const [googleConfigured, setGoogleConfigured] = useState(false);
    const [connectingGoogle, setConnectingGoogle] = useState(false);
    const [calendarWeek, setCalendarWeek] = useState(() => startOfWeek(new Date()));
    const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));
    const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
    const [myGoogleEvents, setMyGoogleEvents] = useState<MyGoogleEvent[]>([]);

    const load = useCallback(async () => {
        try {
            const [mine, house, google] = await Promise.all([
                api('GET', '/availability/me'),
                api('GET', `/availability/apartment/${APARTMENT_ID}`),
                api('GET', '/availability/google/status'),
            ]);
            setBlocks(mine.blocks);
            setMembers(house.members);
            setGoogleConnected(google.connected);
            setGoogleConfigured(google.configured);
        } catch (e) {
            setMessage(errorMessage(e));
        }
    }, []);

    const loadCalendar = useCallback(async () => {
        const from = dateKey(calendarWeek);
        const to = dateKey(addDays(calendarWeek, 90));
        try {
            await api('POST', '/availability/google/sync', { from, to });
            const [result, mine] = await Promise.all([
                api('GET', `/availability/calendar?apartment_id=${encodeURIComponent(APARTMENT_ID)}&from=${from}&to=${to}`),
                api('GET', `/availability/google/events?from=${from}&to=${to}`),
            ]);
            setCalendarEvents(result.events);
            setMyGoogleEvents(mine.events);
        } catch (e) {
            setMessage(errorMessage(e));
        }
    }, [calendarWeek]);

    useFocusEffect(
        useCallback(() => {
            load();
            if (tab === 'house' || googleConnected) void loadCalendar();
        }, [load, loadCalendar, tab, googleConnected]),
    );

    const dayBlocks = blocks.map((b, index) => ({ b, index })).filter(({ b }) => b.day_of_week === day);
    const googleDayBlocks = myGoogleEvents
        .filter((event) => weekdayOf(event.date) === day)
        .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
    const configuredDays = DAYS.filter((d) => blocks.some((b) => b.day_of_week === d.key)).length;

    function update(index: number, patch: Partial<MyBlock>) {
        setBlocks((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
    }

    function addBlock() {
        const last = dayBlocks[dayBlocks.length - 1]?.b;
        const start = last && last.end < '22:00' ? last.end : '09:00';
        const end = toMinutes(start) >= 22 * 60 ? '24:00' : `${String(Math.min(toMinutes(start) / 60 + 2, 24) | 0).padStart(2, '0')}:${start.slice(3)}`;
        setBlocks((prev) => [...prev, { day_of_week: day, start, end, label: null }]);
    }

    function copyToWeekdays() {
        const source = blocks.filter((b) => b.day_of_week === day);
        const targets = DAYS.filter((d) => d.key !== day && d.key !== 'saturday' && d.key !== 'sunday').map((d) => d.key);
        setBlocks((prev) => [
            ...prev.filter((b) => !targets.includes(b.day_of_week)),
            ...targets.flatMap((t) => source.map((b) => ({ ...b, day_of_week: t }))),
        ]);
        setMessage('Copiado a los días laborables (sin guardar todavía)');
    }

    async function save() {
        // Normaliza "9:00" -> "09:00" antes de validar y enviar
        const clean = blocks.map((b) => ({
            ...b,
            start: normalizeTime(b.start) ?? b.start,
            end: normalizeTime(b.end) ?? b.end,
            label: b.label?.trim() ? b.label.trim() : null,
        }));
        const problem = validateBlocks(clean);
        if (problem) {
            setMessage(problem);
            return;
        }
        setSaving(true);
        try {
            const saved = await api('PUT', '/availability/me', {
                blocks: clean.map(({ label, ...rest }) => (label ? { ...rest, label } : rest)),
            });
            setBlocks(saved.blocks);
            const house = await api('GET', `/availability/apartment/${APARTMENT_ID}`);
            setMembers(house.members);
            setMessage('Disponibilidad guardada');
        } catch (e) {
            setMessage(errorMessage(e));
        } finally {
            setSaving(false);
        }
    }

    const dayPills = (hasData: (d: Day) => boolean) => (
        <View style={styles.daysRow}>
            {DAYS.map((d) => {
                const selected = d.key === day;
                return (
                    <Pressable key={d.key} onPress={() => setDay(d.key)} style={[styles.day, selected && styles.daySelected]}>
                        <Text style={[styles.dayLabel, selected && styles.daySelectedText]}>{d.short}</Text>
                        <View style={[styles.dot, hasData(d.key) && styles.dotBusy, selected && styles.dotSelected]} />
                    </Pressable>
                );
            })}
        </View>
    );

    async function connectGoogle() {
        setConnectingGoogle(true);
        try {
            const { url } = await api('GET', '/availability/google/connect');
            const result = await WebBrowser.openAuthSessionAsync(url, 'frontend://calendar/google-callback');
            if (result.type !== 'success') return;
            const status = await api('GET', '/availability/google/status');
            setGoogleConnected(status.connected);
            if (status.connected) {
                setTab('mine');
                setMessage('Google Calendar conectado. Actualizando tus franjas…');
            } else {
                setMessage('No se pudo conectar Google Calendar');
            }
        } catch (e) { setMessage(errorMessage(e)); }
        finally { setConnectingGoogle(false); }
    }

    async function disconnectGoogle() {
        try {
            await api('DELETE', '/availability/google');
            setGoogleConnected(false);
            setMyGoogleEvents([]);
            setMessage('Google Calendar desconectado');
        } catch (e) { setMessage(errorMessage(e)); }
    }

    return (
        <SafeAreaView style={styles.safeArea}>
            <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
                <View style={styles.topBar}>
                    <Pressable onPress={() => router.back()} accessibilityLabel="Volver" style={styles.back}>
                        <MaterialCommunityIcons name="arrow-left" size={22} color={Palette.text} />
                    </Pressable>
                    <View>
                        <Text style={styles.eyebrow}>HORARIOS</Text>
                        <Text style={styles.title}>Disponibilidad</Text>
                    </View>
                </View>

                <View style={styles.segmented}>
                    {(
                        [
                            ['mine', 'Mi horario'],
                            ['house', 'La casa'],
                        ] as const
                    ).map(([key, label]) => (
                        <Pressable key={key} onPress={() => setTab(key)} style={tab === key ? styles.segmentSelected : styles.segment}>
                            <Text style={tab === key ? styles.segmentSelectedText : styles.segmentText}>{label}</Text>
                        </Pressable>
                    ))}
                </View>

                {tab === 'mine' ? (
                    <>
                        <Text style={styles.hint}>
                            Añade las horas en las que estás ocupado. Tus compañeros solo verán «Ocupado»; el nombre de la franja es privado.
                        </Text>
                        {dayPills((d) => blocks.some((b) => b.day_of_week === d))}

                        {dayBlocks.length === 0 && <Text style={styles.empty}>Sin franjas este día: apareces como libre.</Text>}
                        {dayBlocks.map(({ b, index }) => (
                            <View key={index} style={styles.card}>
                                <View style={styles.timeRow}>
                                    <TextInput
                                        style={styles.time}
                                        value={b.start}
                                        onChangeText={(t) => update(index, { start: t })}
                                        placeholder="09:00"
                                        maxLength={5}
                                        accessibilityLabel="Hora de inicio"
                                    />
                                    <Text style={styles.dash}>–</Text>
                                    <TextInput
                                        style={styles.time}
                                        value={b.end}
                                        onChangeText={(t) => update(index, { end: t })}
                                        placeholder="13:00"
                                        maxLength={5}
                                        accessibilityLabel="Hora de fin"
                                    />
                                    <Pressable
                                        onPress={() => setBlocks((prev) => prev.filter((_, i) => i !== index))}
                                        accessibilityLabel="Eliminar franja"
                                        style={styles.delete}>
                                        <MaterialCommunityIcons name="trash-can-outline" size={22} color={Palette.error} />
                                    </Pressable>
                                </View>
                                <TextInput
                                    style={styles.labelInput}
                                    value={b.label ?? ''}
                                    onChangeText={(t) => update(index, { label: t })}
                                    placeholder="Nombre (opcional, solo lo ves tú)"
                                    maxLength={60}
                                />
                            </View>
                        ))}

                        <Pressable style={styles.addBlock} onPress={addBlock}>
                            <MaterialCommunityIcons name="plus" size={18} color={Palette.primary} />
                            <Text style={styles.addBlockText}>Añadir franja</Text>
                        </Pressable>
                        {dayBlocks.length > 0 && (
                            <Pressable onPress={copyToWeekdays}>
                                <Text style={styles.link}>Copiar este día a lunes–viernes</Text>
                            </Pressable>
                        )}

                        <View style={styles.google}>
                            <MaterialCommunityIcons name="google" size={18} color={Palette.textSecondary} />
                            <View style={{ flex: 1 }}>
                                <Text style={styles.googleText}>{googleConnected ? 'Google Calendar conectado' : 'Importar eventos como horas ocupadas'}</Text>
                                <Text style={styles.googleHint}>Solo se comparten las horas, nunca sus títulos ni detalles.</Text>
                            </View>
                            <Pressable disabled={!googleConfigured || connectingGoogle} onPress={() => void (googleConnected ? disconnectGoogle() : connectGoogle())}>
                                <Text style={[styles.googleAction, (!googleConfigured || connectingGoogle) && { opacity: 0.5 }]}>{googleConnected ? 'Desconectar' : connectingGoogle ? 'Conectando…' : 'Conectar'}</Text>
                            </Pressable>
                        </View>
                        {!googleConfigured ? <Text style={styles.googleHint}>Falta configurar OAuth de Google en el servidor.</Text> : null}

                        {googleConnected && googleDayBlocks.map((event) => (
                            <View key={event.id} style={styles.card}>
                                <View style={styles.timeRow}>
                                    <Text style={styles.importedTime}>{event.start}</Text>
                                    <Text style={styles.dash}>–</Text>
                                    <Text style={styles.importedTime}>{event.end}</Text>
                                    <View style={styles.readOnlyTag}><Text style={styles.readOnlyTagText}>Google</Text></View>
                                </View>
                                <Text style={styles.importedLabel}>
                                    {event.title} · {new Date(`${event.date}T00:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })}
                                </Text>
                            </View>
                        ))}

                        <Text style={styles.hint}>Días configurados: {configuredDays}/7</Text>
                        <PrimaryButton title="Guardar disponibilidad" onPress={save} loading={saving} />
                    </>
                ) : (
                    <>
                        <View style={styles.calendarNav}>
                            <Pressable accessibilityLabel="Semana anterior" onPress={() => { const next = addDays(calendarWeek, -7); setCalendarWeek(next); setSelectedDate(dateKey(next)); }}>
                                <MaterialCommunityIcons name="chevron-left" size={24} color={Palette.primary} />
                            </Pressable>
                            <Text style={styles.calendarTitle}>{calendarWeek.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} – {addDays(calendarWeek, 6).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                            <Pressable accessibilityLabel="Semana siguiente" onPress={() => { const next = addDays(calendarWeek, 7); setCalendarWeek(next); setSelectedDate(dateKey(next)); }}>
                                <MaterialCommunityIcons name="chevron-right" size={24} color={Palette.primary} />
                            </Pressable>
                        </View>
                        <View style={styles.dateRow}>
                            {DAYS.map((d, index) => {
                                const date = addDays(calendarWeek, index);
                                const key = dateKey(date);
                                const selected = key === selectedDate;
                                return <Pressable key={key} accessibilityLabel={date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })} onPress={() => setSelectedDate(key)} style={[styles.dateCell, selected && styles.dateCellSelected]}>
                                    <Text style={[styles.dateWeekday, selected && styles.dateCellSelectedText]}>{d.short}</Text>
                                    <Text style={[styles.dateNumber, selected && styles.dateCellSelectedText]}>{date.getDate()}</Text>
                                    <View style={[styles.dateDot, calendarEvents.some((event) => event.date === key) && styles.dateDotActive]} />
                                </Pressable>;
                            })}
                        </View>
                        <Text style={styles.selectedDateTitle}>{new Date(`${selectedDate}T00:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</Text>
                        <View style={styles.scale}>
                            {[6, 12, 18, 24].map((hour) => <Text key={hour} style={styles.scaleText}>{String(hour).padStart(2, '0')}h</Text>)}
                        </View>
                        {members.length === 0 && <Text style={styles.empty}>No hay compañeros en esta casa.</Text>}
                        {members.map((member) => {
                            const events = calendarEvents.filter((event) => event.date === selectedDate && event.user_id === member.id);
                            return <View key={member.id} style={styles.card}>
                                <View style={styles.memberHeader}>
                                    <Text style={styles.memberName}>{member.full_name}{member.isCurrentUser ? ' (tú)' : ''}</Text>
                                    <Text style={styles.memberState}>{events.length === 0 ? 'Libre todo el día' : `${events.length} franja(s) ocupada(s)`}</Text>
                                </View>
                                <View style={styles.bar}>
                                    {events.map((event) => {
                                        const from = Math.max(toMinutes(event.start), 6 * 60);
                                        const to = Math.min(toMinutes(event.end), 24 * 60);
                                        if (to <= from) return null;
                                        return <View key={event.id} accessibilityLabel={`${event.title} de ${event.start} a ${event.end}`} style={[styles.busy, event.kind === 'task' && styles.taskBusy, { left: `${((from - 360) / 1080) * 100}%`, width: `${((to - from) / 1080) * 100}%` }]} />;
                                    })}
                                </View>
                                {events.map((event) => <Text key={`${event.id}-label`} style={event.kind === 'task' ? styles.taskText : styles.busyText}>
                                    {event.start}–{event.end} · {event.kind === 'task' ? event.title : 'Ocupado'}
                                </Text>)}
                            </View>;
                        })}
                        {!calendarEvents.some((event) => event.date === selectedDate) ? <Text style={styles.empty}>Sin franjas ocupadas ni tareas asignadas este día.</Text> : null}
                    </>
                )}
            </ScrollView>
            <Snackbar visible={!!message} onDismiss={() => setMessage('')} duration={3500}>
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
    segmented: { flexDirection: 'row', padding: 3, borderRadius: Radius.input, backgroundColor: Palette.segment },
    segment: { flex: 1, alignItems: 'center', paddingVertical: 9 },
    segmentSelected: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9, backgroundColor: Palette.surface },
    segmentText: { fontSize: 13, fontWeight: '600', color: Palette.textSecondary },
    segmentSelectedText: { fontSize: 13, fontWeight: '700', color: Palette.text },
    hint: { fontSize: 13, color: Palette.textSecondary },
    empty: { fontSize: 13, color: Palette.textSecondary, textAlign: 'center', paddingVertical: 8 },
    daysRow: { flexDirection: 'row', justifyContent: 'space-between' },
    day: { width: 42, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 12, gap: 4 },
    daySelected: { backgroundColor: Palette.primary },
    dayLabel: { fontSize: 14, fontWeight: '700', color: Palette.text },
    daySelectedText: { color: Palette.onPrimary },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'transparent' },
    dotBusy: { backgroundColor: Palette.peach },
    dotSelected: { backgroundColor: Palette.sun },
    card: { padding: 12, gap: 10, borderRadius: Radius.input, borderWidth: 1, borderColor: Palette.border, backgroundColor: Palette.surface },
    timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    time: { width: 76, paddingVertical: 8, textAlign: 'center', fontSize: 16, fontWeight: '700', color: Palette.text, borderRadius: 10, borderWidth: 1, borderColor: Palette.border, backgroundColor: Palette.background },
    dash: { fontSize: 16, color: Palette.textSecondary },
    delete: { marginLeft: 'auto', padding: 6 },
    labelInput: { paddingVertical: 8, paddingHorizontal: 10, fontSize: 14, color: Palette.text, borderRadius: 10, borderWidth: 1, borderColor: Palette.border, backgroundColor: Palette.background },
    addBlock: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: Radius.input, borderWidth: 1, borderStyle: 'dashed', borderColor: Palette.primary },
    addBlockText: { fontSize: 14, fontWeight: '700', color: Palette.primary },
    link: { fontSize: 13, fontWeight: '600', color: Palette.primary, textAlign: 'center' },
    google: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: Radius.input, backgroundColor: Palette.mint, opacity: 0.8 },
    googleText: { fontSize: 13, color: Palette.textSecondary },
    googleHint: { fontSize: 11, color: Palette.textSecondary },
    googleAction: { fontSize: 12, fontWeight: '700', color: Palette.primary },
    calendarNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    calendarTitle: { fontSize: 14, fontWeight: '700', color: Palette.text },
    dateRow: { flexDirection: 'row', justifyContent: 'space-between' },
    dateCell: { width: 42, minHeight: 66, alignItems: 'center', justifyContent: 'center', borderRadius: 12, gap: 3 },
    dateCellSelected: { backgroundColor: Palette.primary },
    dateCellSelectedText: { color: Palette.onPrimary },
    dateWeekday: { fontSize: 11, fontWeight: '700', color: Palette.textSecondary },
    dateNumber: { fontSize: 17, fontWeight: '800', color: Palette.text },
    dateDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'transparent' },
    dateDotActive: { backgroundColor: Palette.peach },
    selectedDateTitle: { fontSize: 15, fontWeight: '800', color: Palette.text, textTransform: 'capitalize' },
    scale: { flexDirection: 'row', justifyContent: 'space-between' },
    scaleText: { fontSize: 11, color: Palette.textSecondary },
    bar: { height: 18, borderRadius: 9, backgroundColor: Palette.mint, overflow: 'hidden' },
    busy: { position: 'absolute', top: 0, bottom: 0, backgroundColor: Palette.peach },
    taskBusy: { backgroundColor: Palette.primary },
    busyText: { fontSize: 12, color: Palette.textSecondary },
    taskText: { fontSize: 12, fontWeight: '700', color: Palette.primary },
    importedTime: { width: 76, paddingVertical: 8, textAlign: 'center', fontSize: 16, fontWeight: '700', color: Palette.textSecondary, borderRadius: 10, borderWidth: 1, borderColor: Palette.border, backgroundColor: Palette.background },
    readOnlyTag: { marginLeft: 'auto', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, backgroundColor: Palette.mint },
    readOnlyTagText: { fontSize: 11, fontWeight: '700', color: Palette.primary },
    importedLabel: { fontSize: 13, color: Palette.textSecondary },
    memberHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    memberName: { fontSize: 15, fontWeight: '700', color: Palette.text },
    memberState: { fontSize: 12, color: Palette.textSecondary },
});
