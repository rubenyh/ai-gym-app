import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { Button, Choice, FormMessage, TextField } from '@/components/form';
import { Card, Row, SectionTitle, SmallButton, Screen } from '@/components/ui/layout';
import { ThemedText } from '@/components/themed-text';
import { useRepositories } from '@/db/repositories-context';
import { routineDoc, type LoadMode, type RoutineDoc } from '@/domain/contracts';
import type { ExerciseSummary } from '@/domain/repositories';
import { formatWeight, parseWeight, type WeightUnit } from '@/domain/units';
import { ExercisePicker } from '@/features/catalog/catalog-screen';

import { confirmDestructive, errorMessage, parseReps, SyncBadge, useWeightUnit } from './common';
import { loadLabel } from './set-row';

type DraftSet = { id: string; reps: string; load: string };
type DraftExercise = { id: string; exerciseKey: string; exerciseName: string; notes: string; rest: string; loadMode: LoadMode; sets: DraftSet[] };

export const LOAD_MODES = [
  { value: 'external', label: 'External' },
  { value: 'bodyweight', label: 'Bodyweight' },
  { value: 'assisted', label: 'Assisted' },
] as const;

function toDraft(doc: RoutineDoc, unit: WeightUnit): DraftExercise[] {
  return doc.exercises.map((e) => ({
    id: e.id,
    exerciseKey: e.exerciseKey,
    exerciseName: e.exerciseName,
    notes: e.notes,
    rest: e.restSeconds === null ? '' : String(e.restSeconds),
    loadMode: e.sets[0]?.loadMode ?? 'external',
    sets: e.sets.map((s) => ({ id: s.id, reps: s.targetReps === null ? '' : String(s.targetReps), load: formatWeight(s.targetLoadGrams, unit, false) })),
  }));
}

/** Converts the editable draft into a routine document, or returns a user-facing error. */
export function buildRoutine(
  base: Pick<RoutineDoc, 'id' | 'archived' | 'origin'>,
  name: string,
  notes: string,
  exercises: DraftExercise[],
  unit: WeightUnit,
): RoutineDoc | string {
  const out: RoutineDoc['exercises'] = [];
  for (const [i, e] of exercises.entries()) {
    const rest = parseReps(e.rest);
    if (Number.isNaN(rest) || (rest !== null && rest > 3600)) return `${e.exerciseName}: rest must be 0–3600 seconds.`;
    const sets = [];
    for (const [j, s] of e.sets.entries()) {
      const reps = parseReps(s.reps);
      if (Number.isNaN(reps)) return `${e.exerciseName} set ${j + 1}: target reps must be a whole number.`;
      const load = e.loadMode === 'bodyweight' ? null : parseWeight(s.load, unit);
      if (load !== null && (Number.isNaN(load) || load > 1_000_000)) return `${e.exerciseName} set ${j + 1}: enter a valid ${unit} value.`;
      sets.push({ id: s.id, position: j, targetReps: reps, targetLoadGrams: load, loadMode: e.loadMode });
    }
    out.push({ id: e.id, position: i, exerciseKey: e.exerciseKey, exerciseName: e.exerciseName, notes: e.notes, restSeconds: rest, sets });
  }
  const parsed = routineDoc.safeParse({ ...base, name: name.trim(), notes, exercises: out });
  if (!parsed.success) return name.trim() ? 'Check the routine: at most 50 exercises and 50 sets each.' : 'Enter a routine name.';
  return parsed.data;
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Routine create/edit (PLAN-01). Edits a local draft; saves the whole document at once. */
export function RoutineEditor({ id }: { id: string }) {
  const repos = useRepositories();
  const unit = useWeightUnit();
  const isNew = id === 'new';
  const [existing] = useState(() => (isNew ? null : repos.routines.get(id)));
  const [base] = useState(() => ({ id: existing?.id ?? randomUUID(), archived: existing?.archived ?? false, origin: existing?.origin ?? ('manual' as const) }));
  const [name, setName] = useState(existing?.name ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [exercises, setExercises] = useState<DraftExercise[]>(() => (existing ? toDraft(existing, unit) : []));
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isNew && !existing) {
    return (
      <Screen>
        <FormMessage text="This routine was not found on this device." />
      </Screen>
    );
  }

  const update = (i: number, patch: Partial<DraftExercise>) => setExercises((list) => list.map((e, j) => (j === i ? { ...e, ...patch } : e)));

  function addExercise(e: ExerciseSummary) {
    const sets = [0, 1, 2].map(() => ({ id: randomUUID(), reps: '', load: '' }));
    setExercises((list) => [
      ...list,
      { id: randomUUID(), exerciseKey: e.key, exerciseName: e.name, notes: '', rest: '90', loadMode: e.loadMode, sets },
    ]);
  }

  function save() {
    const doc = buildRoutine(base, name, notes, exercises, unit);
    if (typeof doc === 'string') return setError(doc);
    try {
      repos.routines.save(doc);
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Screen>
      {existing ? <SyncBadge meta={existing} /> : null}
      <TextField label="Routine name" value={name} onChangeText={setName} maxLength={100} />
      <TextField label="Notes" value={notes} onChangeText={setNotes} multiline maxLength={2000} />

      <SectionTitle>Exercises</SectionTitle>
      {exercises.length === 0 ? <ThemedText themeColor="textSecondary">No exercises yet.</ThemedText> : null}
      {exercises.map((e, i) => (
        <Card key={e.id}>
          <ThemedText type="smallBold">
            {i + 1}. {e.exerciseName}
          </ThemedText>
          <Row>
            <SmallButton label="Up" accessibilityLabel={`Move ${e.exerciseName} up`} disabled={i === 0} onPress={() => setExercises((l) => move(l, i, i - 1))} />
            <SmallButton
              label="Down"
              accessibilityLabel={`Move ${e.exerciseName} down`}
              disabled={i === exercises.length - 1}
              onPress={() => setExercises((l) => move(l, i, i + 1))}
            />
            <SmallButton label="Remove" accessibilityLabel={`Remove ${e.exerciseName}`} onPress={() => setExercises((l) => l.filter((_, j) => j !== i))} />
          </Row>
          <Choice label="Load mode" options={LOAD_MODES} value={e.loadMode} onChange={(loadMode) => update(i, { loadMode })} />
          <TextField label="Rest (seconds)" keyboardType="number-pad" value={e.rest} onChangeText={(rest) => update(i, { rest })} />
          {e.sets.map((s, j) => (
            <View key={s.id} style={styles.set}>
              <ThemedText type="smallBold">Set {j + 1}</ThemedText>
              <TextField
                label="Target reps"
                accessibilityLabel={`${e.exerciseName} set ${j + 1} target reps`}
                keyboardType="number-pad"
                value={s.reps}
                onChangeText={(reps) => update(i, { sets: e.sets.map((x) => (x.id === s.id ? { ...x, reps } : x)) })}
              />
              {e.loadMode !== 'bodyweight' ? (
                <TextField
                  label={`Target ${loadLabel(e.loadMode, unit).toLowerCase()}`}
                  accessibilityLabel={`${e.exerciseName} set ${j + 1} target ${loadLabel(e.loadMode, unit).toLowerCase()}`}
                  keyboardType="decimal-pad"
                  placeholder="Optional"
                  value={s.load}
                  onChangeText={(load) => update(i, { sets: e.sets.map((x) => (x.id === s.id ? { ...x, load } : x)) })}
                />
              ) : null}
              <SmallButton
                label="Remove"
                accessibilityLabel={`Remove ${e.exerciseName} set ${j + 1}`}
                onPress={() => update(i, { sets: e.sets.filter((x) => x.id !== s.id) })}
              />
            </View>
          ))}
          <SmallButton
            label="Add set"
            accessibilityLabel={`Add set to ${e.exerciseName}`}
            onPress={() => {
              const last = e.sets.at(-1);
              update(i, { sets: [...e.sets, { id: randomUUID(), reps: last?.reps ?? '', load: last?.load ?? '' }] });
            }}
          />
        </Card>
      ))}
      <SmallButton label="Add exercise" onPress={() => setPicking(true)} />
      <ExercisePicker visible={picking} onClose={() => setPicking(false)} onSelect={addExercise} />

      <FormMessage text={error} />
      <Button label="Save routine" onPress={save} />
      {existing ? (
        <Row>
          <SmallButton
            label={existing.archived ? 'Unarchive' : 'Archive'}
            onPress={() =>
              existing.archived
                ? (repos.routines.setArchived(existing.id, false), router.back())
                : confirmDestructive('Archive routine?', 'It is hidden from your list but stays readable in past workouts.', 'Archive', () => {
                    repos.routines.setArchived(existing.id, true);
                    router.back();
                  })
            }
          />
          <SmallButton
            label="Delete"
            accessibilityLabel="Delete routine"
            onPress={() =>
              confirmDestructive('Delete routine?', 'Past workouts are not changed.', 'Delete', () => {
                repos.routines.delete(existing.id);
                router.back();
              })
            }
          />
        </Row>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({ set: { gap: Spacing.one, paddingVertical: Spacing.one } });
