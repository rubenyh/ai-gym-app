import { useLocalSearchParams } from 'expo-router';

import { LoggerScreen } from '@/features/workouts/logger-screen';

export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <LoggerScreen sessionId={id} />;
}
