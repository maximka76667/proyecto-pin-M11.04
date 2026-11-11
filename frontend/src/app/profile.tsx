import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { ReactNode, useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Snackbar } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { Palette, Radius } from '@/constants/onboarding';
import { ApiError, api, apiUpload, hasAuthToken } from '@/lib/api';
import { PASSWORD_UPDATED } from '@/lib/password-policy';
import { logout } from '@/lib/session';

const CARD = '#FFFFFF';
const CHORE_REMINDERS_KEY = 'room8_chore_reminders';

// Respuesta de GET /users/me
type Profile = {
  id: string;
  email: string | null;
  full_name: string;
  avatar_url?: string | null;
  has_password: boolean;
  apartments: {
    id: string;
    name: string;
    invite_code?: string;
    members_count: number;
    joined_at?: string;
  }[];
};

type GoogleStatus = { configured: boolean; connected: boolean };

// Avisos que llegan al volver de otra pantalla
const notices: Record<string, string> = {
  'password-updated': PASSWORD_UPDATED,
};

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function formatJoinedDate(joinedAt?: string) {
  if (!joinedAt) return 'desde sep 2025';
  const d = new Date(joinedAt);
  if (isNaN(d.getTime())) return 'desde sep 2025';
  return `desde ${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

export default function ProfileScreen() {
  const { notice } = useLocalSearchParams<{ notice?: string }>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [error, setError] = useState('');
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [lastNotice, setLastNotice] = useState('');

  // Preferencia local de recordatorios (preparada para UT1020 con persistencia local)
  const [choreReminders, setChoreReminders] = useState(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        const saved = window.localStorage.getItem(CHORE_REMINDERS_KEY);
        if (saved !== null) return saved === 'true';
      } catch {
        // ignore storage errors
      }
    }
    return true;
  });

  const handleToggleReminders = (val: boolean) => {
    setChoreReminders(val);
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(CHORE_REMINDERS_KEY, String(val));
      } catch {
        // ignore storage errors
      }
    }
  };

  // Modal para editar nombre y foto (UT1016)
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [successNotice, setSuccessNotice] = useState('');

  const noticeText = notice ? notices[notice] : undefined;

  const loadProfile = useCallback(() => {
    // Sin sesión no se pide nada a la API: directo al login
    if (!hasAuthToken()) {
      router.replace('/auth' as Href);
      return;
    }
    let active = true;
    setError('');
    void Promise.all([
      api('GET', '/users/me') as Promise<Profile>,
      (api('GET', '/availability/google/status') as Promise<GoogleStatus>).catch(() => null),
    ])
      .then(([me, googleStatus]) => {
        if (!active) return;
        setProfile(me);
        setNewName(me.full_name);
        setGoogle(googleStatus);
        setError('');
      })
      .catch(() => {
        if (active) setError('No se ha podido conectar. Inténtalo de nuevo');
      });
    return () => {
      active = false;
    };
  }, []);

  useFocusEffect(loadProfile);

  const dismissNotice = () => {
    setLastNotice(noticeText ?? '');
    setSuccessNotice('');
    router.setParams({ notice: undefined });
  };

  const handlePickPhoto = async () => {
    try {
      setEditError('');
      // PA 1: Deniega el acceso a la galería -> "Necesitamos acceso a tu galería para cambiar la foto"
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setEditError('Necesitamos acceso a tu galería para cambiar la foto');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];

      // PA 1: Imagen demasiado grande -> "La imagen no puede superar los 5 MB"
      let size = asset.fileSize ?? asset.file?.size;
      if (!size && asset.uri) {
        try {
          const res = await fetch(asset.uri);
          const blob = await res.blob();
          size = blob.size;
        } catch {
          // ignore
        }
      }

      if (size && size > 5 * 1024 * 1024) {
        setEditError('La imagen no puede superar los 5 MB');
        return;
      }

      setSelectedPhoto(asset);
      setRemovePhoto(false);
    } catch {
      setEditError('No se ha podido acceder a la galería');
    }
  };

  const handleRemovePhoto = () => {
    setSelectedPhoto(null);
    setRemovePhoto(true);
    setEditError('');
  };

  const handleSaveProfile = async () => {
    if (!profile) return;
    const trimmed = newName.trim();
    if (!trimmed) {
      setEditError('El nombre no puede estar vacío');
      return;
    }
    if (trimmed.length > 50) {
      setEditError('El nombre no puede superar los 50 caracteres');
      return;
    }

    setSaving(true);
    setEditError('');
    try {
      let updatedProfile: Profile | null = null;

      // 1. Si el usuario decidió quitar la foto
      if (removePhoto && !selectedPhoto) {
        updatedProfile = (await api('DELETE', '/users/me/avatar')) as Profile;
      } else if (selectedPhoto) {
        // 2. Si se eligió una foto nueva, subirla
        updatedProfile = (await apiUpload(
          '/users/me/avatar',
          'image',
          {
            uri: selectedPhoto.uri,
            name: selectedPhoto.fileName ?? 'avatar.jpg',
            type: selectedPhoto.mimeType ?? 'image/jpeg',
            file: selectedPhoto.file,
          },
          // Máximo 5 MB: si en 20 s no ha terminado, se avisa y se puede volver a intentar
          20_000,
        )) as Profile;
      }

      // 3. Guardar el nombre actualizado si cambió o si no tenemos perfil actualizado
      if (trimmed !== profile.full_name || !updatedProfile) {
        updatedProfile = (await api('PATCH', '/users/me', {
          full_name: trimmed,
        })) as Profile;
      }

      if (updatedProfile) {
        setProfile(updatedProfile);
      }
      setSelectedPhoto(null);
      setRemovePhoto(false);
      setEditModalVisible(false);
      setSuccessNotice('Perfil actualizado correctamente');
    } catch (e) {
      // Un 400 es el backend rechazando lo enviado (nombre o imagen no válidos): se muestra
      // su mensaje. Cualquier otro fallo (sin conexión, servidor caído) es «no se han podido
      // guardar», y el nombre escrito se mantiene para volver a intentarlo (PA-1016.04)
      if (e instanceof ApiError && e.status === 400) {
        setEditError(e.message);
      } else {
        setEditError('No se han podido guardar los cambios');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleInvite = async (apartmentName: string, inviteCode?: string) => {
    if (!inviteCode) {
      setSuccessNotice('No se ha encontrado el código de invitación.');
      return;
    }

    const message = `¡Únete a ${apartmentName} en Room8! Usa el código de invitación: ${inviteCode}`;

    if (Platform.OS === 'web') {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(inviteCode);
        }
      } catch {
        // Fallback en caso de que clipboard falle
      }
      setSuccessNotice(`¡Código copiado al portapapeles! (${inviteCode})`);
      return;
    }

    try {
      await Share.share({
        message,
        title: `Invitar a ${apartmentName}`,
      });
      setSuccessNotice('Invitación compartida');
    } catch {
      setSuccessNotice(`Código de invitación: ${inviteCode}`);
    }
  };

  if (!profile) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          {error ? (
            <View style={styles.errorContainer}>
              <Text style={styles.error}>{error}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={loadProfile}
                style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
                <Text style={styles.retryButtonText}>Reintentar</Text>
              </Pressable>
            </View>
          ) : (
            <ActivityIndicator size="large" color={Palette.primary} />
          )}
        </View>
      </SafeAreaView>
    );
  }

  const initial = profile.full_name.trim().charAt(0).toUpperCase() || '?';
  const primaryApartment = profile.apartments[0];

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title} accessibilityRole="header">
          Mi cuenta
        </Text>

        {/* Tarjeta de usuario con botón de editar nombre y foto */}
        <View style={[styles.card, styles.userCard]}>
          <View style={styles.avatar}>
            {profile.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarText}>{initial}</Text>
            )}
          </View>
          <View style={styles.userText}>
            <Text style={styles.userName} numberOfLines={1}>
              {profile.full_name}
            </Text>
            <Text style={styles.userSubtitle} numberOfLines={1}>
              {primaryApartment
                ? `${primaryApartment.name} · ${formatJoinedDate(primaryApartment.joined_at)}`
                : 'Sin hogar'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Editar perfil"
            onPress={() => {
              setNewName(profile.full_name);
              setSelectedPhoto(null);
              setRemovePhoto(false);
              setEditError('');
              setEditModalVisible(true);
            }}
            style={({ pressed }) => [styles.editIconBtn, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="pencil-outline" size={20} color={Palette.textSecondary} />
          </Pressable>
        </View>

        {/* Sección HOGAR */}
        <Section label="Hogar">
          {profile.apartments.length > 0 ? (
            profile.apartments.map((apartment) => (
              <Row
                key={apartment.id}
                icon="home-outline"
                tint={Palette.mint}
                title={apartment.name}
                subtitle={`${apartment.members_count} ${
                  apartment.members_count === 1 ? 'compañero' : 'compañeros'
                }`}
              />
            ))
          ) : (
            <Row
              icon="home-plus-outline"
              tint={Palette.mint}
              title="Todavía no tienes hogar"
              subtitle="Crea uno o únete con un código"
              onPress={() => router.push('/household' as Href)}
            />
          )}
        </Section>

        {/* Botón de invitar a conviviente (UT1016) */}
        {primaryApartment?.invite_code ? (
          <Pressable
            style={({ pressed }) => [styles.inviteButton, pressed && styles.pressed]}
            onPress={() => handleInvite(primaryApartment.name, primaryApartment.invite_code)}>
            <MaterialCommunityIcons name="account-plus-outline" size={20} color={Palette.primary} />
            <Text style={styles.inviteButtonText}>
              Invitar a alguien a {primaryApartment.name}
            </Text>
          </Pressable>
        ) : null}

        {/* Sección TU RUTINA (Google Calendar + Chore reminders - UT1020) */}
        <Section label="Tu rutina">
          {google?.configured ? (
            <Row
              icon="calendar-month-outline"
              tint={Palette.lavender}
              title="Google Calendar"
              subtitle={google.connected ? 'Conectado · solo libre/ocupado' : 'Sin conectar'}
              trailing={google.connected ? 'check-circle-outline' : 'chevron-right'}
              onPress={() => router.push('/availability' as Href)}
            />
          ) : (
            <Row
              icon="calendar-month-outline"
              tint={Palette.lavender}
              title="Google Calendar"
              subtitle="Toca para gestionar disponibilidad"
              trailing="chevron-right"
              onPress={() => router.push('/availability' as Href)}
            />
          )}

          <View style={styles.divider} />

          {/* Recordatorios de tareas (UT1020) */}
          <View style={styles.row}>
            <View style={[styles.iconTile, { backgroundColor: '#FDF1DB' }]}>
              <MaterialCommunityIcons name="bell-outline" size={20} color="#D97706" />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Recordatorios de tareas</Text>
              <Text style={styles.rowSubtitle}>{"Avisos antes de que venza una tarea"}</Text>
            </View>
            <Switch
              value={choreReminders}
              onValueChange={handleToggleReminders}
              trackColor={{ false: '#D1D5DB', true: Palette.primary }}
              thumbColor={Palette.surface}
            />
          </View>
        </Section>

        {/* Sección CUENTA (Cambio de contraseña + Logout - UT1015) */}
        <Section label="Cuenta">
          {profile.has_password ? (
            <Row
              icon="lock-outline"
              tint={Palette.peach}
              title="Cambiar contraseña"
              subtitle="Actualiza la contraseña con la que entras"
              onPress={() => router.push('/change-password' as Href)}
            />
          ) : (
            <Row
              icon="google"
              tint={Palette.segment}
              title="Inicias sesión con Google"
              subtitle="Tu cuenta no tiene contraseña en Room8"
            />
          )}
          <View style={styles.divider} />
          <Row
            icon="logout"
            tint="#FBE9E7"
            iconColor={Palette.error}
            title="Cerrar sesión"
            titleColor={Palette.error}
            trailing={null}
            onPress={() => setConfirmLogout(true)}
          />
        </Section>
      </ScrollView>

      {/* Modal para editar perfil (UT1016: Foto y Nombre) */}
      <Modal
        visible={editModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setSelectedPhoto(null);
          setRemovePhoto(false);
          setEditModalVisible(false);
        }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Editar perfil</Text>

            {/* Vista previa de foto / inicial */}
            <View style={styles.modalAvatarContainer}>
              <View style={[styles.avatar, styles.modalAvatar]}>
                {selectedPhoto ? (
                  <Image source={{ uri: selectedPhoto.uri }} style={styles.avatarImage} />
                ) : !removePhoto && profile.avatar_url ? (
                  <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} />
                ) : (
                  <Text style={styles.avatarText}>{initial}</Text>
                )}
              </View>

              <View style={styles.photoActionsRow}>
                {/* Botón "Añadir una foto" / "Cambiar foto" (PA 1 & PA 2) */}
                <Pressable
                  accessibilityRole="button"
                  onPress={handlePickPhoto}
                  style={({ pressed }) => [styles.photoPickerBtn, pressed && styles.pressed]}>
                  <MaterialCommunityIcons name="camera-outline" size={18} color={Palette.primary} />
                  <Text style={styles.photoPickerText}>
                    {selectedPhoto || (!removePhoto && profile.avatar_url)
                      ? 'Cambiar foto'
                      : 'Añadir una foto'}
                  </Text>
                </Pressable>

                {/* Botón "Eliminar foto" */}
                {selectedPhoto || (!removePhoto && profile.avatar_url) ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={handleRemovePhoto}
                    style={({ pressed }) => [styles.photoDeleteBtn, pressed && styles.pressed]}>
                    <MaterialCommunityIcons name="trash-can-outline" size={18} color="#DC2626" />
                    <Text style={styles.photoDeleteText}>Eliminar</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            {/* Campo de nombre */}
            <Text style={styles.inputLabel}>Nombre</Text>
            <TextInput
              style={styles.modalInput}
              value={newName}
              onChangeText={setNewName}
              placeholder="Introduce tu nombre"
              placeholderTextColor={Palette.textSecondary}
              maxLength={60}
              autoFocus
            />

            {editError ? <Text style={styles.modalError}>{editError}</Text> : null}

            <View style={styles.modalActions}>
              <Pressable
                onPress={() => {
                  setSelectedPhoto(null);
                  setRemovePhoto(false);
                  setEditModalVisible(false);
                }}
                style={[styles.modalButton, styles.cancelButton]}>
                <Text style={styles.cancelButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={handleSaveProfile}
                disabled={saving}
                style={[styles.modalButton, styles.saveButton]}>
                {saving ? (
                  <ActivityIndicator size="small" color={Palette.onPrimary} />
                ) : (
                  <Text style={styles.saveButtonText}>Guardar</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <ConfirmDialog
        visible={confirmLogout}
        icon="logout"
        title="Cerrar sesión"
        message="¿Estás seguro de que quieres cerrar sesión?"
        confirmLabel="Cerrar sesión"
        onCancel={() => setConfirmLogout(false)}
        onConfirm={() => {
          setConfirmLogout(false);
          logout();
        }}
      />

      <Snackbar
        visible={Boolean(noticeText || successNotice)}
        onDismiss={dismissNotice}
        duration={3000}
        style={styles.snackbar}>
        {successNotice || noticeText || lastNotice}
      </Snackbar>
    </SafeAreaView>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({
  icon,
  tint,
  iconColor = Palette.text,
  title,
  titleColor = Palette.text,
  subtitle,
  trailing = 'chevron-right',
  onPress,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  tint: string;
  iconColor?: string;
  title: string;
  titleColor?: string;
  subtitle?: string;
  trailing?: keyof typeof MaterialCommunityIcons.glyphMap | null;
  onPress?: () => void;
}) {
  const content = (
    <>
      <View style={[styles.iconTile, { backgroundColor: tint }]}>
        <MaterialCommunityIcons name={icon} size={20} color={iconColor} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: titleColor }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {onPress && trailing ? (
        <MaterialCommunityIcons name={trailing} size={22} color={Palette.textSecondary} />
      ) : null}
    </>
  );

  if (!onPress) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Palette.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  container: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 20,
  },
  title: { fontSize: 32, lineHeight: 38, fontWeight: '800', color: Palette.text },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: CARD,
    overflow: 'hidden',
  },
  userCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: Radius.input,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.peach,
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: Radius.input,
  },
  avatarText: { fontSize: 22, fontWeight: '700', color: Palette.text },
  userText: { flex: 1, gap: 2 },
  userName: { fontSize: 18, fontWeight: '800', color: Palette.text },
  userSubtitle: { fontSize: 13, color: Palette.textSecondary },
  editIconBtn: { padding: 8 },
  section: { gap: 8 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: Palette.textSecondary,
    paddingHorizontal: 4,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
  iconTile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: '700' },
  rowSubtitle: { fontSize: 13, color: Palette.textSecondary },
  divider: { height: 1, marginLeft: 70, backgroundColor: Palette.border },
  pressed: { opacity: 0.6 },
  error: { fontSize: 15, color: Palette.error, textAlign: 'center' },
  errorContainer: { alignItems: 'center', gap: 12 },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: Palette.primary,
    borderRadius: Radius.button,
  },
  retryButtonText: { color: Palette.onPrimary, fontWeight: '700', fontSize: 14 },
  snackbar: { backgroundColor: Palette.primary },
  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    marginTop: -8,
    marginBottom: 4,
  },
  inviteButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: Palette.primary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: Palette.surface,
    borderRadius: 20,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Palette.text,
    marginBottom: 14,
  },
  modalAvatarContainer: {
    alignItems: 'center',
    marginBottom: 16,
    gap: 8,
  },
  modalAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
  },
  photoPickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Palette.mint,
  },
  photoPickerText: {
    fontSize: 13,
    fontWeight: '700',
    color: Palette.primary,
  },
  photoActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  photoDeleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: '#FEE2E2',
  },
  photoDeleteText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#DC2626',
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Palette.textSecondary,
    marginBottom: 6,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: Palette.text,
    backgroundColor: Palette.background,
  },
  modalError: {
    color: Palette.error,
    fontSize: 12,
    marginTop: 6,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 18,
  },
  modalButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  cancelButton: {
    backgroundColor: 'transparent',
  },
  cancelButtonText: {
    color: Palette.textSecondary,
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: Palette.primary,
  },
  saveButtonText: {
    color: Palette.onPrimary,
    fontWeight: '700',
  },
});
