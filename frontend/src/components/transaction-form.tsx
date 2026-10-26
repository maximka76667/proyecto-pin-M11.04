import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { APARTMENT_ID, USER_ID } from "@/constants/dev-session";
import { Palette, Radius } from "@/constants/onboarding";
import { api, errorMessage, Member, TransactionCategory } from "@/lib/api";
import { limitTransactionAmountInput } from "@/lib/transaction-amount";

export type TransactionFormValues = {
  amount: string;
  concept: string;
  category: TransactionCategory;
  date: string;
  debtorIds: string[];
};

type Props = {
  title: string;
  submitLabel: string;
  initialValues?: Partial<TransactionFormValues>;
  onCancel: () => void;
  onSubmit: (values: TransactionFormValues) => Promise<void>;
  allowMultipleDebtors?: boolean;
  excludeCurrentUser?: boolean;
  allowDebtorChange?: boolean;
};

const categories: {
  value: TransactionCategory;
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}[] = [
  { value: "supplies", label: "Groceries", icon: "cart-outline" },
  { value: "utilities", label: "Utilities", icon: "flash-outline" },
  { value: "maintenance", label: "Home", icon: "home-outline" },
  { value: "entertainment", label: "Entertainment", icon: "movie-outline" },
  { value: "other", label: "Other", icon: "dots-horizontal" },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function TransactionForm({
  title,
  submitLabel,
  initialValues,
  onCancel,
  onSubmit,
  allowMultipleDebtors = true,
  excludeCurrentUser = false,
  allowDebtorChange = true,
}: Props) {
  const [amount, setAmount] = useState(initialValues?.amount ?? "");
  const [concept, setConcept] = useState(initialValues?.concept ?? "");
  const [category, setCategory] = useState<TransactionCategory>(
    initialValues?.category ?? "supplies",
  );
  const [date, setDate] = useState(initialValues?.date ?? today());
  const [selectedDebtorIds, setSelectedDebtorIds] = useState<string[]>(
    initialValues?.debtorIds ?? [],
  );
  const [roommates, setRoommates] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        setRoommates(
          (await api(
            "GET",
            `/apartments/${encodeURIComponent(APARTMENT_ID)}/members`,
          )) as Member[],
        );
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoadingMembers(false);
      }
    })();
  }, []);

  const normalizedAmount = amount.trim().replace(",", ".");
  const numericAmount = Number(normalizedAmount) || 0;
  const perPerson =
    selectedDebtorIds.length > 0 && numericAmount > 0
      ? (numericAmount / selectedDebtorIds.length).toFixed(2)
      : null;

  const toggleAll = () => {
    if (!allowMultipleDebtors) return;
    setSelectedDebtorIds(
      selectedDebtorIds.length === roommates.length
        ? []
        : roommates.map((member) => member.id),
    );
  };

  const save = async () => {
    if (
      !/^\d{1,6}(\.\d{1,2})?$/.test(normalizedAmount) ||
      Number(normalizedAmount) <= 0
    ) {
      setError(
        "Enter a valid positive amount (up to 6 integer digits and 2 decimals).",
      );
      return;
    }
    if (!concept.trim()) {
      setError("Write what the expense was for.");
      return;
    }
    if (selectedDebtorIds.length === 0) {
      setError("Choose at least one person who shares the expense.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError("Enter a valid date using YYYY-MM-DD.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await onSubmit({
        amount: normalizedAmount,
        concept: concept.trim(),
        category,
        date,
        debtorIds: selectedDebtorIds,
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topBar}>
          <Pressable onPress={onCancel} hitSlop={12}>
            <MaterialCommunityIcons
              name="close"
              size={24}
              color={Palette.text}
            />
          </Pressable>
          <Text style={styles.screenTitle}>{title}</Text>
          <Pressable onPress={save} disabled={saving} hitSlop={12}>
            {saving ? (
              <ActivityIndicator color={Palette.primary} />
            ) : (
              <Text style={styles.saveLink}>Save</Text>
            )}
          </Pressable>
        </View>

        <Text style={styles.label}>Amount</Text>
        <View style={styles.amountField}>
          <Text style={styles.currency}>€</Text>
          <TextInput
            value={amount}
            onChangeText={(value) =>
              setAmount(limitTransactionAmountInput(value))
            }
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

        <Text style={styles.label}>Date</Text>
        <TextInput
          value={date}
          onChangeText={setDate}
          style={styles.input}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={Palette.textSecondary}
        />

        <Text style={styles.label}>Category</Text>
        <View style={styles.chipGrid}>
          {categories.map((item) => {
            const selected = category === item.value;
            return (
              <Pressable
                key={item.value}
                onPress={() => setCategory(item.value)}
                style={[styles.chip, selected && styles.chipActive]}
              >
                <MaterialCommunityIcons
                  name={item.icon}
                  size={18}
                  color={selected ? Palette.text : Palette.primary}
                />
                <Text
                  style={[styles.chipText, selected && styles.chipTextActive]}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.debtorHeaderRow}>
          <Text style={styles.label}>Who shares the expense?</Text>
          {allowDebtorChange &&
          allowMultipleDebtors &&
          roommates.length > 0 ? (
            <Pressable onPress={toggleAll} hitSlop={8}>
              <Text style={styles.selectAllText}>
                {selectedDebtorIds.length === roommates.length
                  ? "Deselect all"
                  : "Select all"}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {!allowDebtorChange ? (
          <Text style={styles.readOnlyHint}>
            La persona no se puede cambiar al editar un gasto. Para cambiarla,
            elimina el gasto y crea uno nuevo.
          </Text>
        ) : null}
        {allowDebtorChange &&
        allowMultipleDebtors &&
        selectedDebtorIds.length > 1 &&
        perPerson ? (
          <View style={styles.splitBadge}>
            <MaterialCommunityIcons
              name="calculator"
              size={16}
              color={Palette.primary}
            />
            <Text style={styles.splitText}>
              Split equally: {perPerson} € per person
            </Text>
          </View>
        ) : null}
        {loadingMembers ? <ActivityIndicator color={Palette.primary} /> : null}
        <View style={styles.chipGrid}>
          {roommates
            .filter((member) => !excludeCurrentUser || member.id !== USER_ID)
            .filter(
              (member) =>
                allowDebtorChange || selectedDebtorIds.includes(member.id),
            )
            .map((member) => {
              const selected = selectedDebtorIds.includes(member.id);
              return (
                <Pressable
                  key={member.id}
                  onPress={() =>
                    !allowDebtorChange
                      ? undefined
                      : setSelectedDebtorIds((current) =>
                          allowMultipleDebtors
                            ? selected
                              ? current.filter((id) => id !== member.id)
                              : [...current, member.id]
                            : [member.id],
                        )
                  }
                  disabled={!allowDebtorChange}
                  style={[styles.chip, selected && styles.chipActive]}
                >
                  <MaterialCommunityIcons
                    name={
                      allowMultipleDebtors
                        ? selected
                          ? "checkbox-marked"
                          : "checkbox-blank-outline"
                        : selected
                          ? "radiobox-marked"
                          : "radiobox-blank"
                    }
                    size={18}
                    color={selected ? Palette.text : Palette.primary}
                  />
                  <Text
                    style={[styles.chipText, selected && styles.chipTextActive]}
                  >
                    {member.id === USER_ID ? "Yo" : member.full_name}
                    {selected && perPerson ? ` (${perPerson} €)` : ""}
                  </Text>
                </Pressable>
              );
            })}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          onPress={save}
          disabled={saving}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.pressed,
          ]}
        >
          {saving ? (
            <ActivityIndicator color={Palette.onPrimary} />
          ) : (
            <Text style={styles.primaryButtonText}>{submitLabel}</Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Palette.background },
  container: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    padding: 24,
    gap: 16,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  screenTitle: { fontSize: 18, fontWeight: "800", color: Palette.text },
  saveLink: { fontSize: 15, fontWeight: "800", color: Palette.primary },
  label: { marginTop: 4, fontSize: 13, fontWeight: "800", color: Palette.text },
  amountField: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 16,
    backgroundColor: Palette.surface,
  },
  currency: { fontSize: 25, fontWeight: "700", color: Palette.textSecondary },
  amountInput: {
    flex: 1,
    paddingVertical: 17,
    paddingLeft: 10,
    fontSize: 25,
    fontWeight: "800",
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
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 11,
    paddingHorizontal: 13,
    borderRadius: Radius.input,
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  chipActive: { backgroundColor: Palette.peach, borderColor: Palette.peach },
  chipText: { fontSize: 13, fontWeight: "700", color: Palette.text },
  chipTextActive: { fontWeight: "800" },
  debtorHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  selectAllText: { fontSize: 13, fontWeight: "700", color: Palette.primary },
  splitBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: Radius.input,
    backgroundColor: Palette.mint,
  },
  splitText: { fontSize: 13, fontWeight: "700", color: Palette.text },
  readOnlyHint: { fontSize: 13, color: Palette.textSecondary },
  error: { fontSize: 14, color: Palette.error },
  pressed: { opacity: 0.85 },
  primaryButton: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.button,
    backgroundColor: Palette.primary,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "800",
    color: Palette.onPrimary,
  },
});
