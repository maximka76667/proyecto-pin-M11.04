import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Palette, Radius } from '@/constants/onboarding';

const CARD = '#FFFFFF';

type PasswordScreenProps = {
  backLabel: string;
  onBack: () => void;
  title: string;
  subtitle: string;
  children: ReactNode;
  tip?: string;
  // Mensaje que no pertenece a ningún campo (sin conexión, demasiados intentos…)
  error?: string;
  submitLabel: string;
  onSubmit: () => void;
  loading: boolean;
  onCancel: () => void;
  // Enlaces extra bajo la tarjeta (p. ej. "Reenviar código")
  extra?: ReactNode;
};

// Armazón común de "Cambiar contraseña" desde Mi cuenta y de la recuperación desde el login
export function PasswordScreen({
  backLabel,
  onBack,
  title,
  subtitle,
  children,
  tip = 'Elige una contraseña que no uses en otras cuentas.',
  error,
  submitLabel,
  onSubmit,
  loading,
  onCancel,
  extra,
}: PasswordScreenProps) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.backRow}>
            <Pressable
              onPress={onBack}
              disabled={loading}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Volver a ${backLabel}`}
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
              <MaterialCommunityIcons name="arrow-left" size={22} color={Palette.text} />
            </Pressable>
            <Text style={styles.backLabel}>{backLabel}</Text>
          </View>

          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>

          <View style={styles.card}>{children}</View>

          {tip ? (
            <View style={styles.tip}>
              <MaterialCommunityIcons
                name="shield-check-outline"
                size={20}
                color={Palette.primary}
              />
              <Text style={styles.tipText}>{tip}</Text>
            </View>
          ) : null}

          {extra}

          <View style={styles.footer}>
            {error ? (
              <Text style={styles.error} accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : null}
            <Pressable
              onPress={onSubmit}
              disabled={loading}
              accessibilityRole="button"
              accessibilityState={{ disabled: loading, busy: loading }}
              style={({ pressed }) => [
                styles.submit,
                (pressed || loading) && styles.submitPressed,
              ]}>
              {loading ? (
                <ActivityIndicator color={Palette.onPrimary} />
              ) : (
                <Text style={styles.submitText}>{submitLabel}</Text>
              )}
            </Pressable>
            <Pressable onPress={onCancel} disabled={loading} hitSlop={8} accessibilityRole="button">
              <Text style={styles.cancel}>Cancelar</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Palette.background },
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 20,
  },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  backLabel: { fontSize: 15, fontWeight: '600', color: Palette.text },
  header: { gap: 8 },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '800', color: Palette.text },
  subtitle: { fontSize: 16, lineHeight: 23, color: Palette.textSecondary },
  card: {
    gap: 20,
    padding: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: CARD,
  },
  tip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 16,
    borderRadius: Radius.input,
    backgroundColor: Palette.mint,
  },
  tipText: { flex: 1, fontSize: 14, lineHeight: 20, color: Palette.primary },
  footer: { marginTop: 'auto', gap: 14, paddingTop: 8 },
  error: { fontSize: 14, lineHeight: 20, color: Palette.error, textAlign: 'center' },
  submit: {
    height: 56,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.primary,
  },
  submitPressed: { opacity: 0.85 },
  submitText: { fontSize: 16, fontWeight: '700', color: Palette.onPrimary },
  cancel: { fontSize: 15, fontWeight: '600', textAlign: 'center', color: Palette.textSecondary },
  pressed: { opacity: 0.7 },
});
