import { Stack } from 'expo-router';

export default function Layout() {
  return (
    <Stack>
      <Stack.Screen name="search" options={{ title: 'Find people' }} />
      <Stack.Screen name="connections" options={{ title: 'Followers' }} />
      <Stack.Screen name="post/[postId]" options={{ title: 'Post' }} />
      <Stack.Screen name="profile/[handle]" options={{ title: 'Profile' }} />
      <Stack.Screen name="publish/[sessionId]" options={{ title: 'Share workout' }} />
    </Stack>
  );
}
