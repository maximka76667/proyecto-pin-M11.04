import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Palette } from '@/constants/onboarding';
import { apiUpload, ScannedTicket } from '@/lib/api';

type Source = 'camera' | 'library';

// Sends a receipt photo to POST /scanner/ticket
export function scanTicket(asset: ImagePicker.ImagePickerAsset): Promise<ScannedTicket> {
  return apiUpload('/scanner/ticket', 'image', {
    uri: asset.uri,
    name: asset.fileName ?? 'ticket.jpg',
    type: asset.mimeType ?? 'image/jpeg',
    file: asset.file,
  });
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
  const [scanning, setScanning] = useState(false);

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

      setScanning(true);
      onScanned(await scanTicket(asset), asset);
    } catch (e) {
      onError(e);
    } finally {
      setScanning(false);
    }
  };

  if (scanning) {
    return (
      <View style={styles.scanning}>
        <ActivityIndicator color={Palette.primary} />
        <Text style={styles.scanningText}>Leyendo el ticket…</Text>
      </View>
    );
  }

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
  primaryButton: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 16, backgroundColor: Palette.primary },
  primaryButtonText: { fontSize: 15, fontWeight: '800', color: Palette.onPrimary },
  secondaryButton: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderWidth: 1, borderColor: Palette.primary, borderRadius: 16 },
  secondaryButtonText: { fontSize: 15, fontWeight: '800', color: Palette.primary },
  scanning: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 18 },
  scanningText: { fontSize: 14, fontWeight: '700', color: Palette.textSecondary },
  compactRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 14 },
  compactLabel: { flex: 1, fontSize: 12, color: Palette.textSecondary },
  compactButton: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  compactButtonText: { fontSize: 13, fontWeight: '800', color: Palette.primary },
});
