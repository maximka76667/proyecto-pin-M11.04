import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { APARTMENT_ID } from '@/constants/dev-session';
import { Palette, Radius } from '@/constants/onboarding';
import { api, errorMessage } from '@/lib/api';
import { currentMonth, monthLabel, shiftMonth } from '@/lib/month';

// GET /points/ranking: puntos del mes y totales de cada miembro de la casa
type RankingRow = {
  user_id: string;
  full_name: string;
  isCurrentUser: boolean;
  points: number;
  total_points: number;
  rank: number;
};

type RankingResponse = { month: string; ranking: RankingRow[] };

const medalColors: Record<number, string> = { 1: '#E0A82E', 2: '#9AA3AE', 3: '#B87A4B' };

export default function RankingScreen() {
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState<RankingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Se vuelve a cargar al volver a la pantalla (p. ej. tras completar una tarea) y al cambiar de mes
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setError('');
      void (
        api(
          'GET',
          `/points/ranking?apartment_id=${encodeURIComponent(APARTMENT_ID)}&month=${month}`,
        ) as Promise<RankingResponse>
      )
        .then((result) => {
          if (active) setData(result);
        })
        .catch((e) => {
          if (active) setError(errorMessage(e));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [month]),
  );

  const isCurrentMonth = month === currentMonth();

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.topBar}>
          <Text style={styles.title}>Ranking de la casa</Text>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/chores'))}
            hitSlop={12}
            accessibilityLabel="Cerrar">
            <MaterialCommunityIcons name="close" size={23} color={Palette.text} />
          </Pressable>
        </View>

        <View style={styles.monthRow}>
          <Pressable
            accessibilityLabel="Mes anterior"
            hitSlop={10}
            onPress={() => setMonth((current) => shiftMonth(current, -1))}>
            <MaterialCommunityIcons name="chevron-left" size={24} color={Palette.primary} />
          </Pressable>
          <Text style={styles.monthTitle}>{monthLabel(month)}</Text>
          <Pressable
            accessibilityLabel="Mes siguiente"
            disabled={isCurrentMonth}
            hitSlop={10}
            onPress={() => setMonth((current) => shiftMonth(current, 1))}
            style={isCurrentMonth && styles.disabled}>
            <MaterialCommunityIcons name="chevron-right" size={24} color={Palette.primary} />
          </Pressable>
        </View>

        {loading ? <ActivityIndicator color={Palette.primary} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {!loading && !error && data ? (
          <View style={styles.list}>
            {data.ranking.map((row) => (
              <View key={row.user_id} style={[styles.row, row.isCurrentUser && styles.rowCurrent]}>
                <View style={styles.rankBadge}>
                  {row.points > 0 && medalColors[row.rank] ? (
                    <MaterialCommunityIcons name="trophy" size={22} color={medalColors[row.rank]} />
                  ) : (
                    <Text style={styles.rankText}>{row.rank}</Text>
                  )}
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.name}>
                    {row.isCurrentUser ? `Yo · ${row.full_name}` : row.full_name}
                  </Text>
                  <Text style={styles.total}>{row.total_points} pts en total</Text>
                </View>
                <Text style={styles.points}>{row.points} pts</Text>
              </View>
            ))}
            {data.ranking.every((row) => row.points === 0) ? (
              <Text style={styles.muted}>
                Todavía no hay puntos este mes. Se ganan al marcar tus tareas como hechas.
              </Text>
            ) : null}
          </View>
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
    paddingTop: 12,
    paddingBottom: 32,
    gap: 16,
  },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 22, fontWeight: '800', color: Palette.text },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthTitle: { fontSize: 15, fontWeight: '800', color: Palette.text, textTransform: 'capitalize' },
  disabled: { opacity: 0.3 },
  list: { gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.input,
    backgroundColor: Palette.surface,
  },
  rowCurrent: { borderColor: Palette.primary, backgroundColor: Palette.mint },
  rankBadge: { width: 28, alignItems: 'center' },
  rankText: { fontSize: 16, fontWeight: '800', color: Palette.textSecondary },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '800', color: Palette.text },
  total: { fontSize: 12, color: Palette.textSecondary },
  points: { fontSize: 16, fontWeight: '800', color: Palette.primary },
  error: { fontSize: 14, textAlign: 'center', color: Palette.error },
  muted: { fontSize: 14, textAlign: 'center', color: Palette.textSecondary },
});
