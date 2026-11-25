import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert } from 'react-native';

import { Button, TextField } from '@/components/form';
import { Card, Row, Screen, SectionTitle, SmallButton } from '@/components/ui/layout';
import { ThemedText } from '@/components/themed-text';
import { useLocalQuery, useRepositories } from '@/db/repositories-context';
import type { PreviousResult, RestTimer } from '@/domain/repositories';
import { formatWeight, type WeightUnit } from '@/domain/units';
import { ExercisePicker } from '@/features/catalog/catalog-screen';

import { confirmDestructive, errorMessage, formatClock, SyncBadge, useNow, useWeightUnit } from './common';
import { SetRow } from './set-row';

const DEFAULT_REST_SECONDS = 90;

/** Notes input that commits on blur/submit only; parent keys it by the committed value. */
export function NotesField({ label, value, onCommit }: { label: string; value: string; onCommit: (text: string) => void }) {
  const [text, setText] = useState(value);
  const commit = () => text !== value && onCommit(text);
  return <TextField label={label} value={text} onChangeText={setText} onBlur={commit} onSubmitEditing={commit} multiline maxLength={2000} />;
}

export function previousText(prev: PreviousResult | null, unit: WeightUnit): string | null {
  if (!prev || prev.sets.length === 0) return null;
  const sets = prev.sets.map((s) => {
    const reps = s.reps ?? 0;
    if (s.loadMode === 'bodyweight' || s.loadGrams === null) return `${reps} reps`;
    return `${reps} × ${formatWeight(s.loadGrams, unit)}${s.loadMode === 'assisted' ? ' assist' : ''}`;
  });
  return `Last time: ${sets.join(', ')}`;
}

/**
 * Rest countdown from the persisted deadline: recomputed from the wall clock, so it survives restarts.
 * Owns its 1 s ticker so only this banner re-renders each second, never the set list.
 */
export function RestTimerBanner({ timer, onDismiss }: { timer: RestTimer; onDismiss: () => void }) {
  if (!timer) return null;
  return <RestCountdown endsAt={timer.endsAt} onDismiss={onDismiss} />;
}

/** Elapsed workout time; isolated ticker (see RestTimerBanner). */
export function ElapsedClock({ startedAt }: { startedAt: string }) {
  const text = formatClock(useNow() - Date.parse(startedAt));
  return <ThemedText accessibilityLabel={`Elapsed ${text}`}>{text}</ThemedText>;
}

function RestCountdown({ endsAt, onDismiss }: { endsAt: string; onDismiss: () => void }) {
  const remaining = Date.parse(endsAt) - useNow();
  return (
    <Card>
      <Row>
        <ThemedText type="smallBold" accessibilityRole="timer" style={{ flex: 1 }}>
          {remaining > 0 ? `Rest ${formatClock(remaining)}` : 'Rest complete'}
        </ThemedText>
        <SmallButton label="Dismiss" accessibilityLabel="Dismiss rest timer" onPress={onDismiss} />
      </Row>
    </Card>
  );
}

/** Active workout logger (SESSION-02/03). Every change is one committed local write; nothing waits on network. */
export function LoggerScreen({ sessionId }: { sessionId: string }) {
  const repos = useRepositories();
  const unit = useWeightUnit();
  const [picking, setPicking] = useState(false);
  const data = useLocalQuery((r) => ({ session: r.sessions.get(sessionId), timer: r.sessions.restTimer() }), [sessionId]);
  const { session } = data;
  // Previous results exclude this session, so set saves cannot change them: re-query only when the
  // exercise list changes, not on every committed set (one query per exercise).
  const exerciseKeys = (session?.exercises ?? []).map((e) => e.exerciseKey).join('|');
  const previous = useMemo(
    () => new Map(exerciseKeys ? exerciseKeys.split('|').map((k) => [k, repos.sessions.previousResults(k, sessionId)]) : []),
    [repos, exerciseKeys, sessionId],
  );

  const run = (write: () => void) => {
    try {
      write();
    } catch (e) {
      Alert.alert('Could not save', errorMessage(e));
    }
  };

  if (!session) {
    return (
      <Screen>
        <ThemedText>This workout no longer exists on this device.</ThemedText>
      </Screen>
    );
  }
  if (session.status === 'completed') {
    return (
      <Screen>
        <ThemedText>This workout is finished.</ThemedText>
        <Button label="View summary" onPress={() => router.replace({ pathname: '/training/summary/[id]', params: { id: sessionId } })} />
      </Screen>
    );
  }

  function finish() {
    const hasCompleted = session!.exercises.some((e) => e.sets.some((s) => s.completed));
    if (!hasCompleted) {
      Alert.alert('No completed sets', 'Complete at least one set to finish. An empty workout can only be discarded and earns no reward.', [
        { text: 'Keep logging', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => run(() => (repos.sessions.discard(sessionId), router.back())) },
      ]);
      return;
    }
    run(() => {
      repos.sessions.finish(sessionId);
      router.replace({ pathname: '/training/summary/[id]', params: { id: sessionId } });
    });
  }

  const timerForThis = data.timer?.sessionId === sessionId ? data.timer : null;

  return (
    <Screen>
      <Row>
        <ThemedText type="smallBold" style={{ flex: 1 }}>
          {session.name}
        </ThemedText>
        <ElapsedClock startedAt={session.startedAt} />
      </Row>
      <SyncBadge meta={session} />
      <RestTimerBanner timer={timerForThis} onDismiss={() => run(() => repos.sessions.clearRestTimer())} />

      {session.exercises.length === 0 ? <ThemedText themeColor="textSecondary">No exercises yet. Add one to start logging.</ThemedText> : null}
      {session.exercises.map((ex, i) => {
        const prev = previousText(previous.get(ex.exerciseKey) ?? null, unit);
        return (
          <Card key={ex.id}>
            <SectionTitle>{ex.exerciseName}</SectionTitle>
            {prev ? (
              <ThemedText type="small" themeColor="textSecondary">
                {prev}
              </ThemedText>
            ) : null}
            <Row>
              <SmallButton
                label="Up"
                accessibilityLabel={`Move ${ex.exerciseName} up`}
                disabled={i === 0}
                onPress={() => run(() => repos.sessions.moveExercise(sessionId, ex.id, i - 1))}
              />
              <SmallButton
                label="Down"
                accessibilityLabel={`Move ${ex.exerciseName} down`}
                disabled={i === session.exercises.length - 1}
                onPress={() => run(() => repos.sessions.moveExercise(sessionId, ex.id, i + 1))}
              />
              <SmallButton
                label="Remove"
                accessibilityLabel={`Remove ${ex.exerciseName}`}
                onPress={() =>
                  confirmDestructive('Remove exercise?', `${ex.exerciseName} and its sets will be removed from this workout.`, 'Remove', () =>
                    run(() => repos.sessions.removeExercise(sessionId, ex.id)),
                  )
                }
              />
            </Row>
            {ex.sets.map((s, j) => (
              <SetRow
                key={`${s.id}:${s.reps}:${s.loadGrams}:${unit}`}
                set={s}
                index={j}
                unit={unit}
                handlers={{
                  onCommitReps: (reps) => run(() => repos.sessions.updateSet(sessionId, s.id, { reps })),
                  onCommitLoad: (loadGrams) => run(() => repos.sessions.updateSet(sessionId, s.id, { loadGrams })),
                  onToggle: (completed) =>
                    run(() => {
                      const before = repos.sessions.restTimer()?.endsAt;
                      repos.sessions.setCompleted(sessionId, s.id, completed);
                      // The repository may start the rest timer itself; start it here only if it did not.
                      if (completed && ex.restSeconds && repos.sessions.restTimer()?.endsAt === before) {
                        repos.sessions.startRestTimer(sessionId, ex.restSeconds);
                      }
                    }),
                  onRemove: () => run(() => repos.sessions.removeSet(sessionId, s.id)),
                }}
              />
            ))}
            <Row>
              <SmallButton
                label="Add set"
                accessibilityLabel={`Add set to ${ex.exerciseName}`}
                onPress={() => run(() => repos.sessions.addSet(sessionId, ex.id))}
              />
              <SmallButton
                label={`Rest ${ex.restSeconds ?? DEFAULT_REST_SECONDS}s`}
                accessibilityLabel={`Start ${ex.restSeconds ?? DEFAULT_REST_SECONDS} second rest timer`}
                onPress={() => run(() => repos.sessions.startRestTimer(sessionId, ex.restSeconds ?? DEFAULT_REST_SECONDS))}
              />
            </Row>
            <NotesField
              key={ex.notes}
              label={`${ex.exerciseName} notes`}
              value={ex.notes}
              onCommit={(notes) => run(() => repos.sessions.setExerciseNotes(sessionId, ex.id, notes))}
            />
          </Card>
        );
      })}

      <SmallButton label="Add exercise" onPress={() => setPicking(true)} />
      <ExercisePicker visible={picking} onClose={() => setPicking(false)} onSelect={(e) => run(() => repos.sessions.addExercise(sessionId, e.key))} />
      <NotesField key={session.notes} label="Workout notes" value={session.notes} onCommit={(notes) => run(() => repos.sessions.setNotes(sessionId, notes))} />

      <Button label="Finish workout" onPress={finish} />
      <Button
        label="Discard workout"
        variant="secondary"
        onPress={() =>
          confirmDestructive('Discard workout?', 'All sets logged in this workout will be deleted.', 'Discard', () =>
            run(() => {
              repos.sessions.discard(sessionId);
              router.back();
            }),
          )
        }
      />
    </Screen>
  );
}
