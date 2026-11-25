import { useLocalSearchParams } from 'expo-router';

import { SummaryScreen } from '@/features/workouts/summary-screen';

export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SummaryScreen sessionId={id} />;
}
