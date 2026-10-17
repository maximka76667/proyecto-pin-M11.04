import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Palette, Radius } from '@/constants/onboarding';
import { api, errorMessage } from '@/lib/api';

type PublicBalance = {
  apartment: { name: string };
  globalPayments: { deudor: string; acreedor: string; monto: number }[];
};

export default function SharedBalance() {
  const { inviteCode } = useLocalSearchParams<{ inviteCode?: string }>();
  const [balance, setBalance] = useState<PublicBalance | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const loadBalance = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await api(
          'GET',
          `/transactions/public-balance/${encodeURIComponent(inviteCode ?? '')}`,
        );
        if (active) setBalance(data);
      } catch (e) {
        if (active) setError(errorMessage(e));
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadBalance();
    return () => {
      active = false;
    };
  }, [inviteCode]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <View style={styles.logo}>
            <MaterialCommunityIcons name="home-heart" size={28} color={Palette.onPrimary} />
          </View>
          <Text style={styles.eyebrow}>ROOM8 · BALANCE COMPARTIDO</Text>
          <Text style={styles.title}>{balance?.apartment.name ?? 'Balance del hogar'}</Text>
          <Text style={styles.subtitle}>Consulta el balance sin instalar la aplicación.</Text>
        </View>

        {loading ? <ActivityIndicator color={Palette.primary} size="large" /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {balance && !loading ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Pagos pendientes entre convivientes</Text>
            {balance.globalPayments.length === 0 ? (
              <Text style={styles.muted}>No hay pagos pendientes.</Text>
            ) : (
              <View style={styles.list}>
                {balance.globalPayments.map((payment, index) => (
                  <View key={`${payment.deudor}-${payment.acreedor}-${index}`} style={styles.payment}>
                    <View style={styles.paymentText}>
                      <Text style={styles.debtor}>{payment.deudor}</Text>
                      <Text style={styles.arrow}>debe a {payment.acreedor}</Text>
                    </View>
                    <Text style={styles.amount}>{payment.monto.toFixed(2)} €</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : null}

        {balance && !loading ? (
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/household',
                params: { mode: 'join', inviteCode },
              })
            }
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
            <Text style={styles.buttonText}>Unirme a este hogar</Text>
            <MaterialCommunityIcons name="arrow-right" size={18} color={Palette.onPrimary} />
          </Pressable>
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
    maxWidth: 640,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
    gap: 20,
  },
  header: { alignItems: 'center', gap: 10, paddingVertical: 20 },
  logo: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.primary,
  },
  eyebrow: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: Palette.primary,
  },
  title: { fontSize: 30, fontWeight: '800', textAlign: 'center', color: Palette.text },
  subtitle: { fontSize: 15, textAlign: 'center', color: Palette.textSecondary },
  card: {
    padding: 20,
    gap: 16,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.input,
    backgroundColor: Palette.surface,
  },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: Palette.text },
  list: { gap: 12 },
  payment: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Palette.border,
  },
  paymentText: { flex: 1, gap: 3 },
  debtor: { fontSize: 15, fontWeight: '700', color: Palette.text },
  arrow: { fontSize: 13, color: Palette.textSecondary },
  amount: { fontSize: 16, fontWeight: '800', color: Palette.primary },
  muted: { fontSize: 14, color: Palette.textSecondary },
  error: { fontSize: 14, textAlign: 'center', color: Palette.error },
  button: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: Radius.button,
    backgroundColor: Palette.primary,
  },
  buttonText: { fontSize: 16, fontWeight: '700', color: Palette.onPrimary },
  pressed: { opacity: 0.85 },
});
