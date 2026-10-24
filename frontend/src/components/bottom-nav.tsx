import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, usePathname, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Palette } from '@/constants/onboarding';

type Tab = {
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  href: Extract<Href, string>;
};

// Página a la que lleva cada botón: para cambiar un destino basta con cambiar su href.
// La barra solo aparece en estas páginas, así que se mueve sola con el destino.
const tabs: Tab[] = [
  { label: 'Home', icon: 'home-outline', href: '/' },
  { label: 'Chores', icon: 'checkbox-marked-outline', href: '/chores' },
  { label: 'Money', icon: 'credit-card-outline', href: '/transactions' },
  { label: 'You', icon: 'account-outline', href: '/household' },
];

export function BottomNav() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  if (!tabs.some(({ href }) => href === pathname)) return null;

  return (
    <View
      accessibilityRole="tablist"
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={styles.tabs}>
        {tabs.map((tab) => {
          const active = tab.href === pathname;
          const color = active ? Palette.primary : Palette.textSecondary;

          return (
            <Pressable
              key={tab.label}
              accessibilityRole="tab"
              aria-selected={active}
              // cambiar de pestaña no apila historial
              onPress={() => {
                if (!active) router.replace(tab.href);
              }}
              style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
              <MaterialCommunityIcons name={tab.icon} size={26} color={color} />
              <Text style={[styles.label, { color }]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  tabs: {
    flexDirection: 'row',
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  tab: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 2 },
  label: { fontSize: 12, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
