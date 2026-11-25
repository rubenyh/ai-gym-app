import { useLocalSearchParams } from 'expo-router';

import { SessionDetailScreen } from '@/features/workouts/history-screen';

export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SessionDetailScreen sessionId={id} />;
}
