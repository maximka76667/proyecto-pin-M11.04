import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, usePathname, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Palette } from '@/constants/onboarding';
import { getCurrentUser, hasAuthToken } from '@/lib/api';
import { fetchUnreadCount } from '@/lib/notifications';

type Tab = {
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  href: Extract<Href, string>;
};

// Página a la que lleva cada botón: para cambiar un destino basta con cambiar su href.
// La barra solo aparece en estas páginas, así que se mueve sola con el destino.
const tabs: Tab[] = [
  { label: 'Inicio', icon: 'home-outline', href: '/' },
  { label: 'Tareas', icon: 'checkbox-marked-outline', href: '/chores' },
  { label: 'Calendario', icon: 'calendar-month-outline', href: '/availability' },
  { label: 'Dinero', icon: 'credit-card-outline', href: '/transactions' },
  { label: 'Tú', icon: 'account-outline', href: '/profile' },
];

export function BottomNav() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [hasHousehold, setHasHousehold] = useState(false);
  // Avisos de tareas sin leer: pintan un punto en la pestaña «Tú», desde donde se abren (UT1019)
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let active = true;
    if (!hasAuthToken()) {
      Promise.resolve().then(() => {
        if (active) setHasHousehold(false);
      });
      return () => {
        active = false;
      };
    }
    void getCurrentUser()
      .then((user) => {
        if (!active) return;
        setHasHousehold(user.user_apartments.length > 0);

        // Solo en las páginas que enseñan la barra. Va aparte de la cadena de arriba: si el
        // contador falla, la barra sale igual, sin el punto
        const apartmentId = user.user_apartments[0]?.apartment_id;
        if (!apartmentId || !tabs.some(({ href }) => href === pathname)) return;
        void fetchUnreadCount(apartmentId)
          .then((count) => {
            if (active) setUnread(count);
          })
          .catch(() => undefined);
      })
      .catch(() => {
        if (active) setHasHousehold(false);
      });
    return () => { active = false; };
  }, [pathname]);

  if (!hasHousehold || !tabs.some(({ href }) => href === pathname)) return null;

  return (
    <View
      accessibilityRole="tablist"
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={styles.tabs}>
        {tabs.map((tab) => {
          const active = tab.href === pathname;
          const color = active ? Palette.primary : Palette.textSecondary;
          const hasUnread = tab.href === '/profile' && unread > 0;

          return (
            <Pressable
              key={tab.label}
              accessibilityRole="tab"
              accessibilityLabel={hasUnread ? `${tab.label}, tienes avisos sin leer` : undefined}
              aria-selected={active}
              // cambiar de pestaña no apila historial
              onPress={() => {
                if (!active) router.replace(tab.href);
              }}
              style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
              <View>
                <MaterialCommunityIcons name={tab.icon} size={26} color={color} />
                {hasUnread ? <View style={styles.unreadDot} /> : null}
              </View>
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
  // El borde del color de la barra separa el punto del icono
  unreadDot: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Palette.surface,
    backgroundColor: Palette.error,
  },
  pressed: { opacity: 0.6 },
});
