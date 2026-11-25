import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useLocalQuery } from '@/db/repositories-context';

import { openLogger } from './start-session';

/**
 * Persistent resume affordance shown over every tab while a workout is active (SCREENS_AND_FLOWS.md
 * Navigation, SESSION-03). The logger itself opens above the tab shell.
 */
export function ActiveSessionBar() {
  const active = useLocalQuery((r) => {
    const s = r.sessions.active();
    return s ? { id: s.id, name: s.name } : null;
  }, []);
  const insets = useSafeAreaInsets();
  if (!active) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Resume active workout ${active.name}`}
      onPress={() => openLogger(active.id)}
      style={[styles.wrap, { bottom: BottomTabInset + insets.bottom + Spacing.two }]}>
      <ThemedView type="backgroundSelected" style={styles.bar}>
        <ThemedText type="smallBold" numberOfLines={1} style={styles.grow}>
          Workout in progress · {active.name}
        </ThemedText>
        <ThemedText type="smallBold">Resume</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  wrap: { position: 'absolute', left: Spacing.three, right: Spacing.three },
  bar: {
    minHeight: 48,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
});
