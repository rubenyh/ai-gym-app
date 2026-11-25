import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { formatWeight, type WeightUnit } from '@/domain/units';

import type { ExerciseTrend } from './calc/trends';

export const PENDING_LABEL = 'Pending sync';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <ThemedView type="backgroundElement" style={styles.section}>
      <ThemedText type="smallBold" accessibilityRole="header">
        {title}
      </ThemedText>
      {children}
    </ThemedView>
  );
}

export function Muted({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <ThemedText type="small" themeColor="textSecondary" testID={testID}>
      {children}
    </ThemedText>
  );
}

/** Static horizontal meter (no animation needed; reduced-motion safe). */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max, now: Math.min(value, max) }}
      style={styles.track}>
      <View style={[styles.fill, { width: `${pct}%` }]} />
    </View>
  );
}

/** Per-session bars of actual results (top load, or reps for bodyweight) plus a text table. */
export function TrendChart({ trend, unit }: { trend: ExerciseTrend; unit: WeightUnit }) {
  if (!trend.points.length) return <Muted>No completed sets for this exercise yet.</Muted>;
  const byLoad = trend.points.some((p) => p.topLoadGrams !== null);
  const value = (p: ExerciseTrend['points'][number]) => (byLoad ? (p.topLoadGrams ?? 0) : p.topReps);
  const max = Math.max(...trend.points.map(value), 1);
  const recent = trend.points.slice(-12);
  return (
    <View style={styles.chart}>
      {trend.insufficientData && <Muted>Insufficient data for a trend: log this exercise at least twice.</Muted>}
      {recent.map((p) => {
        const text = `${p.localDate ?? p.completedAt.slice(0, 10)}: ${
          p.topLoadGrams !== null ? `${formatWeight(p.topLoadGrams, unit)} × ${p.topReps}` : `${p.topReps} reps`
        } (${p.sets.length} set${p.sets.length === 1 ? '' : 's'})`;
        return (
          <View key={p.sessionId} accessible accessibilityLabel={text} style={styles.barRow}>
            <View style={[styles.bar, { width: `${Math.max(4, (value(p) / max) * 100)}%` }]} />
            <ThemedText type="small">{text}</ThemedText>
            <Muted>
              {p.sets.map((s) => (s.loadGrams !== null && s.loadMode === 'external' ? `${formatWeight(s.loadGrams, unit, false)}×${s.reps}` : `${s.reps}`)).join('  ')}
              {p.sets.some((s) => s.loadMode === 'assisted') ? '  (assisted)' : ''}
            </Muted>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  track: { height: 12, borderRadius: 6, backgroundColor: '#8884', overflow: 'hidden' },
  fill: { height: 12, borderRadius: 6, backgroundColor: '#3FA34D' },
  chart: { gap: Spacing.two },
  barRow: { gap: Spacing.half },
  bar: { height: 8, borderRadius: 4, backgroundColor: '#2F6FED' },
});
