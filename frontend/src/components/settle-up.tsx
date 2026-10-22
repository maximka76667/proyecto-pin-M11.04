import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Dialog, Portal, Snackbar } from 'react-native-paper';

import { Palette, Radius } from '@/constants/onboarding';
import { api, errorMessage } from '@/lib/api';

type Accion = 'marcar_pagado' | 'confirmar_pago' | 'rechazar_pago';

// El backend decide el rol del usuario y qué puede hacer en cada deuda: aquí solo se pinta
type Deuda = {
  deudorId: string;
  deudor: string;
  acreedorId: string;
  acreedor: string;
  monto: number;
  estado: 'por_pagar' | 'pendiente_confirmacion';
  pagoPendienteId: string | null;
  rol: 'deudor' | 'acreedor' | 'ajeno';
  acciones: Accion[];
};

// Sin Palette.mint: es el fondo de la fila y el avatar desaparecería
const AVATAR_COLORS = [Palette.peach, Palette.sun, Palette.surface];

const TEXTOS: Record<
  Accion,
  { boton: string; titulo: string; confirmar: string; hecho: string }
> = {
  marcar_pagado: {
    boton: 'He realizado el pago',
    titulo: '¿Has realizado el pago?',
    confirmar: 'Sí, lo he pagado',
    hecho: 'Aviso enviado',
  },
  confirmar_pago: {
    boton: 'Confirmar pago recibido',
    titulo: '¿Confirmas que has recibido el pago?',
    confirmar: 'Confirmar',
    hecho: 'Pago confirmado ✓',
  },
  rechazar_pago: {
    boton: 'No lo he recibido',
    titulo: '¿No te ha llegado el pago?',
    confirmar: 'Rechazar',
    hecho: 'Pago rechazado',
  },
};

// Un par deudor-acreedor puede tener a la vez su deuda y un aviso que ya no encaja con ella
function debtKey(deuda: Deuda) {
  return `${deuda.deudorId}-${deuda.acreedorId}-${deuda.pagoPendienteId ?? 'deuda'}`;
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

function DebtText({ deuda }: { deuda: Deuda }) {
  const pendiente = deuda.estado === 'pendiente_confirmacion';
  const deudor = <Text style={styles.bold}>{deuda.deudor}</Text>;
  const acreedor = <Text style={styles.bold}>{deuda.acreedor}</Text>;

  let frase: ReactNode;
  let estado: string | null;

  if (deuda.rol === 'deudor') {
    frase = pendiente ? <>Has pagado a {acreedor}</> : <>Pagas a {acreedor}</>;
    estado = pendiente ? 'Pendiente de que lo confirme' : null;
  } else if (deuda.rol === 'acreedor') {
    frase = pendiente ? <>{deudor} te ha pagado</> : <>{deudor} te paga</>;
    estado = pendiente ? 'Confírmalo cuando lo recibas' : 'Esperando su pago';
  } else {
    frase = <>{deudor} paga a {acreedor}</>;
    estado = pendiente ? 'Pendiente de confirmar' : null;
  }

  return (
    <View style={styles.rowInfo}>
      <Text style={styles.rowText}>{frase}</Text>
      {estado ? (
        <View style={styles.statusRow}>
          {pendiente ? (
            <MaterialCommunityIcons name="clock-outline" size={13} color={Palette.textSecondary} />
          ) : null}
          <Text style={styles.rowStatus}>{estado}</Text>
        </View>
      ) : null}
    </View>
  );
}

function DialogText({ accion, deuda }: { accion: Accion; deuda: Deuda }) {
  const monto = <Text style={styles.bold}>{formatEuros(deuda.monto)}</Text>;

  if (accion === 'marcar_pagado') {
    return (
      <Text style={styles.dialogText}>
        Vas a avisar a <Text style={styles.bold}>{deuda.acreedor}</Text> de que le has pagado{' '}
        {monto}. Quedará pendiente hasta que lo confirme.
      </Text>
    );
  }
  if (accion === 'confirmar_pago') {
    return (
      <Text style={styles.dialogText}>
        <Text style={styles.bold}>{deuda.deudor}</Text> te ha pagado {monto}. El balance del
        hogar se actualizará.
      </Text>
    );
  }
  return (
    <Text style={styles.dialogText}>
      Se descartará el aviso de <Text style={styles.bold}>{deuda.deudor}</Text> y la deuda volverá
      a estar pendiente de pago.
    </Text>
  );
}

export function SettleUpCard({
  apartmentId,
  refreshKey,
  onSettled,
}: {
  apartmentId: string;
  refreshKey: number;
  onSettled: () => void;
}) {
  // null = la lista no se ha podido cargar; [] = cargada y sin ninguna deuda pendiente
  const [deudas, setDeudas] = useState<Deuda[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Se guarda la deuda al abrir el diálogo para que su contenido no cambie mientras
  // se cierra ni cuando la lista se recarga después de confirmar
  const [dialogo, setDialogo] = useState<{ accion: Accion; deuda: Deuda } | null>(null);
  const [dialogoVisible, setDialogoVisible] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    const loadDeudas = async () => {
      try {
        const data: Deuda[] = await api(
          'GET',
          `/transactions/${encodeURIComponent(apartmentId)}/settle-up`,
        );
        setDeudas(data);
        // si solo hay una deuda con la que puedas hacer algo, se preselecciona
        const accionables = data.filter((deuda) => deuda.acciones.length > 0);
        setSelectedKey(accionables.length === 1 ? debtKey(accionables[0]) : null);
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
  }, [apartmentId, refreshKey]);

  const listaDeudas = deudas ?? [];
  const selected = listaDeudas.find((deuda) => debtKey(deuda) === selectedKey) ?? null;
  const hayAccionables = listaDeudas.some((deuda) => deuda.acciones.length > 0);

  const ejecutar = async () => {
    if (!dialogo) return;
    const { accion, deuda } = dialogo;
    setEnviando(true);
    try {
      if (accion === 'marcar_pagado') {
        await api('POST', `/transactions/${encodeURIComponent(apartmentId)}/settle`, {
          acreedor_id: deuda.acreedorId,
          amount: deuda.monto.toFixed(2),
        });
      } else if (deuda.pagoPendienteId) {
        const paso = accion === 'confirmar_pago' ? 'confirm' : 'reject';
        await api(
          'POST',
          `/transactions/${encodeURIComponent(deuda.pagoPendienteId)}/${paso}`,
        );
      }
      setAviso(TEXTOS[accion].hecho);
      setDialogoVisible(false);
      onSettled();
    } catch (e) {
      setDialogoVisible(false);
      setError(errorMessage(e));
    } finally {
      setEnviando(false);
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
              const selectable = deuda.acciones.length > 0;
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
                  <DebtText deuda={deuda} />
                  <Text style={styles.amount}>{formatEuros(deuda.monto)}</Text>
                </Pressable>
              );
            })}
          </View>

          {hayAccionables ? (
            <View style={styles.actions}>
              {selected ? (
                selected.acciones.map((accion) => {
                  const secundaria = accion === 'rechazar_pago';

                  return (
                    <Pressable
                      key={accion}
                      onPress={() => {
                        setDialogo({ accion, deuda: selected });
                        setDialogoVisible(true);
                      }}
                      disabled={enviando}
                      style={({ pressed }) => [
                        secundaria ? styles.secondaryButton : styles.button,
                        enviando && styles.buttonDisabled,
                        pressed && styles.pressed,
                      ]}>
                      {enviando && dialogo?.accion === accion ? (
                        <ActivityIndicator
                          color={secundaria ? Palette.error : Palette.onPrimary}
                        />
                      ) : (
                        <Text style={secundaria ? styles.secondaryButtonText : styles.buttonText}>
                          {TEXTOS[accion].boton}
                        </Text>
                      )}
                    </Pressable>
                  );
                })
              ) : (
                <View style={[styles.button, styles.buttonDisabled]}>
                  <Text style={styles.buttonText}>Selecciona una deuda</Text>
                </View>
              )}
            </View>
          ) : (
            <Text style={styles.muted}>No tienes ningún pago que marcar ni confirmar.</Text>
          )}
        </>
      ) : null}

      <Portal>
        <Dialog
          visible={dialogoVisible}
          onDismiss={() => !enviando && setDialogoVisible(false)}
          style={styles.dialog}>
          <Dialog.Title style={styles.dialogTitle}>
            {dialogo ? TEXTOS[dialogo.accion].titulo : ''}
          </Dialog.Title>
          <Dialog.Content>
            {dialogo ? <DialogText accion={dialogo.accion} deuda={dialogo.deuda} /> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button
              onPress={() => setDialogoVisible(false)}
              disabled={enviando}
              textColor={Palette.textSecondary}>
              Cancelar
            </Button>
            <Button
              onPress={ejecutar}
              loading={enviando}
              disabled={enviando}
              textColor={dialogo?.accion === 'rechazar_pago' ? Palette.error : Palette.primary}>
              {dialogo ? TEXTOS[dialogo.accion].confirmar : ''}
            </Button>
          </Dialog.Actions>
        </Dialog>

        <Snackbar
          visible={aviso !== null}
          onDismiss={() => setAviso(null)}
          duration={3000}
          style={styles.snackbar}>
          {aviso ?? ''}
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
  rowInfo: {
    flex: 1,
    marginLeft: 4,
    gap: 2,
  },
  rowText: {
    fontSize: 14,
    color: Palette.text,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rowStatus: {
    fontSize: 12,
    color: Palette.textSecondary,
  },
  bold: {
    fontWeight: '800',
  },
  amount: {
    fontSize: 16,
    fontWeight: '800',
    color: Palette.primary,
  },
  actions: {
    gap: 10,
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
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 56,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: Palette.error,
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
