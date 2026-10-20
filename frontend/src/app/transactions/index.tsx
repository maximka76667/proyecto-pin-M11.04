import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SettleUpCard } from '@/components/settle-up';
import { Palette } from '@/constants/onboarding';
import { api, errorMessage } from '@/lib/api';

const APARTMENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_ID = '11111111-1111-1111-1111-111111111111';

type PersonalSummary = {
  miResumen: {
    esDeudor: boolean;
    monto: number;
    conceptos: string[];
  };
  mensaje: string;
};

type Transaction = {
  id: string;
  apartment_id: string;
  from_user_id: string;
  to_user_id: string;
  amount: number | string;
  category: string;
  fromUser: {
    full_name: string;
  };
  toUser: {
    full_name: string;
  };
};

export default function Transactions() {
  const [summary, setSummary] = useState<PersonalSummary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [transactionMenu, setTransactionMenu] = useState<Transaction | null>(null);
  const [transactionToDelete, setTransactionToDelete] = useState<Transaction | null>(null);
  // sube al saldar una deuda, para recargar el balance y la lista sin salir de la pantalla
  const [refreshKey, setRefreshKey] = useState(0);

  const deleteTransaction = async () => {
    if (!transactionToDelete) return;

    try {
      await api('DELETE', `/transactions/${transactionToDelete.id}`);
      const deletedId = transactionToDelete.id;
      setTransactionToDelete(null);
      setTransactions((current) =>
        current.filter(({ id }) => id !== deletedId),
      );

      try {
        const updatedSummary = await api(
          'GET',
          `/transactions/${encodeURIComponent(APARTMENT_ID)}/my-summary`,
        ) as PersonalSummary;
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
        const apartmentTransactions = await api(
          'GET',
          `/transactions?apartment_id=${encodeURIComponent(APARTMENT_ID)}`,
        ) as Transaction[];

        if (active) {
          setTransactions(
            apartmentTransactions.filter((transaction) =>
              transaction.from_user_id === USER_ID || transaction.to_user_id === USER_ID),
          );
        }

        try {
          const summaryData = await api(
            'GET',
            `/transactions/${encodeURIComponent(APARTMENT_ID)}/my-summary`,
          ) as PersonalSummary;
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

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={Palette.text} />
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.eyebrow}>MIS TRANSACCIONES</Text>
          <Text style={styles.title}>Dinero</Text>
        </View>

        {loading ? <ActivityIndicator color={Palette.primary} size="large" /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

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
          <Text style={styles.sectionTitle}>Mis transacciones</Text>
          <Text style={styles.sectionCaption}>{transactions.length}</Text>
        </View>

        {transactions.length > 0 ? (
          <View style={styles.transactionList}>
            {transactions.map((transaction) => {
              const amount = Number(transaction.amount);
              const paidByMe = transaction.from_user_id === USER_ID;
              const pendiente = transaction.category === 'pending';
              // el backend no deja editar ni borrar pagos ni avisos: no se ofrece el menú
              const editable = transaction.category !== 'payment' && !pendiente;

              return (
                <View key={transaction.id} style={styles.transaction}>
                  <View style={[styles.categoryIcon, !paidByMe && styles.categoryIconOther]}>
                    <MaterialCommunityIcons
                      name={paidByMe ? 'cart-outline' : 'home-outline'}
                      size={20}
                      color={Palette.primary}
                    />
                  </View>
                  <View style={styles.transactionInfo}>
                    <Text style={styles.transactionCategory}>{transaction.category}</Text>
                    <Text style={styles.transactionStatus}>
                      {paidByMe ? 'Pagaste tú' : `Pagó ${transaction.fromUser.full_name}`}
                      {pendiente ? ' · pendiente de confirmar' : ''}
                    </Text>
                  </View>
                  <View style={styles.transactionActions}>
                    <Text
                      style={[
                        styles.transactionAmount,
                        !paidByMe && styles.negativeAmount,
                        // todavía no cuenta en el balance
                        pendiente && styles.pendingAmount,
                      ]}>
                      {paidByMe ? '+' : '-'}{amount.toFixed(2)} €
                    </Text>
                    {editable ? (
                      <Pressable
                        onPress={() => setTransactionMenu(transaction)}
                        hitSlop={8}
                        style={styles.menuButton}>
                        <MaterialCommunityIcons name="dots-horizontal" size={22} color={Palette.text} />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        ) : !loading ? (
          <Text style={styles.muted}>No hay transacciones para mostrar.</Text>
        ) : null}
      </ScrollView>
      <Modal
        visible={transactionMenu !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setTransactionMenu(null)}>
        <Pressable
          style={[styles.modalBackdrop, styles.actionMenuBackdrop]}
          onPress={() => setTransactionMenu(null)}>
          <Pressable style={styles.actionMenu} onPress={() => undefined}>
            <View style={styles.actionMenuHandle} />
            <View style={styles.actionMenuHeader}>
              <View style={styles.actionMenuIcon}>
                <MaterialCommunityIcons name="receipt-text-outline" size={23} color={Palette.primary} />
              </View>
              <View style={styles.actionMenuHeaderText}>
                <Text style={styles.actionMenuEyebrow}>OPCIONES DEL GASTO</Text>
                <Text style={styles.actionMenuTitle}>
                  {transactionMenu?.category ?? 'Gasto'}
                </Text>
              </View>
              <Text style={styles.actionMenuAmount}>
                {transactionMenu ? `${Number(transactionMenu.amount).toFixed(2)} €` : ''}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                if (!transactionMenu) return;
                const id = transactionMenu.id;
                setTransactionMenu(null);
                router.push({
                  pathname: '/transactions/edit',
                  params: { id },
                });
              }}
              style={styles.actionMenuItem}>
              <View style={styles.actionMenuItemIcon}>
                <MaterialCommunityIcons name="pencil-outline" size={20} color={Palette.primary} />
              </View>
              <Text style={styles.actionMenuItemText}>Editar gasto</Text>
              <MaterialCommunityIcons name="chevron-right" size={21} color={Palette.textSecondary} />
            </Pressable>
            <Pressable
              onPress={() => {
                setTransactionToDelete(transactionMenu);
                setTransactionMenu(null);
              }}
              style={styles.actionMenuItem}>
              <View style={[styles.actionMenuItemIcon, styles.actionMenuDeleteIcon]}>
                <MaterialCommunityIcons name="trash-can-outline" size={20} color={Palette.error} />
              </View>
              <Text style={styles.actionMenuDeleteText}>Eliminar gasto</Text>
              <MaterialCommunityIcons name="chevron-right" size={21} color={Palette.textSecondary} />
            </Pressable>
            <Pressable
              onPress={() => setTransactionMenu(null)}
              style={styles.actionMenuCancel}>
              <Text style={styles.actionMenuCancelText}>Cancelar</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
                ? `${Number(transactionToDelete.amount).toFixed(2)} € de ${transactionToDelete.category}`
                : 'este gasto'}
              ?
            </Text>
            <View style={styles.confirmationActions}>
              <Pressable
                onPress={() => setTransactionToDelete(null)}
                style={styles.cancelButton}>
                <Text style={styles.cancelButtonText}>No</Text>
              </Pressable>
              <Pressable onPress={() => void deleteTransaction()} style={styles.deleteButton}>
                <Text style={styles.deleteButtonText}>Sí, eliminar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  back: { alignSelf: 'flex-start', paddingTop: 8 },
  header: { gap: 6 },
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
  balanceLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: Palette.onPrimary },
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
  transactionAmount: { fontSize: 14, fontWeight: '800', color: Palette.primary },
  transactionActions: { alignItems: 'flex-end', gap: 8 },
  menuButton: {
    padding: 4,
    borderRadius: 12,
    backgroundColor: Palette.segment,
  },
  negativeAmount: { color: Palette.error },
  pendingAmount: { color: Palette.textSecondary },
  error: { fontSize: 14, color: Palette.error },
  muted: { fontSize: 14, color: Palette.textSecondary },
  actionMenuBackdrop: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: 0,
  },
  actionMenu: {
    width: '100%',
    maxWidth: 560,
    gap: 6,
    padding: 24,
    paddingTop: 12,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: Palette.background,
  },
  actionMenuHandle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    marginBottom: 20,
    borderRadius: 999,
    backgroundColor: Palette.border,
  },
  actionMenuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  actionMenuIcon: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: Palette.mint,
  },
  actionMenuHeaderText: { flex: 1, gap: 3 },
  actionMenuEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    color: Palette.textSecondary,
  },
  actionMenuTitle: { fontSize: 19, fontWeight: '800', color: Palette.text },
  actionMenuAmount: { fontSize: 16, fontWeight: '800', color: Palette.primary },
  actionMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 58,
    paddingHorizontal: 10,
    borderRadius: 15,
    backgroundColor: Palette.surface,
  },
  actionMenuItemIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: Palette.mint,
  },
  actionMenuDeleteIcon: { backgroundColor: '#F9E4E0' },
  actionMenuItemText: { fontSize: 16, fontWeight: '700', color: Palette.text },
  actionMenuDeleteText: { fontSize: 16, fontWeight: '700', color: Palette.error },
  actionMenuCancel: {
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
    marginTop: 6,
    borderRadius: 15,
    backgroundColor: Palette.segment,
  },
  actionMenuCancelText: { fontSize: 15, fontWeight: '800', color: Palette.text },
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
