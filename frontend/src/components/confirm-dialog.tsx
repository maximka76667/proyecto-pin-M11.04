import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Palette } from '@/constants/onboarding';

type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  onCancel: () => void;
  onConfirm: () => void;
};

// Confirmación genérica con el mismo aspecto que DeleteChoreDialog (p. ej. cerrar sesión)
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  icon,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.dialog} accessibilityRole="alert">
          <View style={styles.icon}>
            <MaterialCommunityIcons name={icon} size={24} color={Palette.error} />
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            <Pressable onPress={onCancel} accessibilityRole="button" style={styles.cancelButton}>
              <Text style={styles.cancelText}>Cancelar</Text>
            </Pressable>
            <Pressable onPress={onConfirm} accessibilityRole="button" style={styles.confirmButton}>
              <Text style={styles.confirmText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(31,42,36,0.45)',
  },
  dialog: {
    width: '100%',
    maxWidth: 380,
    gap: 12,
    padding: 24,
    borderRadius: 22,
    backgroundColor: Palette.background,
  },
  icon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    backgroundColor: '#FBE9E7',
  },
  title: { fontSize: 22, fontWeight: '800', color: Palette.text },
  message: { fontSize: 15, lineHeight: 22, color: Palette.textSecondary },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelButton: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: Palette.segment,
  },
  cancelText: { fontSize: 15, fontWeight: '800', color: Palette.text },
  confirmButton: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: Palette.error,
  },
  confirmText: { fontSize: 15, fontWeight: '800', color: Palette.onPrimary },
});
