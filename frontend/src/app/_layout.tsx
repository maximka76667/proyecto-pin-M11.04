import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';
import { ActivityIndicator, StyleSheet, useColorScheme, View } from 'react-native';
import { useEffect, useState } from 'react';
import { router, usePathname, type Href } from 'expo-router';
import { MD3DarkTheme, MD3LightTheme, PaperProvider } from 'react-native-paper';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { BottomNav } from '@/components/bottom-nav';
import { getCurrentUser, hasAuthToken } from '@/lib/api';
import { Palette } from '@/constants/onboarding';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const pathname = usePathname();
  const [routeChecked, setRouteChecked] = useState(false);

  useEffect(() => {
    let active = true;
    const publicPaths = ['/auth', '/', '/household', '/household-created'];

    if (!hasAuthToken()) {
      if (pathname !== '/auth') {
        router.replace('/auth' as Href);
      } else if (active) {
        setRouteChecked(true);
      }
      return () => { active = false; };
    }

    void getCurrentUser()
      .then((user) => {
        if (!active) return;
        const hasHousehold = user.user_apartments.length > 0;
        if (!hasHousehold && !publicPaths.includes(pathname)) {
          router.replace('/' as Href);
          return;
        }
        setRouteChecked(true);
      })
      .catch(() => {
        if (!active) return;
        if (pathname !== '/auth') {
          router.replace('/auth' as Href);
        } else {
          setRouteChecked(true);
        }
      });

    return () => { active = false; };
  }, [pathname]);

  return (
    <PaperProvider theme={colorScheme === 'dark' ? MD3DarkTheme : MD3LightTheme}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        {/* La barra va debajo del Stack y solo se pinta en las páginas a las que lleva */}
        <View style={styles.app}>
          {routeChecked ? <Stack screenOptions={{ headerShown: false }} /> : <RouteLoading />}
          {routeChecked ? <BottomNav /> : null}
        </View>
      </ThemeProvider>
    </PaperProvider>
  );
}

function RouteLoading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={Palette.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1 },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.background,
  },
});
