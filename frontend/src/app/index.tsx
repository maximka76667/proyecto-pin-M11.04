import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Text, TextInput, useTheme } from 'react-native-paper';

const API_URL = 'http://localhost:3000';

type Apartment = {
  id: string;
  name: string;
  address: string;
  landlord_id: string | null;
};

// Sends the request and throws an Error with the backend message if it fails
async function api(method: string, path: string, body?: object) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    const message = Array.isArray(data.message) ? data.message.join('\n') : data.message;
    throw new Error(`${response.status}: ${message}`);
  }
  return data;
}

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : 'Error al conectar';
}

export default function App() {
  const theme = useTheme();
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [landlordId, setLandlordId] = useState('');

  const loadApartments = useCallback(async () => {
    try {
      setApartments(await api('GET', '/apartments'));
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    loadApartments();
  }, [loadApartments]);

  const createApartment = async () => {
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
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.container}>
      <Card>
        <Card.Title title="Crear apartamento" />
        <Card.Content style={styles.form}>
          <TextInput mode="outlined" label="Nombre" value={name} onChangeText={setName} />
          <TextInput
            mode="outlined"
            label="Dirección"
            value={address}
            onChangeText={setAddress}
          />
          <TextInput
            mode="outlined"
            label="ID del landlord (opcional)"
            value={landlordId}
            onChangeText={setLandlordId}
            autoCapitalize="none"
          />
        </Card.Content>
        <Card.Actions>
          <Button mode="contained" icon="home-plus" onPress={createApartment}>
            Crear
          </Button>
        </Card.Actions>
      </Card>

      {error ? (
        <Text style={{ color: theme.colors.error }} onPress={() => setError('')}>
          {error}
        </Text>
      ) : null}

      <View style={styles.listHeader}>
        <Text variant="titleLarge">Apartamentos ({apartments.length})</Text>
        <Button icon="refresh" onPress={loadApartments}>
          Recargar
        </Button>
      </View>

      {apartments.map((apartment) => (
        <ApartmentItem
          key={apartment.id}
          apartment={apartment}
          onSave={(changes) => updateApartment(apartment.id, changes)}
          onDelete={() => deleteApartment(apartment.id)}
        />
      ))}
    </ScrollView>
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
  const theme = useTheme();
  const [editing, setEditing] = useState(false);
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
    // Empty landlord = remove the landlord
    const ok = await onSave({ name, address, landlord_id: landlordId.trim() || null });
    if (ok) setEditing(false);
  };

  if (editing) {
    return (
      <Card mode="outlined">
        <Card.Content style={styles.form}>
          <TextInput mode="outlined" label="Nombre" value={name} onChangeText={setName} />
          <TextInput
            mode="outlined"
            label="Dirección"
            value={address}
            onChangeText={setAddress}
          />
          <TextInput
            mode="outlined"
            label="ID del landlord (vacío = sin landlord)"
            value={landlordId}
            onChangeText={setLandlordId}
            autoCapitalize="none"
          />
        </Card.Content>
        <Card.Actions>
          <Button onPress={() => setEditing(false)}>Cancelar</Button>
          <Button mode="contained" icon="content-save" onPress={save}>
            Guardar
          </Button>
        </Card.Actions>
      </Card>
    );
  }

  return (
    <Card mode="outlined">
      <Card.Title title={apartment.name} subtitle={apartment.address} />
      <Card.Content>
        <Text variant="bodySmall">Landlord: {apartment.landlord_id ?? 'sin landlord'}</Text>
        <Text variant="bodySmall">ID: {apartment.id}</Text>
      </Card.Content>
      <Card.Actions>
        <Button icon="pencil" onPress={startEditing}>
          Editar
        </Button>
        <Button icon="delete" textColor={theme.colors.error} onPress={onDelete}>
          Eliminar
        </Button>
      </Card.Actions>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 20,
    paddingTop: 100,
    gap: 16,
  },
  form: {
    gap: 12,
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
