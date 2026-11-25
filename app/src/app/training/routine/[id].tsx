import { useLocalSearchParams } from 'expo-router';

import { RoutineEditor } from '@/features/workouts/routine-editor';

export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RoutineEditor id={id} />;
}
