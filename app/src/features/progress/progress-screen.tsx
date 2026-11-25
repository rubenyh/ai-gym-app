import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Choice } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useLocalQuery } from '@/db/repositories-context';
import { formatVolume, formatWeight } from '@/domain/units';

import { weeklyConsistency } from './calc/consistency';
import { weekStart } from './calc/dates';
import { completedHistory, sessionLocalDate } from './calc/history';
import { computeRecords } from './calc/records';
import { exerciseTrend, performedExercises } from './calc/trends';
import { sessionVolume } from './calc/volume';
import { Muted, PENDING_LABEL, Section, TrendChart } from './ui';
import { useProgressData } from './use-progress-data';

export function ProgressScreen() {
  const { sessions, goals, unit, today } = useProgressData();
  const history = useMemo(() => completedHistory(sessions), [sessions]);
  const exercises = useMemo(() => performedExercises(history), [history]);
  const records = useMemo(() => computeRecords(history), [history]);
  const weeks = useMemo(() => weeklyConsistency(history, goals, today).slice(0, 8), [history, goals, today]);
  const [selected, setSelected] = useState<string | null>(null);
  const key = exercises.some((e) => e.key === selected) ? selected! : exercises[0]?.key;
  const trend = useMemo(() => (key ? exerciseTrend(history, key) : null), [history, key]);
  const latestWeight = useLocalQuery((r) => [...r.bodyWeight.list()].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0] ?? null, []);

  const thisWeek = weekStart(today);
  const weekVolume = history.filter((s) => weekStart(sessionLocalDate(s) ?? '1970-01-01') === thisWeek).reduce((n, s) => n + sessionVolume(s), 0);
  const allVolume = history.reduce((n, s) => n + sessionVolume(s), 0);

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="subtitle" accessibilityRole="header">
            Progress
          </ThemedText>

          <Section title="Weekly consistency">
            {weeks.length ? (
              weeks.map((w) => (
                <ThemedText key={w.weekStart} type="small">
                  Week of {w.weekStart}: {w.days} / {w.targetDays} days{w.achieved ? ' ✓ goal reached' : ''}
                </ThemedText>
              ))
            ) : (
              <Muted>No weekly goal yet.</Muted>
            )}
          </Section>

          <Section title="Volume (completed external load)">
            <ThemedText type="small" testID="volume-week">This week: {formatVolume(weekVolume, unit)}</ThemedText>
            <ThemedText type="small">All time: {formatVolume(allVolume, unit)}</ThemedText>
            <Muted>Logged load × reps. Bodyweight and assisted sets are not included.</Muted>
          </Section>

          <Section title="Exercise trends">
            {key && trend ? (
              <>
                <Choice label="Exercise" options={exercises.map((e) => ({ value: e.key, label: e.name }))} value={key} onChange={setSelected} />
                <TrendChart trend={trend} unit={unit} />
                <Link href={{ pathname: '/insights/exercise/[key]', params: { key } }} accessibilityRole="button" style={styles.link}>
                  <ThemedText type="linkPrimary">Exercise details</ThemedText>
                </Link>
              </>
            ) : (
              <Muted>Complete a workout to see trends.</Muted>
            )}
          </Section>

          <Section title="Records">
            {records.length ? (
              records.map((r) => (
                <View key={`${r.exerciseKey}|${r.loadMode}`}>
                  <ThemedText type="smallBold">
                    {r.exerciseName}
                    {r.loadMode === 'bodyweight' ? ' (bodyweight)' : ''}
                  </ThemedText>
                  {r.weightPr && (
                    <ThemedText type="small">
                      Heaviest: {formatWeight(r.weightPr.loadGrams, unit)} × {r.weightPr.reps}
                    </ThemedText>
                  )}
                  <Muted>
                    Best reps:{' '}
                    {r.repPrs
                      .slice(0, 4)
                      .map((x) => (x.loadGrams === null ? `${x.reps}` : `${x.reps} @ ${formatWeight(x.loadGrams, unit)}`))
                      .join(', ')}
                  </Muted>
                </View>
              ))
            ) : (
              <Muted>No records yet.</Muted>
            )}
          </Section>

          <Section title="Body weight">
            <ThemedText type="small">
              {latestWeight ? `Latest: ${formatWeight(latestWeight.weightGrams, unit)} on ${latestWeight.measuredAt.slice(0, 10)}` : 'No entries yet.'}
            </ThemedText>
            <Muted>Private. Never shown on your profile or posts.</Muted>
            <Link href="/insights/body-weight" accessibilityRole="button" style={styles.link}>
              <ThemedText type="linkPrimary">Log or edit body weight</ThemedText>
            </Link>
          </Section>

          <Section title="History">
            {history.length ? (
              history.slice(0, 30).map((s) => (
                <View key={s.id} accessible>
                  <ThemedText type="small">
                    {sessionLocalDate(s)} · {s.name}
                  </ThemedText>
                  <Muted>
                    {formatVolume(sessionVolume(s), unit)}
                    {s.pendingOps > 0 ? ` · ${PENDING_LABEL}` : ''}
                  </Muted>
                </View>
              ))
            ) : (
              <Muted>No completed workouts yet.</Muted>
            )}
          </Section>

          <Link href="/insights/achievements" accessibilityRole="button" style={styles.link}>
            <ThemedText type="linkPrimary">Achievements and pet</ThemedText>
          </Link>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Room for the floating ActiveSessionBar above the tab bar.
  content: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six * 2 },
  link: { minHeight: 44, paddingVertical: Spacing.two },
});
