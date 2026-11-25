import { useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, FormMessage, FormScreen } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { useLocalQuery, useSyncEngine } from '@/db/repositories-context';

import { describeChange, phaseLabel } from './sync-labels';

/** Sync status (SYNC-01, NFR-09): explicit pending/failed/conflict/offline states, manual retry, conflict recovery. */
export function SyncStatusScreen() {
  const sync = useSyncEngine();
  const status = useSyncExternalStore(sync.subscribe, sync.status);
  const data = useLocalQuery((r) => ({ summary: r.outbox.summary(), conflicts: sync.store.conflicts(), failed: sync.store.failed() }), [sync]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { summary, conflicts, failed } = data;

  const act = async (fn: () => unknown) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const retry = () => {
    setBusy(true);
    void act(() => sync.syncNow()).finally(() => setBusy(false));
  };

  return (
    <FormScreen title="Sync status">
      <ThemedText>{phaseLabel(status)}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Waiting to upload: {summary.pending + summary.inflight} · Failed: {summary.failed} · Conflicts: {summary.conflicts}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Last sync: {summary.lastSyncAt ? new Date(summary.lastSyncAt).toLocaleString() : 'never on this device'}
      </ThemedText>
      <FormMessage text={summary.lastError ? `Last error: ${summary.lastError}` : null} />
      <ThemedText type="small" themeColor="textSecondary">
        Sync runs while the app is open (on launch, when it returns to the foreground and when the connection comes back).
      </ThemedText>
      <Button label="Sync now" onPress={retry} busy={busy} />
      <FormMessage text={error} />

      {conflicts.length ? <ThemedText type="smallBold">Changed on another device</ThemedText> : null}
      {conflicts.map((c) => (
        <View key={`${c.aggregateType}:${c.aggregateId}`} style={styles.card}>
          <ThemedText>{describeChange(c.aggregateType, c.localDoc ?? c.serverDoc)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {c.serverDeleted ? 'It was deleted on another device.' : 'It was edited on another device.'} Your version is kept until you choose.
          </ThemedText>
          <Button label="Keep mine" onPress={() => act(() => sync.store.resolveConflict(c.aggregateType, c.aggregateId, 'mine')).then(retry)} />
          <Button
            label={c.serverDeleted ? 'Accept deletion' : 'Use server copy'}
            variant="secondary"
            onPress={() => act(() => sync.store.resolveConflict(c.aggregateType, c.aggregateId, 'server')).then(retry)}
          />
        </View>
      ))}

      {failed.length ? <ThemedText type="smallBold">Not accepted by the server</ThemedText> : null}
      {failed.map((f) => (
        <View key={f.opId} style={styles.card}>
          <ThemedText>{describeChange(f.aggregateType, null)}</ThemedText>
          <FormMessage text={f.lastError} />
          <Button label="Try again" variant="secondary" onPress={() => act(() => sync.store.retryFailed(f.opId)).then(retry)} />
        </View>
      ))}
    </FormScreen>
  );
}

const styles = StyleSheet.create({ card: { gap: 8, paddingVertical: 8 } });
