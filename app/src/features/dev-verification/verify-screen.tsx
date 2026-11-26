import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { Easing, Keyframe, ReduceMotion, useReducedMotion } from 'react-native-reanimated';

import { RivePet } from '@/components/characters/rive-pet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

import { incrementProbe, readProbe, type ProbeValue } from './sqlite-probe';

// rating.riv: sample from rive-app/rive-nitro-react-native (MIT). See assets/rive/ATTRIBUTION.md.

export function VerifyScreen({ deepLinkSource }: { deepLinkSource?: string }) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Section title="Deep link">
        <ThemedText testID="deep-link-status">
          {deepLinkSource
            ? `Opened via deep link (source=${deepLinkSource})`
            : 'Opened in-app (no source param)'}
        </ThemedText>
      </Section>
      <Section title="SQLite persistence">
        <SqliteProbe />
      </Section>
      <Section title="Rive character">
        <RiveProbe />
      </Section>
      <Section title="Reanimated keyframe">
        <MotionProbe />
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <ThemedView type="backgroundElement" style={styles.section}>
      <ThemedText type="smallBold" accessibilityRole="header">
        {title}
      </ThemedText>
      {children}
    </ThemedView>
  );
}

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.button}>
      <ThemedText type="linkPrimary">{label}</ThemedText>
    </Pressable>
  );
}

function SqliteProbe() {
  const [value, setValue] = useState<ProbeValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    readProbe().then(setValue, (e: Error) => setError(e.message));
  }, []);

  if (error) return <ThemedText testID="sqlite-error">SQLite error: {error}</ThemedText>;
  if (!value) return <ActivityIndicator />;
  return (
    <>
      <ThemedText testID="sqlite-count">Stored count: {value.count}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Last write: {value.updatedAt ?? 'never'}. Increment, force-close, reopen: the count must remain.
      </ThemedText>
      <Button
        label="Increment and save"
        onPress={() => incrementProbe().then(setValue, (e: Error) => setError(e.message))}
      />
    </>
  );
}

function StaticCharacter({ reason }: { reason: string }) {
  return (
    <View
      testID="rive-fallback"
      accessible
      accessibilityLabel={`Character (static fallback: ${reason})`}
      style={styles.fallback}>
      <ThemedText type="title">★</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Static fallback: {reason}
      </ThemedText>
    </View>
  );
}

export function RiveProbe() {
  const reduceMotion = useReducedMotion();
  const [forceFallback, setForceFallback] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);

  // Same platform adapter as the pet (native runtime on Android/iOS, canvas runtime on web).
  let body: React.ReactNode;
  if (forceFallback) body = <StaticCharacter reason="forced for testing" />;
  else if (reduceMotion) body = <StaticCharacter reason="reduced motion" />;
  else if (viewError !== null) body = <StaticCharacter reason={viewError} />;
  else body = <RivePet stage={3} onFail={(reason) => setViewError(reason ?? 'Rive failed to load')} />;

  return (
    <>
      {body}
      <ThemedText type="small" themeColor="textSecondary">
        Reduced motion: {reduceMotion ? 'on (static character)' : 'off'}
      </ThemedText>
      <Button
        label={forceFallback ? 'Show Rive animation' : 'Force static fallback'}
        onPress={() => setForceFallback((f) => !f)}
      />
    </>
  );
}

// ReduceMotion.System: when the OS setting is on, Reanimated jumps to the final frame.
const popIn = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.4 }, { rotate: '-20deg' }] },
  60: { opacity: 1, transform: [{ scale: 1.15 }, { rotate: '8deg' }], easing: Easing.out(Easing.quad) },
  100: { opacity: 1, transform: [{ scale: 1 }, { rotate: '0deg' }] },
})
  .duration(700)
  .reduceMotion(ReduceMotion.System);

function MotionProbe() {
  const reduceMotion = useReducedMotion();
  const [run, setRun] = useState(0);
  return (
    <>
      <Animated.View key={run} entering={popIn} style={styles.badge} testID="keyframe-badge">
        <ThemedText type="smallBold">XP</ThemedText>
      </Animated.View>
      <ThemedText type="small" themeColor="textSecondary" testID="motion-status">
        {reduceMotion
          ? 'Reduced motion on: badge appears in its final state without animating.'
          : 'Reduced motion off: badge pops in with a keyframe.'}
      </ThemedText>
      <Button label="Replay keyframe" onPress={() => setRun((r) => r + 1)} />
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three },
  section: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  button: { minHeight: 44, justifyContent: 'center' },
  fallback: { height: 180, alignItems: 'center', justifyContent: 'center' },
  badge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F5C542',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
