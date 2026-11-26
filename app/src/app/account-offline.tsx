import { Button, FormMessage, FormScreen } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { useAccount } from '@/features/account/account-provider';

/** Signed in on this device for the first time but the server is unreachable (NFR-09). */
export default function AccountOfflineRoute() {
  const { state, refresh, signOut } = useAccount();
  if (state.kind === 'offline' && state.openInOtherTab) {
    // Web: another tab holds this account's local database. Signing out here would also sign that tab out
    // without its unsynced-changes check, so only Retry is offered.
    return (
      <FormScreen title="Open in another tab">
        <ThemedText>{state.message}</ThemedText>
        <Button label="Retry" onPress={refresh} />
      </FormScreen>
    );
  }
  return (
    <FormScreen title="No connection">
      <ThemedText>Finishing sign-in needs a connection once. After that the app works offline.</ThemedText>
      <FormMessage text={state.kind === 'offline' ? state.message : null} />
      <Button label="Retry" onPress={refresh} />
      <Button label="Sign out" variant="secondary" onPress={signOut} />
    </FormScreen>
  );
}
