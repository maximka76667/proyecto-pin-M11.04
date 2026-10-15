import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Dialog, Portal, Snackbar } from 'react-native-paper';

import { Palette, Radius } from '@/constants/onboarding';
import { api, errorMessage } from '@/lib/api';

type Deuda = {
  deudorId: string;
  deudor: string;
  acreedorId: string;
  acreedor: string;
  monto: number;
};

// Sin Palette.mint: es el fondo de la fila y el avatar desaparecería
const AVATAR_COLORS = [Palette.peach, Palette.sun, Palette.surface];

function debtKey(deuda: Deuda) {
  return `${deuda.deudorId}-${deuda.acreedorId}`;
}

function formatEuros(monto: number) {
  return `${monto.toFixed(2).replace('.', ',')} €`;
}

function Avatar({ id, name }: { id: string; name: string }) {
  const hash = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  return (
    <View style={[styles.avatar, { backgroundColor: AVATAR_COLORS[hash % AVATAR_COLORS.length] }]}>
      <Text style={styles.avatarText}>{initial}</Text>
    </View>
  );
}

function DebtText({ deuda, userId }: { deuda: Deuda; userId: string }) {
  if (deuda.deudorId === userId) {
    return (
      <Text style={styles.rowText}>
        Pagas a <Text style={styles.bold}>{deuda.acreedor}</Text>
      </Text>
    );
  }
  if (deuda.acreedorId === userId) {
    return (
      <Text style={styles.rowText}>
        <Text style={styles.bold}>{deuda.deudor}</Text> te paga
      </Text>
    );
  }
  return (
    <Text style={styles.rowText}>
      <Text style={styles.bold}>{deuda.deudor}</Text> paga a{' '}
      <Text style={styles.bold}>{deuda.acreedor}</Text>
    </Text>
  );
}

export function SettleUpCard({
  apartmentId,
  userId,
  refreshKey,
  onSettled,
}: {
  apartmentId: string;
  userId: string;
  refreshKey: number;
  onSettled: () => void;
}) {
  // null = la lista no se ha podido cargar; [] = cargada y sin ninguna deuda pendiente
  const [deudas, setDeudas] = useState<Deuda[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [settling, setSettling] = useState(false);
  const [snackbarVisible, setSnackbarVisible] = useState(false);

  useEffect(() => {
    const loadDeudas = async () => {
      try {
        const data: Deuda[] = await api(
          'GET',
          `/transactions/${encodeURIComponent(apartmentId)}/settle-up`,
        );
        setDeudas(data);
        // Solo el acreedor puede confirmar el pago; si solo hay una opción, se preselecciona
        const selectable = data.filter((deuda) => deuda.acreedorId === userId);
        setSelectedKey(selectable.length === 1 ? debtKey(selectable[0]) : null);
        setError('');
      } catch (e) {
        // sin lista no se puede dar por hecho que las cuentas estén saldadas
        setDeudas(null);
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    };

    loadDeudas();
  }, [apartmentId, userId, refreshKey]);

  const listaDeudas = deudas ?? [];
  const selected = listaDeudas.find((deuda) => debtKey(deuda) === selectedKey) ?? null;
  const canSettleAny = listaDeudas.some((deuda) => deuda.acreedorId === userId);

  const settle = async () => {
    if (!selected) return;
    setSettling(true);
    try {
      await api('POST', `/transactions/${encodeURIComponent(apartmentId)}/settle`, {
        deudor_id: selected.deudorId,
        amount: selected.monto.toFixed(2),
      });
      setConfirmVisible(false);
      setSnackbarVisible(true);
      onSettled();
    } catch (e) {
      setConfirmVisible(false);
      setError(errorMessage(e));
    } finally {
      setSettling(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Recomendaciones para saldar</Text>
        <MaterialCommunityIcons name="scale-balance" size={20} color={Palette.textSecondary} />
      </View>

      {loading ? <ActivityIndicator color={Palette.primary} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!loading && deudas === null ? (
        <View style={styles.empty}>
          <MaterialCommunityIcons name="alert-circle-outline" size={22} color={Palette.error} />
          <Text style={styles.muted}>No se han podido cargar las deudas pendientes.</Text>
        </View>
      ) : null}

      {!loading && deudas !== null && deudas.length === 0 ? (
        <View style={styles.empty}>
          <MaterialCommunityIcons name="check-circle-outline" size={22} color={Palette.primary} />
          <Text style={styles.muted}>Estáis al día. No hay deudas pendientes.</Text>
        </View>
      ) : null}

      {listaDeudas.length > 0 ? (
        <>
          <View style={styles.list}>
            {listaDeudas.map((deuda) => {
              const key = debtKey(deuda);
              const selectable = deuda.acreedorId === userId;
              const isSelected = key === selectedKey;

              return (
                <Pressable
                  key={key}
                  disabled={!selectable}
                  onPress={() => setSelectedKey(isSelected ? null : key)}
                  style={({ pressed }) => [
                    styles.row,
                    isSelected && styles.rowSelected,
                    !selectable && styles.rowDisabled,
                    pressed && styles.pressed,
                  ]}>
                  <Avatar id={deuda.deudorId} name={deuda.deudor} />
                  <MaterialCommunityIcons name="chevron-right" size={20} color={Palette.primary} />
                  <Avatar id={deuda.acreedorId} name={deuda.acreedor} />
                  <DebtText deuda={deuda} userId={userId} />
                  <Text style={styles.amount}>{formatEuros(deuda.monto)}</Text>
                </Pressable>
              );
            })}
          </View>

          {canSettleAny ? (
            <Pressable
              onPress={() => setConfirmVisible(true)}
              disabled={!selected || settling}
              style={({ pressed }) => [
                styles.button,
                (!selected || settling) && styles.buttonDisabled,
                pressed && styles.pressed,
              ]}>
              {settling ? (
                <ActivityIndicator color={Palette.onPrimary} />
              ) : (
                <Text style={styles.buttonText}>Marcar como pagada</Text>
              )}
            </Pressable>
          ) : (
            <Text style={styles.muted}>
              Solo quien recibe el dinero puede confirmar el pago.
            </Text>
          )}
        </>
      ) : null}

      <Portal>
        <Dialog
          visible={confirmVisible}
          onDismiss={() => !settling && setConfirmVisible(false)}
          style={styles.dialog}>
          <Dialog.Title style={styles.dialogTitle}>¿Confirmas que has recibido el pago?</Dialog.Title>
          <Dialog.Content>
            {selected ? (
              <Text style={styles.dialogText}>
                <Text style={styles.bold}>{selected.deudor}</Text> te ha pagado{' '}
                <Text style={styles.bold}>{formatEuros(selected.monto)}</Text>. El balance del
                hogar se actualizará.
              </Text>
            ) : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button
              onPress={() => setConfirmVisible(false)}
              disabled={settling}
              textColor={Palette.textSecondary}>
              Cancelar
            </Button>
            <Button onPress={settle} loading={settling} disabled={settling} textColor={Palette.primary}>
              Confirmar
            </Button>
          </Dialog.Actions>
        </Dialog>

        <Snackbar
          visible={snackbarVisible}
          onDismiss={() => setSnackbarVisible(false)}
          duration={3000}
          style={styles.snackbar}>
          Deuda saldada ✓
        </Snackbar>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 16,
    backgroundColor: Palette.surface,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: Palette.text,
  },
  list: {
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 14,
    backgroundColor: Palette.mint,
  },
  rowSelected: {
    borderColor: Palette.primary,
  },
  rowDisabled: {
    opacity: 0.6,
  },
  pressed: {
    opacity: 0.85,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '700',
    color: Palette.text,
  },
  rowText: {
    flex: 1,
    marginLeft: 4,
    fontSize: 14,
    color: Palette.text,
  },
  bold: {
    fontWeight: '800',
  },
  amount: {
    fontSize: 16,
    fontWeight: '800',
    color: Palette.primary,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 56,
    borderRadius: Radius.button,
    backgroundColor: Palette.primary,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    color: Palette.onPrimary,
  },
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  muted: {
    flex: 1,
    fontSize: 14,
    color: Palette.textSecondary,
  },
  error: {
    fontSize: 14,
    color: Palette.error,
  },
  dialog: {
    backgroundColor: Palette.surface,
    borderRadius: 16,
  },
  dialogTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Palette.text,
  },
  dialogText: {
    fontSize: 15,
    lineHeight: 22,
    color: Palette.text,
  },
  snackbar: {
    backgroundColor: Palette.primary,
  },
});
