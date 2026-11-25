import { useLocalSearchParams } from 'expo-router';

import { ProgramEditor } from '@/features/workouts/program-editor';

export default function ProgramRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <ProgramEditor id={id} />;
}
