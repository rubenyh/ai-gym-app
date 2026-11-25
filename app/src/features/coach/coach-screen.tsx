import { useMutation, useQuery } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator } from 'react-native';

import { Button, Choice, FormMessage, FormScreen, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import type { CoachDraftResponse } from '@/domain/contracts';
import { useLocalQuery } from '@/db/repositories-context';
import { useAccount } from '@/features/account/account-provider';
import { CoachApiError, coachApiUrl, coachClient } from '@/services/coach-client';

import { fetchTrainingProfile, missingProfileFields } from './profile';
import { Card, CoachQueryProvider, coachQueryClient, draftKey, profileKey } from './ui';

const PROFILE_FIELDS = new Set(['goal', 'experience', 'equipment', 'limitations', 'availableWeekdays', 'sessionMinutes']);

/** COACH-01 entry: optional coach. Routines and logging never depend on it. */
export function CoachScreen() {
  return (
    <CoachQueryProvider>
      <CoachHome />
    </CoachQueryProvider>
  );
}

function CoachHome() {
  const { state } = useAccount();
  const userId = state.kind === 'ready' ? state.userId : null;
  const active = useLocalQuery((r) => r.programs.active(), []);
  const profile = useQuery({ queryKey: profileKey, queryFn: () => fetchTrainingProfile(userId!), enabled: !!userId });
  const missing = profile.data !== undefined ? missingProfileFields(profile.data) : [];

  const [text, setText] = useState('');
  const [mode, setMode] = useState<'create' | 'adjust'>('create');
  const [answer, setAnswer] = useState('');
  const [response, setResponse] = useState<CoachDraftResponse | null>(null);
  const [error, setError] = useState<CoachApiError | null>(null);
  // Reused across retries after a network error so the server deduplicates (same request ID = same draft).
  const requestId = useRef<string | null>(null);

  const submit = useMutation({
    mutationFn: (preferencesText: string) => {
      requestId.current ??= randomUUID();
      return coachClient.createDraft({
        requestId: requestId.current,
        mode,
        programId: active?.id ?? null,
        baseRevision: active?.serverRevision ?? null,
        preferencesText,
      });
    },
    onMutate: () => {
      setError(null);
      setResponse(null);
    },
    onSuccess: (r) => {
      requestId.current = null; // definitive answer: a new attempt is a new request
      coachQueryClient.setQueryData(draftKey(r.draftId), r);
      setResponse(r);
    },
    onError: (e) => {
      const err = e instanceof CoachApiError ? e : new CoachApiError('error', 'Something went wrong.', true);
      if (err.status !== null && err.status !== 503) requestId.current = null;
      setError(err);
    },
  });

  // A concurrent duplicate returns 'pending': poll until the server finishes.
  const polled = useQuery({
    queryKey: draftKey(response?.draftId ?? 'none'),
    queryFn: () => coachClient.getDraft(response!.draftId),
    enabled: response?.status === 'pending',
    refetchInterval: (q) => (q.state.data?.status === 'pending' || !q.state.data ? 2000 : false),
  });
  const current = polled.data ?? response;

  const send = (extra?: string) => {
    const body = extra ? `${text.trim()}\n${extra}` : text.trim();
    if (body) submit.mutate(body.slice(0, 1000));
  };

  if (!coachApiUrl()) {
    return (
      <FormScreen title="Coach">
        <FormMessage text="The coach is unavailable in this build (no coach server configured). Your routines and workouts work without it." />
      </FormScreen>
    );
  }

  return (
    <FormScreen title="Coach">
      <ThemedText type="small">Describe what you want. The coach creates a draft; nothing changes until you approve it.</ThemedText>
      <Card>
        <ThemedText type="smallBold">Training profile</ThemedText>
        {profile.isLoading ? <ActivityIndicator accessibilityLabel="Loading profile" /> : null}
        {profile.error ? <FormMessage text="Could not load your training profile." /> : null}
        {profile.data !== undefined ? (
          <ThemedText type="small">
            {missing.length ? `Missing: ${missing.join(', ')}` : 'Complete'}
          </ThemedText>
        ) : null}
        <Button label="Edit training profile" variant="secondary" onPress={() => router.push('/coach-draft/profile')} />
      </Card>

      {active ? (
        <Choice
          label="Request type"
          options={[
            { value: 'create', label: 'New program' },
            { value: 'adjust', label: `Adjust "${active.name}"` },
          ]}
          value={mode}
          onChange={(m) => {
            requestId.current = null;
            setMode(m);
          }}
        />
      ) : null}
      <TextField
        label="Your request"
        value={text}
        onChangeText={(t) => {
          requestId.current = null; // different text = different request
          setText(t);
        }}
        placeholder="e.g. prioritize back and include more biceps"
        multiline
        maxLength={1000}
      />
      <Button
        label="Generate draft"
        busy={submit.isPending}
        onPress={() => send()}
      />

      {submit.isPending || current?.status === 'pending' ? (
        <Card>
          <ActivityIndicator />
          <ThemedText accessibilityLiveRegion="polite">Generating your draft. This can take up to 90 seconds.</ThemedText>
        </Card>
      ) : null}

      {error ? (
        <Card>
          <FormMessage text={error.message} />
          {error.retryable ? <Button label="Try again" onPress={() => send()} /> : null}
        </Card>
      ) : null}

      {current?.status === 'failed' && current.error ? (
        <Card>
          <FormMessage text={current.error.message} />
          {current.error.retryable ? <Button label="Try again" onPress={() => send()} /> : null}
        </Card>
      ) : null}

      {current?.status === 'needs_input' && current.clarification ? (
        <Card>
          <ThemedText type="smallBold" accessibilityRole="header">
            The coach needs one detail
          </ThemedText>
          <ThemedText accessibilityLiveRegion="polite">{current.clarification.question}</ThemedText>
          {PROFILE_FIELDS.has(current.clarification.field) ? (
            <Button label="Update training profile" variant="secondary" onPress={() => router.push('/coach-draft/profile')} />
          ) : null}
          <TextField label="Your answer" value={answer} onChangeText={setAnswer} maxLength={300} />
          <Button
            label="Send answer"
            onPress={() => answer.trim() && send(`${current.clarification!.question} ${answer.trim()}`)}
          />
        </Card>
      ) : null}

      {current?.status === 'ready' ? (
        <Card>
          <ThemedText type="smallBold">Draft ready: {current.draft?.title}</ThemedText>
          <Button label="Review draft" onPress={() => router.push(`/coach-draft/${current.draftId}`)} />
        </Card>
      ) : null}
    </FormScreen>
  );
}
