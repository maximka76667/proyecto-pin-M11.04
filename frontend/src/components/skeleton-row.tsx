import { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';

import { Palette } from '@/constants/onboarding';

// Marcador de una fila (icono y dos líneas de texto) mientras carga. Tiene el mismo tamaño que las
// filas de las tarjetas de ajustes, para que no se mueva nada cuando llegan los datos
export function SkeletonRow({ label = 'Cargando' }: { label?: string }) {
  const opacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    // El driver nativo no existe en web
    const useNativeDriver = Platform.OS !== 'web';
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver }),
        Animated.timing(opacity, { toValue: 0.45, duration: 700, useNativeDriver }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [opacity]);

  return (
    <Animated.View
      accessibilityLabel={label}
      accessibilityRole="progressbar"
      style={[styles.row, { opacity }]}>
      <View style={[styles.block, styles.icon]} />
      <View style={styles.text}>
        <View style={[styles.block, styles.title]} />
        <View style={[styles.block, styles.subtitle]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  block: { backgroundColor: Palette.border },
  icon: { width: 40, height: 40, borderRadius: 12 },
  text: { flex: 1, gap: 2 },
  title: { width: '55%', height: 15, borderRadius: 6 },
  subtitle: { width: '80%', height: 13, borderRadius: 6, marginTop: 4 },
});
