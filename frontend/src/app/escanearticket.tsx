import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ReceiptEditor,
  ReceiptItem,
  ReceiptItemInput,
  receiptTotals,
  toReceiptItems,
} from '@/components/receipt-editor';
import { TicketScanner } from '@/components/ticket-scanner';
import { Palette } from '@/constants/onboarding';
import { api, errorMessage, ScannedTicket } from '@/lib/api';

type Member = { id: string; full_name: string; isCurrentUser?: boolean };

const APARTMENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

export default function ScanReceiptScreen() {
  const { items: encodedItems } = useLocalSearchParams<{ items?: string }>();
  const [items, setItems] = useState<ReceiptItem[]>(() => parseItems(encodedItems));
  // true when the user chose to add the products by hand instead of scanning
  const [manual, setManual] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [showSplit, setShowSplit] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const { sharedItems, total, missingPrices } = receiptTotals(items);

  // A new scan replaces the list: it is a different (or retaken) photo of the ticket
  const onScanned = (ticket: ScannedTicket) => {
    if (ticket.items.length === 0) {
      setError('No hemos encontrado productos. Prueba con otra foto o añádelos a mano.');
      return;
    }
    setItems(toReceiptItems(ticket.items));
    setError('');
  };
  const onScanError = (e: unknown) => setError(errorMessage(e));

  useEffect(() => {
    void (async () => {
      try {
        const loaded = await api(
          'GET',
          `/apartments/${encodeURIComponent(APARTMENT_ID)}/members`,
        ) as Member[];
        const otherMembers = loaded.filter(({ isCurrentUser }) => !isCurrentUser);
        setMembers(otherMembers);
        setSelectedMembers(otherMembers.map(({ id }) => id));
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoadingMembers(false);
      }
    })();
  }, []);

  const continueToSplit = () => {
    if (items.length === 0) {
      setError('Añade al menos un producto con un precio válido.');
      return;
    }
    // Unshared products without a price don't matter: they are not sent
    if (missingPrices > 0) {
      setError('Toca los productos marcados en rojo para completar su precio.');
      return;
    }
    if (sharedItems.length === 0 || total <= 0) {
      setError('Marca al menos un producto para compartir.');
      return;
    }
    if (members.length === 0) {
      setError('No hay miembros disponibles para repartir este gasto.');
      return;
    }
    setShowSplit(true);
    setError('');
  };

  const createExpense = async () => {
    if (selectedMembers.length === 0) {
      setError('Selecciona quién paga y al menos una persona para repartir el gasto.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api('POST', '/transactions/from-receipt', {
        apartment_id: APARTMENT_ID,
        participant_ids: selectedMembers,
        items: sharedItems.map(({ name: itemName, quantity: itemQuantity, unit_price }) => ({
          name: itemName,
          quantity: itemQuantity,
          unit_price,
        })),
        category: 'supplies',
      });
      router.replace('/transactions');
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
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={Palette.text} />
          </Pressable>
          <Text style={styles.screenTitle}>Añadir productos</Text>
          <Text style={styles.step}>{showSplit ? '2 de 2' : '1 de 2'}</Text>
        </View>

        {!showSplit && items.length === 0 && !manual ? (
          <>
            <View style={styles.header}>
              <Text style={styles.eyebrow}>ESCANEAR TICKET</Text>
              <Text style={styles.title}>Haz una foto del ticket</Text>
              <Text style={styles.subtitle}>Leeremos los productos y podrás revisarlos antes de repartir el gasto.</Text>
            </View>
            <TicketScanner onScanned={onScanned} onError={onScanError} />
            <Pressable onPress={() => setManual(true)} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Añadir productos a mano</Text>
            </Pressable>
          </>
        ) : !showSplit ? (
          <>
            <View style={styles.header}>
              <Text style={styles.eyebrow}>REVISAR TICKET</Text>
              <Text style={styles.title}>¿Todo correcto?</Text>
              <Text style={styles.subtitle}>Añade lo que falte o toca un producto para modificarlo.</Text>
            </View>
            <TicketScanner compact onScanned={onScanned} onError={onScanError} />
            <ReceiptEditor items={items} onChange={setItems} />
            <Pressable onPress={continueToSplit} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Continuar y repartir</Text>
              <MaterialCommunityIcons name="arrow-right" size={20} color={Palette.onPrimary} />
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.header}>
              <Text style={styles.eyebrow}>REPARTIR GASTO</Text>
              <Text style={styles.title}>{total.toFixed(2)} €</Text>
              <Text style={styles.subtitle}>Selecciona las personas que comparten este ticket y quién lo ha pagado.</Text>
            </View>
            <Text style={styles.label}>Compartir con</Text>
            {loadingMembers ? <ActivityIndicator color={Palette.primary} /> : members.map((member) => {
              const selected = selectedMembers.includes(member.id);
              return (
                <Pressable
                  key={member.id}
                  onPress={() => setSelectedMembers((current) => selected ? current.filter((id) => id !== member.id) : [...current, member.id])}
                  style={[styles.memberCard, selected && styles.memberSelected]}>
                  <MaterialCommunityIcons name={selected ? 'check-circle' : 'circle-outline'} size={22} color={selected ? Palette.primary : Palette.textSecondary} />
                  <Text style={styles.memberName}>{member.full_name}</Text>
                </Pressable>
              );
            })}
            <Text style={styles.splitSummary}>
              Tú pagas el ticket. Se reparte entre tú y las {selectedMembers.length} personas seleccionadas: {(Math.ceil(Math.round(total * 100) / (selectedMembers.length + 1)) / 100).toFixed(2)} € por persona
            </Text>
            <Pressable onPress={createExpense} disabled={saving} style={styles.primaryButton}>
              {saving ? <ActivityIndicator color={Palette.onPrimary} /> : <><Text style={styles.primaryButtonText}>Crear gasto compartido</Text><MaterialCommunityIcons name="check" size={20} color={Palette.onPrimary} /></>}
            </Pressable>
            <Pressable onPress={() => setShowSplit(false)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Volver a productos</Text></Pressable>
          </>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function parseItems(encodedItems?: string): ReceiptItem[] {
  if (!encodedItems) return [];
  try {
    return toReceiptItems(JSON.parse(encodedItems) as ReceiptItemInput[]);
  } catch {
    return [];
  }
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Palette.background },
  container: { flexGrow: 1, width: '100%', maxWidth: 560, alignSelf: 'center', padding: 24, gap: 14 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  screenTitle: { fontSize: 18, fontWeight: '800', color: Palette.text },
  step: { fontSize: 12, fontWeight: '700', color: Palette.primary },
  header: { gap: 7, marginTop: 12 },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4, color: Palette.primary },
  title: { fontSize: 30, fontWeight: '800', color: Palette.text },
  subtitle: { fontSize: 14, lineHeight: 21, color: Palette.textSecondary },
  primaryButton: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 8, borderRadius: 16, backgroundColor: Palette.primary },
  primaryButtonText: { fontSize: 15, fontWeight: '800', color: Palette.onPrimary },
  secondaryButton: { alignItems: 'center', padding: 12 },
  secondaryButtonText: { fontSize: 14, fontWeight: '800', color: Palette.primary },
  error: { fontSize: 13, color: Palette.error },
  label: { marginTop: 5, fontSize: 13, fontWeight: '800', color: Palette.text },
  memberCard: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 15, borderWidth: 1, borderColor: Palette.border, borderRadius: 14, backgroundColor: Palette.surface },
  memberSelected: { borderColor: Palette.primary, backgroundColor: Palette.mint },
  memberName: { fontSize: 15, fontWeight: '700', color: Palette.text },
  splitSummary: { padding: 14, borderRadius: 14, backgroundColor: Palette.mint, fontSize: 14, fontWeight: '700', color: Palette.text },
});
