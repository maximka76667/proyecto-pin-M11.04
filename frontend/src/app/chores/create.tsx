import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { ChoreForm } from '@/components/chore-form';
import { APARTMENT_ID } from '@/constants/dev-session';
import { Palette, Radius } from '@/constants/onboarding';
import { api, errorMessage } from '@/lib/api';
const frequencies = [
  { value: 'once', label: 'Once' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'daily', label: 'Daily' },
] as const;

const categories = [
  { value: 'cleaning', label: 'Cleaning', icon: 'broom' },
  { value: 'maintenance', label: 'Maintenance', icon: 'tools' },
  { value: 'shopping', label: 'Shopping', icon: 'cart-outline' },
  { value: 'other', label: 'Other', icon: 'dots-horizontal' },
] as const;

export default function CreateChoreScreen() {
  return (
    <ChoreForm
      heading="Create a chore"
      subtitle="Make the invisible work visible, then let Room8 help share it fairly."
      submitLabel="Create chore"
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
          Assignments will be added later when the household schedule is ready.
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
