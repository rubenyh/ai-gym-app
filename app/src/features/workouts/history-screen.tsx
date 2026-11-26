import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { useLayoutEffect, useRef, useState } from 'react';
import { Alert, Pressable } from 'react-native';

import { Button, FormMessage, TextField } from '@/components/form';
import { Card, Row, Screen, SectionTitle, SmallButton } from '@/components/ui/layout';
import { ThemedText } from '@/components/themed-text';
import { useLocalQuery, useRepositories } from '@/db/repositories-context';
import { sessionDoc, type PerformedSet, type SessionDoc } from '@/domain/contracts';
import type { HistoryCursor, Repositories, SyncMeta } from '@/domain/repositories';
import { deletePost, findPostsForSession } from '@/features/community/api';

import { errorMessage, formatClock, REPS_REQUIRED, sessionStats, SyncBadge, useWeightUnit } from './common';
import { SetRow } from './set-row';
import { publishHref, SessionStats } from './summary-screen';

const PAGE_SIZE = 30;

/** Pages through history with the (completedAt, id) cursor; re-reads all loaded pages after each write. */
export function readHistoryPages(r: Repositories, pages: number) {
  const sessions: (SessionDoc & SyncMeta)[] = [];
  let before: HistoryCursor | undefined;
  for (let i = 0; i < pages; i++) {
    const page = r.sessions.history({ limit: PAGE_SIZE, before });
    sessions.push(...page);
    if (page.length < PAGE_SIZE) return { sessions, hasMore: false };
    const last = page[page.length - 1];
    before = { completedAt: last.completedAt!, id: last.id };
  }
  return { sessions, hasMore: true };
}

export function HistoryScreen() {
  const [pages, setPages] = useState(1);
  const { sessions, hasMore } = useLocalQuery((r) => readHistoryPages(r, pages), [pages]);
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
      {hasMore ? <Button label="Load more" variant="secondary" onPress={() => setPages((n) => n + 1)} /> : null}
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
  const latestDraft = useRef(draft);
  useLayoutEffect(() => {
    latestDraft.current = draft;
  });

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
          onPress={() => confirmDeleteSession(sessionId, () => {
            try {
              repos.sessions.delete(sessionId);
              router.back();
            } catch (e) {
              setError(errorMessage(e));
            }
          })}
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
    // Tapping Save blurs the field being typed in, whose commit updates the draft after this press handler was
    // bound: read the latest committed draft, not the one this render closed over (it lost the last edit).
    const draft = latestDraft.current;
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
      <TextField label="Workout name" value={draft.name} onChangeText={(name) => setDraft((d) => d && { ...d, name })} maxLength={100} />
      {draft.exercises.map((ex) => (
        <Card key={ex.id}>
          <SectionTitle>{ex.exerciseName}</SectionTitle>
          {ex.sets.map((s, j) => (
            <SetRow
              key={s.id}
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
            onChangeText={(notes) => setDraft((d) => d && { ...d, exercises: d.exercises.map((e) => (e.id === ex.id ? { ...e, notes } : e)) })}
          />
        </Card>
      ))}
      <TextField label="Workout notes" value={draft.notes} multiline maxLength={2000} onChangeText={(notes) => setDraft((d) => d && { ...d, notes })} />
      <FormMessage text={error} />
      <Button label="Save changes" onPress={save} />
      <Row>
        <SmallButton label="Cancel editing" onPress={() => (setDraft(null), setError(null))} />
      </Row>
    </Screen>
  );
}

/**
 * SOCIAL-05: deleting a source workout never silently deletes its posts. If posts exist (checked online,
 * before the server unlinks them), offer keep-post or delete-both; offline falls back to a plain warning.
 */
async function confirmDeleteSession(sessionId: string, deleteSession: () => void) {
  let posts: { id: string; photoPath: string | null }[] = [];
  try {
    posts = await findPostsForSession(sessionId);
  } catch {
    // Offline or not signed in: posts cannot be checked now; the generic warning still applies.
  }
  if (posts.length === 0) {
    Alert.alert(
      'Delete workout?',
      'Progress and rewards are recalculated. Published posts are not deleted automatically; delete them from Community.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: deleteSession },
      ],
    );
    return;
  }
  Alert.alert(
    'This workout is published',
    `${posts.length === 1 ? 'A post' : `${posts.length} posts`} use this workout. Posts are independent copies and stay public unless you delete them too.`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Keep post, delete workout', onPress: deleteSession },
      {
        text: 'Delete both',
        style: 'destructive',
        onPress: async () => {
          const results = await Promise.allSettled(posts.map((p) => deletePost(p)));
          // Never report "both deleted" while a post is still public: keep the workout so the user can retry.
          if (results.some((r) => r.status === 'rejected')) {
            Alert.alert('Post not deleted', 'Your workout was kept. Check your connection and try again, or delete the post from Community.');
            return;
          }
          deleteSession();
        },
      },
    ],
  );
}
