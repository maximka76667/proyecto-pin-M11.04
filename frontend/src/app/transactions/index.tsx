import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
const USER_ID = '22222222-2222-2222-2222-222222222222';

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
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const loadTransactions = async () => {
      try {
        const [summaryData, allTransactions] = await Promise.all([
          api(
            'GET',
            `/transactions/${encodeURIComponent(APARTMENT_ID)}/my-summary`,
          ) as Promise<PersonalSummary>,
          api('GET', '/transactions') as Promise<Transaction[]>,
        ]);

        setSummary(summaryData);
        setTransactions(
          allTransactions.filter(
            (transaction) => transaction.apartment_id === APARTMENT_ID
              && (transaction.from_user_id === USER_ID || transaction.to_user_id === USER_ID),
          ),
        );
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    };

    loadTransactions();
  }, [refreshKey]);

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
          userId={USER_ID}
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
                    </Text>
                  </View>
                  <Text style={[styles.transactionAmount, !paidByMe && styles.negativeAmount]}>
                    {paidByMe ? '+' : '-'}{amount.toFixed(2)} €
                  </Text>
                </View>
              );
            })}
          </View>
        ) : !loading ? (
          <Text style={styles.muted}>No hay transacciones para mostrar.</Text>
        ) : null}
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
  negativeAmount: { color: Palette.error },
  error: { fontSize: 14, color: Palette.error },
  muted: { fontSize: 14, color: Palette.textSecondary },
});
