import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Palette } from '@/constants/onboarding';
import { api, errorMessage } from '@/lib/api';

const APARTMENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CURRENT_USER_ID = '22222222-2222-2222-2222-222222222222';

type SettleAction = 'marcar_pagado' | 'confirmar_pago' | 'rechazar_pago';
type SettleUpRow = {
  deudorId: string;
  deudor: string;
  acreedorId: string;
  acreedor: string;
  monto: number;
  estado: 'por_pagar' | 'pendiente_confirmacion';
  rol: 'deudor' | 'acreedor' | 'ajeno';
  acciones: SettleAction[];
  pagoPendienteId: string | null;
};

export default function SettleUpScreen() {
  const [rows, setRows] = useState<SettleUpRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const data = (await api(
        'GET',
        `/transactions/${encodeURIComponent(APARTMENT_ID)}/settle-up`,
      )) as SettleUpRow[];
      setRows(data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadRows();
    }, [loadRows]),
  );

  const handleAction = async (row: SettleUpRow, action: SettleAction) => {
    try {
      if (action === 'marcar_pagado') {
        await api('POST', `/transactions/${encodeURIComponent(APARTMENT_ID)}/settle`, {
          acreedor_id: row.acreedorId,
          amount: row.monto.toFixed(2),
        });
      } else if (action === 'confirmar_pago' && row.pagoPendienteId) {
        await api('POST', `/transactions/${row.pagoPendienteId}/confirm`);
      } else if (action === 'rechazar_pago' && row.pagoPendienteId) {
        await api('POST', `/transactions/${row.pagoPendienteId}/reject`);
      }

      await loadRows();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={Palette.text} />
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.eyebrow}>SALDAR DEUDAS</Text>
          <Text style={styles.title}>Pagos pendientes</Text>
        </View>

        {loading ? <ActivityIndicator color={Palette.primary} size="large" /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {!loading && rows.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="check-circle-outline" size={28} color={Palette.primary} />
            <Text style={styles.emptyTitle}>Todo está al día</Text>
            <Text style={styles.emptyText}>No tienes deudas o pagos pendientes en este hogar.</Text>
          </View>
        ) : null}

        {rows.map((row) => {
          const isCurrentUserDebtor = row.deudorId === CURRENT_USER_ID;
          const isCurrentUserCreditor = row.acreedorId === CURRENT_USER_ID;

          return (
            <View key={`${row.deudorId}-${row.acreedorId}-${row.pagoPendienteId ?? 'pending'}`} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardIcon}>
                  <MaterialCommunityIcons name="hand-coin-outline" size={20} color={Palette.primary} />
                </View>
                <View style={styles.cardText}>
                  <Text style={styles.cardRole}>
                    {isCurrentUserDebtor ? 'Debes' : isCurrentUserCreditor ? 'Te deben' : 'Deuda del hogar'}
                  </Text>
                  <Text style={styles.cardPeople}>
                    {row.deudor} → {row.acreedor}
                  </Text>
                </View>
                <Text style={styles.amount}>{row.monto.toFixed(2)} €</Text>
              </View>

              <Text style={styles.status}>
                {row.estado === 'pendiente_confirmacion'
                  ? 'Pago pendiente de confirmación'
                  : 'Pendiente de pago'}
              </Text>

              <View style={styles.actions}>
                {row.acciones.includes('marcar_pagado') ? (
                  <Pressable
                    onPress={() => void handleAction(row, 'marcar_pagado')}
                    style={styles.primaryButton}>
                    <Text style={styles.primaryButtonText}>Marcar como pagado</Text>
                  </Pressable>
                ) : null}

                {row.acciones.includes('confirmar_pago') ? (
                  <Pressable
                    onPress={() => void handleAction(row, 'confirmar_pago')}
                    style={styles.confirmButton}>
                    <Text style={styles.confirmButtonText}>Confirmar</Text>
                  </Pressable>
                ) : null}

                {row.acciones.includes('rechazar_pago') ? (
                  <Pressable
                    onPress={() => void handleAction(row, 'rechazar_pago')}
                    style={styles.rejectButton}>
                    <Text style={styles.rejectButtonText}>Rechazar</Text>
                  </Pressable>
                ) : null}

                {!row.acciones.length ? (
                  <Text style={styles.noActions}>No hay acciones disponibles para ti.</Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Palette.background },
  container: { flexGrow: 1, width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 24, paddingBottom: 32, gap: 18 },
  back: { alignSelf: 'flex-start', paddingTop: 8 },
  header: { gap: 6 },
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 1.5, color: Palette.primary },
  title: { fontSize: 30, fontWeight: '800', color: Palette.text },
  card: { gap: 12, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: Palette.border, backgroundColor: Palette.surface },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: Palette.mint },
  cardText: { flex: 1 },
  cardRole: { fontSize: 11, fontWeight: '800', letterSpacing: 1.1, color: Palette.textSecondary },
  cardPeople: { fontSize: 15, fontWeight: '700', color: Palette.text },
  amount: { fontSize: 16, fontWeight: '800', color: Palette.primary },
  status: { fontSize: 13, color: Palette.textSecondary },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  primaryButton: { flex: 1, minHeight: 42, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: Palette.primary },
  primaryButtonText: { fontSize: 14, fontWeight: '800', color: Palette.onPrimary },
  confirmButton: { flex: 1, minHeight: 42, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#2a9d8f' },
  confirmButtonText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  rejectButton: { flex: 1, minHeight: 42, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#f1f1f1' },
  rejectButtonText: { fontSize: 14, fontWeight: '800', color: Palette.error },
  noActions: { fontSize: 13, color: Palette.textSecondary },
  emptyState: { gap: 8, padding: 22, borderRadius: 16, borderWidth: 1, borderColor: Palette.border, backgroundColor: Palette.surface, alignItems: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: Palette.text },
  emptyText: { fontSize: 14, color: Palette.textSecondary, textAlign: 'center' },
  error: { fontSize: 14, color: Palette.error },
});
