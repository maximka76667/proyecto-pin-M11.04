import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";

import {
  LIMIT_MESSAGE,
  ReceiptItem,
  receiptTotals,
} from "@/components/receipt-editor";
import { Palette } from "@/constants/onboarding";
import { api, ApiError, errorMessage, Member } from "@/lib/api";

// What POST /transactions/from-receipt returns
export type ReceiptExpense = {
  total: string;
  participant_count: number;
  transactions: unknown[];
};

// The items sent to POST /transactions/from-receipt: only the shared products
export function receiptRequestItems(items: ReceiptItem[]) {
  return receiptTotals(items).sharedItems.map(
    ({ name, quantity, unit_price }) => ({
      name,
      quantity,
      unit_price,
    }),
  );
}

// Friendly message for the user. The backend rejects prices/quantities/products over the
// limit with a 400 that names the field (e.g. "items.0.quantity must not be greater than 999")
export function receiptErrorMessage(e: unknown) {
  const isLimitError =
    e instanceof ApiError &&
    e.status === 400 &&
    /\b(unit_price|quantity|items)\b/.test(e.message);
  return isLimitError ? LIMIT_MESSAGE : errorMessage(e);
}

// Second step of a ticket: choose the flatmates to share it with and create the expense.
// The current user pays; only the shared products are sent.
// Used by escanearticket and by /dev?tab=scanner
export function ReceiptSplit({
  apartmentId,
  items,
  onCreated,
  onError,
}: {
  apartmentId: string;
  items: ReceiptItem[];
  onCreated: (expense: ReceiptExpense) => void;
  onError: (e: unknown) => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [saving, setSaving] = useState(false);

  const { total } = receiptTotals(items);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = (await api(
          "GET",
          `/apartments/${encodeURIComponent(apartmentId)}/members`,
        )) as Member[];
        if (cancelled) return;
        const otherMembers = loaded.filter(
          ({ isCurrentUser }) => !isCurrentUser,
        );
        setMembers(otherMembers);
        setSelectedMembers(otherMembers.map(({ id }) => id));
      } catch (e) {
        if (!cancelled) onError(e);
      } finally {
        if (!cancelled) setLoadingMembers(false);
      }
    })();
    // Ignores the answer if the component is gone (or /dev changed the apartment) meanwhile
    return () => {
      cancelled = true;
    };
  }, [apartmentId, onError]);

  const toggleMember = (id: string) =>
    setSelectedMembers((current) =>
      current.includes(id)
        ? current.filter((memberId) => memberId !== id)
        : [...current, id],
    );

  const createExpense = async () => {
    if (selectedMembers.length === 0) {
      onError(
        new Error("Selecciona al menos una persona para repartir el gasto."),
      );
      return;
    }
    if (Math.round(total * 100) > 1_000_000) {
      onError(new Error("El gasto no puede superar los 10.000,00 €."));
      return;
    }
    setSaving(true);
    try {
      const expense = (await api("POST", "/transactions/from-receipt", {
        apartment_id: apartmentId,
        participant_ids: selectedMembers,
        items: receiptRequestItems(items),
        category: "supplies",
      })) as ReceiptExpense;
      onCreated(expense);
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  };

  // Same rounding as the backend: up, in cents
  const perPerson =
    Math.ceil(Math.round(total * 100) / (selectedMembers.length + 1)) / 100;

  return (
    <>
      <Text style={styles.label}>Compartir con</Text>
      {loadingMembers ? (
        <ActivityIndicator color={Palette.primary} />
      ) : members.length === 0 ? (
        <Text style={styles.empty}>
          No hay más miembros en este piso para repartir el gasto.
        </Text>
      ) : (
        members.map((member) => {
          const selected = selectedMembers.includes(member.id);
          return (
            <Pressable
              key={member.id}
              onPress={() => toggleMember(member.id)}
              style={[styles.memberCard, selected && styles.memberSelected]}
            >
              <MaterialCommunityIcons
                name={selected ? "check-circle" : "circle-outline"}
                size={22}
                color={selected ? Palette.primary : Palette.textSecondary}
              />
              <Text style={styles.memberName}>{member.full_name}</Text>
            </Pressable>
          );
        })
      )}
      <Text style={styles.splitSummary}>
        Tú pagas el ticket. Se reparte entre tú y las {selectedMembers.length}{" "}
        personas seleccionadas: {perPerson.toFixed(2)} € por persona
      </Text>
      <Pressable
        onPress={createExpense}
        disabled={saving || loadingMembers}
        style={styles.primaryButton}
      >
        {saving ? (
          <ActivityIndicator color={Palette.onPrimary} />
        ) : (
          <>
            <Text style={styles.primaryButtonText}>Crear gasto compartido</Text>
            <MaterialCommunityIcons
              name="check"
              size={20}
              color={Palette.onPrimary}
            />
          </>
        )}
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  label: { marginTop: 5, fontSize: 13, fontWeight: "800", color: Palette.text },
  empty: { fontSize: 14, color: Palette.textSecondary },
  memberCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    padding: 15,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 14,
    backgroundColor: Palette.surface,
  },
  memberSelected: {
    borderColor: Palette.primary,
    backgroundColor: Palette.mint,
  },
  memberName: { fontSize: 15, fontWeight: "700", color: Palette.text },
  splitSummary: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: Palette.mint,
    fontSize: 14,
    fontWeight: "700",
    color: Palette.text,
  },
  primaryButton: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 8,
    borderRadius: 16,
    backgroundColor: Palette.primary,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: "800",
    color: Palette.onPrimary,
  },
});
