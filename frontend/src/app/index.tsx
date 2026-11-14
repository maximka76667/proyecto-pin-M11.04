import { router, useLocalSearchParams, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Eyebrow, PrimaryButton } from '@/components/onboarding';
import { Palette } from '@/constants/onboarding';
import { getCurrentUser, hasAuthToken, type CurrentUser } from '@/lib/api';

export default function Welcome() {
  const { inviteCode, verified } = useLocalSearchParams<{
    inviteCode?: string;
    verified?: string;
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
          if (active) setUser(currentUser);
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
    }, []),
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

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {verified === '1' ? <VerificationNotice /> : null}
        <View style={styles.topBar}>
          <View style={styles.brand}>
            <View style={styles.logo}>
              <Text style={styles.logoText}>8</Text>
            </View>
            <Text style={styles.brandText}>room8</Text>
          </View>
          <Text style={styles.step}>1 de 3</Text>
        </View>

        <HouseIllustration />

        <View style={styles.copy}>
          <Eyebrow>Bienvenido a casa</Eyebrow>
          <Text style={styles.title}>Un hogar más feliz empieza juntos.</Text>
          <Text style={styles.subtitle}>
            Room8 hace que las tareas y los gastos compartidos sean más justos, sencillos y humanos.
          </Text>
        </View>

        <View style={styles.actions}>
          <PrimaryButton title="Crear un hogar" onPress={() => router.push('/household')} />
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/household',
                params: { mode: 'join', inviteCode },
              })
            }>
            <Text style={styles.link}>Unirme con un código de invitación</Text>
          </Pressable>
          <Text style={styles.footer}>Hecho para las personas con las que vives.</Text>
        </View>
      </View>
    </SafeAreaView>
  );
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

function HouseIllustration() {
  return (
    <View style={styles.illustration}>
      <View style={styles.circle} />
      <View style={styles.sun} />
      <View style={styles.house}>
        <View style={styles.roof} />
        <View style={styles.houseBody}>
          <View style={styles.windows}>
            <View style={[styles.window, { backgroundColor: Palette.sun }]} />
            <View style={[styles.window, { backgroundColor: Palette.peach }]} />
          </View>
          <View style={styles.door} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  container: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
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
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logo: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.peach,
  },
  logoText: {
    fontSize: 16,
    fontWeight: '800',
    color: Palette.text,
  },
  brandText: {
    fontSize: 18,
    fontWeight: '800',
    color: Palette.text,
  },
  step: {
    fontSize: 12,
    color: Palette.textSecondary,
  },
  illustration: {
    flex: 1,
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: Palette.mint,
  },
  sun: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Palette.sun,
    top: '50%',
    marginTop: -110,
    marginLeft: 150,
  },
  house: {
    alignItems: 'center',
    marginTop: 40,
  },
  roof: {
    width: 0,
    height: 0,
    borderLeftWidth: 75,
    borderRightWidth: 75,
    borderBottomWidth: 55,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: Palette.primary,
  },
  houseBody: {
    width: 120,
    height: 80,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 0,
    backgroundColor: Palette.primary,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
  },
  windows: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 26,
  },
  window: {
    width: 18,
    height: 18,
    borderRadius: 4,
  },
  door: {
    width: 22,
    height: 36,
    borderTopLeftRadius: 11,
    borderTopRightRadius: 11,
    backgroundColor: Palette.surface,
  },
  copy: {
    alignItems: 'center',
    gap: 12,
    marginBottom: 32,
  },
  title: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '800',
    textAlign: 'center',
    color: Palette.text,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    color: Palette.textSecondary,
  },
  actions: {
    gap: 16,
  },
  link: {
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    color: Palette.primary,
  },
  footer: {
    fontSize: 12,
    textAlign: 'center',
    color: Palette.textSecondary,
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
