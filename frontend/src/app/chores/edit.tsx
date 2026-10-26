import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ChoreForm, closeChoreForm, type ChoreFormValues } from '@/components/chore-form';
import { Palette } from '@/constants/onboarding';
import { api, errorMessage } from '@/lib/api';

type TaskToEdit = {
  title: string;
  description: string | null;
  category: ChoreFormValues['category'];
  frequency: ChoreFormValues['frequency'];
};

export default function EditChoreScreen() {
  const { taskId } = useLocalSearchParams<{ taskId?: string }>();
  const [initialValues, setInitialValues] = useState<ChoreFormValues | null>(null);
  // sin taskId no hay nada que cargar: el error se muestra desde el principio
  const [loading, setLoading] = useState(Boolean(taskId));
  const [error, setError] = useState(taskId ? '' : 'No se encontró la tarea.');

  useEffect(() => {
    if (!taskId) return;

    void (async () => {
      try {
        const task = await api(
          'GET',
          `/tasks/${encodeURIComponent(taskId)}`,
        ) as TaskToEdit;
        setInitialValues({
          title: task.title,
          description: task.description ?? '',
          category: task.category,
          frequency: task.frequency,
        });
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [taskId]);

  if (!taskId || !initialValues) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <Pressable onPress={closeChoreForm} hitSlop={12} accessibilityLabel="Cerrar">
            <MaterialCommunityIcons name="close" size={24} color={Palette.text} />
          </Pressable>
          {loading ? <ActivityIndicator color={Palette.primary} /> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <ChoreForm
      heading="Editar tarea"
      subtitle="Los cambios se guardan para todas las personas del hogar."
      submitLabel="Guardar cambios"
      initialValues={initialValues}
      onSubmit={async (values) => {
        // El PATCH rechaza cualquier campo que no sea uno de estos (p. ej. apartment_id).
        // Una descripción vacía borra la que hubiera.
        await api('PATCH', `/tasks/${encodeURIComponent(taskId)}`, {
          title: values.title,
          description: values.description,
          category: values.category,
          frequency: values.frequency,
        });
        // vuelve a la lista aunque se haya entrado desde los detalles, con el aviso de éxito
        router.dismissTo({ pathname: '/chores', params: { notice: 'updated' } });
      }}
    />
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Palette.background },
  container: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 12,
    gap: 16,
  },
  error: { fontSize: 14, color: Palette.error },
});
