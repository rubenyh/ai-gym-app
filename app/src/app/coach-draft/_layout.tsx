import { Stack } from 'expo-router';

export default function Layout() {
  return (
    <Stack>
      <Stack.Screen name="profile" options={{ title: 'Training profile' }} />
      <Stack.Screen name="[draftId]" options={{ title: 'Coach draft' }} />
    </Stack>
  );
}
