import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Eyebrow, Field, PhotoField, PrimaryButton, SegmentedControl } from '@/components/onboarding';
import { Palette } from '@/constants/onboarding';
import { Apartment, api, errorMessage } from '@/lib/api';

type Mode = 'create' | 'join';

export default function Household() {
  const params = useLocalSearchParams<{ mode?: string; inviteCode?: string }>();
  const [mode, setMode] = useState<Mode>(params.mode === 'join' ? 'join' : 'create');

  const [yourName, setYourName] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [address, setAddress] = useState('');
  const [inviteCode, setInviteCode] = useState(params.inviteCode ?? '');

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const changeMode = (newMode: Mode) => {
    setMode(newMode);
    setError('');
  };

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
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
        name: householdName.trim(),
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
    if (!yourName.trim() || !inviteCode.trim()) {
      setError('Introduce tu nombre y un código de invitación.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await api('POST', '/apartments/join', {
        full_name: yourName.trim(),
        invite_code: inviteCode.trim(),
      });
      router.replace('/');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled">
        <Pressable onPress={goBack} hitSlop={12} style={styles.back}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={Palette.text} />
        </Pressable>

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
          <Field
            label={mode === 'join' ? 'Tu nombre' : 'Tu nombre (todavía no se guarda en la base de datos)'}
            placeholder="p. ej. Alex"
            value={yourName}
            onChangeText={setYourName}
          />

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
              label="Código de invitación"
              placeholder="p. ej. H7K4Q"
              value={inviteCode}
              onChangeText={setInviteCode}
              autoCapitalize="characters"
            />
          )}

          <PhotoField name={yourName} />
        </View>

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
  back: {
    alignSelf: 'flex-start',
    paddingTop: 8,
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
