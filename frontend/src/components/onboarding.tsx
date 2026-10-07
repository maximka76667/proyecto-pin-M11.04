import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';

import { Palette, Radius } from '@/constants/onboarding';

export function Eyebrow({ children }: { children: ReactNode }) {
  return <Text style={styles.eyebrow}>{children}</Text>;
}

export function PrimaryButton({
  title,
  onPress,
  loading = false,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
      {loading ? (
        <ActivityIndicator color={Palette.onPrimary} />
      ) : (
        <>
          <Text style={styles.primaryButtonText}>{title}</Text>
          <MaterialCommunityIcons name="arrow-right" size={18} color={Palette.onPrimary} />
        </>
      )}
    </Pressable>
  );
}

export function Field({ label, ...inputProps }: { label: string } & TextInputProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={Palette.textSecondary}
        style={styles.input}
        {...inputProps}
      />
    </View>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && styles.segmentSelected]}>
            <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Only visual for now: shows the initial of the name, no image picker yet
export function PhotoField({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || 'A';

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>Your photo</Text>
      <View style={styles.photoRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <View style={styles.photoButton}>
          <MaterialCommunityIcons name="camera-outline" size={16} color={Palette.primary} />
          <Text style={styles.photoButtonText}>Add a photo</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: Palette.primary,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 56,
    borderRadius: Radius.button,
    backgroundColor: Palette.primary,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: Palette.onPrimary,
  },
  pressed: {
    opacity: 0.85,
  },
  field: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: Palette.text,
  },
  input: {
    height: 48,
    paddingHorizontal: 16,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
    fontSize: 15,
    color: Palette.text,
  },
  segmented: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: Radius.input,
    backgroundColor: Palette.segment,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: Radius.input - 2,
  },
  segmentSelected: {
    backgroundColor: Palette.surface,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  segmentTextSelected: {
    color: Palette.text,
  },
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: Radius.input,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.peach,
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '700',
    color: Palette.text,
  },
  photoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  photoButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: Palette.primary,
  },
});
