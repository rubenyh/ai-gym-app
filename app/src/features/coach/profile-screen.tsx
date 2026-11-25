import { useMutation, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { Button, Choice, FormMessage, FormScreen, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { useRepositories } from '@/db/repositories-context';
import { useAccount } from '@/features/account/account-provider';

import { WEEKDAYS } from './approval';
import {
  cmToFeetInches,
  experienceLevels,
  feetInchesToCm,
  fetchTrainingProfile,
  saveTrainingProfile,
  trainingProfileSchema,
  type StoredProfile,
} from './profile';
import { CoachQueryProvider, coachQueryClient, MultiChoice, profileKey } from './ui';

/** PROFILE-01: private training profile used only by the coach. Never shown on the public profile. */
export function TrainingProfileScreen() {
  return (
    <CoachQueryProvider>
      <Loader />
    </CoachQueryProvider>
  );
}

function Loader() {
  const { state } = useAccount();
  const userId = state.kind === 'ready' ? state.userId : null;
  const query = useQuery({ queryKey: profileKey, queryFn: () => fetchTrainingProfile(userId!), enabled: !!userId });
  if (query.isLoading) return <FormScreen title="Training profile"><ThemedText>Loading…</ThemedText></FormScreen>;
  if (query.error || !userId) {
    return (
      <FormScreen title="Training profile">
        <FormMessage text="Could not load your training profile. Check your connection." />
        <Button label="Try again" onPress={() => query.refetch()} />
      </FormScreen>
    );
  }
  const lengthUnit = state.kind === 'ready' ? state.account.settings.lengthUnit : 'cm';
  return <ProfileForm userId={userId} stored={query.data ?? null} lengthUnit={lengthUnit} />;
}

const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

function ProfileForm({ userId, stored, lengthUnit }: { userId: string; stored: StoredProfile | null; lengthUnit: 'cm' | 'ft_in' }) {
  const repos = useRepositories();
  const ftIn = stored?.heightCm ? cmToFeetInches(stored.heightCm) : null;
  const [goal, setGoal] = useState(stored?.goal ?? '');
  const [age, setAge] = useState(stored?.age?.toString() ?? '');
  const [heightCm, setHeightCm] = useState(stored?.heightCm?.toString() ?? '');
  const [feet, setFeet] = useState(ftIn?.feet.toString() ?? '');
  const [inches, setInches] = useState(ftIn?.inches.toString() ?? '');
  const [experience, setExperience] = useState<(typeof experienceLevels)[number] | ''>(stored?.experience ?? '');
  const [equipment, setEquipment] = useState<string[]>(stored?.equipment ?? []);
  const [limitations, setLimitations] = useState(stored?.limitations ?? '');
  const [weekdays, setWeekdays] = useState<number[]>(stored?.availableWeekdays ?? []);
  const [minutes, setMinutes] = useState(stored?.sessionMinutes?.toString() ?? '');
  const [error, setError] = useState<string | null>(null);

  // Equipment names come from the catalog so the coach can match them (O-15 keeps the vocabulary open).
  const equipmentOptions = [...new Set([...repos.catalog.equipment(), ...equipment])].map((e) => ({ value: e, label: e }));

  const save = useMutation({
    mutationFn: async () => {
      const height =
        lengthUnit === 'cm' ? num(heightCm) : feet.trim() || inches.trim() ? feetInchesToCm(num(feet) ?? 0, num(inches) ?? 0) : null;
      const parsed = trainingProfileSchema.safeParse({
        goal,
        age: num(age),
        heightCm: height,
        experience: experience || undefined,
        equipment,
        limitations,
        availableWeekdays: weekdays,
        sessionMinutes: num(minutes),
      });
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new Error(`${String(issue.path[0] ?? 'Profile')}: ${issue.message}`);
      }
      await saveTrainingProfile(userId, stored !== null, parsed.data);
    },
    onSuccess: async () => {
      await coachQueryClient.invalidateQueries({ queryKey: profileKey });
      router.back();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not save.'),
  });

  return (
    <FormScreen title="Training profile">
      <ThemedText type="small">Private. Used only to generate coach drafts; never shown on your profile or posts.</ThemedText>
      <TextField label="Goal" value={goal} onChangeText={setGoal} placeholder="e.g. build strength" maxLength={200} />
      <Choice
        label="Experience"
        options={experienceLevels.map((e) => ({ value: e, label: e[0].toUpperCase() + e.slice(1) }))}
        value={experience as (typeof experienceLevels)[number]}
        onChange={setExperience}
      />
      <MultiChoice
        label="Available weekdays"
        options={WEEKDAYS.map((d, i) => ({ value: i + 1, label: d }))}
        value={weekdays}
        onChange={setWeekdays}
      />
      <TextField label="Session length (minutes)" value={minutes} onChangeText={setMinutes} keyboardType="number-pad" />
      <MultiChoice label="Equipment" options={equipmentOptions} value={equipment} onChange={setEquipment} />
      <TextField label="Age (optional)" value={age} onChangeText={setAge} keyboardType="number-pad" />
      {lengthUnit === 'cm' ? (
        <TextField label="Height in cm (optional)" value={heightCm} onChangeText={setHeightCm} keyboardType="decimal-pad" />
      ) : (
        <>
          <TextField label="Height feet (optional)" value={feet} onChangeText={setFeet} keyboardType="number-pad" />
          <TextField label="Height inches (optional)" value={inches} onChangeText={setInches} keyboardType="number-pad" />
        </>
      )}
      <TextField
        label="Limitations (optional)"
        value={limitations}
        onChangeText={setLimitations}
        placeholder="Movements to avoid"
        multiline
        maxLength={1000}
      />
      <ThemedText type="small">The coach uses limitations to exclude exercises. It is not a medical assessment.</ThemedText>
      <FormMessage text={error} />
      <Button label="Save profile" busy={save.isPending} onPress={() => { setError(null); save.mutate(); }} />
    </FormScreen>
  );
}
