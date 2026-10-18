import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Palette, Radius } from '@/constants/onboarding';
import { api, errorMessage } from '@/lib/api';

const APARTMENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const frequencies = [
  { value: 'once', label: 'Once' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'daily', label: 'Daily' },
] as const;

const categories = [
  { value: 'cleaning', label: 'Cleaning', icon: 'broom' },
  { value: 'maintenance', label: 'Maintenance', icon: 'tools' },
  { value: 'shopping', label: 'Shopping', icon: 'cart-outline' },
  { value: 'other', label: 'Other', icon: 'dots-horizontal' },
] as const;

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function CreateChoreScreen() {
  const [title, setTitle] = useState('');
  const [category, setCategory] =
    useState<(typeof categories)[number]['value']>('other');
  const [frequency, setFrequency] = useState<(typeof frequencies)[number]['value']>('weekly');
  const [bestDay, setBestDay] = useState('Wed');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const close = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/chores');
    }
  };

  const save = async () => {
    if (!title.trim()) {
      setError('Add a name for the chore.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await api('POST', '/tasks', {
        apartment_id: APARTMENT_ID,
        title: title.trim(),
        frequency: frequency === 'once' ? 'none' : frequency,
        category,
      });
      router.replace('/chores');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.topBar}>
          <Pressable onPress={close} hitSlop={12} accessibilityLabel="Close">
            <MaterialCommunityIcons name="close" size={24} color={Palette.text} />
          </Pressable>
          <Pressable onPress={() => void save()} disabled={saving} hitSlop={12}>
            <Text style={styles.save}>Save</Text>
          </Pressable>
        </View>

        <View style={styles.intro}>
          <Text style={styles.title}>Create a chore</Text>
          <Text style={styles.subtitle}>
            Make the invisible work visible, then let Room8 help share it fairly.
          </Text>
        </View>

        <Text style={styles.label}>What needs doing?</Text>
        <TextInput
          value={title}
          onChangeText={(value) => {
            setTitle(value);
            if (error) setError('');
          }}
          placeholder="e.g. Water the plants"
          placeholderTextColor={Palette.textSecondary}
          style={styles.input}
          accessibilityLabel="Chore name"
          returnKeyType="done"
        />

        <Text style={styles.label}>Category</Text>
        <View style={styles.categoryGrid}>
          {categories.map((item) => (
            <Pressable
              key={item.value}
              onPress={() => setCategory(item.value)}
              style={[styles.category, category === item.value && styles.categorySelected]}>
              <MaterialCommunityIcons
                name={item.icon}
                size={18}
                color={category === item.value ? Palette.primary : Palette.textSecondary}
              />
              <Text
                style={[
                  styles.categoryText,
                  category === item.value && styles.categoryTextSelected,
                ]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>How often?</Text>
        <View style={styles.frequencyRow}>
          {frequencies.map((item) => (
            <Pressable
              key={item.value}
              onPress={() => setFrequency(item.value)}
              style={[styles.frequency, frequency === item.value && styles.frequencySelected]}>
              <Text
                style={[
                  styles.frequencyText,
                  frequency === item.value && styles.frequencyTextSelected,
                ]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Best day</Text>
        <View style={styles.daysRow}>
          {days.map((day) => (
            <Pressable
              key={day}
              onPress={() => setBestDay(day)}
              style={[styles.day, bestDay === day && styles.daySelected]}>
              <Text style={[styles.dayText, bestDay === day && styles.dayTextSelected]}>
                {day}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.infoCard}>
          <MaterialCommunityIcons name="star-outline" size={18} color={Palette.primary} />
          <Text style={styles.infoText}>
            Room8 will schedule this fairly based on everyone&apos;s availability and balance.
          </Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable onPress={() => void save()} disabled={saving} style={styles.primaryButton}>
          {saving ? (
            <Text style={styles.primaryButtonText}>Saving...</Text>
          ) : (
            <Text style={styles.primaryButtonText}>Create chore</Text>
          )}
        </Pressable>
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
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  save: { fontSize: 14, fontWeight: '800', color: Palette.primary },
  intro: { gap: 8, marginTop: 12, marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', color: Palette.text },
  subtitle: { fontSize: 14, lineHeight: 20, color: Palette.textSecondary },
  label: { marginTop: 4, fontSize: 13, fontWeight: '800', color: Palette.text },
  input: {
    minHeight: 52,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.input,
    backgroundColor: Palette.surface,
    color: Palette.text,
    fontSize: 15,
  },
  frequencyRow: { flexDirection: 'row', gap: 8 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  category: {
    width: '48%',
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.input,
    backgroundColor: Palette.surface,
  },
  categorySelected: { borderColor: Palette.primary, backgroundColor: Palette.mint },
  categoryText: { fontSize: 13, fontWeight: '700', color: Palette.textSecondary },
  categoryTextSelected: { color: Palette.primary },
  frequency: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.input,
    backgroundColor: Palette.surface,
  },
  frequencySelected: { borderColor: Palette.primary, backgroundColor: Palette.mint },
  frequencyText: { fontSize: 13, fontWeight: '700', color: Palette.textSecondary },
  frequencyTextSelected: { color: Palette.primary },
  daysRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  day: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: Radius.input,
    backgroundColor: Palette.surface,
  },
  daySelected: { backgroundColor: Palette.primary },
  dayText: { fontSize: 12, fontWeight: '700', color: Palette.text },
  dayTextSelected: { color: Palette.onPrimary },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
    borderRadius: Radius.input,
    backgroundColor: '#DDD8F5',
  },
  infoText: { flex: 1, fontSize: 13, lineHeight: 18, color: Palette.text },
  error: { fontSize: 14, color: Palette.error },
  primaryButton: {
    alignItems: 'center',
    paddingVertical: 15,
    borderRadius: Radius.button,
    backgroundColor: Palette.primary,
  },
  primaryButtonText: { fontSize: 15, fontWeight: '800', color: Palette.onPrimary },
});
