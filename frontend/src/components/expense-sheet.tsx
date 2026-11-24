import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Palette } from '@/constants/onboarding';
import {
  balanceText,
  categoryLabel,
  describePayerShare,
  describeShare,
  ExpenseItem,
  ExpenseListEntry,
  myBalanceCents,
  myReceiptBalanceCents,
} from '@/lib/expenses';

// What the delete confirmation needs to know about the expense or receipt being deleted
export type DeleteTarget = {
  kind: 'expense' | 'receipt';
  id: string;
  // the version the user loaded: the backend answers 409 if someone changed it since
  version: number;
  concept?: string | null;
  category: string;
  amount: number;
};

type Props = {
  // The expense or ticket to show; null keeps the sheet closed
  entry: ExpenseListEntry | null;
  userId: string;
  onClose: () => void;
  onEdit: (id: string) => void;
  onDelete: (target: DeleteTarget) => void;
};

const money = (amount: string | number) => `${Number(amount).toFixed(2)} €`;

const itemTarget = (item: ExpenseItem): DeleteTarget => ({
  kind: 'expense',
  id: item.id,
  version: item.version,
  concept: item.concept,
  category: item.category,
  amount: Number(item.total_amount) || 0,
});

// Who owes what in one expense, one line per person
function Shares({ item, userId }: { item: ExpenseItem; userId: string }) {
  const payerLine = describePayerShare(item, userId);

  if (item.shares.length === 0 && !payerLine) {
    return <Text style={styles.muted}>Nadie debe nada por este gasto.</Text>;
  }
  return (
    <View style={styles.shares}>
      {item.shares.map((share) => (
        <View key={share.transaction_id} style={styles.shareRow}>
          <MaterialCommunityIcons
            name="account-arrow-right-outline"
            size={19}
            color={Palette.primary}
          />
          <Text style={styles.shareText}>{describeShare(item, share, userId)}</Text>
        </View>
      ))}
      {payerLine ? (
        <View style={styles.shareRow}>
          <MaterialCommunityIcons name="account-outline" size={19} color={Palette.textSecondary} />
          <Text style={styles.sharePayerText}>{payerLine}</Text>
        </View>
      ) : null}
    </View>
  );
}

function Action({
  icon,
  label,
  destructive,
  onPress,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  destructive?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.item}>
      <View style={[styles.itemIcon, destructive && styles.itemIconDelete]}>
        <MaterialCommunityIcons
          name={icon}
          size={20}
          color={destructive ? Palette.error : Palette.primary}
        />
      </View>
      <Text style={destructive ? styles.itemDeleteText : styles.itemText}>{label}</Text>
      <MaterialCommunityIcons name="chevron-right" size={21} color={Palette.textSecondary} />
    </Pressable>
  );
}

// The sliding sheet that opens when you tap an expense or a ticket: who owes what, and the
// actions to edit or delete it. Only the person who paid gets the actions.
export function ExpenseSheet({ entry, userId, onClose, onEdit, onDelete }: Props) {
  return (
    <Modal visible={entry !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          {entry ? (
            <SheetContent
              entry={entry}
              userId={userId}
              onClose={onClose}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SheetContent({
  entry,
  userId,
  onClose,
  onEdit,
  onDelete,
}: Props & { entry: ExpenseListEntry }) {
  const isReceipt = entry.kind === 'receipt';
  const settlement = !isReceipt && entry.type === 'SETTLEMENT';
  const title = isReceipt ? 'Ticket' : entry.concept || categoryLabel(entry.category);
  const myCents = isReceipt ? myReceiptBalanceCents(entry, userId) : myBalanceCents(entry, userId);

  return (
    <>
      <View style={styles.handle} />
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <MaterialCommunityIcons
            name={isReceipt ? 'receipt-text-outline' : 'cash-multiple'}
            size={23}
            color={Palette.primary}
          />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>{isReceipt ? 'TICKET' : settlement ? 'PAGO' : 'GASTO'}</Text>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          <Text style={styles.meta}>
            {entry.paidByCurrentUser ? 'Pagaste tú' : `Pagó ${entry.payer.full_name}`} ·{' '}
            {new Date(entry.date).toLocaleDateString('es-ES')}
          </Text>
        </View>
        <Text style={styles.amount}>{money(entry.total_amount)}</Text>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <View style={[styles.mine, myCents < 0 && styles.mineOwes]}>
          <Text style={styles.mineLabel}>PARA TI</Text>
          <Text style={styles.mineText}>{balanceText(myCents)}</Text>
        </View>

        {entry.kind === 'receipt' ? (
          <>
            {entry.items.map((item) => (
              <View key={item.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {item.concept || categoryLabel(item.category)}
                  </Text>
                  <Text style={styles.cardAmount}>{money(item.total_amount)}</Text>
                </View>
                <Shares item={item} userId={userId} />
                {item.canEdit ? (
                  <View style={styles.cardActions}>
                    <Pressable
                      onPress={() => onEdit(item.id)}
                      hitSlop={6}
                      style={styles.cardAction}>
                      <MaterialCommunityIcons
                        name="pencil-outline"
                        size={16}
                        color={Palette.primary}
                      />
                      <Text style={styles.cardActionText}>Editar</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => onDelete(itemTarget(item))}
                      hitSlop={6}
                      style={styles.cardAction}>
                      <MaterialCommunityIcons
                        name="trash-can-outline"
                        size={16}
                        color={Palette.error}
                      />
                      <Text style={styles.cardActionDeleteText}>Eliminar</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ))}
            {!entry.paidByCurrentUser ? (
              <Text style={styles.muted}>Solo ves los productos en los que participas.</Text>
            ) : null}
          </>
        ) : (
          <View style={styles.card}>
            <Shares item={entry} userId={userId} />
          </View>
        )}
      </ScrollView>

      {entry.canEdit ? (
        entry.kind === 'receipt' ? (
          <Action
            icon="trash-can-outline"
            label="Eliminar ticket"
            destructive
            onPress={() =>
              onDelete({
                kind: 'receipt',
                id: entry.id,
                version: entry.version,
                concept: 'Ticket',
                category: 'other',
                amount: Number(entry.total_amount) || 0,
              })
            }
          />
        ) : (
          <>
            <Action icon="pencil-outline" label="Editar gasto" onPress={() => onEdit(entry.id)} />
            <Action
              icon="trash-can-outline"
              label="Eliminar gasto"
              destructive
              onPress={() => onDelete(itemTarget(entry))}
            />
          </>
        )
      ) : null}
      <Pressable onPress={onClose} style={styles.close}>
        <Text style={styles.closeText}>Cerrar</Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(31,42,36,0.45)',
  },
  sheet: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '90%',
    gap: 6,
    padding: 24,
    paddingTop: 12,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: Palette.background,
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    marginBottom: 20,
    borderRadius: 999,
    backgroundColor: Palette.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  headerIcon: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: Palette.mint,
  },
  headerText: { flex: 1, gap: 3 },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    color: Palette.textSecondary,
  },
  title: { fontSize: 19, fontWeight: '800', color: Palette.text },
  meta: { fontSize: 12, color: Palette.textSecondary },
  amount: { fontSize: 18, fontWeight: '800', color: Palette.text },
  body: { flexGrow: 0 },
  bodyContent: { gap: 10, paddingBottom: 8 },
  mine: {
    gap: 2,
    padding: 12,
    borderRadius: 14,
    backgroundColor: Palette.mint,
  },
  mineOwes: { backgroundColor: Palette.peach },
  mineLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    color: Palette.text,
  },
  mineText: { fontSize: 17, fontWeight: '800', color: Palette.text },
  card: {
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 14,
    backgroundColor: Palette.surface,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: Palette.text },
  cardAmount: { fontSize: 15, fontWeight: '700', color: Palette.text },
  cardActions: { flexDirection: 'row', gap: 18 },
  cardAction: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardActionText: { fontSize: 14, fontWeight: '700', color: Palette.primary },
  cardActionDeleteText: {
    fontSize: 14,
    fontWeight: '700',
    color: Palette.error,
  },
  shares: { gap: 8 },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  shareText: { flex: 1, fontSize: 14, color: Palette.text },
  sharePayerText: { flex: 1, fontSize: 14, color: Palette.textSecondary },
  muted: { fontSize: 13, color: Palette.textSecondary },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 58,
    paddingHorizontal: 10,
    borderRadius: 15,
    backgroundColor: Palette.surface,
  },
  itemIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: Palette.mint,
  },
  itemIconDelete: { backgroundColor: '#F9E4E0' },
  itemText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: Palette.text,
  },
  itemDeleteText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: Palette.error,
  },
  close: {
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
    marginTop: 6,
    borderRadius: 15,
    backgroundColor: Palette.segment,
  },
  closeText: { fontSize: 15, fontWeight: '800', color: Palette.text },
});
