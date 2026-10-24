import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Eyebrow, Field, PrimaryButton, SegmentedControl } from '@/components/onboarding';
import { ReceiptEditor, ReceiptItem, toReceiptItems } from '@/components/receipt-editor';
import { ReceiptExpense, receiptRequestItems, ReceiptSplit } from '@/components/receipt-split';
import { scanTicket, TicketScanner } from '@/components/ticket-scanner';
import { Palette, Radius } from '@/constants/onboarding';
import {
  Apartment,
  api,
  errorMessage,
  ScannedTicket,
  Transaction,
  TransactionCategory,
} from '@/lib/api';
import { limitTransactionAmountInput } from '@/lib/transaction-amount';

const CATEGORIES: TransactionCategory[] = ['utilities', 'maintenance', 'supplies', 'other'];

type Tab = 'apartments' | 'expenses' | 'scanner';

const TABS: { value: Tab; label: string; title: string; subtitle: string }[] = [
  {
    value: 'apartments',
    label: 'Apartments',
    title: 'Apartments',
    subtitle: 'Create, edit and delete apartments to test the API.',
  },
  {
    value: 'expenses',
    label: 'Expenses',
    title: 'Expenses',
    subtitle: 'Create, edit and delete expenses to test the API.',
  },
  {
    value: 'scanner',
    label: 'Scanner',
    title: 'Ticket scanner',
    subtitle: 'Send a receipt photo to the scanner and see what it reads.',
  },
];

type ShowError = (action: string, e: unknown) => void;

// Test screen to try the API (open /dev, /dev?tab=expenses or /dev?tab=scanner)
export default function DevScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const current = TABS.find(({ value }) => value === params.tab) ?? TABS[0];
  const tab = current.value;
  const [error, setError] = useState('');

  // Shows the error in the banner (stays until closed) and logs it to the console.
  // console.log, not console.error: in dev Expo shows every console.error as a second red toast
  const showError = useCallback((action: string, e: unknown) => {
    const message = `${action} failed — ${errorMessage(e)}`;
    console.log(message, e);
    setError(message);
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Eyebrow>Developer tools</Eyebrow>
          <Text style={styles.title}>{current.title}</Text>
          <Text style={styles.subtitle}>{current.subtitle}</Text>
        </View>

        {/* The tab lives in the URL so reloading the page keeps it */}
        <SegmentedControl
          options={TABS}
          value={tab}
          onChange={(value) => router.setParams({ tab: value })}
        />

        {tab === 'apartments' ? (
          <DevApartments showError={showError} />
        ) : tab === 'expenses' ? (
          <DevExpenses showError={showError} />
        ) : (
          <DevScanner showError={showError} />
        )}
      </ScrollView>

      {/* Outside the ScrollView so it is visible wherever you are on the page */}
      {error ? (
        <View style={styles.errorBanner} pointerEvents="box-none">
          <Pressable style={styles.errorBox} onPress={() => setError('')}>
            <MaterialCommunityIcons name="alert-circle-outline" size={20} color={Palette.error} />
            <Text style={styles.errorText}>{error}</Text>
            <MaterialCommunityIcons name="close" size={18} color={Palette.error} />
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function DevApartments({ showError }: { showError: ShowError }) {
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [landlordId, setLandlordId] = useState('');

  const loadApartments = useCallback(async () => {
    setLoading(true);
    try {
      setApartments(await api('GET', '/apartments'));
    } catch (e) {
      showError('Load apartments', e);
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    loadApartments();
  }, [loadApartments]);

  const createApartment = async () => {
    setCreating(true);
    try {
      await api('POST', '/apartments', {
        name,
        address,
        ...(landlordId.trim() ? { landlord_id: landlordId.trim() } : {}),
      });
      setName('');
      setAddress('');
      setLandlordId('');
      await loadApartments();
    } catch (e) {
      showError('Create apartment', e);
    } finally {
      setCreating(false);
    }
  };

  const updateApartment = async (id: string, changes: Partial<Apartment>) => {
    try {
      await api('PATCH', `/apartments/${id}`, changes);
      await loadApartments();
      return true;
    } catch (e) {
      showError('Update apartment', e);
      return false;
    }
  };

  const deleteApartment = async (id: string) => {
    try {
      await api('DELETE', `/apartments/${id}`);
      await loadApartments();
    } catch (e) {
      showError('Delete apartment', e);
    }
  };

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>New apartment</Text>
        <Field label="Name" placeholder="e.g. Piso Centro" value={name} onChangeText={setName} />
        <Field
          label="Address"
          placeholder="e.g. Calle Mayor 3, Valencia"
          value={address}
          onChangeText={setAddress}
        />
        <Field
          label="Landlord ID (optional)"
          placeholder="User uuid"
          value={landlordId}
          onChangeText={setLandlordId}
          autoCapitalize="none"
        />
        <PrimaryButton title="Create apartment" onPress={createApartment} loading={creating} />
      </View>

      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>
          All apartments <Text style={styles.count}>({apartments.length})</Text>
        </Text>
        <IconButton icon="refresh" label="Reload" onPress={loadApartments} />
      </View>

      {loading && apartments.length === 0 ? (
        <ActivityIndicator color={Palette.primary} />
      ) : apartments.length === 0 ? (
        <View style={styles.empty}>
          <MaterialCommunityIcons name="home-outline" size={32} color={Palette.textSecondary} />
          <Text style={styles.emptyText}>No apartments yet. Create the first one above.</Text>
        </View>
      ) : (
        apartments.map((apartment) => (
          <ApartmentItem
            key={apartment.id}
            apartment={apartment}
            onSave={(changes) => updateApartment(apartment.id, changes)}
            onDelete={() => deleteApartment(apartment.id)}
          />
        ))
      )}
    </>
  );
}

function ApartmentItem({
  apartment,
  onSave,
  onDelete,
}: {
  apartment: Apartment;
  onSave: (changes: Partial<Apartment>) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(apartment.name);
  const [address, setAddress] = useState(apartment.address);
  const [landlordId, setLandlordId] = useState(apartment.landlord_id ?? '');

  const startEditing = () => {
    setName(apartment.name);
    setAddress(apartment.address);
    setLandlordId(apartment.landlord_id ?? '');
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    // Empty landlord = remove the landlord
    const ok = await onSave({ name, address, landlord_id: landlordId.trim() || null });
    setSaving(false);
    if (ok) setEditing(false);
  };

  if (editing) {
    return (
      <View style={[styles.card, styles.cardEditing]}>
        <Text style={styles.cardTitle}>Edit apartment</Text>
        <Field label="Name" value={name} onChangeText={setName} />
        <Field label="Address" value={address} onChangeText={setAddress} />
        <Field
          label="Landlord ID (empty = no landlord)"
          value={landlordId}
          onChangeText={setLandlordId}
          autoCapitalize="none"
        />
        <View style={styles.row}>
          <IconButton icon="close" label="Cancel" onPress={() => setEditing(false)} />
          <View style={styles.flex}>
            <PrimaryButton title="Save" onPress={save} loading={saving} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.item}>
      <View style={styles.itemIcon}>
        <MaterialCommunityIcons name="home-variant" size={22} color={Palette.onPrimary} />
      </View>

      <View style={styles.itemInfo}>
        <Text style={styles.itemName}>{apartment.name}</Text>
        <Text style={styles.itemAddress}>{apartment.address}</Text>
        <View style={[styles.badge, !apartment.landlord_id && styles.badgeEmpty]}>
          <MaterialCommunityIcons
            name={apartment.landlord_id ? 'account-key' : 'account-off-outline'}
            size={12}
            color={apartment.landlord_id ? Palette.primary : Palette.textSecondary}
          />
          <Text
            style={[styles.badgeText, !apartment.landlord_id && styles.badgeTextEmpty]}
            numberOfLines={1}>
            {apartment.landlord_id ?? 'No landlord'}
          </Text>
        </View>
        <Text style={styles.itemId} numberOfLines={1}>
          {apartment.id}
        </Text>
      </View>

      <View style={styles.itemActions}>
        <IconButton icon="pencil-outline" onPress={startEditing} />
        <IconButton icon="trash-can-outline" color={Palette.error} onPress={onDelete} />
      </View>
    </View>
  );
}

function DevExpenses({ showError }: { showError: ShowError }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // Empty filter = all expenses
  const [filterApartmentId, setFilterApartmentId] = useState('');

  const [apartmentId, setApartmentId] = useState('');
  const [fromUserId, setFromUserId] = useState('');
  const [toUserId, setToUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<TransactionCategory>('other');

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const filter = filterApartmentId.trim();
      const query = filter ? `?apartment_id=${encodeURIComponent(filter)}` : '';
      setTransactions(await api('GET', `/transactions${query}`));
    } catch (e) {
      showError('Load expenses', e);
    } finally {
      setLoading(false);
    }
  }, [filterApartmentId, showError]);

  useEffect(() => {
    loadTransactions();
    // Only on mount, the filter is applied with the Reload button
  }, []);

  const createTransaction = async () => {
    setCreating(true);
    try {
      await api('POST', '/transactions', {
        apartment_id: apartmentId.trim(),
        from_user_id: fromUserId.trim(),
        to_user_id: toUserId.trim(),
        amount: amount.trim(),
        category,
      });
      setAmount('');
      await loadTransactions();
    } catch (e) {
      showError('Create expense', e);
    } finally {
      setCreating(false);
    }
  };

  const updateTransaction = async (id: string, changes: Partial<Transaction>) => {
    try {
      await api('PATCH', `/transactions/${id}`, changes);
      await loadTransactions();
      return true;
    } catch (e) {
      showError('Update expense', e);
      return false;
    }
  };

  const deleteTransaction = async (id: string) => {
    try {
      await api('DELETE', `/transactions/${id}`);
      await loadTransactions();
    } catch (e) {
      showError('Delete expense', e);
    }
  };

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>New expense</Text>
        <Field
          label="Apartment ID"
          placeholder="Apartment uuid"
          value={apartmentId}
          onChangeText={setApartmentId}
          autoCapitalize="none"
        />
        <Field
          label="Paid by (from user ID)"
          placeholder="User uuid"
          value={fromUserId}
          onChangeText={setFromUserId}
          autoCapitalize="none"
        />
        <Field
          label="Owed by (to user ID)"
          placeholder="User uuid"
          value={toUserId}
          onChangeText={setToUserId}
          autoCapitalize="none"
        />
        <Field
          label="Amount"
          placeholder="e.g. 12.50"
          value={amount}
          onChangeText={(value) => setAmount(limitTransactionAmountInput(value))}
          keyboardType="decimal-pad"
        />
        <CategoryPicker value={category} onChange={setCategory} />
        <PrimaryButton title="Create expense" onPress={createTransaction} loading={creating} />
      </View>

      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>
          {filterApartmentId.trim() ? 'Filtered expenses' : 'All expenses'}{' '}
          <Text style={styles.count}>({transactions.length})</Text>
        </Text>
        <IconButton icon="refresh" label="Reload" onPress={loadTransactions} />
      </View>
      <Field
        label="Filter by apartment ID (optional)"
        placeholder="Apartment uuid, then press Reload"
        value={filterApartmentId}
        onChangeText={setFilterApartmentId}
        autoCapitalize="none"
      />

      {loading && transactions.length === 0 ? (
        <ActivityIndicator color={Palette.primary} />
      ) : transactions.length === 0 ? (
        <View style={styles.empty}>
          <MaterialCommunityIcons name="receipt-text-outline" size={32} color={Palette.textSecondary} />
          <Text style={styles.emptyText}>No expenses yet. Create the first one above.</Text>
        </View>
      ) : (
        transactions.map((transaction) => (
          <TransactionItem
            key={transaction.id}
            transaction={transaction}
            onSave={(changes) => updateTransaction(transaction.id, changes)}
            onDelete={() => deleteTransaction(transaction.id)}
          />
        ))
      )}
    </>
  );
}

function TransactionItem({
  transaction,
  onSave,
  onDelete,
}: {
  transaction: Transaction;
  onSave: (changes: Partial<Transaction>) => Promise<boolean>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [amount, setAmount] = useState(transaction.amount);
  const [category, setCategory] = useState(transaction.category);

  const startEditing = () => {
    setAmount(transaction.amount);
    setCategory(transaction.category);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    const ok = await onSave({ amount: amount.trim(), category });
    setSaving(false);
    if (ok) setEditing(false);
  };

  const remove = async () => {
    // Avoid sending the DELETE twice on double click
    if (deleting) return;
    setDeleting(true);
    await onDelete();
    setDeleting(false);
  };

  if (editing) {
    return (
      <View style={[styles.card, styles.cardEditing]}>
        <Text style={styles.cardTitle}>Edit expense</Text>
        <Field
          label="Amount"
          value={amount}
          onChangeText={(value) => setAmount(limitTransactionAmountInput(value))}
          keyboardType="decimal-pad"
        />
        <CategoryPicker value={category} onChange={setCategory} />
        <View style={styles.row}>
          <IconButton icon="close" label="Cancel" onPress={() => setEditing(false)} />
          <View style={styles.flex}>
            <PrimaryButton title="Save" onPress={save} loading={saving} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.item}>
      <View style={styles.itemIcon}>
        <MaterialCommunityIcons name="receipt-text-outline" size={22} color={Palette.onPrimary} />
      </View>

      <View style={styles.itemInfo}>
        <Text style={styles.itemName}>{Number(transaction.amount).toFixed(2)} €</Text>
        <View style={styles.badge}>
          <MaterialCommunityIcons name="tag-outline" size={12} color={Palette.primary} />
          <Text style={styles.badgeText}>{transaction.category}</Text>
        </View>
        <Text style={styles.itemId} numberOfLines={1}>
          id: {transaction.id}
        </Text>
        <Text style={styles.itemId} numberOfLines={1}>
          apartment: {transaction.apartment_id}
        </Text>
        <Text style={styles.itemId} numberOfLines={1}>
          from: {transaction.from_user_id}
        </Text>
        <Text style={styles.itemId} numberOfLines={1}>
          to: {transaction.to_user_id}
        </Text>
      </View>

      <View style={styles.itemActions}>
        <IconButton icon="pencil-outline" onPress={startEditing} />
        {deleting ? (
          <ActivityIndicator color={Palette.error} style={styles.iconButton} />
        ) : (
          <IconButton icon="trash-can-outline" color={Palette.error} onPress={remove} />
        )}
      </View>
    </View>
  );
}

function DevScanner({ showError }: { showError: ShowError }) {
  const [image, setImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  // result = what the scanner returned; items = the same products after editing them
  const [result, setResult] = useState<ScannedTicket | null>(null);
  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [showJson, setShowJson] = useState(false);

  const showResult = (ticket: ScannedTicket) => {
    setResult(ticket);
    setItems(toReceiptItems(ticket.items));
  };

  // Sends the same photo again, to see if Gemini answers the same
  const scanAgain = async (asset: ImagePicker.ImagePickerAsset) => {
    setScanning(true);
    setResult(null);
    try {
      showResult(await scanTicket(asset));
    } catch (e) {
      showError('Scan ticket', e);
    } finally {
      setScanning(false);
    }
  };

  // Apartment typed in the field; splitApartmentId is set with "Load members"
  const [apartmentId, setApartmentId] = useState('');
  const [splitApartmentId, setSplitApartmentId] = useState('');
  const [created, setCreated] = useState<ReceiptExpense | null>(null);
  // Stable: ReceiptSplit reloads the members when its callbacks change.
  // Raw backend error here (not the friendly message), it is more useful for testing
  const onSplitError = useCallback((e: unknown) => showError('Create expense', e), [showError]);

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Receipt photo</Text>
        {/* Same component as the review screen (escanearticket) */}
        <TicketScanner
          onScanned={(ticket, asset) => {
            setImage(asset);
            showResult(ticket);
          }}
          onError={(e) => showError('Scan ticket', e)}
        />
        {image && !scanning ? (
          <IconButton icon="refresh" label="Scan same photo again" onPress={() => scanAgain(image)} />
        ) : null}
        {image ? (
          <Image source={{ uri: image.uri }} style={styles.preview} resizeMode="contain" />
        ) : (
          <View style={styles.empty}>
            <MaterialCommunityIcons name="receipt-text-outline" size={32} color={Palette.textSecondary} />
            <Text style={styles.emptyText}>Pick a receipt photo to send it to POST /scanner/ticket.</Text>
          </View>
        )}
        {scanning ? <ActivityIndicator color={Palette.primary} /> : null}
      </View>

      {result ? (
        <>
          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>
              {result.comercio ?? 'Unknown store'}{' '}
              <Text style={styles.count}>({result.items.length} products)</Text>
            </Text>
            <IconButton
              icon="code-json"
              label={showJson ? 'Hide JSON' : 'Raw JSON'}
              onPress={() => setShowJson((value) => !value)}
            />
          </View>

          {showJson ? (
            <>
              <Text style={styles.cardTitle}>Scanner response</Text>
              <Text selectable style={styles.json}>
                {JSON.stringify(result, null, 2)}
              </Text>
              <Text style={styles.cardTitle}>Items escanearticket would send</Text>
              <Text selectable style={styles.json}>
                {JSON.stringify(receiptRequestItems(items), null, 2)}
              </Text>
            </>
          ) : null}

          {result.items.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No products found. Is it a receipt?</Text>
            </View>
          ) : null}
        </>
      ) : null}

      {/* Same component as escanearticket, so the product review can be tested here */}
      {result && (items.length > 0 || result.items.length > 0) ? (
        <>
          <ReceiptEditor items={items} onChange={setItems} />

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Create expense</Text>
            <Text style={styles.subtitle}>
              Same split as escanearticket: the current user pays and the shared products are
              split with the selected members. No frontend checks here, so invalid data reaches
              the backend validation.
            </Text>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Field
                  label="Apartment ID"
                  placeholder="Apartment uuid"
                  value={apartmentId}
                  onChangeText={setApartmentId}
                  autoCapitalize="none"
                />
              </View>
              <IconButton
                icon="account-multiple-outline"
                label="Load members"
                onPress={() => {
                  setCreated(null);
                  setSplitApartmentId(apartmentId.trim());
                }}
              />
            </View>
            {/* Same component as escanearticket. key: another apartment starts from scratch */}
            {splitApartmentId ? (
              <ReceiptSplit
                key={splitApartmentId}
                apartmentId={splitApartmentId}
                items={items}
                onCreated={setCreated}
                onError={onSplitError}
              />
            ) : null}
          </View>

          {created ? (
            <>
              <Text style={styles.listTitle}>
                Created <Text style={styles.count}>({created.transactions.length} debts)</Text>
              </Text>
              <Text selectable style={styles.json}>
                {JSON.stringify(created, null, 2)}
              </Text>
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function CategoryPicker({
  value,
  onChange,
}: {
  value: TransactionCategory;
  onChange: (value: TransactionCategory) => void;
}) {
  return (
    <View style={styles.chips}>
      {CATEGORIES.map((category) => {
        const selected = category === value;
        return (
          <Pressable
            key={category}
            onPress={() => onChange(category)}
            style={[styles.chip, selected && styles.chipSelected]}>
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{category}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function IconButton({
  icon,
  label,
  color = Palette.primary,
  onPress,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label?: string;
  color?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
      <MaterialCommunityIcons name={icon} size={18} color={color} />
      {label ? <Text style={[styles.iconButtonText, { color }]}>{label}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  container: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    padding: 24,
    gap: 20,
  },
  header: {
    gap: 8,
  },
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    color: Palette.text,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: Palette.textSecondary,
  },
  card: {
    gap: 16,
    padding: 20,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  cardEditing: {
    borderColor: Palette.primary,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Palette.text,
  },
  errorBanner: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    alignItems: 'center',
  },
  errorBox: {
    width: '100%',
    maxWidth: 608,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Palette.error,
    backgroundColor: '#FBE9E7',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    color: Palette.error,
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  listTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Palette.text,
  },
  count: {
    fontWeight: '400',
    color: Palette.textSecondary,
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    padding: 32,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Palette.border,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    color: Palette.textSecondary,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    padding: 16,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  itemIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.input,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.primary,
  },
  itemInfo: {
    flex: 1,
    gap: 4,
  },
  itemName: {
    fontSize: 16,
    fontWeight: '700',
    color: Palette.text,
  },
  itemAddress: {
    fontSize: 14,
    color: Palette.textSecondary,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    gap: 4,
    marginTop: 4,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: Radius.pill,
    backgroundColor: Palette.mint,
  },
  badgeEmpty: {
    backgroundColor: Palette.segment,
  },
  badgeText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '600',
    color: Palette.primary,
  },
  badgeTextEmpty: {
    color: Palette.textSecondary,
  },
  itemId: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: Palette.textSecondary,
  },
  itemActions: {
    flexDirection: 'row',
    gap: 4,
  },
  iconButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: Radius.input,
  },
  iconButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  flex: {
    flex: 1,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  chipSelected: {
    borderColor: Palette.primary,
    backgroundColor: Palette.mint,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  chipTextSelected: {
    color: Palette.primary,
  },
  preview: {
    width: '100%',
    height: 280,
    borderRadius: Radius.input,
    backgroundColor: Palette.segment,
  },
  json: {
    padding: 14,
    borderRadius: Radius.input,
    backgroundColor: Palette.segment,
    fontSize: 12,
    fontFamily: 'monospace',
    color: Palette.text,
  },
});
