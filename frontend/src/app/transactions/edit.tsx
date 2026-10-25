import { ActivityIndicator, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, errorMessage, TransactionCategory } from "@/lib/api";
import { Palette } from "@/constants/onboarding";
import {
  TransactionForm,
  TransactionFormValues,
} from "@/components/transaction-form";

type Transaction = {
  id: string;
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
        setTransaction(loaded);
        setInitialValues({
          amount: String(loaded.amount),
          concept: loaded.concept ?? "",
          category: loaded.category,
          date: loaded.date.slice(0, 10),
          debtorIds:
            loaded.to_user_id === loaded.from_user_id
              ? []
              : [loaded.to_user_id],
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
      allowMultipleDebtors={false}
      excludeCurrentUser
      onCancel={() => router.back()}
      onSubmit={async ({ amount, concept, category, date, debtorIds }) => {
        await api("PATCH", `/transactions/${transaction.id}`, {
          amount,
          concept,
          category,
          date,
          to_user_id: debtorIds[0],
        });
        router.back();
      }}
    />
  );
}
