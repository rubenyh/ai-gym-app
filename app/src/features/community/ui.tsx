import { useNetInfo } from '@react-native-community/netinfo';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import type { PostSnapshot } from '@/domain/contracts';
import { formatWeight, type WeightUnit } from '@/domain/units';
import { friendlyError } from '@/features/account/errors';
import { useAccount } from '@/features/account/account-provider';

import { signedPhotoUrl, UnavailableError } from './api';

/** Signed-in user id and display unit; community routes only mount when the account is ready. */
export function useMe(): { userId: string; unit: WeightUnit } {
  const { state } = useAccount();
  if (state.kind !== 'ready') return { userId: '', unit: 'kg' };
  return { userId: state.userId, unit: state.account.settings.weightUnit };
}

/** Loading / offline / unavailable / error states (NFR-09). Returns null when there is nothing to show. */
export function QueryState({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const net = useNetInfo();
  if (loading) return <ActivityIndicator accessibilityLabel="Loading" style={styles.pad} />;
  if (error instanceof UnavailableError) return <Message text="This content is unavailable. It may have been deleted or made private." />;
  if (net.isConnected === false) return <Message text="You are offline. Social features need a connection." onRetry={onRetry} />;
  if (error) return <Message text={friendlyError(error)} onRetry={onRetry} />;
  return null;
}

export function Message({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <View style={styles.message} accessibilityLiveRegion="polite">
      <ThemedText type="small">{text}</ThemedText>
      {onRetry ? <Button label="Retry" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

function setLine(s: { reps: number | null; loadGrams: number | null }, loadMode: string, unit: WeightUnit) {
  const reps = s.reps === null ? '–' : `${s.reps} reps`;
  if (s.loadGrams === null) return loadMode === 'bodyweight' ? `${reps} · bodyweight` : reps;
  const sign = loadMode === 'assisted' ? '−' : '';
  return `${reps} · ${sign}${formatWeight(s.loadGrams, unit)}`;
}

/** Renders only the public snapshot fields (title, date, duration, exercises, sets). */
export function SnapshotView({ snapshot, unit }: { snapshot: PostSnapshot; unit: WeightUnit }) {
  return (
    <View style={styles.snapshot}>
      <ThemedText type="smallBold">{snapshot.title}</ThemedText>
      <ThemedText type="small">
        {snapshot.completedOn} · {snapshot.durationMinutes} min
      </ThemedText>
      {snapshot.exercises.map((e, i) => (
        <View key={i}>
          <ThemedText type="smallBold">{e.exerciseName}</ThemedText>
          {e.sets.map((s, j) => (
            <ThemedText key={j} type="small">
              Set {j + 1}: {setLine(s, e.loadMode, unit)}
            </ThemedText>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Private post photo through a short-lived signed URL; memory cache only (never written to disk). */
export function PostPhoto({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    signedPhotoUrl(path).then((u) => !cancelled && setUrl(u));
    return () => {
      cancelled = true;
    };
  }, [path]);
  if (!url) return <ThemedView type="backgroundElement" style={styles.photo} accessibilityLabel="Photo loading" />;
  return <Image source={{ uri: url }} cachePolicy="memory" style={styles.photo} accessibilityLabel="Workout photo" />;
}

const styles = StyleSheet.create({
  pad: { padding: 24 },
  message: { padding: 16, gap: 8 },
  snapshot: { gap: 6 },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12 },
});
