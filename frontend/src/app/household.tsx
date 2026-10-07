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
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<Mode>(params.mode === 'join' ? 'join' : 'create');

  const [yourName, setYourName] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [address, setAddress] = useState('');
  const [inviteCode, setInviteCode] = useState('');

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
      setError('Please fill in the household name and address.');
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
        params: { name: apartment.name, address: apartment.address },
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  // Invitations are not implemented in the backend yet
  const joinHousehold = () => {
    setError('Joining with an invite code is not available yet.');
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
          <Eyebrow>Let&apos;s set up home</Eyebrow>
          <Text style={styles.title}>Who are you living with?</Text>
          <Text style={styles.subtitle}>
            Create a new household or join one your roommate already started.
          </Text>
        </View>

        <SegmentedControl
          options={[
            { value: 'create', label: 'Create new' },
            { value: 'join', label: 'Join household' },
          ]}
          value={mode}
          onChange={changeMode}
        />

        <View style={styles.form}>
          <Field
            label="Your name (not saved in DB yet)"
            placeholder="e.g. Alex"
            value={yourName}
            onChangeText={setYourName}
          />

          {mode === 'create' ? (
            <>
              <Field
                label="Household name"
                placeholder="e.g. Piso Centro"
                value={householdName}
                onChangeText={setHouseholdName}
              />
              <Field
                label="Address"
                placeholder="e.g. Calle Mayor 3, Valencia"
                value={address}
                onChangeText={setAddress}
              />
            </>
          ) : (
            <Field
              label="Invite code"
              placeholder="e.g. H7K4Q"
              value={inviteCode}
              onChangeText={setInviteCode}
              autoCapitalize="characters"
            />
          )}

          <PhotoField name={yourName} />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {mode === 'create' ? (
          <PrimaryButton title="Continue" onPress={createHousehold} loading={loading} />
        ) : (
          <PrimaryButton title="Join household" onPress={joinHousehold} />
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
