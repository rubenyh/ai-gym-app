import { useMemo } from 'react';

import { FormScreen } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { formatVolume, formatWeight } from '@/domain/units';

import { completedHistory } from './calc/history';
import { computeRecords } from './calc/records';
import { exerciseTrend } from './calc/trends';
import { Muted, Section, TrendChart } from './ui';
import { useProgressData } from './use-progress-data';

export function ExerciseDetailScreen({ exerciseKey }: { exerciseKey: string }) {
  const { sessions, unit } = useProgressData();
  const history = useMemo(() => completedHistory(sessions), [sessions]);
  const trend = useMemo(() => exerciseTrend(history, exerciseKey), [history, exerciseKey]);
  const records = useMemo(() => computeRecords(history).filter((r) => r.exerciseKey === exerciseKey), [history, exerciseKey]);
  const name = history.flatMap((s) => s.exercises).find((e) => e.exerciseKey === exerciseKey)?.exerciseName ?? 'Exercise';

  return (
    <FormScreen title={name}>
      <Section title="Records">
        {records.length === 0 && <Muted>No records yet.</Muted>}
        {records.map((r) => (
          <ThemedText key={r.loadMode} type="small">
            {r.weightPr ? `Heaviest: ${formatWeight(r.weightPr.loadGrams, unit)} × ${r.weightPr.reps}. ` : ''}
            Best reps: {r.repPrs.map((x) => (x.loadGrams === null ? `${x.reps}` : `${x.reps} @ ${formatWeight(x.loadGrams, unit)}`)).join(', ')}
          </ThemedText>
        ))}
      </Section>
      <Section title="Sessions (set drilldown)">
        <TrendChart trend={trend} unit={unit} />
        <Muted>Total volume: {formatVolume(trend.points.reduce((n, p) => n + p.volumeGramReps, 0), unit)}</Muted>
      </Section>
    </FormScreen>
  );
}
