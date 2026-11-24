import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Snackbar } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DeleteTarget, ExpenseSheet } from '@/components/expense-sheet';
import { SettleUpCard } from '@/components/settle-up';
import { APARTMENT_ID, USER_ID } from '@/constants/dev-session';
import { Palette } from '@/constants/onboarding';
import { api, errorMessage } from '@/lib/api';
import {
  ExpenseListEntry,
  myBalanceCents,
  myReceiptBalanceCents,
  signedAmount,
} from '@/lib/expenses';

// Aviso que se muestra al volver de guardar un gasto
const notices: Record<string, string> = {
  receipt: 'Gasto del ticket guardado. Tu balance se ha actualizado.',
  updated: 'Gasto actualizado correctamente.',
};

type PersonalSummary = {
  miResumen: {
    esDeudor: boolean;
    monto: number;
    conceptos: string[];
  };
  mensaje: string;
};

// What the delete dialog needs to know about the expense or receipt
type DisplayTransaction = DeleteTarget;

const categoryLabels: Record<string, string> = {
  supplies: 'Compra',
  utilities: 'Suministros',
  maintenance: 'Hogar',
  entertainment: 'Ocio',
  other: 'Otro',
  payment: 'Pago',
  pending: 'Pendiente',
};

export default function Transactions() {
  const { notice } = useLocalSearchParams<{ notice?: string }>();
  const [summary, setSummary] = useState<PersonalSummary | null>(null);
  const [transactions, setTransactions] = useState<ExpenseListEntry[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // sube al saldar una deuda, para recargar el balance y la lista sin salir de la pantalla
  const [refreshKey, setRefreshKey] = useState(0);
  // the expense or ticket whose sheet is open
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = transactions.find(({ id }) => id === selectedId) ?? null;
  const [transactionToDelete, setTransactionToDelete] = useState<DisplayTransaction | null>(null);
  // Al cerrarse el aviso se quita el parámetro, para que no vuelva a salir al recargar la página,
  // y se guarda el texto para que no desaparezca mientras se desvanece
  const noticeText = notice ? notices[notice] : undefined;
  const [lastNoticeText, setLastNoticeText] = useState('');

  const dismissNotice = () => {
    setLastNoticeText(noticeText ?? '');
    router.setParams({ notice: undefined });
  };

  const deleteTransaction = async () => {
    if (!transactionToDelete) return;

    try {
      const { kind, id, version } = transactionToDelete;
      await api(
        'DELETE',
        `/${kind === 'receipt' ? 'receipts' : 'expenses'}/${id}?version=${version}`,
      );
      setTransactionToDelete(null);
      setSuccess('Gasto eliminado correctamente.');
      // the list is reloaded: deleting a product changes the total of its receipt
      setRefreshKey((key) => key + 1);

      try {
        const updatedSummary = (await api(
          'GET',
          `/transactions/${encodeURIComponent(APARTMENT_ID)}/my-summary`,
        )) as PersonalSummary;
        setSummary(updatedSummary);
      } catch (summaryError) {
        setError(errorMessage(summaryError));
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  useFocusEffect(
    useCallback(() => {
      let active = true;

      const loadTransactions = async () => {
        setLoading(true);
        setError('');
        try {
          const loaded = (await api(
            'GET',
            `/expenses?apartment_id=${encodeURIComponent(APARTMENT_ID)}`,
          )) as ExpenseListEntry[];

          if (active) setTransactions(loaded);

          try {
            const summaryData = (await api(
              'GET',
              `/transactions/${encodeURIComponent(APARTMENT_ID)}/my-summary`,
            )) as PersonalSummary;
            if (active) setSummary(summaryData);
          } catch (summaryError) {
            if (active) setError(errorMessage(summaryError));
          }
        } catch (e) {
          if (active) setError(errorMessage(e));
        } finally {
          if (active) setLoading(false);
        }
      };

      void loadTransactions();
      return () => {
        active = false;
      };
    }, [refreshKey]),
  );

  const refreshTransactions = () => {
    setRefreshing(true);
    setRefreshKey((key) => key + 1);
    setTimeout(() => setRefreshing(false), 500);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshTransactions}
            tintColor={Palette.primary}
          />
        }>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={Palette.text} />
        </Pressable>

        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.eyebrow}>MIS GASTOS</Text>
              <Text style={styles.title}>Dinero</Text>
            </View>
            <Pressable onPress={() => router.push('/escanearticket')} style={styles.scanButton}>
              <MaterialCommunityIcons name="line-scan" size={20} color={Palette.onPrimary} />
              <Text style={styles.scanButtonText}>Ticket</Text>
            </Pressable>
          </View>
        </View>

        <Pressable
          onPress={() => router.push('/transactions/new')}
          style={({ pressed }) => [styles.newExpense, pressed && styles.pressed]}>
          <MaterialCommunityIcons name="plus" size={20} color={Palette.onPrimary} />
          <Text style={styles.newExpenseText}>Añadir gasto</Text>
        </Pressable>

        {loading ? <ActivityIndicator color={Palette.primary} size="large" /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {success ? <Text style={styles.success}>{success}</Text> : null}

        {summary ? (
          <Pressable
            onPress={() => router.push('/transactions/summary')}
            style={({ pressed }) => [styles.balanceCard, pressed && styles.pressed]}>
            <Text style={styles.balanceLabel}>MI BALANCE</Text>
            <Text style={styles.balanceAmount}>
              {summary.miResumen.esDeudor ? '-' : '+'}
              {summary.miResumen.monto.toFixed(2)} €
            </Text>
            <Text style={styles.balanceMessage}>{summary.mensaje}</Text>
            <View style={styles.balanceFooter}>
              <Text style={styles.balanceHint}>Ver detalle del balance</Text>
              <MaterialCommunityIcons name="arrow-right" size={20} color={Palette.onPrimary} />
            </View>
          </Pressable>
        ) : null}

        <SettleUpCard
          apartmentId={APARTMENT_ID}
          refreshKey={refreshKey}
          onSettled={() => setRefreshKey((key) => key + 1)}
        />

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Mis gastos</Text>
          <Text style={styles.sectionCaption}>{transactions.length}</Text>
        </View>

        {transactions.length > 0 ? (
          <View style={styles.transactionList}>
            {transactions.map((entry) => {
              const isReceipt = entry.kind === 'receipt';
              const paidByMe = entry.paidByCurrentUser;
              const settlement = !isReceipt && entry.type === 'SETTLEMENT';
              // what the user gets back (+) or owes (-) from this expense
              const balanceCents = isReceipt
                ? myReceiptBalanceCents(entry, USER_ID)
                : myBalanceCents(entry, USER_ID);
              const title = isReceipt
                ? 'Ticket'
                : entry.concept || categoryLabels[entry.category] || entry.category;
              const status = isReceipt
                ? paidByMe
                  ? `Pagaste tú · ${entry.items.length} productos`
                  : `Pagó ${entry.payer.full_name}`
                : settlement
                  ? paidByMe
                    ? `Pagaste a ${entry.shares[0]?.user.full_name ?? ''}`
                    : `${entry.payer.full_name} te pagó`
                  : paidByMe
                    ? `Pagaste tú · ${entry.shares.map((share) => share.user.full_name).join(', ')}`
                    : `Pagó ${entry.payer.full_name}`;

              return (
                <View key={entry.id} style={[styles.entry, isReceipt && styles.entryCard]}>
                  <Pressable
                    onPress={() => setSelectedId(entry.id)}
                    style={({ pressed }) => [
                      styles.transaction,
                      isReceipt && styles.transactionInCard,
                      pressed && styles.pressed,
                    ]}>
                    <View style={[styles.categoryIcon, !paidByMe && styles.categoryIconOther]}>
                      <MaterialCommunityIcons
                        name={
                          isReceipt
                            ? 'receipt-text-outline'
                            : paidByMe
                              ? 'cart-outline'
                              : 'home-outline'
                        }
                        size={20}
                        color={Palette.primary}
                      />
                    </View>
                    <View style={styles.transactionInfo}>
                      <Text style={styles.transactionCategory}>{title}</Text>
                      <Text style={styles.transactionStatus}>{status}</Text>
                      <Text style={styles.transactionDate}>
                        {new Date(entry.date).toLocaleDateString('es-ES')}
                      </Text>
                    </View>
                    <View style={styles.transactionActions}>
                      <Text style={styles.transactionAmount}>
                        {Number(entry.total_amount).toFixed(2)} €
                      </Text>
                      <Text
                        style={[
                          styles.transactionBalance,
                          balanceCents > 0 && styles.balancePositive,
                          balanceCents < 0 && styles.negativeAmount,
                        ]}>
                        {signedAmount(balanceCents)}
                      </Text>
                    </View>
                  </Pressable>
                  {isReceipt ? (
                    <Pressable onPress={() => setSelectedId(entry.id)} style={styles.receiptItems}>
                      {entry.items.map((item) => {
                        const itemCents = myBalanceCents(item, USER_ID);
                        return (
                          <View key={item.id} style={styles.receiptItem}>
                            <Text style={styles.receiptItemBullet}>-</Text>
                            <Text style={styles.receiptItemName} numberOfLines={1}>
                              {item.concept || categoryLabels[item.category] || item.category}
                            </Text>
                            <View style={styles.receiptItemAmounts}>
                              <Text style={styles.receiptItemAmount}>
                                {Number(item.total_amount).toFixed(2)} €
                              </Text>
                              <Text
                                style={[
                                  styles.transactionBalance,
                                  itemCents > 0 && styles.balancePositive,
                                  itemCents < 0 && styles.negativeAmount,
                                ]}>
                                {signedAmount(itemCents)}
                              </Text>
                            </View>
                          </View>
                        );
                      })}
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : !loading ? (
          <Text style={styles.muted}>No hay gastos para mostrar.</Text>
        ) : null}
      </ScrollView>
      <ExpenseSheet
        entry={selected}
        userId={USER_ID}
        onClose={() => setSelectedId(null)}
        onEdit={(id) => {
          setSelectedId(null);
          router.push({ pathname: '/transactions/edit', params: { id } });
        }}
        onDelete={(target) => {
          setSelectedId(null);
          setTransactionToDelete(target);
        }}
      />
      <Modal
        visible={transactionToDelete !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setTransactionToDelete(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.confirmation}>
            <View style={styles.confirmationIcon}>
              <MaterialCommunityIcons name="trash-can-outline" size={24} color={Palette.error} />
            </View>
            <Text style={styles.confirmationTitle}>Cancelar gasto</Text>
            <Text style={styles.confirmationMessage}>
              ¿Quieres eliminar{' '}
              {transactionToDelete
                ? `${transactionToDelete.amount.toFixed(2)} € de ${
                    transactionToDelete.concept ||
                    categoryLabels[transactionToDelete.category] ||
                    transactionToDelete.category
                  }`
                : 'este gasto'}
              ?
            </Text>
            <View style={styles.confirmationActions}>
              <Pressable onPress={() => setTransactionToDelete(null)} style={styles.cancelButton}>
                <Text style={styles.cancelButtonText}>No</Text>
              </Pressable>
              <Pressable onPress={() => void deleteTransaction()} style={styles.deleteButton}>
                <Text style={styles.deleteButtonText}>Sí, eliminar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Snackbar
        visible={Boolean(noticeText)}
        onDismiss={dismissNotice}
        duration={3000}
        style={styles.snackbar}>
        {noticeText ?? lastNoticeText}
      </Snackbar>
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
    paddingBottom: 32,
    gap: 18,
  },
  entry: { gap: 6 },
  entryCard: {
    gap: 0,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 16,
    backgroundColor: Palette.surface,
    overflow: 'hidden',
  },
  transactionInCard: {
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: 'transparent',
  },
  receiptItems: {
    gap: 8,
    marginHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: Palette.border,
  },
  receiptItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 4,
  },
  receiptItemBullet: { fontSize: 14, color: Palette.textSecondary },
  receiptItemName: { flex: 1, fontSize: 14, color: Palette.textSecondary },
  receiptItemAmount: { fontSize: 14, color: Palette.text },
  receiptItemAmounts: { alignItems: 'flex-end' },
  back: { alignSelf: 'flex-start', paddingTop: 8 },
  header: { gap: 6 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: Palette.primary,
  },
  scanButtonText: { fontSize: 12, fontWeight: '800', color: Palette.onPrimary },
  eyebrow: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: Palette.primary,
  },
  title: { fontSize: 32, fontWeight: '800', color: Palette.text },
  balanceCard: {
    gap: 8,
    padding: 20,
    borderRadius: 20,
    backgroundColor: Palette.primary,
  },
  pressed: { opacity: 0.85 },
  newExpense: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: Palette.primary,
  },
  newExpenseText: { fontSize: 15, fontWeight: '800', color: Palette.onPrimary },
  balanceLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: Palette.onPrimary,
  },
  balanceAmount: { fontSize: 36, fontWeight: '800', color: Palette.onPrimary },
  balanceMessage: { fontSize: 14, lineHeight: 20, color: Palette.onPrimary },
  balanceFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.25)',
  },
  balanceHint: { fontSize: 14, fontWeight: '700', color: Palette.onPrimary },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  sectionTitle: { fontSize: 21, fontWeight: '800', color: Palette.text },
  sectionCaption: { fontSize: 13, color: Palette.textSecondary },
  transactionList: { gap: 10 },
  transaction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 16,
    backgroundColor: Palette.surface,
  },
  categoryIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: Palette.peach,
  },
  categoryIconOther: { backgroundColor: Palette.mint },
  transactionInfo: { flex: 1, gap: 3 },
  transactionCategory: { fontSize: 15, fontWeight: '700', color: Palette.text },
  transactionStatus: { fontSize: 12, color: Palette.textSecondary },
  transactionDate: { fontSize: 11, color: Palette.textSecondary },
  transactionAmount: {
    fontSize: 16,
    fontWeight: '800',
    color: Palette.text,
  },
  transactionBalance: {
    fontSize: 13,
    fontWeight: '700',
    color: Palette.textSecondary,
  },
  balancePositive: { color: Palette.primary },
  transactionActions: { alignItems: 'flex-end', gap: 8 },
  negativeAmount: { color: Palette.error },
  pendingAmount: { color: Palette.textSecondary },
  error: { fontSize: 14, color: Palette.error },
  success: { fontSize: 14, color: Palette.primary, fontWeight: '700' },
  muted: { fontSize: 14, color: Palette.textSecondary },
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
  confirmationMessage: {
    fontSize: 15,
    lineHeight: 22,
    color: Palette.textSecondary,
  },
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
  deleteButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: Palette.onPrimary,
  },
  snackbar: { backgroundColor: Palette.primary },
});
