import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable } from 'react-native';

import { Button, FormMessage, TextField } from '@/components/form';
import { Card, Row, Screen, SectionTitle, SmallButton } from '@/components/ui/layout';
import { ThemedText } from '@/components/themed-text';
import { useLocalQuery, useRepositories } from '@/db/repositories-context';
import { sessionDoc, type PerformedSet, type SessionDoc } from '@/domain/contracts';
import type { SyncMeta } from '@/domain/repositories';

import { confirmDestructive, errorMessage, formatClock, REPS_REQUIRED, sessionStats, SyncBadge, useWeightUnit } from './common';
import { SetRow } from './set-row';
import { publishHref, SessionStats } from './summary-screen';

const HISTORY_LIMIT = 100;

export function HistoryScreen() {
  // ponytail: first 100 workouts only; add `before` cursor paging when history grows past that.
  const sessions = useLocalQuery((r) => r.sessions.history({ limit: HISTORY_LIMIT }), []);
  return (
    <Screen>
      {sessions.length === 0 ? <ThemedText themeColor="textSecondary">No finished workouts yet.</ThemedText> : null}
      {sessions.map((s) => {
        const stats = sessionStats(s);
        return (
          <Pressable
            key={s.id}
            accessibilityRole="button"
            accessibilityLabel={`${s.name}, ${s.localDate ?? ''}, ${stats.sets} sets`}
            onPress={() => router.push({ pathname: '/training/history/[id]', params: { id: s.id } })}>
            <Card>
              <Row>
                <ThemedText type="smallBold">{s.name}</ThemedText>
                <SyncBadge meta={s} />
              </Row>
              <ThemedText type="small" themeColor="textSecondary">
                {s.localDate} · {formatClock(stats.durationMs)} · {stats.sets} sets
              </ThemedText>
            </Card>
          </Pressable>
        );
      })}
    </Screen>
  );
}

function stripMeta(doc: SessionDoc & SyncMeta): SessionDoc {
  const { serverRevision: _r, pendingOps: _p, conflict: _c, ...rest } = doc;
  return structuredClone(rest);
}

/** Completed-session detail with edit (validated full replace) and delete (SESSION-04). */
export function SessionDetailScreen({ sessionId }: { sessionId: string }) {
  const repos = useRepositories();
  const unit = useWeightUnit();
  const session = useLocalQuery((r) => r.sessions.get(sessionId), [sessionId]);
  const [draft, setDraft] = useState<SessionDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!session) {
    return (
      <Screen>
        <ThemedText>This workout no longer exists on this device.</ThemedText>
      </Screen>
    );
  }
  if (session.status !== 'completed') {
    return (
      <Screen>
        <ThemedText>This workout is still active.</ThemedText>
        <Button label="Open logger" onPress={() => router.replace({ pathname: '/training/session/[id]', params: { id: sessionId } })} />
      </Screen>
    );
  }

  if (!draft) {
    return (
      <Screen>
        <ThemedText type="subtitle" accessibilityRole="header">
          {session.name}
        </ThemedText>
        <ThemedText themeColor="textSecondary">{session.localDate}</ThemedText>
        <SyncBadge meta={session} />
        <SessionStats session={session} unit={unit} />
        <Button label="Edit workout" onPress={() => setDraft(stripMeta(session))} />
        <Button label="Publish to community" variant="secondary" onPress={() => router.push(publishHref(sessionId))} />
        <Button
          label="Delete workout"
          variant="secondary"
          onPress={() =>
            confirmDestructive(
              'Delete workout?',
              'Progress and rewards are recalculated. Published posts are not deleted automatically; delete them from Community.',
              'Delete',
              () => {
                try {
                  repos.sessions.delete(sessionId);
                  router.back();
                } catch (e) {
                  setError(errorMessage(e));
                }
              },
            )
          }
        />
        <FormMessage text={error} />
      </Screen>
    );
  }

  const updateSet = (exId: string, setId: string, patch: Partial<PerformedSet>) =>
    setDraft((d) =>
      d && {
        ...d,
        exercises: d.exercises.map((e) => (e.id !== exId ? e : { ...e, sets: e.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) })),
      },
    );
  const setSets = (exId: string, fn: (sets: PerformedSet[]) => PerformedSet[]) =>
    setDraft((d) => d && { ...d, exercises: d.exercises.map((e) => (e.id !== exId ? e : { ...e, sets: fn(e.sets).map((s, i) => ({ ...s, position: i })) })) });

  function save() {
    if (!draft) return;
    if (draft.exercises.some((e) => e.sets.some((s) => s.completed && !(s.reps && s.reps > 0)))) return setError(REPS_REQUIRED);
    if (!draft.exercises.some((e) => e.sets.some((s) => s.completed))) return setError('A finished workout needs at least one completed set. Delete it instead.');
    const parsed = sessionDoc.safeParse(draft);
    if (!parsed.success) return setError(draft.name.trim() ? 'Some values are out of range.' : 'Enter a workout name.');
    try {
      repos.sessions.saveCompleted(parsed.data);
      setDraft(null);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Screen>
      <TextField label="Workout name" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} maxLength={100} />
      {draft.exercises.map((ex) => (
        <Card key={ex.id}>
          <SectionTitle>{ex.exerciseName}</SectionTitle>
          {ex.sets.map((s, j) => (
            <SetRow
              key={`${s.id}:${s.reps}:${s.loadGrams}:${unit}`}
              set={s}
              index={j}
              unit={unit}
              handlers={{
                onCommitReps: (reps) => updateSet(ex.id, s.id, { reps }),
                onCommitLoad: (loadGrams) => updateSet(ex.id, s.id, { loadGrams }),
                onToggle: (completed) =>
                  updateSet(ex.id, s.id, { completed, completedAt: completed ? (s.completedAt ?? new Date().toISOString()) : null }),
                onRemove: () => setSets(ex.id, (sets) => sets.filter((x) => x.id !== s.id)),
              }}
            />
          ))}
          <SmallButton
            label="Add set"
            accessibilityLabel={`Add set to ${ex.exerciseName}`}
            onPress={() =>
              setSets(ex.id, (sets) => [
                ...sets,
                {
                  id: randomUUID(),
                  position: sets.length,
                  targetReps: null,
                  targetLoadGrams: null,
                  reps: null,
                  loadGrams: null,
                  loadMode: sets.at(-1)?.loadMode ?? 'external',
                  completed: false,
                  completedAt: null,
                },
              ])
            }
          />
          <TextField
            label={`${ex.exerciseName} notes`}
            value={ex.notes}
            multiline
            maxLength={2000}
            onChangeText={(notes) => setDraft({ ...draft, exercises: draft.exercises.map((e) => (e.id === ex.id ? { ...e, notes } : e)) })}
          />
        </Card>
      ))}
      <TextField label="Workout notes" value={draft.notes} multiline maxLength={2000} onChangeText={(notes) => setDraft({ ...draft, notes })} />
      <FormMessage text={error} />
      <Button label="Save changes" onPress={save} />
      <Row>
        <SmallButton label="Cancel editing" onPress={() => (setDraft(null), setError(null))} />
      </Row>
    </Screen>
  );
}
