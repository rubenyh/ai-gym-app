import { useLocalSearchParams } from 'expo-router';

import { PostScreen } from '@/features/community/post-screen';

export default function Route() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  return <PostScreen postId={postId} />;
}
