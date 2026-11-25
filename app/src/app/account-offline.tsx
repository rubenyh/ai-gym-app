import { Button, FormMessage, FormScreen } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { useAccount } from '@/features/account/account-provider';

/** Signed in on this device for the first time but the server is unreachable (NFR-09). */
export default function AccountOfflineRoute() {
  const { state, refresh, signOut } = useAccount();
  return (
    <FormScreen title="No connection">
      <ThemedText>Finishing sign-in needs a connection once. After that the app works offline.</ThemedText>
      <FormMessage text={state.kind === 'offline' ? state.message : null} />
      <Button label="Retry" onPress={refresh} />
      <Button label="Sign out" variant="secondary" onPress={signOut} />
    </FormScreen>
  );
}
