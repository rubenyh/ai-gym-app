import { Link } from 'expo-router';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { ThemedText } from '@/components/themed-text';

export default function HomeScreen() {
  return (
    <PlaceholderScreen title="Home" milestone="M1–M4">
      {__DEV__ && (
        <Link href="/dev/verify" accessibilityRole="button">
          <ThemedText type="linkPrimary">Open M0 native verification (dev only)</ThemedText>
        </Link>
      )}
    </PlaceholderScreen>
  );
}
