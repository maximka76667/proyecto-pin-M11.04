import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Snackbar } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Palette, Radius } from '@/constants/onboarding';
import { api, errorMessage, getCurrentUser, hasAuthToken } from '@/lib/api';

type PreferenceType = 'prefer' | 'indifferent' | 'avoid';

type TaskWithPreference = {
  id: string;
  apartment_id: string;
  title: string;
  description: string | null;
  duration_minutes: number;
  category: string;
  priority: string;
  frequency: string;
  preference: PreferenceType;
};

function getChoreIcon(title: string, category?: string): keyof typeof MaterialCommunityIcons.glyphMap {
  const t = title.toLowerCase();
  if (t.includes('cocin') || t.includes('comid')) return 'pot-steam-outline';
  if (t.includes('plat') || t.includes('lavar') || t.includes('vajill')) return 'silverware-fork-knife';
  if (t.includes('baño') || t.includes('ducha') || t.includes('aseo')) return 'bathtub-outline';
  if (t.includes('barr') || t.includes('freg') || t.includes('suelo')) return 'broom';
  if (t.includes('basur') || t.includes('recicl')) return 'trash-can-outline';
  if (category === 'cleaning') return 'broom';
  if (category === 'maintenance') return 'tools';
  if (category === 'shopping') return 'cart-outline';
  return 'format-list-checks';
}

const PREFERENCE_OPTIONS: { value: PreferenceType; label: string }[] = [
  { value: 'prefer', label: 'Prefiero' },
  { value: 'indifferent', label: 'Indiferente' },
  { value: 'avoid', label: 'Prefiero evitar' },
];

export type TaskPreferencesViewProps = {
  apartmentId?: string;
  onBack?: () => void;
  showBackButton?: boolean;
};

export function TaskPreferencesView({
  apartmentId: propApartmentId,
  onBack,
  showBackButton = true,
}: TaskPreferencesViewProps) {
  const [apartmentId, setApartmentId] = useState<string | null>(propApartmentId ?? null);
  const [tasks, setTasks] = useState<TaskWithPreference[]>([]);
  const [preferences, setPreferences] = useState<Record<string, PreferenceType>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadPreferences = useCallback(async () => {
    if (!hasAuthToken()) {
      router.replace('/auth' as Href);
      return;
    }

    setLoading(true);
    setError('');

    try {
      let targetAptId = propApartmentId ?? apartmentId;
      if (!targetAptId) {
        const user = await getCurrentUser();
        targetAptId = user.user_apartments[0]?.apartment_id ?? null;
        setApartmentId(targetAptId);
      }

      if (!targetAptId) {
        setError('No se ha encontrado ningún hogar asociado a tu cuenta.');
        setLoading(false);
        return;
      }

      const data = (await api(
        'GET',
        `/tasks/preferences?apartment_id=${encodeURIComponent(targetAptId)}`,
      )) as TaskWithPreference[];

      setTasks(data);

      const initialPrefs: Record<string, PreferenceType> = {};
      for (const t of data) {
        initialPrefs[t.id] = t.preference || 'indifferent';
      }
      setPreferences(initialPrefs);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [apartmentId, propApartmentId]);

  useFocusEffect(
    useCallback(() => {
      void loadPreferences();
    }, [loadPreferences]),
  );

  const goBack = () => {
    if (onBack) {
      onBack();
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/profile' as Href);
    }
  };

  const handleSelectPreference = (taskId: string, val: PreferenceType) => {
    setPreferences((prev) => ({
      ...prev,
      [taskId]: val,
    }));
  };

  const handleSave = async () => {
    if (!apartmentId) return;
    setSaving(true);
    setError('');

    try {
      const payload = {
        apartment_id: apartmentId,
        preferences: Object.entries(preferences).map(([task_id, preference]) => ({
          task_id,
          preference,
        })),
      };

      await api('PUT', '/tasks/preferences', payload);
      setNotice('Preferencias guardadas correctamente');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Barra superior de navegación */}
      {showBackButton ? (
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Volver"
            onPress={goBack}
            style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={Palette.text} />
            <Text style={styles.backBtnText}>Volver</Text>
          </Pressable>
          <Text style={styles.brandTitle}>Room8</Text>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.container}>
        {/* Título de la pantalla */}
        <Text style={styles.mainTitle} accessibilityRole="header">
          Preferencias de tareas
        </Text>
        <Text style={styles.subtitle}>
          Cuéntanos qué te gusta hacer y qué prefieres evitar en casa.
        </Text>

        {/* Tarjeta explicativa de la IA */}
        <View style={styles.bannerCard}>
          <View style={styles.bannerHeader}>
            <MaterialCommunityIcons
              name="star-four-points-outline"
              size={22}
              color={Palette.primary}
              style={styles.bannerIcon}
            />
            <Text style={styles.bannerTitle}>
              Tus gustos cuentan, el equilibrio primero
            </Text>
          </View>
          <Text style={styles.bannerBody}>
            La IA tendrá en cuenta tus preferencias, pero priorizará un reparto
            equilibrado y la carga de trabajo. Evitar una tarea no la excluye.
          </Text>
        </View>

        {/* Cabecera de la sección de tareas */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Tus tareas, a tu manera</Text>
          <Text style={styles.sectionCount}>
            {tasks.length} {tasks.length === 1 ? 'tarea' : 'tareas'}
          </Text>
        </View>
        <Text style={styles.sectionHelp}>
          Elige una sola opción para cada tarea.
        </Text>

        {/* Contenido principal: Estados de carga, error y lista */}
        {loading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={Palette.primary} />
          </View>
        ) : error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={loadPreferences}
              style={({ pressed }) => [styles.retryBtn, pressed && styles.pressed]}>
              <Text style={styles.retryBtnText}>Reintentar</Text>
            </Pressable>
          </View>
        ) : tasks.length === 0 ? (
          <View style={styles.emptyBox}>
            <MaterialCommunityIcons
              name="checkbox-blank-off-outline"
              size={38}
              color={Palette.textSecondary}
            />
            <Text style={styles.emptyTitle}>No hay tareas registradas</Text>
            <Text style={styles.emptySubtitle}>
              Crea tareas para tu hogar en la pestaña de Tareas para poder elegir
              tus preferencias.
            </Text>
          </View>
        ) : (
          <View style={styles.tasksCard}>
            {tasks.map((task, index) => {
              const currentPref = preferences[task.id] ?? 'indifferent';
              const iconName = getChoreIcon(task.title, task.category);
              const isLast = index === tasks.length - 1;

              return (
                <View
                  key={task.id}
                  style={[styles.taskItem, !isLast && styles.taskItemDivider]}>
                  {/* Fila del icono y título de la tarea */}
                  <View style={styles.taskTitleRow}>
                    <MaterialCommunityIcons
                      name={iconName}
                      size={20}
                      color={Palette.text}
                      style={styles.taskIcon}
                    />
                    <Text style={styles.taskTitle}>{task.title}</Text>
                  </View>

                  {/* Selector segmentado de 3 opciones */}
                  <View style={styles.segmentedContainer}>
                    {PREFERENCE_OPTIONS.map((opt) => {
                      const isSelected = currentPref === opt.value;
                      return (
                        <Pressable
                          key={opt.value}
                          accessibilityRole="button"
                          accessibilityState={{ selected: isSelected }}
                          onPress={() => handleSelectPreference(task.id, opt.value)}
                          style={[
                            styles.segmentButton,
                            isSelected && styles.segmentButtonSelected,
                          ]}>
                          {isSelected ? (
                            <MaterialCommunityIcons
                              name="check"
                              size={15}
                              color={Palette.onPrimary}
                              style={styles.checkIcon}
                            />
                          ) : null}
                          <Text
                            style={[
                              styles.segmentButtonText,
                              isSelected && styles.segmentButtonTextSelected,
                            ]}
                            numberOfLines={1}>
                            {opt.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Botón de Guardar preferencias */}
        {tasks.length > 0 && !loading ? (
          <View style={styles.bottomSection}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Guardar preferencias"
              disabled={saving}
              onPress={handleSave}
              style={({ pressed }) => [
                styles.saveButton,
                saving && styles.saveButtonDisabled,
                pressed && styles.pressed,
              ]}>
              {saving ? (
                <ActivityIndicator size="small" color={Palette.onPrimary} />
              ) : (
                <Text style={styles.saveButtonText}>Guardar preferencias</Text>
              )}
            </Pressable>
            <Text style={styles.footerHint}>
              Puedes cambiarlas cuando quieras desde tu perfil.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Aviso de confirmación */}
      <Snackbar
        visible={Boolean(notice)}
        onDismiss={() => setNotice('')}
        duration={3000}
        style={styles.snackbar}>
        {notice}
      </Snackbar>
    </SafeAreaView>
  );
}

export default function TaskPreferencesScreen() {
  const { apartment_id: paramApartmentId } = useLocalSearchParams<{ apartment_id?: string }>();
  return <TaskPreferencesView apartmentId={paramApartmentId} />;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  topBar: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingRight: 10,
  },
  backBtnText: {
    marginLeft: 4,
    fontSize: 16,
    fontWeight: '600',
    color: Palette.text,
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Palette.primary,
    letterSpacing: -0.5,
  },
  container: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  mainTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: Palette.text,
    letterSpacing: -0.6,
    marginTop: 4,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: Palette.textSecondary,
    lineHeight: 22,
    marginBottom: 20,
  },
  bannerCard: {
    backgroundColor: '#EBF4EE',
    borderRadius: 18,
    padding: 16,
    marginBottom: 24,
  },
  bannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  bannerIcon: {
    marginRight: 8,
  },
  bannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Palette.primary,
    flex: 1,
  },
  bannerBody: {
    fontSize: 13,
    color: '#385A4E',
    lineHeight: 19,
    paddingLeft: 30,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Palette.text,
  },
  sectionCount: {
    fontSize: 14,
    color: Palette.textSecondary,
  },
  sectionHelp: {
    fontSize: 13,
    color: Palette.textSecondary,
    marginBottom: 14,
  },
  tasksCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#EFEAE2',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 2,
  },
  taskItem: {
    paddingVertical: 14,
  },
  taskItemDivider: {
    borderBottomWidth: 1,
    borderBottomColor: '#F3EFE9',
  },
  taskTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  taskIcon: {
    marginRight: 10,
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Palette.text,
  },
  segmentedContainer: {
    flexDirection: 'row',
    backgroundColor: '#F3EFEA',
    borderRadius: 14,
    padding: 3,
  },
  segmentButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderRadius: 11,
  },
  segmentButtonSelected: {
    backgroundColor: Palette.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  checkIcon: {
    marginRight: 4,
  },
  segmentButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: Palette.textSecondary,
  },
  segmentButtonTextSelected: {
    color: Palette.onPrimary,
    fontWeight: '700',
  },
  bottomSection: {
    marginTop: 26,
    alignItems: 'center',
  },
  saveButton: {
    width: '100%',
    backgroundColor: Palette.primary,
    borderRadius: Radius.button * 1.5,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: Palette.onPrimary,
  },
  footerHint: {
    fontSize: 13,
    color: Palette.textSecondary,
    textAlign: 'center',
    marginTop: 12,
  },
  centerBox: {
    paddingVertical: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBox: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FDECEC',
    borderRadius: 16,
    marginVertical: 10,
  },
  errorText: {
    fontSize: 14,
    color: Palette.error,
    textAlign: 'center',
    marginBottom: 12,
  },
  retryBtn: {
    backgroundColor: Palette.primary,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
  },
  retryBtnText: {
    color: Palette.onPrimary,
    fontWeight: '600',
    fontSize: 13,
  },
  emptyBox: {
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EFEAE2',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Palette.text,
    marginTop: 10,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: Palette.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.7,
  },
  snackbar: {
    backgroundColor: Palette.primary,
  },
});
