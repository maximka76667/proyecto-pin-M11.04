import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ScanProgress, ScanStep } from '@/components/scan-progress';
import { Palette } from '@/constants/onboarding';
import { ApiError, apiUpload, ConnectionError, ScannedTicket } from '@/lib/api';

type Source = 'camera' | 'library';

export const SCANNER_UNAVAILABLE =
  'No hemos podido leer el ticket ahora mismo. Añade los productos a mano.';

// Sends a receipt photo to POST /scanner/ticket. With a provider only that reader is used;
// without one the backend tries Gemini and then the backup by itself
export function scanTicket(
  asset: ImagePicker.ImagePickerAsset,
  provider?: 'gemini' | 'openrouter',
): Promise<ScannedTicket> {
  const query = provider ? `?provider=${provider}` : '';
  return apiUpload(`/scanner/ticket${query}`, 'image', {
    uri: asset.uri,
    name: asset.fileName ?? 'ticket.jpg',
    type: asset.mimeType ?? 'image/jpeg',
    file: asset.file,
  });
}

// The backup only makes sense when the reader is down or overloaded. A 400 means the photo is
// not a readable ticket, and another reader would say the same
function canTryBackup(error: unknown) {
  if (error instanceof ConnectionError) return true;
  return error instanceof ApiError && (error.status === 429 || error.status >= 500);
}

// Reads the ticket with Gemini and, if that fails, with the backup reader. The app runs both
// attempts itself (one request each) so onStep can tell the user what is really happening
export async function scanTicketWithFallback(
  asset: ImagePicker.ImagePickerAsset,
  onStep: (step: ScanStep) => void,
): Promise<ScannedTicket> {
  onStep('gemini');
  try {
    return await scanTicket(asset, 'gemini');
  } catch (error) {
    if (!canTryBackup(error)) throw error;
  }

  onStep('fallback');
  try {
    return await scanTicket(asset, 'openrouter');
  } catch (error) {
    // The backup did read the photo but found no ticket: that message is more useful
    if (error instanceof ApiError && error.status === 400) throw error;
    throw new Error(SCANNER_UNAVAILABLE);
  }
}

// Camera / gallery buttons that read a receipt. Used by the review screen and by /dev.
// compact: one small row, for scanning again from the product list
export function TicketScanner({
  onScanned,
  onError,
  compact = false,
}: {
  onScanned: (ticket: ScannedTicket, image: ImagePicker.ImagePickerAsset) => void;
  onError: (e: unknown) => void;
  compact?: boolean;
}) {
  // null = not scanning; otherwise which reader the app is waiting for
  const [step, setStep] = useState<ScanStep | null>(null);

  const pick = async (source: Source) => {
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          onError(new Error('Necesitamos permiso para usar la cámara.'));
          return;
        }
      }
      // quality < 1 makes native photos smaller, the backend accepts up to 8 MB
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: 'images', quality: 0.8 };
      const picked =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);
      const asset = picked.assets?.[0];
      if (picked.canceled || !asset) return;

      onScanned(await scanTicketWithFallback(asset, setStep), asset);
    } catch (e) {
      onError(e);
    } finally {
      setStep(null);
    }
  };

  if (step) return <ScanProgress key={step} step={step} />;

  if (compact) {
    return (
      <View style={styles.compactRow}>
        <Text style={styles.compactLabel}>Volver a escanear</Text>
        <Pressable onPress={() => pick('camera')} hitSlop={8} style={styles.compactButton}>
          <MaterialCommunityIcons name="camera-outline" size={18} color={Palette.primary} />
          <Text style={styles.compactButtonText}>Foto</Text>
        </Pressable>
        <Pressable onPress={() => pick('library')} hitSlop={8} style={styles.compactButton}>
          <MaterialCommunityIcons name="image-outline" size={18} color={Palette.primary} />
          <Text style={styles.compactButtonText}>Galería</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.buttons}>
      <Pressable onPress={() => pick('camera')} style={styles.primaryButton}>
        <MaterialCommunityIcons name="camera-outline" size={20} color={Palette.onPrimary} />
        <Text style={styles.primaryButtonText}>Hacer foto</Text>
      </Pressable>
      <Pressable onPress={() => pick('library')} style={styles.secondaryButton}>
        <MaterialCommunityIcons name="image-outline" size={20} color={Palette.primary} />
        <Text style={styles.secondaryButtonText}>Elegir de la galería</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  buttons: { gap: 10 },
  primaryButton: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 16,
    backgroundColor: Palette.primary,
  },
  primaryButtonText: { fontSize: 15, fontWeight: '800', color: Palette.onPrimary },
  secondaryButton: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: Palette.primary,
    borderRadius: 16,
  },
  secondaryButtonText: { fontSize: 15, fontWeight: '800', color: Palette.primary },
  compactRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 14 },
  compactLabel: { flex: 1, fontSize: 12, color: Palette.textSecondary },
  compactButton: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  compactButtonText: { fontSize: 13, fontWeight: '800', color: Palette.primary },
});
