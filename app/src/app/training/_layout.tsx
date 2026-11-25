import { Stack } from 'expo-router';

export default function TrainingLayout() {
  return (
    <Stack>
      <Stack.Screen name="catalog" options={{ title: 'Exercise catalog' }} />
      <Stack.Screen name="exercise" options={{ title: 'Exercise' }} />
      <Stack.Screen name="custom-exercise" options={{ title: 'Custom exercise' }} />
      <Stack.Screen name="routine/[id]" options={{ title: 'Routine' }} />
      <Stack.Screen name="program" options={{ title: 'Program' }} />
      <Stack.Screen name="session/[id]" options={{ title: 'Workout' }} />
      <Stack.Screen name="summary/[id]" options={{ title: 'Workout summary', headerBackVisible: false, gestureEnabled: false }} />
      <Stack.Screen name="history/index" options={{ title: 'History' }} />
      <Stack.Screen name="history/[id]" options={{ title: 'Workout details' }} />
    </Stack>
  );
}
