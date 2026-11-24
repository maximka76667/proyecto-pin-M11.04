import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { ChoreForm } from '@/components/chore-form';
import { APARTMENT_ID } from '@/constants/dev-session';
import { Palette, Radius } from '@/constants/onboarding';
import { api } from '@/lib/api';

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
          duration_minutes: values.duration_minutes,
          points: values.points ?? undefined,
          frequency: values.frequency,
          category: values.category,
        });

        router.replace({ pathname: '/chores', params: { notice: 'created' } });
      }}>
      <View style={styles.infoCard}>
        <MaterialCommunityIcons name="star-outline" size={18} color={Palette.primary} />
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
