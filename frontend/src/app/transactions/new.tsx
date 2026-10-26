import { router } from "expo-router";

import { APARTMENT_ID, USER_ID } from "@/constants/dev-session";
import { api } from "@/lib/api";
import { TransactionForm } from "@/components/transaction-form";

export default function NewExpenseScreen() {
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/transactions");
  };

  return (
    <TransactionForm
      title="New expense"
      submitLabel="Save expense"
      onCancel={goBack}
      onSubmit={async ({ amount, concept, category, date, debtorIds }) => {
        await api("POST", "/transactions", {
          apartment_id: APARTMENT_ID,
          from_user_id: USER_ID,
          to_user_ids: debtorIds,
          amount,
          concept,
          category,
          date,
        });
        goBack();
      }}
    />
  );
}
