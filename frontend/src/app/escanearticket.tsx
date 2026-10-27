import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ReceiptEditor,
  ReceiptItem,
  ReceiptItemInput,
  receiptTotals,
  toReceiptItems,
} from '@/components/receipt-editor';
import { receiptErrorMessage, ReceiptSplit } from '@/components/receipt-split';
import { TicketScanner } from '@/components/ticket-scanner';
import { Palette } from '@/constants/onboarding';
import { errorMessage, ScannedTicket } from '@/lib/api';

const APARTMENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

export default function ScanReceiptScreen() {
  const { items: encodedItems } = useLocalSearchParams<{ items?: string }>();
  const [items, setItems] = useState<ReceiptItem[]>(() => parseItems(encodedItems));
  // true when the user chose to add the products by hand instead of scanning
  const [manual, setManual] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
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
  // Stable: ReceiptSplit reloads the members when its callbacks change
  const onSplitError = useCallback((e: unknown) => setError(receiptErrorMessage(e)), []);

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
    setShowSplit(true);
    setError('');
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
            <ReceiptSplit
              apartmentId={APARTMENT_ID}
              items={items}
              onCreated={() => router.replace({ pathname: '/transactions', params: { notice: 'receipt' } })}
              onError={onSplitError}
            />
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
});
