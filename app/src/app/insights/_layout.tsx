import { Stack } from 'expo-router';

export default function Layout() {
  return (
    <Stack>
      <Stack.Screen name="achievements" options={{ title: 'Achievements' }} />
      <Stack.Screen name="body-weight" options={{ title: 'Body weight' }} />
      <Stack.Screen name="exercise/[key]" options={{ title: 'Exercise' }} />
    </Stack>
  );
}
