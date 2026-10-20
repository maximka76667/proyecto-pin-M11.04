import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, errorMessage } from '@/lib/api';
import { Palette, Radius } from '@/constants/onboarding';

type Category = 'utilities' | 'maintenance' | 'supplies' | 'payment' | 'other';

type Transaction = {
  id: string;
  amount: string;
  category: Category;
  fromUser: { full_name: string };
  toUser: { full_name: string };
  apartment: { name: string };
};

const categories: { value: Category; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }[] = [
  { value: 'supplies', label: 'Groceries', icon: 'cart-outline' },
  { value: 'utilities', label: 'Utilities', icon: 'flash-outline' },
  { value: 'maintenance', label: 'Home', icon: 'home-outline' },
  { value: 'other', label: 'Other', icon: 'dots-horizontal' },
];

export default function EditExpenseScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<Category>('other');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) {
      setError('Expense not found.');
      setLoading(false);
      return;
    }

    void (async () => {
      try {
        const loaded = await api('GET', `/transactions/${id}`) as Transaction;
        setTransaction(loaded);
        setAmount(loaded.amount);
        setCategory(loaded.category);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const save = async () => {
    const normalizedAmount = amount.trim().replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(normalizedAmount) || Number(normalizedAmount) <= 0) {
      setError('Enter a valid positive amount.');
      return;
    }
    if (!transaction) return;

    setSaving(true);
    setError('');
    try {
      await api('PATCH', `/transactions/${transaction.id}`, {
        amount: normalizedAmount,
        category,
      });
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ActivityIndicator color={Palette.primary} style={styles.loader} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <MaterialCommunityIcons name="close" size={24} color={Palette.text} />
          </Pressable>
          <Text style={styles.screenTitle}>Edit expense</Text>
          <Pressable onPress={save} disabled={saving || !transaction} hitSlop={12}>
            {saving ? <ActivityIndicator color={Palette.primary} /> : <Text style={styles.saveLink}>Save</Text>}
          </Pressable>
        </View>

        <Pressable
          onPress={() => {}}
          style={({ pressed }) => [styles.receiptCard, pressed && styles.receiptCardPressed]}>
          <View style={styles.receiptIcon}>
            <MaterialCommunityIcons name="camera-outline" size={22} color={Palette.onPrimary} />
          </View>
          <View style={styles.receiptCopy}>
            <Text style={styles.receiptTitle}>Scan a receipt</Text>
            <Text style={styles.receiptSubtitle}>Let AI fill in the details for you.</Text>
          </View>
          <MaterialCommunityIcons name="arrow-up-right" size={20} color={Palette.onPrimary} />
        </Pressable>

        <Text style={styles.label}>Amount</Text>
        <View style={styles.amountField}>
          <Text style={styles.currency}>€</Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            style={styles.amountInput}
            placeholder="0.00"
            placeholderTextColor={Palette.textSecondary}
          />
        </View>

        <Text style={styles.label}>What was it for?</Text>
        <View style={styles.categoryGrid}>
          {categories.map((item) => (
            <Pressable
              key={item.value}
              onPress={() => setCategory(item.value)}
              style={[styles.category, category === item.value && styles.categoryActive]}>
              <MaterialCommunityIcons
                name={item.icon}
                size={18}
                color={category === item.value ? Palette.text : Palette.primary}
              />
              <Text style={[styles.categoryText, category === item.value && styles.categoryTextActive]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Split between</Text>
        <View style={styles.splitCard}>
          <SplitOption label="Everyone" detail={transaction ? `Paid by ${transaction.fromUser.full_name}` : ''} selected />
          <SplitOption label={transaction?.toUser.full_name ?? 'Household members'} detail="Current split" />
          <SplitOption label="Custom" detail="Coming soon" disabled />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable onPress={save} disabled={saving || !transaction} style={styles.primaryButton}>
          {saving ? <ActivityIndicator color={Palette.onPrimary} /> : <Text style={styles.primaryButtonText}>Save changes</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function SplitOption({
  label,
  detail,
  selected = false,
  disabled = false,
}: {
  label: string;
  detail: string;
  selected?: boolean;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.splitOption, disabled && styles.splitDisabled]}>
      <MaterialCommunityIcons
        name={selected ? 'radiobox-marked' : 'radiobox-blank'}
        size={20}
        color={selected ? Palette.primary : Palette.border}
      />
      <View style={styles.splitCopy}>
        <Text style={styles.splitLabel}>{label}</Text>
        <Text style={styles.splitDetail}>{detail}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Palette.background },
  loader: { flex: 1 },
  container: { width: '100%', maxWidth: 480, alignSelf: 'center', padding: 24, gap: 16 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  screenTitle: { fontSize: 18, fontWeight: '800', color: Palette.text },
  saveLink: { fontSize: 15, fontWeight: '800', color: Palette.primary },
  receiptCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 18, backgroundColor: Palette.primary },
  receiptCardPressed: { opacity: 0.85 },
  receiptIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  receiptCopy: { flex: 1, gap: 3 },
  receiptTitle: { fontSize: 15, fontWeight: '800', color: Palette.onPrimary },
  receiptSubtitle: { fontSize: 12, color: Palette.mint },
  label: { marginTop: 4, fontSize: 13, fontWeight: '800', color: Palette.text },
  amountField: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, borderWidth: 1, borderColor: Palette.border, borderRadius: 16, backgroundColor: Palette.surface },
  currency: { fontSize: 25, fontWeight: '700', color: Palette.textSecondary },
  amountInput: { flex: 1, paddingVertical: 17, paddingLeft: 10, fontSize: 25, fontWeight: '800', color: Palette.text },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  category: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 11, paddingHorizontal: 13, borderRadius: Radius.input, backgroundColor: Palette.surface, borderWidth: 1, borderColor: Palette.border },
  categoryActive: { backgroundColor: Palette.peach, borderColor: Palette.peach },
  categoryText: { fontSize: 13, fontWeight: '700', color: Palette.text },
  categoryTextActive: { fontWeight: '800' },
  splitCard: { padding: 14, gap: 2, borderWidth: 1, borderColor: Palette.border, borderRadius: 16, backgroundColor: Palette.surface },
  splitOption: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  splitDisabled: { opacity: 0.45 },
  splitCopy: { gap: 2 },
  splitLabel: { fontSize: 14, fontWeight: '700', color: Palette.text },
  splitDetail: { fontSize: 12, color: Palette.textSecondary },
  error: { fontSize: 14, color: Palette.error },
  primaryButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.button, backgroundColor: Palette.primary },
  primaryButtonText: { fontSize: 16, fontWeight: '800', color: Palette.onPrimary },
});
