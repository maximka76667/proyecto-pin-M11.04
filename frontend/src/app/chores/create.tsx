import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { ChoreForm } from '@/components/chore-form';
import { APARTMENT_ID } from '@/constants/dev-session';
import { Palette, Radius } from '@/constants/onboarding';
import { api, errorMessage } from '@/lib/api';
const frequencies = [
  { value: 'once', label: 'Una vez' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'daily', label: 'Diaria' },
] as const;

const categories = [
  { value: 'cleaning', label: 'Limpieza', icon: 'broom' },
  { value: 'maintenance', label: 'Mantenimiento', icon: 'tools' },
  { value: 'shopping', label: 'Compras', icon: 'cart-outline' },
  { value: 'other', label: 'Otra', icon: 'dots-horizontal' },
] as const;

export default function CreateChoreScreen() {
  return (
    <ChoreForm
      heading="Crear una tarea"
      subtitle="Haz visible el trabajo invisible y deja que Room8 ayude a repartirlo de forma justa."
      submitLabel="Crear tarea"
      onSubmit={async (values) => {
        await api('POST', '/tasks', {
          apartment_id: APARTMENT_ID,
          title: values.title,
          description: values.description || undefined,
          frequency: values.frequency,
          category: values.category,
        });

        router.replace({ pathname: '/chores', params: { notice: 'created' } });
      }}>
      <View style={styles.infoCard}>
        <MaterialCommunityIcons name="star-outline" size={18} color={Palette.primary} />
        <Text style={styles.infoText}>
          Las asignaciones se añadirán más adelante, cuando el calendario del hogar esté preparado.
        </Text>
      </View>
    </ChoreForm>
  );
}

const styles = StyleSheet.create({
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
    borderRadius: Radius.input,
    backgroundColor: Palette.lavender,
  },
  infoText: { flex: 1, fontSize: 13, lineHeight: 18, color: Palette.text },
});
