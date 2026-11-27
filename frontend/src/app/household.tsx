import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Eyebrow, Field, PrimaryButton, SegmentedControl } from '@/components/onboarding';
import { Palette } from '@/constants/onboarding';
import { Apartment, api, errorMessage } from '@/lib/api';

type Mode = 'create' | 'join';

export default function Household() {
  const params = useLocalSearchParams<{
    mode?: string;
    inviteCode?: string;
    householdSetupFailed?: string;
  }>();
  const [mode, setMode] = useState<Mode>(params.mode === 'join' ? 'join' : 'create');

  const [householdName, setHouseholdName] = useState('');
  const [address, setAddress] = useState('');
  const [inviteCode, setInviteCode] = useState(params.inviteCode ?? '');

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const changeMode = (newMode: Mode) => {
    setMode(newMode);
    setError('');
  };

  const createHousehold = async () => {
    if (!householdName.trim() || !address.trim()) {
      setError('Completa el nombre y la dirección del hogar.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const apartment: Apartment = await api('POST', '/apartments', {
        name: householdName.trim().replace(/\s+/g, ''),
        address: address.trim(),
      });
      router.replace({
        pathname: '/household-created',
        params: {
          id: apartment.id,
          name: apartment.name,
          address: apartment.address,
          inviteCode: apartment.invite_code,
        },
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const joinHousehold = async () => {
    if (!inviteCode.trim()) {
      setError('Pega el enlace o introduce el código de invitación.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const code = extractInviteCode(inviteCode);
      if (!code) {
        setError('El enlace o código de invitación no es válido.');
        return;
      }
      await api('POST', '/apartments/join', { invite_code: code });
      router.replace('/');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Eyebrow>Configuremos tu hogar</Eyebrow>
          <Text style={styles.title}>¿Con quién vives?</Text>
          <Text style={styles.subtitle}>
            Crea un hogar nuevo o únete a uno que ya haya creado tu compañero de piso.
          </Text>
        </View>

        <SegmentedControl
          options={[
            { value: 'create', label: 'Crear nuevo' },
            { value: 'join', label: 'Unirme a un hogar' },
          ]}
          value={mode}
          onChange={changeMode}
        />

        <View style={styles.form}>
          {mode === 'create' ? (
            <>
              <Field
                label="Nombre del hogar"
                placeholder="e.g. Piso Centro"
                value={householdName}
                onChangeText={setHouseholdName}
              />
              <Field
                label="Dirección"
                placeholder="p. ej. Calle Mayor 3, Valencia"
                value={address}
                onChangeText={setAddress}
              />
            </>
          ) : (
            <Field
              label="Enlace o código de invitación"
              placeholder="Pega aquí el enlace o código"
              value={inviteCode}
              onChangeText={setInviteCode}
              autoCapitalize="characters"
            />
          )}
        </View>

        {params.householdSetupFailed === '1' ? (
          <Text style={styles.error}>
            No hemos encontrado una casa con ese enlace o código. Comprueba los datos e inténtalo de
            nuevo.
          </Text>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {mode === 'create' ? (
          <PrimaryButton title="Continuar" onPress={createHousehold} loading={loading} />
        ) : (
          <PrimaryButton title="Unirme al hogar" onPress={joinHousehold} loading={loading} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function extractInviteCode(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    return url.searchParams.get('inviteCode') ?? url.searchParams.get('invite_code') ?? '';
  } catch {
    return trimmed;
  }
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  container: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingBottom: 24,
    gap: 24,
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
  form: {
    gap: 20,
  },
  error: {
    fontSize: 14,
    color: Palette.error,
  },
});
