import { useLocalSearchParams } from 'expo-router';

import { ExerciseDetailScreen } from '@/features/catalog/exercise-detail';

export default function ExerciseRoute() {
  const { key } = useLocalSearchParams<{ key: string }>();
  return <ExerciseDetailScreen exerciseKey={key} />;
}
