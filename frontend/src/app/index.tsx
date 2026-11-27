import { router, useLocalSearchParams, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Eyebrow } from '@/components/onboarding';
import { Palette } from '@/constants/onboarding';
import { getCurrentUser, hasAuthToken, type CurrentUser } from '@/lib/api';

export default function Welcome() {
  const { inviteCode, verified, householdSetupFailed } = useLocalSearchParams<{
    inviteCode?: string;
    verified?: string;
    householdSetupFailed?: string;
  }>();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [checked, setChecked] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasAuthToken()) {
        router.replace('/auth' as Href);
        return;
      }
      let active = true;
      void getCurrentUser()
        .then((currentUser) => {
          if (!active) return;
          if (currentUser.user_apartments.length === 0) {
            router.replace({
              pathname: '/household',
              params: { verified, householdSetupFailed, inviteCode },
            });
            return;
          }
          setUser(currentUser);
        })
        .catch(() => {
          if (active) setUser(null);
        })
        .finally(() => {
          if (active) setChecked(true);
        });
      return () => {
        active = false;
      };
    }, [householdSetupFailed, inviteCode, verified]),
  );

  if (!checked) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={Palette.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (checked && user?.user_apartments.length) {
    return <CatHome name={user.full_name} verified={verified === '1'} />;
  }

  return null;
}

function CatHome({ name, verified }: { name: string; verified: boolean }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.homeContainer}>
        {verified ? <VerificationNotice /> : null}
        <Eyebrow>Bienvenido a casa</Eyebrow>
        <Text style={styles.homeTitle}>Hola, {name}</Text>
        <Text style={styles.cat}>🐱</Text>
        <Text style={styles.homeSubtitle}>Tu hogar compartido empieza aquí.</Text>
      </View>
    </SafeAreaView>
  );
}

function VerificationNotice() {
  return (
    <View style={styles.verificationNotice} accessibilityLiveRegion="polite">
      <Text style={styles.verificationNoticeText}>
        Email verificado correctamente. Bienvenido a Room8.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Palette.background },
  verificationNotice: {
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: Palette.mint,
  },
  verificationNoticeText: {
    color: Palette.primary,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  homeContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  homeTitle: {
    marginTop: 10,
    fontSize: 32,
    fontWeight: '800',
    color: Palette.text,
  },
  cat: {
    marginTop: 32,
    fontSize: 96,
  },
  homeSubtitle: {
    marginTop: 16,
    fontSize: 15,
    color: Palette.textSecondary,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
