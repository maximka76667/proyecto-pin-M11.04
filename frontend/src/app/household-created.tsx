import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Eyebrow, PrimaryButton } from '@/components/onboarding';
import { Palette, Radius } from '@/constants/onboarding';

export default function HouseholdCreated() {
  const { name, address } = useLocalSearchParams<{ name?: string; address?: string }>();

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
          </View>
        </View>

        <PrimaryButton title="Done" onPress={() => router.replace('/')} />
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
});
