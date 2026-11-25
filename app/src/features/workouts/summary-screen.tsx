import { router, type Href } from 'expo-router';
import { useState } from 'react';

import { Button, FormMessage, TextField } from '@/components/form';
import { Card, Screen, SectionTitle } from '@/components/ui/layout';
import { ThemedText } from '@/components/themed-text';
import { useLocalQuery, useRepositories } from '@/db/repositories-context';
import type { SessionDoc } from '@/domain/contracts';
import { SummaryRewards } from '@/features/progress/summary-rewards';
import { formatVolume, formatWeight, type WeightUnit } from '@/domain/units';

import { errorMessage, formatClock, sessionStats, SyncBadge, useWeightUnit } from './common';

export function setText(s: SessionDoc['exercises'][number]['sets'][number], unit: WeightUnit) {
  const reps = `${s.reps ?? 0} reps`;
  if (s.loadMode === 'bodyweight' || s.loadGrams === null) return reps;
  return `${reps} × ${formatWeight(s.loadGrams, unit)}${s.loadMode === 'assisted' ? ' assistance' : ''}`;
}

/** Completed exercises/sets, duration and volume. Shared by the summary and history detail. */
export function SessionStats({ session, unit }: { session: SessionDoc; unit: WeightUnit }) {
  const stats = sessionStats(session);
  return (
    <>
      <Card>
        <ThemedText>
          {stats.exercises} {stats.exercises === 1 ? 'exercise' : 'exercises'} · {stats.sets} {stats.sets === 1 ? 'set' : 'sets'}
        </ThemedText>
        <ThemedText>Duration {formatClock(stats.durationMs)}</ThemedText>
        <ThemedText>Volume {formatVolume(stats.volumeGramReps, unit)}</ThemedText>
      </Card>
      {session.exercises
        .filter((e) => e.sets.some((s) => s.completed))
        .map((e) => (
          <Card key={e.id}>
            <SectionTitle>{e.exerciseName}</SectionTitle>
            {e.sets
              .filter((s) => s.completed)
              .map((s, i) => (
                <ThemedText key={s.id} type="small">
                  Set {i + 1}: {setText(s, unit)}
                </ThemedText>
              ))}
            {e.notes ? (
              <ThemedText type="small" themeColor="textSecondary">
                {e.notes}
              </ThemedText>
            ) : null}
          </Card>
        ))}
      {session.notes ? <ThemedText themeColor="textSecondary">{session.notes}</ThemedText> : null}
    </>
  );
}

export function publishHref(sessionId: string) {
  // Route owned by the community feature.
  return `/social/publish/${sessionId}` as Href;
}

/** Post-finish summary (SESSION-04). Publishing is offered, never automatic. */
export function SummaryScreen({ sessionId }: { sessionId: string }) {
  const repos = useRepositories();
  const unit = useWeightUnit();
  const session = useLocalQuery((r) => r.sessions.get(sessionId), [sessionId]);
  const [routineName, setRoutineName] = useState(session?.name ?? '');
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);

  if (!session) {
    return (
      <Screen>
        <ThemedText>This workout no longer exists on this device.</ThemedText>
        <Button label="Done" onPress={() => router.navigate('/workouts')} />
      </Screen>
    );
  }

  function saveRoutine() {
    if (!routineName.trim()) return setMessage({ text: 'Enter a routine name.', tone: 'error' });
    try {
      repos.routines.createFromSession(sessionId, routineName.trim());
      setMessage({ text: `Saved routine "${routineName.trim()}".`, tone: 'info' });
    } catch (e) {
      setMessage({ text: errorMessage(e), tone: 'error' });
    }
  }

  return (
    <Screen>
      <ThemedText type="subtitle" accessibilityRole="header">
        {session.name}
      </ThemedText>
      <SyncBadge meta={session} />
      <SessionStats session={session} unit={unit} />
      <SummaryRewards sessionId={sessionId} />

      <TextField label="Routine name" value={routineName} onChangeText={setRoutineName} maxLength={100} />
      <Button label="Save as routine" variant="secondary" onPress={saveRoutine} />
      <FormMessage text={message?.text} tone={message?.tone} />
      <Button
        label="Edit workout"
        variant="secondary"
        onPress={() => router.push({ pathname: '/training/history/[id]', params: { id: sessionId } })}
      />
      <Button label="Publish to community" variant="secondary" onPress={() => router.push(publishHref(sessionId))} />
      <Button label="Done" onPress={() => router.navigate('/workouts')} />
    </Screen>
  );
}
