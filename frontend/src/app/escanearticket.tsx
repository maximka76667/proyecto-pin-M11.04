import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { APARTMENT_ID, USER_ID } from '@/constants/dev-session';
import { Palette } from '@/constants/onboarding';
import { api, errorMessage } from '@/lib/api';

type ReceiptItem = { id: string; name: string; quantity: number; unit_price: string };
type Member = { id: string; full_name: string; isCurrentUser?: boolean };

const SAMPLE_ITEMS: ReceiptItem[] = [
];

export default function ScanReceiptScreen() {
  const { items: encodedItems } = useLocalSearchParams<{ items?: string }>();
  const [items, setItems] = useState<ReceiptItem[]>(() => parseItems(encodedItems));
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [editing, setEditing] = useState<ReceiptItem | null>(null);
  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity * Number(item.unit_price), 0),
    [items],
  );

  useEffect(() => {
    void (async () => {
      try {
        const loaded = await api(
          'GET',
          `/apartments/${encodeURIComponent(APARTMENT_ID)}/members`,
        ) as Member[];
        setMembers(loaded);
        setSelectedMembers(loaded.map(({ id }) => id));
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoadingMembers(false);
      }
    })();
  }, []);

  const openNewItem = () => {
    setEditing(null);
    setItemModalVisible(true);
    setName('');
    setQuantity('1');
    setPrice('');
    setError('');
  };

  const openEditItem = (item: ReceiptItem) => {
    setEditing(item);
    setItemModalVisible(true);
    setName(item.name);
    setQuantity(String(item.quantity));
    setPrice(item.unit_price);
    setError('');
  };

  const saveItem = () => {
    const normalizedPrice = price.trim().replace(',', '.');
    const parsedQuantity = Number(quantity);
    if (!name.trim() || !/^\d+(\.\d{1,2})?$/.test(normalizedPrice) || Number(normalizedPrice) <= 0) {
      setError('Introduce un nombre y un precio válido.');
      return;
    }
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1) {
      setError('La cantidad debe ser un número entero mayor que cero.');
      return;
    }

    const item = {
      id: editing?.id ?? `${Date.now()}`,
      name: name.trim(),
      quantity: parsedQuantity,
      unit_price: Number(normalizedPrice).toFixed(2),
    };
    setItems((current) =>
      editing ? current.map((existing) => (existing.id === editing.id ? item : existing)) : [...current, item],
    );
    setEditing(null);
    setItemModalVisible(false);
    setName('');
    setQuantity('1');
    setPrice('');
    setError('');
  };

  const continueToSplit = () => {
    if (items.length === 0 || total <= 0) {
      setError('Añade al menos un producto con un precio válido.');
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
        items: items.map(({ name: itemName, quantity: itemQuantity, unit_price }) => ({
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

        {!showSplit ? (
          <>
            <View style={styles.header}>
              <Text style={styles.eyebrow}>REVISAR TICKET</Text>
              <Text style={styles.title}>¿Todo correcto?</Text>
              <Text style={styles.subtitle}>Añade lo que falte o toca un producto para modificarlo.</Text>
            </View>
            <View style={styles.totalCard}>
              <View>
                <Text style={styles.totalLabel}>TOTAL DEL TICKET</Text>
                <Text style={styles.total}>{total.toFixed(2)} €</Text>
              </View>
              <MaterialCommunityIcons name="receipt-text-check-outline" size={34} color={Palette.primary} />
            </View>
            <View style={styles.listHeader}>
              <Text style={styles.sectionTitle}>Productos</Text>
              <Text style={styles.hint}>Toca para editar</Text>
            </View>
            {items.map((item) => (
              <Pressable key={item.id} onPress={() => openEditItem(item)} style={styles.itemCard}>
                <View style={styles.quantity}><Text style={styles.quantityText}>{item.quantity}x</Text></View>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemPrice}>{(item.quantity * Number(item.unit_price)).toFixed(2)} €</Text>
                <Pressable onPress={() => setItems((current) => current.filter(({ id }) => id !== item.id))} hitSlop={8}>
                  <MaterialCommunityIcons name="trash-can-outline" size={20} color={Palette.error} />
                </Pressable>
              </Pressable>
            ))}
            <Pressable onPress={openNewItem} style={styles.addButton}>
              <MaterialCommunityIcons name="plus" size={21} color={Palette.primary} />
              <Text style={styles.addButtonText}>Añadir producto</Text>
            </Pressable>
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
                  <Text style={styles.memberName}>
                    {member.id === USER_ID ? 'Yo' : member.full_name}
                  </Text>
                </Pressable>
              );
            })}
            <Text style={styles.splitSummary}>
              Tú pagas el ticket. Se reparte entre tú y las {selectedMembers.length} personas seleccionadas: {(total / (selectedMembers.length + 1)).toFixed(2)} € por persona
            </Text>
            <Pressable onPress={createExpense} disabled={saving} style={styles.primaryButton}>
              {saving ? <ActivityIndicator color={Palette.onPrimary} /> : <><Text style={styles.primaryButtonText}>Crear gasto compartido</Text><MaterialCommunityIcons name="check" size={20} color={Palette.onPrimary} /></>}
            </Pressable>
            <Pressable onPress={() => setShowSplit(false)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Volver a productos</Text></Pressable>
          </>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <Modal visible={itemModalVisible} transparent animationType="slide" onRequestClose={() => setItemModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{editing ? 'Editar producto' : 'Nuevo producto'}</Text>
            <Text style={styles.label}>Nombre</Text>
            <TextInput value={name} onChangeText={setName} placeholder="Ej. Leche" placeholderTextColor={Palette.textSecondary} style={styles.input} />
            <View style={styles.formRow}>
              <View style={styles.formHalf}><Text style={styles.label}>Cantidad</Text><TextInput value={quantity} onChangeText={setQuantity} keyboardType="number-pad" style={styles.input} /></View>
              <View style={styles.formHalf}><Text style={styles.label}>Precio unidad</Text><TextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={Palette.textSecondary} style={styles.input} /></View>
            </View>
            <Pressable onPress={saveItem} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Guardar producto</Text></Pressable>
            <Pressable onPress={() => { setEditing(null); setItemModalVisible(false); setName(''); }} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Cancelar</Text></Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function parseItems(encodedItems?: string): ReceiptItem[] {
  if (!encodedItems) return SAMPLE_ITEMS;
  try {
    const parsed = JSON.parse(encodedItems) as Array<Partial<ReceiptItem>>;
    return parsed.map((item, index) => ({
      id: item.id ?? `${index}`,
      name: item.name?.trim() || `Producto ${index + 1}`,
      quantity: Number.isInteger(item.quantity) && (item.quantity ?? 0) > 0 ? item.quantity! : 1,
      unit_price: Number.isFinite(Number(item.unit_price)) && Number(item.unit_price) > 0
        ? Number(item.unit_price).toFixed(2)
        : '0.00',
    }));
  } catch {
    return SAMPLE_ITEMS;
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
  totalCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, borderRadius: 18, backgroundColor: Palette.mint },
  totalLabel: { fontSize: 11, fontWeight: '800', color: Palette.textSecondary },
  total: { marginTop: 4, fontSize: 30, fontWeight: '800', color: Palette.text },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  sectionTitle: { fontSize: 19, fontWeight: '800', color: Palette.text },
  hint: { fontSize: 11, color: Palette.textSecondary },
  itemCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderWidth: 1, borderColor: Palette.border, borderRadius: 14, backgroundColor: Palette.surface },
  quantity: { minWidth: 32, paddingVertical: 6, borderRadius: 8, backgroundColor: Palette.segment, alignItems: 'center' },
  quantityText: { fontSize: 12, fontWeight: '800', color: Palette.primary },
  itemName: { flex: 1, fontSize: 14, fontWeight: '700', color: Palette.text },
  itemPrice: { fontSize: 14, fontWeight: '800', color: Palette.text },
  addButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, padding: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: Palette.primary, borderRadius: 14 },
  addButtonText: { fontSize: 14, fontWeight: '800', color: Palette.primary },
  primaryButton: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 8, borderRadius: 16, backgroundColor: Palette.primary },
  primaryButtonText: { fontSize: 15, fontWeight: '800', color: Palette.onPrimary },
  secondaryButton: { alignItems: 'center', padding: 12 },
  secondaryButtonText: { fontSize: 14, fontWeight: '800', color: Palette.primary },
  error: { fontSize: 13, color: Palette.error },
  label: { marginTop: 5, fontSize: 13, fontWeight: '800', color: Palette.text },
  memberCard: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 15, borderWidth: 1, borderColor: Palette.border, borderRadius: 14, backgroundColor: Palette.surface },
  memberSelected: { borderColor: Palette.primary, backgroundColor: Palette.mint },
  memberName: { fontSize: 15, fontWeight: '700', color: Palette.text },
  payerList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  payer: { paddingVertical: 10, paddingHorizontal: 13, borderRadius: 12, backgroundColor: Palette.segment },
  payerSelected: { backgroundColor: Palette.primary },
  payerText: { fontSize: 13, fontWeight: '700', color: Palette.text },
  payerTextSelected: { color: Palette.onPrimary },
  splitSummary: { padding: 14, borderRadius: 14, backgroundColor: Palette.mint, fontSize: 14, fontWeight: '700', color: Palette.text },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  modal: { gap: 10, padding: 24, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: Palette.background },
  modalTitle: { marginBottom: 6, fontSize: 21, fontWeight: '800', color: Palette.text },
  input: { minHeight: 48, paddingHorizontal: 13, borderWidth: 1, borderColor: Palette.border, borderRadius: 12, backgroundColor: Palette.surface, color: Palette.text },
  formRow: { flexDirection: 'row', gap: 10 },
  formHalf: { flex: 1, gap: 4 },
});
