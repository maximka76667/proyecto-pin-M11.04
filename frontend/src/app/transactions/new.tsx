import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
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

import { APARTMENT_ID, USER_ID } from '@/constants/dev-session';
import { Palette, Radius } from '@/constants/onboarding';
import { api, errorMessage, Member, TransactionCategory } from '@/lib/api';
import { limitTransactionAmountInput } from '@/lib/transaction-amount';

const categories: {
  value: TransactionCategory;
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}[] = [
  { value: 'supplies', label: 'Groceries', icon: 'cart-outline' },
  { value: 'utilities', label: 'Utilities', icon: 'flash-outline' },
  { value: 'maintenance', label: 'Home', icon: 'home-outline' },
  { value: 'entertainment', label: 'Entertainment', icon: 'movie-outline' },
  { value: 'other', label: 'Other', icon: 'dots-horizontal' },
];

// UT998: register an expense you paid and choose the roommate(s) who owe you
export default function NewExpenseScreen() {
  const [amount, setAmount] = useState('');
  const [concept, setConcept] = useState('');
  const [category, setCategory] = useState<TransactionCategory>('supplies');
  const [selectedDebtorIds, setSelectedDebtorIds] = useState<string[]>([]);
  const [roommates, setRoommates] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/transactions');
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        const members = (await api(
          'GET',
          `/apartments/${encodeURIComponent(APARTMENT_ID)}/members`,
        )) as Member[];
        setRoommates(members);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoadingMembers(false);
      }
    })();
  }, []);

  const normalizedAmount = amount.trim().replace(',', '.');
  const numericAmount = parseFloat(normalizedAmount) || 0;
  const perPerson =
    selectedDebtorIds.length > 0 && numericAmount > 0
      ? (numericAmount / selectedDebtorIds.length).toFixed(2)
      : null;

  const toggleDebtor = (id: string) => {
    setSelectedDebtorIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const toggleAll = () => {
    if (selectedDebtorIds.length === roommates.length) {
      setSelectedDebtorIds([]);
    } else {
      setSelectedDebtorIds(roommates.map((m) => m.id));
    }
  };

  const save = async () => {
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(normalizedAmount) || Number(normalizedAmount) <= 0) {
      setError('Enter a valid positive amount (up to 6 integer digits and 2 decimals).');
      return;
    }
    if (!concept.trim()) {
      setError('Write what the expense was for.');
      return;
    }
    if (selectedDebtorIds.length === 0) {
      setError('Choose at least one person who shares the expense.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await api('POST', '/transactions', {
        apartment_id: APARTMENT_ID,
        from_user_id: USER_ID,
        to_user_ids: selectedDebtorIds,
        amount: normalizedAmount,
        concept: concept.trim(),
        category,
      });
      goBack();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.topBar}>
          <Pressable onPress={goBack} hitSlop={12}>
            <MaterialCommunityIcons name="close" size={24} color={Palette.text} />
          </Pressable>
          <Text style={styles.screenTitle}>New expense</Text>
          <View style={styles.topBarSpacer} />
        </View>

        <Text style={styles.label}>Amount</Text>
        <View style={styles.amountField}>
          <Text style={styles.currency}>€</Text>
          <TextInput
            value={amount}
            onChangeText={(value) => setAmount(limitTransactionAmountInput(value))}
            keyboardType="decimal-pad"
            style={styles.amountInput}
            placeholder="0.00"
            placeholderTextColor={Palette.textSecondary}
          />
        </View>

        <Text style={styles.label}>Concept</Text>
        <TextInput
          value={concept}
          onChangeText={setConcept}
          maxLength={100}
          style={styles.input}
          placeholder="e.g. Compra del súper"
          placeholderTextColor={Palette.textSecondary}
        />

        <Text style={styles.label}>What was it for?</Text>
        <View style={styles.chipGrid}>
          {categories.map((item) => {
            const selected = category === item.value;
            return (
              <Pressable
                key={item.value}
                onPress={() => setCategory(item.value)}
                style={[styles.chip, selected && styles.chipActive]}>
                <MaterialCommunityIcons
                  name={item.icon}
                  size={18}
                  color={selected ? Palette.text : Palette.primary}
                />
                <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.debtorHeaderRow}>
          <Text style={styles.label}>Who shares the expense?</Text>
          {roommates.length > 0 ? (
            <Pressable onPress={toggleAll} hitSlop={8}>
              <Text style={styles.selectAllText}>
                {selectedDebtorIds.length === roommates.length ? 'Deselect all' : 'Select all'}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {selectedDebtorIds.length > 1 && perPerson ? (
          <View style={styles.splitBadge}>
            <MaterialCommunityIcons name="calculator" size={16} color={Palette.primary} />
            <Text style={styles.splitText}>
              Split equally: {perPerson} € per person ({selectedDebtorIds.length} roommates)
            </Text>
          </View>
        ) : null}

        {loadingMembers ? <ActivityIndicator color={Palette.primary} /> : null}
        {!loadingMembers && roommates.length === 0 && !error ? (
          <Text style={styles.muted}>There are no roommates in this household yet.</Text>
        ) : null}
        <View style={styles.chipGrid}>
          {roommates.map((member) => {
            const selected = selectedDebtorIds.includes(member.id);
            return (
              <Pressable
                key={member.id}
                onPress={() => toggleDebtor(member.id)}
                style={[styles.chip, selected && styles.chipActive]}>
                <MaterialCommunityIcons
                  name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'}
                  size={18}
                  color={selected ? Palette.text : Palette.primary}
                />
                <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                  {member.id === USER_ID ? 'Yo' : member.full_name}
                  {selected && perPerson ? ` (${perPerson} €)` : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          onPress={save}
          disabled={saving}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
          {saving ? (
            <ActivityIndicator color={Palette.onPrimary} />
          ) : (
            <Text style={styles.primaryButtonText}>Save expense</Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Palette.background },
  container: { width: '100%', maxWidth: 480, alignSelf: 'center', padding: 24, gap: 16 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topBarSpacer: { width: 24 },
  screenTitle: { fontSize: 18, fontWeight: '800', color: Palette.text },
  label: { marginTop: 4, fontSize: 13, fontWeight: '800', color: Palette.text },
  debtorHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  selectAllText: {
    fontSize: 13,
    fontWeight: '700',
    color: Palette.primary,
  },
  splitBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: Radius.input,
    backgroundColor: Palette.mint,
  },
  splitText: {
    fontSize: 13,
    fontWeight: '700',
    color: Palette.text,
  },
  amountField: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 16,
    backgroundColor: Palette.surface,
  },
  currency: { fontSize: 25, fontWeight: '700', color: Palette.textSecondary },
  amountInput: {
    flex: 1,
    paddingVertical: 17,
    paddingLeft: 10,
    fontSize: 25,
    fontWeight: '800',
    color: Palette.text,
  },
  input: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: Palette.text,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.input,
    backgroundColor: Palette.surface,
  },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 11,
    paddingHorizontal: 13,
    borderRadius: Radius.input,
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  chipActive: { backgroundColor: Palette.peach, borderColor: Palette.peach },
  chipText: { fontSize: 13, fontWeight: '700', color: Palette.text },
  chipTextActive: { fontWeight: '800' },
  muted: { fontSize: 14, color: Palette.textSecondary },
  error: { fontSize: 14, color: Palette.error },
  pressed: { opacity: 0.85 },
  primaryButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.button,
    backgroundColor: Palette.primary,
  },
  primaryButtonText: { fontSize: 16, fontWeight: '800', color: Palette.onPrimary },
});
