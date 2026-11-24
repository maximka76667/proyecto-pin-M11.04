import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { LIMIT_MESSAGE, ReceiptItem, receiptTotals } from '@/components/receipt-editor';
import { Palette } from '@/constants/onboarding';
import { api, ApiError, errorMessage, Member } from '@/lib/api';
import { splitExpense } from '@/lib/expense-split';

// What POST /transactions/from-receipt returns
export type ReceiptExpense = {
  total: string;
  unassigned_total?: string;
  participant_count: number;
  transactions: unknown[];
};

// Products shown in the JSON preview of /dev: only the shared ones, without who shares them
export function receiptRequestItems(items: ReceiptItem[]) {
  return receiptTotals(items).sharedItems.map(({ name, quantity, unit_price }) => ({
    name,
    quantity,
    unit_price,
  }));
}

// The items sent to POST /transactions/from-receipt: every product with a price and the people
// who share it. assigned_to = [] means the product stays with whoever pays (no debt)
export function receiptRequestItemsWithAssignees(
  items: ReceiptItem[],
  assignedOf: (item: ReceiptItem) => string[],
) {
  return items
    .filter((item) => item.unit_price !== null)
    .map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      assigned_to: assignedOf(item),
    }));
}

// Same rule as the backend (createFromReceipt): every product is its own expense, split exactly
// between the people who share it (see splitExpense). Whoever pays never owes anything to
// themselves. The debts are what each person owes in total, adding up all their products
export function receiptDebts(
  items: ReceiptItem[],
  assignedOf: (item: ReceiptItem) => string[],
  payerId: string,
) {
  const debts = new Map<string, number>();
  let unassignedCents = 0;
  let totalCents = 0;
  for (const item of items) {
    if (item.unit_price === null) continue;
    const cents = Math.round(Number(item.unit_price) * 100) * item.quantity;
    totalCents += cents;
    const ids = [...new Set(assignedOf(item))];
    if (ids.length === 0) unassignedCents += cents;

    for (const [id, owed] of splitExpense(cents, payerId, ids).debts) {
      debts.set(id, (debts.get(id) ?? 0) + owed);
    }
  }
  return { debts, totalCents, unassignedCents };
}

const euros = (cents: number) => `${(cents / 100).toFixed(2)} €`;

// Friendly message for the user. The backend rejects prices/quantities/products over the
// limit with a 400 that names the field (e.g. "items.0.quantity must not be greater than 999")
export function receiptErrorMessage(e: unknown) {
  const isLimitError =
    e instanceof ApiError && e.status === 400 && /\b(unit_price|quantity|items)\b/.test(e.message);
  return isLimitError ? LIMIT_MESSAGE : errorMessage(e);
}

// Second step of a ticket: choose, product by product, who shares it, and create the expense.
// The current user pays. A product nobody is marked on stays with whoever pays: it counts in
// the ticket total but generates no debt.
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
  // Explicit choices per product id; a product without an entry uses the default (see assignedOf)
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [saving, setSaving] = useState(false);

  const payer = members.find(({ isCurrentUser }) => isCurrentUser);
  const allIds = members.map(({ id }) => id);
  // Default: products ticked as shared in the previous step go to everyone, the rest to the payer
  const assignedOf = (item: ReceiptItem) => assignments[item.id] ?? (item.shared ? allIds : []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = (await api(
          'GET',
          `/apartments/${encodeURIComponent(apartmentId)}/members`,
        )) as Member[];
        if (cancelled) return;
        setMembers(loaded);
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

  const toggleMember = (item: ReceiptItem, memberId: string) => {
    const current = assignedOf(item);
    setAssignments((previous) => ({
      ...previous,
      [item.id]: current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId],
    }));
  };

  const pricedItems = items.filter((item) => item.unit_price !== null);
  const { debts, totalCents, unassignedCents } = payer
    ? receiptDebts(pricedItems, assignedOf, payer.id)
    : { debts: new Map<string, number>(), totalCents: 0, unassignedCents: 0 };

  const createExpense = async () => {
    if (debts.size === 0) {
      onError(new Error('Asigna al menos un producto a otra persona para repartir el gasto.'));
      return;
    }
    if (totalCents > 1_000_000) {
      onError(new Error('El gasto no puede superar los 10.000,00 €.'));
      return;
    }
    setSaving(true);
    try {
      const expense = (await api('POST', '/transactions/from-receipt', {
        apartment_id: apartmentId,
        items: receiptRequestItemsWithAssignees(items, assignedOf),
        category: 'supplies',
      })) as ReceiptExpense;
      onCreated(expense);
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  };

  const memberLabel = (member: Member) =>
    member.isCurrentUser ? 'Yo' : member.full_name.trim().split(' ')[0];

  return (
    <>
      <Text style={styles.label}>¿Quién comparte cada producto?</Text>
      {loadingMembers ? (
        <ActivityIndicator color={Palette.primary} />
      ) : members.length < 2 ? (
        <Text style={styles.empty}>No hay más miembros en este piso para repartir el gasto.</Text>
      ) : (
        pricedItems.map((item) => {
          const assigned = assignedOf(item);
          return (
            <View key={item.id} style={styles.itemCard}>
              <View style={styles.itemHeader}>
                <Text style={styles.itemName} numberOfLines={2}>
                  {item.quantity > 1 ? `${item.quantity} × ` : ''}
                  {item.name}
                </Text>
                <Text style={styles.itemPrice}>
                  {euros(Math.round(Number(item.unit_price) * 100) * item.quantity)}
                </Text>
              </View>
              <View style={styles.chips}>
                {members.map((member) => {
                  const selected = assigned.includes(member.id);
                  return (
                    <Pressable
                      key={member.id}
                      onPress={() => toggleMember(item, member.id)}
                      accessibilityLabel={`${memberLabel(member)}: ${item.name}`}
                      accessibilityState={{ checked: selected }}
                      style={[styles.chip, selected && styles.chipSelected]}>
                      {member.avatar_url ? (
                        <Image source={{ uri: member.avatar_url }} style={styles.memberAvatar} />
                      ) : (
                        <View style={styles.memberAvatarPlaceholder}>
                          <Text style={styles.memberAvatarText}>
                            {member.full_name.trim().charAt(0).toUpperCase() || '?'}
                          </Text>
                        </View>
                      )}
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                        {memberLabel(member)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {assigned.length === 0 ? (
                <Text style={styles.itemHint}>Sin marcar: queda a cuenta de quien paga</Text>
              ) : null}
            </View>
          );
        })
      )}
      <View style={styles.splitSummaryBox}>
        <Text style={styles.splitSummary}>Tú pagas el ticket: {euros(totalCents)}</Text>
        {members
          .filter(({ id }) => debts.has(id))
          .map((member) => (
            <Text key={member.id} style={styles.splitLine}>
              {member.full_name} te debe {euros(debts.get(member.id) ?? 0)}
            </Text>
          ))}
        {unassignedCents > 0 ? (
          <Text style={styles.splitLine}>Sin repartir (a tu cuenta): {euros(unassignedCents)}</Text>
        ) : null}
      </View>
      <Pressable
        onPress={createExpense}
        disabled={saving || loadingMembers}
        style={styles.primaryButton}>
        {saving ? (
          <ActivityIndicator color={Palette.onPrimary} />
        ) : (
          <>
            <Text style={styles.primaryButtonText}>Crear gasto compartido</Text>
            <MaterialCommunityIcons name="check" size={20} color={Palette.onPrimary} />
          </>
        )}
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  label: { marginTop: 5, fontSize: 13, fontWeight: '800', color: Palette.text },
  empty: { fontSize: 14, color: Palette.textSecondary },
  itemCard: {
    gap: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 14,
    backgroundColor: Palette.surface,
  },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  itemName: { flex: 1, fontSize: 15, fontWeight: '700', color: Palette.text },
  itemPrice: { fontSize: 15, fontWeight: '800', color: Palette.text },
  itemHint: { fontSize: 12, color: Palette.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 999,
    backgroundColor: Palette.background,
  },
  chipSelected: { borderColor: Palette.primary, backgroundColor: Palette.mint },
  chipText: { fontSize: 13, fontWeight: '600', color: Palette.textSecondary },
  chipTextSelected: { color: Palette.text, fontWeight: '800' },
  memberAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  memberAvatarPlaceholder: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Palette.peach,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: {
    fontSize: 12,
    fontWeight: '700',
    color: Palette.text,
  },
  splitSummaryBox: {
    gap: 4,
    padding: 14,
    borderRadius: 14,
    backgroundColor: Palette.mint,
  },
  splitSummary: { fontSize: 14, fontWeight: '800', color: Palette.text },
  splitLine: { fontSize: 13, color: Palette.text },
  primaryButton: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 8,
    borderRadius: 16,
    backgroundColor: Palette.primary,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: Palette.onPrimary,
  },
});
