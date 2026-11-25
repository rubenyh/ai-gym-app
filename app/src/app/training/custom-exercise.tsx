import { useLocalSearchParams } from 'expo-router';

import { CustomExerciseEditor } from '@/features/catalog/custom-exercise-editor';

export default function CustomExerciseRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <CustomExerciseEditor id={id} />;
}
