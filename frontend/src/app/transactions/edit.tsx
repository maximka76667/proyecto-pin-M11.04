import { ActivityIndicator, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";

import { APARTMENT_ID } from "@/constants/dev-session";
import { api, errorMessage, TransactionCategory } from "@/lib/api";
import { Palette } from "@/constants/onboarding";
import {
  TransactionForm,
  TransactionFormValues,
} from "@/components/transaction-form";

type Transaction = {
  id: string;
  expense_id?: string | null;
  total_amount?: string | number | null;
  amount: string;
  from_user_id: string;
  concept: string | null;
  date: string;
  to_user_id: string;
  category: TransactionCategory;
};

export default function EditExpenseScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [initialValues, setInitialValues] =
    useState<Partial<TransactionFormValues>>();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) {
      return;
    }

    void (async () => {
      try {
        const loaded = (await api("GET", `/transactions/${id}`)) as Transaction;
        const all = (await api(
          "GET",
          `/transactions?apartment_id=${encodeURIComponent(APARTMENT_ID)}`,
        )) as Transaction[];
        const group = loaded.expense_id
          ? all.filter((item) => item.expense_id === loaded.expense_id)
          : [loaded];
        const totalAmount = Number(
          loaded.total_amount ??
            group.reduce((sum, item) => sum + Number(item.amount), 0),
        );
        const recordedShares = group.reduce(
          (sum, item) => sum + Number(item.amount),
          0,
        );
        const debtorIds = group.map((item) => item.to_user_id);
        const payerParticipates = totalAmount - recordedShares > 0.01;
        setTransaction(loaded);
        setInitialValues({
          amount: String(totalAmount),
          concept: loaded.concept ?? "",
          category: loaded.category,
          date: loaded.date.slice(0, 10),
          debtorIds: payerParticipates
            ? Array.from(new Set([...debtorIds, loaded.from_user_id]))
            : debtorIds,
        });
      } catch (e) {
        setError(errorMessage(e));
      }
    })();
  }, [id]);

  const loadError = error || (!id ? "Expense not found." : "");

  if (loadError) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Palette.background }}>
        <View style={{ padding: 24 }}>
          <Text style={{ color: Palette.error }}>{loadError}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!transaction || !initialValues) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Palette.background }}>
        <ActivityIndicator color={Palette.primary} />
      </SafeAreaView>
    );
  }

  return (
    <TransactionForm
      title="Edit expense"
      submitLabel="Save changes"
      initialValues={initialValues}
      onCancel={() => router.back()}
      onSubmit={async ({ amount, concept, category, date, debtorIds }) => {
        await api("PATCH", `/transactions/${transaction.id}`, {
          amount,
          concept,
          category,
          date,
          to_user_ids: debtorIds,
        });
        router.back();
      }}
    />
  );
}
