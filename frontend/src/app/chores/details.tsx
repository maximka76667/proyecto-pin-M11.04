import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Palette, Radius } from '@/constants/onboarding';
import { api, errorMessage } from '@/lib/api';

type TaskDetails = {
  title: string;
  frequency: 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly';
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
  assignments: {
    user: { full_name: string };
    due_date: string;
    status: string;
  }[];
};

export default function ChoreDetailsScreen() {
  const { taskId } = useLocalSearchParams<{ taskId?: string }>();
  const [task, setTask] = useState<TaskDetails | null>(null);
  const [completed, setCompleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!taskId) {
      setError('Chore not found.');
      setLoading(false);
      return;
    }

    void (async () => {
      try {
        const loaded = await api(
          'GET',
          `/tasks/${encodeURIComponent(taskId)}`,
        ) as TaskDetails;
        setTask(loaded);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [taskId]);

  const assignment = task?.assignments[0];
  // A task can exist before the future scheduler creates its assignment.
  const assignmentDate = assignment
    ? new Date(`${assignment.due_date}T00:00:00`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
    : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.topBar}>
          <Text style={styles.title}>Chore details</Text>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Close">
            <MaterialCommunityIcons name="close" size={23} color={Palette.text} />
          </Pressable>
        </View>

        {loading ? <ActivityIndicator color={Palette.primary} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {task ? <View style={styles.hero}>
          <View style={styles.iconCircle}>
            <MaterialCommunityIcons name="format-list-checks" size={24} color={Palette.primary} />
          </View>
          <Text style={styles.choreTitle}>{task.title}</Text>
          <Text style={styles.meta}>
            {task.frequency} · {assignmentDate ?? 'Anytime'}
          </Text>
        </View> : null}

        {task ? <View style={styles.assignmentCard}>
          <MaterialCommunityIcons name="star-outline" size={18} color={Palette.primary} />
          <Text style={styles.assignment}>
            {assignment
              ? `Assigned to ${assignment.user.full_name}.`
              : 'This chore has not been assigned yet.'}
          </Text>
        </View> : null}

        {task ? <>
          <Text style={styles.sectionLabel}>WHAT DO YOU WANT TO DO?</Text>
          <Pressable
            onPress={() => setCompleted(true)}
            style={[styles.actionButton, completed && styles.completedButton]}>
            <MaterialCommunityIcons name="check-circle-outline" size={18} color={Palette.onPrimary} />
            <Text style={styles.actionText}>{completed ? 'Marked as done' : 'Mark as done'}</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton}>
            <MaterialCommunityIcons name="swap-horizontal" size={18} color={Palette.primary} />
            <Text style={styles.secondaryText}>Request a swap</Text>
          </Pressable>
        </> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Palette.background },
  container: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
    gap: 16,
  },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '800', color: Palette.text },
  hero: {
    alignItems: 'center',
    paddingVertical: 28,
    borderRadius: Radius.input,
    backgroundColor: Palette.mint,
    gap: 6,
  },
  iconCircle: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: Palette.surface,
  },
  choreTitle: { marginTop: 4, fontSize: 20, fontWeight: '800', color: Palette.text },
  meta: { fontSize: 12, color: Palette.textSecondary },
  error: { fontSize: 14, textAlign: 'center', color: Palette.error },
  assignmentCard: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.input,
    backgroundColor: Palette.surface,
  },
  assignment: { flex: 1, fontSize: 13, lineHeight: 18, color: Palette.text },
  sectionLabel: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    color: Palette.primary,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    borderRadius: Radius.button,
    backgroundColor: Palette.primary,
  },
  completedButton: { backgroundColor: '#4C8B6F' },
  actionText: { fontSize: 15, fontWeight: '800', color: Palette.onPrimary },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.button,
    backgroundColor: Palette.surface,
  },
  secondaryText: { fontSize: 15, fontWeight: '700', color: Palette.primary },
});
