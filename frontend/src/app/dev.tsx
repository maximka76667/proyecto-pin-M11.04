import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Eyebrow, Field, PrimaryButton } from '@/components/onboarding';
import { Palette, Radius } from '@/constants/onboarding';
import { Apartment, api, errorMessage } from '@/lib/api';

// Test screen to try the apartments API (open /dev)
export default function DevApartments() {
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [landlordId, setLandlordId] = useState('');

  const loadApartments = useCallback(async () => {
    setLoading(true);
    try {
      setApartments(await api('GET', '/apartments'));
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

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
      setError(errorMessage(e));
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
      setError(errorMessage(e));
      return false;
    }
  };

  const deleteApartment = async (id: string) => {
    try {
      await api('DELETE', `/apartments/${id}`);
      await loadApartments();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Eyebrow>Developer tools</Eyebrow>
          <Text style={styles.title}>Apartments</Text>
          <Text style={styles.subtitle}>Create, edit and delete apartments to test the API.</Text>
        </View>

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

        {error ? (
          <Pressable style={styles.errorBox} onPress={() => setError('')}>
            <MaterialCommunityIcons name="alert-circle-outline" size={18} color={Palette.error} />
            <Text style={styles.errorText}>{error}</Text>
            <MaterialCommunityIcons name="close" size={16} color={Palette.error} />
          </Pressable>
        ) : null}

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
      </ScrollView>
    </SafeAreaView>
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
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: Radius.input,
    backgroundColor: '#FBE9E7',
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
});
