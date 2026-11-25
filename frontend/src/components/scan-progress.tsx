import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, StyleSheet, Text, View } from 'react-native';

import { Palette } from '@/constants/onboarding';

// Which reader the app is waiting for. 'fallback' is shown after Gemini has failed
export type ScanStep = 'gemini' | 'fallback';

const MESSAGES: Record<ScanStep, string> = {
  gemini: 'Leyendo el ticket con Gemini…',
  fallback: 'Gemini no responde. Probando con un lector de respaldo…',
};

// After this long on the same step, tell the user it is slower than usual but still working
const SLOW_AFTER_MS = 10_000;

// Widths of the name bars, so the placeholder rows don't all look the same
const NAME_WIDTHS = ['62%', '78%', '50%', '70%', '58%'] as const;

// Placeholder product rows (same shape as the rows of the review screen) while the ticket is
// being read, with the real step on top. Use key={step} so the "slow" timer restarts per step
export function ScanProgress({ step }: { step: ScanStep }) {
  const [slow, setSlow] = useState(false);
  const opacity = usePulse();

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={MESSAGES[step]}
      accessibilityLiveRegion="polite"
      style={styles.container}>
      <Text style={styles.message}>{MESSAGES[step]}</Text>
      {slow ? (
        <Text style={styles.slow}>Está tardando más de lo normal, pero sigue en marcha.</Text>
      ) : null}
      <Animated.View style={[styles.rows, { opacity }]}>
        {NAME_WIDTHS.map((width, index) => (
          <View key={index} style={styles.card}>
            <View style={[styles.block, styles.quantity]} />
            <View style={[styles.block, styles.name, { width }]} />
            <View style={[styles.block, styles.price]} />
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

// Soft fade in and out. Stays still when the system asks for reduced motion
function usePulse() {
  const opacity = useState(() => new Animated.Value(0.45))[0];

  useEffect(() => {
    let cancelled = false;
    let pulse: Animated.CompositeAnimation | undefined;
    AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (cancelled || reduceMotion) return;
      // The native driver does not exist on web
      const useNativeDriver = Platform.OS !== 'web';
      pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver }),
          Animated.timing(opacity, { toValue: 0.45, duration: 700, useNativeDriver }),
        ]),
      );
      pulse.start();
    });
    return () => {
      cancelled = true;
      pulse?.stop();
    };
  }, [opacity]);

  return opacity;
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  message: { fontSize: 14, fontWeight: '700', color: Palette.text, textAlign: 'center' },
  slow: { fontSize: 12, color: Palette.textSecondary, textAlign: 'center' },
  rows: { gap: 8, marginTop: 4 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 13,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 14,
    backgroundColor: Palette.surface,
  },
  block: { backgroundColor: Palette.border },
  quantity: { width: 32, height: 26, borderRadius: 8 },
  name: { height: 14, borderRadius: 6 },
  price: { width: 48, height: 14, borderRadius: 6, marginLeft: 'auto' },
});
