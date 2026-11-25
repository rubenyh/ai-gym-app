import { useLocalSearchParams } from 'expo-router';

import { ExerciseDetailScreen } from '@/features/progress/exercise-detail-screen';

export default function ExerciseDetailRoute() {
  const { key } = useLocalSearchParams<{ key: string }>();
  return <ExerciseDetailScreen exerciseKey={key} />;
}
