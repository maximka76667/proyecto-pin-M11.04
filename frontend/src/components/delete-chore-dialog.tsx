import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Palette } from '@/constants/onboarding';

type DeleteChoreDialogProps = {
  visible: boolean;
  // se conserva al cerrar el diálogo para que su texto no cambie mientras se desvanece
  chore: { title: string; assignments: unknown[] } | null;
  deleting: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
};

// Confirmación antes de borrar una tarea, usada desde la lista y desde los detalles
export function DeleteChoreDialog({
  visible,
  chore,
  deleting,
  error,
  onCancel,
  onConfirm,
}: DeleteChoreDialogProps) {
  const cancel = () => {
    if (!deleting) onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={cancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.confirmation}>
          <View style={styles.confirmationIcon}>
            <MaterialCommunityIcons name="trash-can-outline" size={24} color={Palette.error} />
          </View>
          <Text style={styles.confirmationTitle}>Delete chore</Text>
          <Text style={styles.confirmationMessage}>
            {`“${chore?.title ?? ''}” will be removed for everyone in the household.`}
            {chore && chore.assignments.length > 0 ? ' Its assignments will be deleted too.' : ''}
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.confirmationActions}>
            <Pressable onPress={cancel} disabled={deleting} style={styles.cancelButton}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={onConfirm} disabled={deleting} style={styles.deleteButton}>
              {deleting ? (
                <ActivityIndicator color={Palette.onPrimary} />
              ) : (
                <Text style={styles.deleteButtonText}>Delete</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(31,42,36,0.45)',
  },
  confirmation: {
    width: '100%',
    maxWidth: 380,
    gap: 12,
    padding: 24,
    borderRadius: 22,
    backgroundColor: Palette.background,
  },
  confirmationIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    backgroundColor: '#FBE9E7',
  },
  confirmationTitle: { fontSize: 22, fontWeight: '800', color: Palette.text },
  confirmationMessage: { fontSize: 15, lineHeight: 22, color: Palette.textSecondary },
  error: { fontSize: 14, color: Palette.error },
  confirmationActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelButton: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: Palette.segment,
  },
  cancelButtonText: { fontSize: 15, fontWeight: '800', color: Palette.text },
  deleteButton: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: Palette.error,
  },
  deleteButtonText: { fontSize: 15, fontWeight: '800', color: Palette.onPrimary },
});
