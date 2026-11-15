import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { APARTMENT_ID, USER_ID } from "@/constants/dev-session";
import { Palette } from "@/constants/onboarding";
import { api, errorMessage } from "@/lib/api";
import {
  categoryLabel,
  describePayerShare,
  describeShare,
  ExpenseItem,
  ExpenseListEntry,
  findEntry,
  findExpense,
  myBalanceCents,
  myReceiptBalanceCents,
  ReceiptEntry,
} from "@/lib/expenses";

// What this screen shows: a ticket with its products, or a single expense (a manual one, a
// settlement or one product opened on its own)
type Shown =
  | { kind: "receipt"; receipt: ReceiptEntry }
  | { kind: "expense"; item: ExpenseItem };

const money = (amount: string | number) => `${Number(amount).toFixed(2)} €`;

// What the expense means for the user: what they get back or what they owe
function balanceText(cents: number) {
  if (cents > 0) return `Te deben ${(cents / 100).toFixed(2)} €`;
  if (cents < 0) return `Debes ${(Math.abs(cents) / 100).toFixed(2)} €`;
  return "Sin deudas contigo";
}

// Who owes what in one expense, one line per person
function Shares({ item }: { item: ExpenseItem }) {
  const payerLine = describePayerShare(item, USER_ID);

  if (item.shares.length === 0 && !payerLine) {
    return <Text style={styles.muted}>Nadie debe nada por este gasto.</Text>;
  }
  return (
    <View style={styles.shares}>
      {item.shares.map((share) => (
        <View key={share.transaction_id} style={styles.shareRow}>
          <MaterialCommunityIcons
            name="account-arrow-right-outline"
            size={20}
            color={Palette.primary}
          />
          <Text style={styles.shareText}>
            {describeShare(item, share, USER_ID)}
          </Text>
        </View>
      ))}
      {payerLine ? (
        <View style={styles.shareRow}>
          <MaterialCommunityIcons
            name="account-outline"
            size={20}
            color={Palette.textSecondary}
          />
          <Text style={styles.sharePayerText}>{payerLine}</Text>
        </View>
      ) : null}
    </View>
  );
}

function EditButton({ id }: { id: string }) {
  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: "/transactions/edit", params: { id } })
      }
      style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}
    >
      <MaterialCommunityIcons
        name="pencil-outline"
        size={18}
        color={Palette.primary}
      />
      <Text style={styles.editButtonText}>Editar gasto</Text>
    </Pressable>
  );
}

export default function ExpenseDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [shown, setShown] = useState<Shown | null>(null);
  const [error, setError] = useState("");

  // Reloaded every time the screen is focused, so an edit shows up when you come back
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let active = true;

      void (async () => {
        try {
          const list = (await api(
            "GET",
            `/expenses?apartment_id=${encodeURIComponent(APARTMENT_ID)}`,
          )) as ExpenseListEntry[];
          if (!active) return;

          const entry = findEntry(list, id);
          const item = entry ? null : findExpense(list, id);
          if (entry?.kind === "receipt") {
            setShown({ kind: "receipt", receipt: entry });
          } else if (entry || item) {
            setShown({ kind: "expense", item: (entry ?? item) as ExpenseItem });
          } else {
            setError("No se encontró el gasto.");
          }
        } catch (e) {
          if (active) setError(errorMessage(e));
        }
      })();

      return () => {
        active = false;
      };
    }, [id]),
  );

  const loadError = error || (!id ? "No se encontró el gasto." : "");

  const back = (
    <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
      <MaterialCommunityIcons name="arrow-left" size={24} color={Palette.text} />
    </Pressable>
  );

  if (loadError) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          {back}
          <Text style={styles.error}>{loadError}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!shown) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          {back}
          <ActivityIndicator color={Palette.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const isReceipt = shown.kind === "receipt";
  const date = isReceipt ? shown.receipt.date : shown.item.date;
  const payer = isReceipt ? shown.receipt.payer : shown.item.payer;
  const paidByMe = isReceipt
    ? shown.receipt.paidByCurrentUser
    : shown.item.paidByCurrentUser;
  const settlement = !isReceipt && shown.item.type === "SETTLEMENT";
  const title = isReceipt
    ? "Ticket"
    : shown.item.concept || categoryLabel(shown.item.category);
  const total = isReceipt ? shown.receipt.total_amount : shown.item.total_amount;
  const myCents = isReceipt
    ? myReceiptBalanceCents(shown.receipt, USER_ID)
    : myBalanceCents(shown.item, USER_ID);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        {back}

        <View style={styles.header}>
          <Text style={styles.eyebrow}>
            {isReceipt ? "TICKET" : settlement ? "PAGO" : "GASTO"}
          </Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.total}>{money(total)}</Text>
          <Text style={styles.meta}>
            {paidByMe ? "Pagaste tú" : `Pagó ${payer.full_name}`} ·{" "}
            {new Date(date).toLocaleDateString("es-ES")}
            {!isReceipt && !settlement
              ? ` · ${categoryLabel(shown.item.category)}`
              : ""}
          </Text>
        </View>

        <View style={[styles.mine, myCents < 0 && styles.mineOwes]}>
          <Text style={styles.mineLabel}>PARA TI</Text>
          <Text style={styles.mineText}>{balanceText(myCents)}</Text>
        </View>

        {isReceipt ? (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Productos</Text>
              <Text style={styles.sectionCaption}>
                {shown.receipt.items.length}
              </Text>
            </View>
            {shown.receipt.items.map((item) => (
              <View key={item.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {item.concept || categoryLabel(item.category)}
                  </Text>
                  <Text style={styles.cardAmount}>{money(item.total_amount)}</Text>
                </View>
                <Shares item={item} />
                {item.canEdit ? <EditButton id={item.id} /> : null}
              </View>
            ))}
            {!shown.receipt.paidByCurrentUser ? (
              <Text style={styles.muted}>
                Solo ves los productos en los que participas.
              </Text>
            ) : null}
          </>
        ) : (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Reparto</Text>
            </View>
            <View style={styles.card}>
              <Shares item={shown.item} />
            </View>
            {shown.item.canEdit ? <EditButton id={shown.item.id} /> : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Palette.background },
  container: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingBottom: 32,
    gap: 16,
  },
  back: { alignSelf: "flex-start", paddingTop: 8 },
  header: { gap: 4 },
  eyebrow: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.5,
    color: Palette.primary,
  },
  title: { fontSize: 28, fontWeight: "800", color: Palette.text },
  total: { fontSize: 34, fontWeight: "800", color: Palette.text },
  meta: { fontSize: 14, color: Palette.textSecondary },
  mine: {
    gap: 4,
    padding: 16,
    borderRadius: 16,
    backgroundColor: Palette.mint,
  },
  mineOwes: { backgroundColor: Palette.peach },
  mineLabel: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.5,
    color: Palette.text,
  },
  mineText: { fontSize: 20, fontWeight: "800", color: Palette.text },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  sectionTitle: { fontSize: 21, fontWeight: "800", color: Palette.text },
  sectionCaption: { fontSize: 13, color: Palette.textSecondary },
  card: {
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 16,
    backgroundColor: Palette.surface,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: Palette.text },
  cardAmount: { fontSize: 16, fontWeight: "700", color: Palette.text },
  shares: { gap: 8 },
  shareRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  shareText: { flex: 1, fontSize: 15, color: Palette.text },
  sharePayerText: { flex: 1, fontSize: 15, color: Palette.textSecondary },
  editButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Palette.primary,
    borderRadius: 16,
  },
  editButtonText: { fontSize: 15, fontWeight: "700", color: Palette.primary },
  pressed: { opacity: 0.7 },
  muted: { fontSize: 14, color: Palette.textSecondary },
  error: { fontSize: 14, color: Palette.error },
});
