import { ActivityIndicator, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, errorMessage, TransactionCategory } from '@/lib/api';
import { APARTMENT_ID } from '@/constants/dev-session';
import { Palette } from '@/constants/onboarding';
import { ExpenseItem, ExpenseListEntry, findExpense, sharingIds } from '@/lib/expenses';
import { TransactionForm, TransactionFormValues } from '@/components/transaction-form';

export default function EditExpenseScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [expense, setExpense] = useState<ExpenseItem | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) {
      return;
    }

    void (async () => {
      try {
        // The list already carries every expense the user can see, with its version
        const list = (await api(
          'GET',
          `/expenses?apartment_id=${encodeURIComponent(APARTMENT_ID)}`,
        )) as ExpenseListEntry[];
        const found = findExpense(list, id);
        if (!found) {
          setError('No se encontró el gasto.');
          return;
        }
        setExpense(found);
      } catch (e) {
        setError(errorMessage(e));
      }
    })();
  }, [id]);

  const loadError = error || (!id ? 'No se encontró el gasto.' : '');

  if (loadError) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Palette.background }}>
        <View style={{ padding: 24 }}>
          <Text style={{ color: Palette.error }}>{loadError}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!expense) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Palette.background }}>
        <ActivityIndicator color={Palette.primary} />
      </SafeAreaView>
    );
  }

  const initialValues: Partial<TransactionFormValues> = {
    amount: String(expense.total_amount),
    concept: expense.concept ?? '',
    category: expense.category as TransactionCategory,
    date: expense.date.slice(0, 10),
    // The debtors and, if the payer also shares it, the payer
    debtorIds: sharingIds(expense),
  };

  return (
    <TransactionForm
      title="Editar gasto"
      submitLabel="Guardar cambios"
      initialValues={initialValues}
      onCancel={() => router.back()}
      onSubmit={async ({ amount, concept, category, date, debtorIds }) => {
        // The version we loaded: if someone edited the expense meanwhile, the backend answers
        // 409 and the form shows its message
        await api('PATCH', `/expenses/${expense.id}`, {
          version: expense.version,
          amount,
          concept,
          category,
          date,
          participant_ids: debtorIds,
        });
        router.dismissTo({
          pathname: '/transactions',
          params: { notice: 'updated' },
        });
      }}
    />
  );
}
