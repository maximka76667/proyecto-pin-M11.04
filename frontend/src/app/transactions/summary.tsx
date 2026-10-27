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

import { APARTMENT_ID } from '@/constants/dev-session';
import { Palette } from '@/constants/onboarding';
import { api, errorMessage } from '@/lib/api';

type PersonalSummary = {
  miResumen: {
    esDeudor: boolean;
    monto: number;
    conceptos: string[];
  };
  mensaje: string;
};

export default function Transactions() {
  const [summary, setSummary] = useState<PersonalSummary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadSummary = async () => {
      try {
        const data: PersonalSummary = await api(
          'GET',
          `/transactions/${encodeURIComponent(APARTMENT_ID)}/my-summary`,
        );
        setSummary(data);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    };

    loadSummary();
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.replace('/transactions')} hitSlop={12} style={styles.back}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={Palette.text} />
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.eyebrow}>DETALLE DEL BALANCE</Text>
          <Text style={styles.title}>¿Cuál es mi balance?</Text>
          <Text style={styles.subtitle}>
            Aquí puedes ver el detalle de tus pagos pendientes.
          </Text>
        </View>

        {loading ? <ActivityIndicator color={Palette.primary} size="large" /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {summary ? (
          <>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Mi balance</Text>
              <Text style={styles.message}>{summary.mensaje}</Text>
              <Text style={styles.amount}>
                {summary.miResumen.monto.toFixed(2)} €
              </Text>
              <Text style={styles.status}>
                {summary.miResumen.esDeudor ? 'Tienes que pagar' : 'Pendiente de cobro'}
              </Text>
              {summary.miResumen.conceptos.length > 0 ? (
                <View style={styles.list}>
                  {summary.miResumen.conceptos.map((concepto, index) => (
                    <View key={`${concepto}-${index}`} style={styles.detailRow}>
                      <MaterialCommunityIcons
                        name={summary.miResumen.esDeudor ? 'arrow-up-bold' : 'arrow-down-bold'}
                        size={18}
                        color={Palette.primary}
                      />
                      <Text style={styles.listItem}>{concepto}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.muted}>No hay conceptos pendientes.</Text>
              )}
            </View>

          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  container: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingBottom: 32,
    gap: 20,
  },
  back: {
    alignSelf: 'flex-start',
    paddingTop: 8,
  },
  header: {
    gap: 8,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: Palette.primary,
  },
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    color: Palette.text,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: Palette.textSecondary,
  },
  card: {
    gap: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 16,
    backgroundColor: Palette.surface,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: Palette.text,
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 12,
    color: Palette.text,
    backgroundColor: Palette.background,
    fontSize: 14,
  },
  button: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: Palette.primary,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '800',
    color: Palette.onPrimary,
  },
  error: {
    fontSize: 14,
    color: Palette.error,
  },
  sectionTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: Palette.text,
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
    color: Palette.text,
  },
  amount: {
    fontSize: 28,
    fontWeight: '800',
    color: Palette.primary,
  },
  status: {
    fontSize: 14,
    fontWeight: '700',
    color: Palette.textSecondary,
  },
  list: {
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  listItem: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: Palette.text,
  },
  muted: {
    fontSize: 14,
    color: Palette.textSecondary,
  },
  payment: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  paymentText: {
    flex: 1,
    fontSize: 13,
    color: Palette.text,
  },
  paymentAmount: {
    fontSize: 14,
    fontWeight: '800',
    color: Palette.primary,
  },
});
