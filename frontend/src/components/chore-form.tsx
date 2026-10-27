import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { type ReactNode, useState } from 'react';
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
import { errorMessage } from '@/lib/api';

export type ChoreCategory = 'cleaning' | 'maintenance' | 'shopping' | 'other';
export type ChoreFrequency = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly';

export type ChoreFormValues = {
  title: string;
  description: string;
  category: ChoreCategory;
  frequency: ChoreFrequency;
};

// Los valores son los del backend: 'none' es una tarea que se hace una sola vez
const frequencies = [
  { value: 'none', label: 'Una vez' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'daily', label: 'Diaria' },
] as const;

export const choreCategories = [
  { value: 'cleaning', label: 'Limpieza', icon: 'broom', tint: Palette.lavender },
  { value: 'maintenance', label: 'Mantenimiento', icon: 'tools', tint: Palette.mint },
  { value: 'shopping', label: 'Compras', icon: 'cart-outline', tint: Palette.peach },
  { value: 'other', label: 'Otra', icon: 'dots-horizontal', tint: Palette.sun },
] as const;

const emptyValues: ChoreFormValues = {
  title: '',
  description: '',
  category: 'other',
  frequency: 'weekly',
};

// Vuelve a la lista aunque el formulario se haya abierto directamente por URL
export function closeChoreForm() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/chores');
  }
}

type ChoreFormProps = {
  heading: string;
  subtitle: string;
  submitLabel: string;
  initialValues?: ChoreFormValues;
  children?: ReactNode;
  onSubmit: (values: ChoreFormValues) => Promise<void>;
};

// Formulario de crear y editar tarea: valida el nombre y muestra el error que lance onSubmit
export function ChoreForm({
  heading,
  subtitle,
  submitLabel,
  initialValues = emptyValues,
  children,
  onSubmit,
}: ChoreFormProps) {
  const [title, setTitle] = useState(initialValues.title);
  const [description, setDescription] = useState(initialValues.description);
  const [category, setCategory] = useState(initialValues.category);
  const [frequency, setFrequency] = useState(initialValues.frequency);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim()) {
      setError('Añade un nombre para la tarea.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        category,
        frequency,
      });
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
          <Pressable onPress={closeChoreForm} hitSlop={12} accessibilityLabel="Cerrar">
            <MaterialCommunityIcons name="close" size={24} color={Palette.text} />
          </Pressable>
          <Pressable onPress={() => void save()} disabled={saving} hitSlop={12}>
            <Text style={styles.save}>Guardar</Text>
          </Pressable>
        </View>

        <View style={styles.intro}>
          <Text style={styles.title}>{heading}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>

        <Text style={styles.label}>¿Qué hay que hacer?</Text>
        <TextInput
          value={title}
          onChangeText={(value) => {
            setTitle(value);
            if (error) setError('');
          }}
          placeholder="p. ej. Regar las plantas"
          placeholderTextColor={Palette.textSecondary}
          style={styles.input}
          accessibilityLabel="Nombre de la tarea"
          returnKeyType="done"
        />

        <Text style={styles.label}>Detalles (opcional)</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="p. ej. Usar los productos de limpieza azules"
          placeholderTextColor={Palette.textSecondary}
          style={[styles.input, styles.descriptionInput]}
          accessibilityLabel="Detalles de la tarea"
          multiline
          textAlignVertical="top"
        />

        <Text style={styles.label}>Categoría</Text>
        <View style={styles.categoryGrid}>
          {choreCategories.map((item) => (
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

        <Text style={styles.label}>¿Con qué frecuencia?</Text>
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

        {children}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable onPress={() => void save()} disabled={saving} style={styles.primaryButton}>
          {saving ? (
            <Text style={styles.primaryButtonText}>Guardando...</Text>
          ) : (
            <Text style={styles.primaryButtonText}>{submitLabel}</Text>
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
  descriptionInput: { minHeight: 88, paddingTop: 14 },
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
  error: { fontSize: 14, color: Palette.error },
  primaryButton: {
    alignItems: 'center',
    paddingVertical: 15,
    borderRadius: Radius.button,
    backgroundColor: Palette.primary,
  },
  primaryButtonText: { fontSize: 15, fontWeight: '800', color: Palette.onPrimary },
});
