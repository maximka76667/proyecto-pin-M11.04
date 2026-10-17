import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Eyebrow, PrimaryButton } from '@/components/onboarding';
import { Palette, Radius } from '@/constants/onboarding';
import { api, errorMessage } from '@/lib/api';

export default function HouseholdCreated() {
  const { id, name, address, inviteCode: initialInviteCode } = useLocalSearchParams<{
    id?: string;
    name?: string;
    address?: string;
    inviteCode?: string;
  }>();
  const [inviteCode, setInviteCode] = useState(initialInviteCode ?? '');
  const [loading, setLoading] = useState(false);
  const [shareNotice, setShareNotice] = useState('');

  const regenerateInvite = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const invitation = await api('POST', `/apartments/${encodeURIComponent(id)}/invitation`);
      setInviteCode(invitation.invite_code);
    } catch (e) {
      Alert.alert('Could not generate invitation', errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const inviteUrl =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? `${window.location.origin}/household?mode=join&inviteCode=${encodeURIComponent(inviteCode)}`
      : undefined;
  const balanceUrl =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? `${window.location.origin}/shared-balance?inviteCode=${encodeURIComponent(inviteCode)}`
      : undefined;
  const inviteMessage = [
    `¡Hola! Este es mi piso compartido en Room8. Únete introduciendo este código: ${inviteCode}`,
    balanceUrl ? `Consulta el balance del hogar: ${balanceUrl}` : '',
    inviteUrl ? `Únete directamente al hogar: ${inviteUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const shareInvite = () => {
    setShareNotice('');
    const sharePromise = Share.share({
      title: 'Invitación a Room8',
      message: inviteMessage,
    });

    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard
        .writeText(inviteMessage)
        .then(() => setShareNotice('Mensaje copiado. Si Teams no lo rellena, pégalo con Ctrl+V.'))
        .catch(() => setShareNotice('Puedes copiar el mensaje que aparece en pantalla.'));
    }

    void sharePromise.catch(() =>
      setShareNotice('Puedes copiar el mensaje que aparece en pantalla.'),
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.content}>
          <View style={styles.icon}>
            <MaterialCommunityIcons name="home-heart" size={40} color={Palette.onPrimary} />
          </View>
          <Eyebrow>You&apos;re all set</Eyebrow>
          <Text style={styles.title}>Your household is ready.</Text>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{name}</Text>
            <Text style={styles.cardSubtitle}>{address}</Text>
            <Text style={styles.inviteLabel}>Invite code</Text>
            <Text selectable style={styles.inviteCode}>
              {inviteCode}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <PrimaryButton title="Share invite code" onPress={shareInvite} />
          <PrimaryButton
            title="Generate a new code"
            onPress={regenerateInvite}
            loading={loading}
          />
          <PrimaryButton title="Done" onPress={() => router.replace('/')} />
        </View>
        {shareNotice ? <Text style={styles.shareNotice}>{shareNotice}</Text> : null}
      </View>
    </SafeAreaView>
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
    paddingBottom: 24,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  icon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    backgroundColor: Palette.primary,
  },
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    textAlign: 'center',
    color: Palette.text,
  },
  card: {
    width: '100%',
    marginTop: 16,
    padding: 16,
    gap: 4,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Palette.text,
  },
  cardSubtitle: {
    fontSize: 14,
    color: Palette.textSecondary,
  },
  inviteLabel: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: '700',
    color: Palette.textSecondary,
  },
  inviteCode: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1,
    color: Palette.primary,
  },
  actions: {
    gap: 12,
  },
  shareNotice: {
    marginTop: 8,
    fontSize: 13,
    textAlign: 'center',
    color: Palette.textSecondary,
  },
});
