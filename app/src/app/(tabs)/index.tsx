import { Link } from 'expo-router';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { ThemedText } from '@/components/themed-text';
import { useAccount } from '@/features/account/account-provider';

export default function HomeScreen() {
  const { state } = useAccount();
  const name = state.kind === 'ready' ? state.account.profile.displayName : null;
  return (
    <PlaceholderScreen title={name ? `Hi, ${name}` : 'Home'} milestone="M2–M4">
      <Link href="/settings" accessibilityRole="button">
        <ThemedText type="linkPrimary">Profile & settings</ThemedText>
      </Link>
      {__DEV__ && (
        <Link href="/dev/verify" accessibilityRole="button">
          <ThemedText type="linkPrimary">Open M0 native verification (dev only)</ThemedText>
        </Link>
      )}
    </PlaceholderScreen>
  );
}
