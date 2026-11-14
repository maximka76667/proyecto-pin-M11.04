import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';
import { ActivityIndicator, StyleSheet, useColorScheme, View } from 'react-native';
import { useEffect, useState } from 'react';
import { router, usePathname, type Href } from 'expo-router';
import { MD3DarkTheme, MD3LightTheme, PaperProvider } from 'react-native-paper';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { BottomNav } from '@/components/bottom-nav';
import { ApiError, getCurrentUser, hasAuthToken, loadAuthToken } from '@/lib/api';
import { Palette } from '@/constants/onboarding';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const pathname = usePathname();
  const [routeChecked, setRouteChecked] = useState(false);
  const [tokenLoaded, setTokenLoaded] = useState(false);

  // En el móvil el token se lee de SecureStore, que es asíncrono: hasta entonces no se sabe si hay sesión
  useEffect(() => {
    void loadAuthToken().then(() => setTokenLoaded(true));
  }, []);

  useEffect(() => {
    if (!tokenLoaded) return;
    let active = true;
    // Sin sesión solo se puede estar en el login o recuperando la contraseña
    const signedOutPaths = ['/auth', '/forgot-password'];
    // Con sesión pero sin hogar. Mi cuenta y cambiar la contraseña también, para poder cerrar sesión
    const publicPaths = [
      '/auth',
      '/',
      '/household',
      '/household-created',
      '/profile',
      '/change-password',
    ];

    if (!hasAuthToken()) {
      if (!signedOutPaths.includes(pathname)) {
        router.replace('/auth' as Href);
      } else {
        // Diferido para no actualizar el estado dentro del propio efecto
        void Promise.resolve().then(() => {
          if (active) setRouteChecked(true);
        });
      }
      return () => {
        active = false;
      };
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
      .catch((error: unknown) => {
        if (!active) return;
        // Un 401 ya lo gestiona api(): borra la sesión y lleva al login con el aviso de caducada.
        // Otro error (sin conexión, servidor caído) no cierra la sesión: la pantalla mostrará el suyo
        if (error instanceof ApiError && error.status === 401) return;
        setRouteChecked(true);
      });

    return () => {
      active = false;
    };
  }, [pathname, tokenLoaded]);

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
