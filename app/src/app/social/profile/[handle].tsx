import { useLocalSearchParams } from 'expo-router';

import { ProfileScreen } from '@/features/community/people-screens';

export default function Route() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  return <ProfileScreen handle={handle} />;
}
