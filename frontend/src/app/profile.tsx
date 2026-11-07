import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { ReactNode, useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Snackbar } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { Palette, Radius } from '@/constants/onboarding';
import { api, hasAuthToken } from '@/lib/api';
import { PASSWORD_UPDATED } from '@/lib/password-policy';
import { logout } from '@/lib/session';

const CARD = '#FFFFFF';

// Respuesta de GET /users/me
type Profile = {
  id: string;
  email: string | null;
  full_name: string;
  has_password: boolean;
  apartments: { id: string; name: string; members_count: number }[];
};

type GoogleStatus = { configured: boolean; connected: boolean };

// Avisos que llegan al volver de otra pantalla
const notices: Record<string, string> = {
  'password-updated': PASSWORD_UPDATED,
};

// "Mi cuenta" (UT1015): solo lo que ya funciona. Editar el perfil, recordatorios,
// notificaciones e invitar son de la UT1016
export default function ProfileScreen() {
  const { notice } = useLocalSearchParams<{ notice?: string }>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [error, setError] = useState('');
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [lastNotice, setLastNotice] = useState('');

  const noticeText = notice ? notices[notice] : undefined;

  useFocusEffect(
    useCallback(() => {
      // Sin sesión no se pide nada a la API: directo al login
      if (!hasAuthToken()) {
        router.replace('/auth' as Href);
        return;
      }
      let active = true;
      void Promise.all([
        api('GET', '/users/me') as Promise<Profile>,
        (api('GET', '/availability/google/status') as Promise<GoogleStatus>).catch(() => null),
      ])
        .then(([me, googleStatus]) => {
          if (!active) return;
          setProfile(me);
          setGoogle(googleStatus);
          setError('');
        })
        .catch(() => {
          if (active) setError('No se ha podido cargar tu cuenta.');
        });
      return () => {
        active = false;
      };
    }, []),
  );

  const dismissNotice = () => {
    setLastNotice(noticeText ?? '');
    router.setParams({ notice: undefined });
  };

  if (!profile) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator size="large" color={Palette.primary} />}
        </View>
      </SafeAreaView>
    );
  }

  const initial = profile.full_name.trim().charAt(0).toUpperCase() || '?';

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title} accessibilityRole="header">
          Mi cuenta
        </Text>

        <View style={[styles.card, styles.userCard]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={styles.userText}>
            <Text style={styles.userName} numberOfLines={1}>
              {profile.full_name}
            </Text>
            {profile.email ? (
              <Text style={styles.rowSubtitle} numberOfLines={1}>
                {profile.email}
              </Text>
            ) : null}
          </View>
        </View>

        <Section label="Hogar">
          {profile.apartments.length > 0 ? (
            profile.apartments.map((apartment) => (
              <Row
                key={apartment.id}
                icon="home-outline"
                tint={Palette.mint}
                title={apartment.name}
                subtitle={`${apartment.members_count} ${apartment.members_count === 1 ? 'conviviente' : 'convivientes'}`}
              />
            ))
          ) : (
            <Row
              icon="home-plus-outline"
              tint={Palette.mint}
              title="Todavía no tienes hogar"
              subtitle="Crea uno o únete con un código"
              onPress={() => router.push('/household' as Href)}
            />
          )}
        </Section>

        {profile.apartments.length > 0 && google?.configured ? (
          <Section label="Tu rutina">
            <Row
              icon="calendar-month-outline"
              tint={Palette.lavender}
              title="Google Calendar"
              subtitle={google.connected ? 'Conectado · solo libre/ocupado' : 'Sin conectar'}
              trailing={google.connected ? 'check-circle-outline' : 'chevron-right'}
              onPress={() => router.push('/availability' as Href)}
            />
          </Section>
        ) : null}

        <Section label="Cuenta">
          {profile.has_password ? (
            <Row
              icon="lock-outline"
              tint={Palette.peach}
              title="Cambiar contraseña"
              subtitle="Actualiza la contraseña con la que entras"
              onPress={() => router.push('/change-password' as Href)}
            />
          ) : (
            // Las cuentas de Google no tienen contraseña y no pueden cambiarla
            <Row
              icon="google"
              tint={Palette.segment}
              title="Inicias sesión con Google"
              subtitle="Tu cuenta no tiene contraseña en Room8"
            />
          )}
          <View style={styles.divider} />
          <Row
            icon="logout"
            tint="#FBE9E7"
            iconColor={Palette.error}
            title="Cerrar sesión"
            titleColor={Palette.error}
            trailing={null}
            onPress={() => setConfirmLogout(true)}
          />
        </Section>
      </ScrollView>

      <ConfirmDialog
        visible={confirmLogout}
        icon="logout"
        title="Cerrar sesión"
        message="¿Estás seguro de que quieres cerrar sesión?"
        confirmLabel="Cerrar sesión"
        onCancel={() => setConfirmLogout(false)}
        onConfirm={() => {
          setConfirmLogout(false);
          logout();
        }}
      />

      <Snackbar
        visible={Boolean(noticeText)}
        onDismiss={dismissNotice}
        duration={3000}
        style={styles.snackbar}>
        {noticeText ?? lastNotice}
      </Snackbar>
    </SafeAreaView>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({
  icon,
  tint,
  iconColor = Palette.text,
  title,
  titleColor = Palette.text,
  subtitle,
  trailing = 'chevron-right',
  onPress,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  tint: string;
  iconColor?: string;
  title: string;
  titleColor?: string;
  subtitle?: string;
  trailing?: keyof typeof MaterialCommunityIcons.glyphMap | null;
  onPress?: () => void;
}) {
  const content = (
    <>
      <View style={[styles.iconTile, { backgroundColor: tint }]}>
        <MaterialCommunityIcons name={icon} size={20} color={iconColor} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: titleColor }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {onPress && trailing ? (
        <MaterialCommunityIcons name={trailing} size={22} color={Palette.textSecondary} />
      ) : null}
    </>
  );

  if (!onPress) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Palette.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  container: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 20,
  },
  title: { fontSize: 32, lineHeight: 38, fontWeight: '800', color: Palette.text },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: CARD,
    overflow: 'hidden',
  },
  userCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: Radius.input,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.peach,
  },
  avatarText: { fontSize: 22, fontWeight: '700', color: Palette.text },
  userText: { flex: 1, gap: 2 },
  userName: { fontSize: 18, fontWeight: '800', color: Palette.text },
  section: { gap: 8 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: Palette.textSecondary,
    paddingHorizontal: 4,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
  iconTile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: '700' },
  rowSubtitle: { fontSize: 13, color: Palette.textSecondary },
  divider: { height: 1, marginLeft: 70, backgroundColor: Palette.border },
  pressed: { opacity: 0.6 },
  error: { fontSize: 15, color: Palette.error, textAlign: 'center' },
  snackbar: { backgroundColor: Palette.primary },
});
