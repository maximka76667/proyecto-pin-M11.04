import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Palette } from '@/constants/onboarding';

// shared = false: the product is only for the user who pays, it is not split.
// unit_price = null: the scanner could not read it, the user has to fill it in
export type ReceiptItem = {
  id: string;
  name: string;
  quantity: number;
  unit_price: string | null;
  shared: boolean;
};

// Products from a route param or from the scanner
export type ReceiptItemInput = Partial<ReceiptItem>;

// Copy of the backend limits (CreateReceiptTransactionDto), keep them in sync.
// Checked here only to warn early: the backend is the one that enforces them
export const MAX_UNIT_PRICE = 99999.99;
export const MAX_QUANTITY = 999;
export const MAX_ITEMS = 100;
export const LIMIT_MESSAGE =
  'El importe o la cantidad introducida superan el límite máximo permitido.';

export function toReceiptItems(input: ReceiptItemInput[]): ReceiptItem[] {
  return input.map((item, index) => ({
    id: item.id ?? `${index}`,
    name: item.name?.trim() || `Producto ${index + 1}`,
    quantity: Number.isInteger(item.quantity) && (item.quantity ?? 0) > 0 ? item.quantity! : 1,
    // Not 0.00: an invented price would be split without anyone noticing
    unit_price:
      item.unit_price != null && Number.isFinite(Number(item.unit_price)) && Number(item.unit_price) > 0
        ? Number(item.unit_price).toFixed(2)
        : null,
    // Everything is shared by default; the user unticks what is only theirs
    shared: item.shared ?? true,
  }));
}

// Products without a price count as 0 until the user fills it in
const lineTotal = (item: ReceiptItem) =>
  item.unit_price === null ? 0 : item.quantity * Number(item.unit_price);

// total = only the shared products, which are the ones that get split.
// missingPrices = shared products without a price: the expense can't be created until they have one
export function receiptTotals(items: ReceiptItem[]) {
  const sharedItems = items.filter((item) => item.shared);
  return {
    sharedItems,
    total: sharedItems.reduce((sum, item) => sum + lineTotal(item), 0),
    ownTotal: items
      .filter((item) => !item.shared)
      .reduce((sum, item) => sum + lineTotal(item), 0),
    missingPrices: sharedItems.filter((item) => item.unit_price === null).length,
  };
}

// Product list of a ticket: choose what is shared, edit, add and delete products.
// Controlled: the page keeps the items. Used by escanearticket and by /dev?tab=scanner
export function ReceiptEditor({
  items,
  onChange,
}: {
  items: ReceiptItem[];
  onChange: (items: ReceiptItem[]) => void;
}) {
  const [editing, setEditing] = useState<ReceiptItem | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');

  const { total, ownTotal, missingPrices } = receiptTotals(items);

  const openItem = (item: ReceiptItem | null) => {
    setEditing(item);
    setName(item?.name ?? '');
    setQuantity(item ? String(item.quantity) : '1');
    setPrice(item?.unit_price ?? '');
    setError('');
    setModalVisible(true);
  };

  const closeModal = () => {
    setEditing(null);
    setModalVisible(false);
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
    if (Number(normalizedPrice) > MAX_UNIT_PRICE || parsedQuantity > MAX_QUANTITY) {
      setError(LIMIT_MESSAGE);
      return;
    }
    if (!editing && items.length >= MAX_ITEMS) {
      setError(`Un ticket puede tener como máximo ${MAX_ITEMS} productos.`);
      return;
    }

    const item: ReceiptItem = {
      id: editing?.id ?? `${Date.now()}`,
      name: name.trim(),
      quantity: parsedQuantity,
      unit_price: Number(normalizedPrice).toFixed(2),
      shared: editing?.shared ?? true,
    };
    onChange(
      editing
        ? items.map((existing) => (existing.id === editing.id ? item : existing))
        : [...items, item],
    );
    closeModal();
  };

  const toggleShared = (id: string) =>
    onChange(items.map((item) => (item.id === id ? { ...item, shared: !item.shared } : item)));

  const removeItem = (id: string) => onChange(items.filter((item) => item.id !== id));

  return (
    <>
      <View style={styles.totalCard}>
        <View>
          <Text style={styles.totalLabel}>TOTAL A COMPARTIR</Text>
          <Text style={styles.total}>{total.toFixed(2)} €</Text>
          {ownTotal > 0 ? (
            <Text style={styles.ownTotal}>+ {ownTotal.toFixed(2)} € solo tuyo</Text>
          ) : null}
          {missingPrices > 0 ? (
            <Text style={styles.missingPriceSummary}>
              {missingPrices === 1
                ? 'Falta el precio de 1 producto'
                : `Falta el precio de ${missingPrices} productos`}
            </Text>
          ) : null}
        </View>
        <MaterialCommunityIcons name="receipt-text-check-outline" size={34} color={Palette.primary} />
      </View>

      <View style={styles.listHeader}>
        <Text style={styles.sectionTitle}>Productos</Text>
        <Text style={styles.hint}>Marca lo que compartes · toca para editar</Text>
      </View>

      {items.map((item) => (
        <Pressable
          key={item.id}
          onPress={() => openItem(item)}
          style={[
            styles.itemCard,
            !item.shared && styles.itemNotShared,
            item.shared && item.unit_price === null && styles.itemMissingPrice,
          ]}>
          <Pressable
            onPress={() => toggleShared(item.id)}
            hitSlop={8}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.shared }}
            accessibilityLabel={`Compartir ${item.name}`}>
            <MaterialCommunityIcons
              name={item.shared ? 'checkbox-marked' : 'checkbox-blank-outline'}
              size={22}
              color={item.shared ? Palette.primary : Palette.textSecondary}
            />
          </Pressable>
          <View style={styles.quantity}>
            <Text style={styles.quantityText}>{item.quantity}x</Text>
          </View>
          <Text style={[styles.itemName, !item.shared && styles.textNotShared]}>{item.name}</Text>
          {item.unit_price === null ? (
            <Text style={[styles.missingPrice, !item.shared && styles.textNotShared]}>
              Falta el precio
            </Text>
          ) : (
            <Text style={[styles.itemPrice, !item.shared && styles.textNotShared]}>
              {lineTotal(item).toFixed(2)} €
            </Text>
          )}
          <Pressable onPress={() => removeItem(item.id)} hitSlop={8}>
            <MaterialCommunityIcons name="trash-can-outline" size={20} color={Palette.error} />
          </Pressable>
        </Pressable>
      ))}

      <Pressable onPress={() => openItem(null)} style={styles.addButton}>
        <MaterialCommunityIcons name="plus" size={21} color={Palette.primary} />
        <Text style={styles.addButtonText}>Añadir producto</Text>
      </Pressable>

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={closeModal}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{editing ? 'Editar producto' : 'Nuevo producto'}</Text>
            <Text style={styles.label}>Nombre</Text>
            <TextInput value={name} onChangeText={setName} placeholder="Ej. Leche" placeholderTextColor={Palette.textSecondary} style={styles.input} />
            <View style={styles.formRow}>
              <View style={styles.formHalf}>
                <Text style={styles.label}>Cantidad</Text>
                <TextInput value={quantity} onChangeText={setQuantity} keyboardType="number-pad" style={styles.input} />
              </View>
              <View style={styles.formHalf}>
                <Text style={styles.label}>Precio unidad</Text>
                <TextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={Palette.textSecondary} style={styles.input} />
              </View>
            </View>
            {/* Inside the modal: an error on the page behind it would be hidden */}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable onPress={saveItem} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Guardar producto</Text>
            </Pressable>
            <Pressable onPress={closeModal} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  totalCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, borderRadius: 18, backgroundColor: Palette.mint },
  totalLabel: { fontSize: 11, fontWeight: '800', color: Palette.textSecondary },
  total: { marginTop: 4, fontSize: 30, fontWeight: '800', color: Palette.text },
  ownTotal: { marginTop: 2, fontSize: 12, fontWeight: '700', color: Palette.textSecondary },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  sectionTitle: { fontSize: 19, fontWeight: '800', color: Palette.text },
  hint: { fontSize: 11, color: Palette.textSecondary },
  itemCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderWidth: 1, borderColor: Palette.border, borderRadius: 14, backgroundColor: Palette.surface },
  itemNotShared: { backgroundColor: Palette.background },
  quantity: { minWidth: 32, paddingVertical: 6, borderRadius: 8, backgroundColor: Palette.segment, alignItems: 'center' },
  quantityText: { fontSize: 12, fontWeight: '800', color: Palette.primary },
  itemName: { flex: 1, fontSize: 14, fontWeight: '700', color: Palette.text },
  itemPrice: { fontSize: 14, fontWeight: '800', color: Palette.text },
  textNotShared: { color: Palette.textSecondary, textDecorationLine: 'line-through' },
  itemMissingPrice: { borderColor: Palette.error },
  missingPrice: { fontSize: 13, fontWeight: '800', color: Palette.error },
  missingPriceSummary: { marginTop: 2, fontSize: 12, fontWeight: '700', color: Palette.error },
  addButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, padding: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: Palette.primary, borderRadius: 14 },
  addButtonText: { fontSize: 14, fontWeight: '800', color: Palette.primary },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  modal: { gap: 10, padding: 24, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: Palette.background },
  modalTitle: { marginBottom: 6, fontSize: 21, fontWeight: '800', color: Palette.text },
  label: { marginTop: 5, fontSize: 13, fontWeight: '800', color: Palette.text },
  input: { minHeight: 48, paddingHorizontal: 13, borderWidth: 1, borderColor: Palette.border, borderRadius: 12, backgroundColor: Palette.surface, color: Palette.text },
  formRow: { flexDirection: 'row', gap: 10 },
  formHalf: { flex: 1, gap: 4 },
  error: { fontSize: 13, color: Palette.error },
  primaryButton: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 8, borderRadius: 16, backgroundColor: Palette.primary },
  primaryButtonText: { fontSize: 15, fontWeight: '800', color: Palette.onPrimary },
  secondaryButton: { alignItems: 'center', padding: 12 },
  secondaryButtonText: { fontSize: 14, fontWeight: '800', color: Palette.primary },
});
