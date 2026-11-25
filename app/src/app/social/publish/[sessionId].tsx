import { useLocalSearchParams } from 'expo-router';

import { PublishScreen } from '@/features/community/publish-screen';

export default function Route() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  return <PublishScreen sessionId={sessionId} />;
}
