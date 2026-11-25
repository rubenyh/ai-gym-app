import { useMutation, useQuery } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button, FormMessage, FormScreen, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { CoachDraftContent, CoachDraftResponse } from '@/domain/contracts';
import { useLocalQuery, useRepositories } from '@/db/repositories-context';
import { CoachApiError, coachClient } from '@/services/coach-client';

import { buildApprovalDoc, changeSummary, isStale, validateEdited, weekdayLabel } from './approval';
import { Card, CoachQueryProvider, coachQueryClient, draftKey } from './ui';

/** COACH-01/02: review, edit, approve (explicit, once) or cancel (changes nothing locally). */
export function DraftReviewScreen() {
  const { draftId } = useLocalSearchParams<{ draftId: string }>();
  return (
    <CoachQueryProvider>
      <DraftLoader draftId={String(draftId)} />
    </CoachQueryProvider>
  );
}

function DraftLoader({ draftId }: { draftId: string }) {
  const query = useQuery({
    queryKey: draftKey(draftId),
    queryFn: () => coachClient.getDraft(draftId),
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 2000 : false),
  });
  if (query.isLoading || query.data?.status === 'pending') {
    return (
      <FormScreen title="Coach draft">
        <ActivityIndicator accessibilityLabel="Loading draft" />
      </FormScreen>
    );
  }
  if (!query.data) {
    return (
      <FormScreen title="Coach draft">
        <FormMessage text={query.error instanceof Error ? query.error.message : query.isPaused ? 'You are offline. The coach needs a connection.' : 'Could not load the draft.'} />
        <Button label="Try again" onPress={() => query.refetch()} />
      </FormScreen>
    );
  }
  const d = query.data;
  if (d.status !== 'ready' || !d.draft) {
    const text =
      d.status === 'approved' ? 'This draft was already approved.'
      : d.status === 'cancelled' ? 'This draft was cancelled. Nothing changed.'
      : (d.error?.message ?? d.clarification?.question ?? 'This draft cannot be reviewed.');
    return (
      <FormScreen title="Coach draft">
        <ThemedText>{text}</ThemedText>
        <Button label="Back to coach" variant="secondary" onPress={() => router.back()} />
      </FormScreen>
    );
  }
  return <DraftEditor draft={d} initial={d.draft} />;
}

const toInt = (s: string) => (s.trim() === '' ? Number.NaN : Number(s));

function DraftEditor({ draft, initial }: { draft: CoachDraftResponse; initial: CoachDraftContent }) {
  const repos = useRepositories();
  const [content, setContent] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [approvedProgramId, setApprovedProgramId] = useState<string | null>(null);
  // One approval ID per review: a repeated tap re-sends the same command, which applies once.
  const [approvalId] = useState(() => randomUUID());
  const approving = useRef(false);
  const local = useLocalQuery(
    (r) => ({
      active: r.programs.active(),
      approved: approvedProgramId ? (r.programs.list().find((p) => p.id === approvedProgramId) ?? null) : null,
    }),
    [approvedProgramId],
  );
  const stale = !approvedProgramId && isStale(draft, local.active);

  const cancel = useMutation({
    mutationFn: () => coachClient.cancelDraft(draft.draftId),
    onSuccess: (r) => {
      coachQueryClient.setQueryData(draftKey(draft.draftId), r);
      router.back();
    },
    onError: (e) => setError(e instanceof CoachApiError ? e.message : 'Could not cancel. Try again.'),
  });

  const edit = (day: number, ex: number, patch: Partial<CoachDraftContent['days'][number]['exercises'][number]>) =>
    setContent((c) => ({
      ...c,
      days: c.days.map((d, i) => (i !== day ? d : { ...d, exercises: d.exercises.map((e, j) => (j === ex ? { ...e, ...patch } : e)) })),
    }));
  const remove = (day: number, ex: number) =>
    setContent((c) => ({
      ...c,
      days: c.days.map((d, i) => (i !== day ? d : { ...d, exercises: d.exercises.filter((_, j) => j !== ex) })),
    }));

  const approve = () => {
    if (approving.current) return;
    const invalid = validateEdited(content);
    if (invalid) return setError(invalid);
    approving.current = true;
    try {
      const doc = buildApprovalDoc(approvalId, draft, content, randomUUID, (key) => repos.catalog.get(key)?.loadMode ?? 'external');
      repos.programs.applyCoachApproval(doc);
      setError(null);
      setApprovedProgramId(doc.program.id);
    } catch (e) {
      approving.current = false;
      setError(e instanceof Error ? e.message : 'Could not save the program.');
    }
  };

  if (approvedProgramId) {
    const synced = local.approved?.serverRevision != null;
    return (
      <FormScreen title={content.title}>
        <ThemedText accessibilityLiveRegion="polite">
          {synced ? 'Program approved and synced. It is now your active program.' : 'Program approved on this device. Pending sync.'}
        </ThemedText>
        <Button label="Done" onPress={() => router.back()} />
      </FormScreen>
    );
  }

  const routineOf = (id: string) => repos.routines.get(id);
  return (
    <FormScreen title={content.title}>
      <ThemedText>{content.explanation}</ThemedText>
      {content.assumptions.length ? (
        <Card>
          <ThemedText type="smallBold">Assumptions</ThemedText>
          {content.assumptions.map((a) => (
            <ThemedText key={a} type="small">• {a}</ThemedText>
          ))}
        </Card>
      ) : null}
      <Card>
        <ThemedText type="smallBold">Changes</ThemedText>
        {changeSummary(content, local.active, routineOf).map((line) => (
          <ThemedText key={line} type="small">{line}</ThemedText>
        ))}
      </Card>

      {content.days.map((day, di) => (
        <Card key={day.weekday}>
          <ThemedText type="smallBold" accessibilityRole="header">
            {weekdayLabel(day.weekday)} · {day.routineName}
          </ThemedText>
          {day.exercises.map((e, ei) => (
            <View key={e.exerciseKey} style={styles.exercise}>
              <ThemedText>{e.exerciseName}</ThemedText>
              <View style={styles.row}>
                <View style={styles.cell}>
                  <TextField label={`${e.exerciseName} sets`} value={numText(e.sets)} keyboardType="number-pad" onChangeText={(t) => edit(di, ei, { sets: toInt(t) })} />
                </View>
                <View style={styles.cell}>
                  <TextField label={`${e.exerciseName} min reps`} value={numText(e.repsMin)} keyboardType="number-pad" onChangeText={(t) => edit(di, ei, { repsMin: toInt(t) })} />
                </View>
                <View style={styles.cell}>
                  <TextField label={`${e.exerciseName} max reps`} value={numText(e.repsMax)} keyboardType="number-pad" onChangeText={(t) => edit(di, ei, { repsMax: toInt(t) })} />
                </View>
                <View style={styles.cell}>
                  <TextField
                    label={`${e.exerciseName} rest seconds`}
                    value={e.restSeconds === null ? '' : numText(e.restSeconds)}
                    keyboardType="number-pad"
                    onChangeText={(t) => edit(di, ei, { restSeconds: t.trim() === '' ? null : toInt(t) })}
                  />
                </View>
              </View>
              <Button label={`Remove ${e.exerciseName}`} variant="secondary" onPress={() => remove(di, ei)} />
            </View>
          ))}
        </Card>
      ))}

      <ThemedText type="small">Loads are not set by the coach. Pick a weight you can control when you train.</ThemedText>
      <FormMessage text={error} />
      {stale ? (
        <FormMessage text="Your active program changed since this draft was made. Request a new draft before approving." />
      ) : (
        <Button label="Approve and activate" onPress={approve} />
      )}
      <Button label="Cancel draft" variant="secondary" busy={cancel.isPending} onPress={() => cancel.mutate()} />
    </FormScreen>
  );
}

const numText = (n: number) => (Number.isNaN(n) ? '' : String(n));

const styles = StyleSheet.create({
  exercise: { gap: Spacing.one, paddingVertical: Spacing.two },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  cell: { minWidth: 120, flexGrow: 1 },
});
