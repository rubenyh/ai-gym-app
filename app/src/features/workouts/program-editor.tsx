import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { useState } from 'react';

import { Button, Choice, FormMessage, TextField } from '@/components/form';
import { Row, Screen, SmallButton } from '@/components/ui/layout';
import { ThemedText } from '@/components/themed-text';
import { useLocalQuery, useRepositories } from '@/db/repositories-context';
import { programDoc, type ProgramDoc } from '@/domain/contracts';

import { confirmDestructive, errorMessage, SyncBadge, WEEKDAYS } from './common';

/** Weekly program: one routine per weekday at most, activate one program (PLAN-01). */
export function ProgramEditor({ id }: { id?: string }) {
  const repos = useRepositories();
  const [existing] = useState(() => (id ? (repos.programs.list().find((p) => p.id === id) ?? null) : null));
  const routines = useLocalQuery((r) => r.routines.list(), []);
  const [name, setName] = useState(existing?.name ?? '');
  const [days, setDays] = useState<Record<number, string>>(() =>
    Object.fromEntries((existing?.days ?? []).map((d) => [d.weekday, d.routineId])),
  );
  const [error, setError] = useState<string | null>(null);

  if (id && !existing) {
    return (
      <Screen>
        <FormMessage text="This program was not found on this device." />
      </Screen>
    );
  }

  const options = [{ value: '', label: 'Rest' }, ...routines.map((r) => ({ value: r.id, label: r.name }))];

  function save(activate: boolean) {
    const doc: ProgramDoc = {
      id: existing?.id ?? randomUUID(),
      name: name.trim(),
      active: existing?.active ?? false,
      origin: existing?.origin ?? 'manual',
      coachDraftId: existing?.coachDraftId ?? null,
      days: Object.entries(days)
        .filter(([, routineId]) => routineId)
        .map(([weekday, routineId]) => ({ weekday: Number(weekday), routineId })),
    };
    if (!programDoc.safeParse(doc).success) return setError(doc.name ? 'Check the weekday assignments.' : 'Enter a program name.');
    try {
      repos.programs.save(doc);
      if (activate) repos.programs.activate(doc.id);
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Screen>
      {existing ? <SyncBadge meta={existing} /> : null}
      <TextField label="Program name" value={name} onChangeText={setName} maxLength={100} />
      {routines.length === 0 ? (
        <ThemedText themeColor="textSecondary">Create a routine first, then assign it to weekdays.</ThemedText>
      ) : null}
      {WEEKDAYS.map((day, i) => (
        <Choice
          key={day}
          label={day}
          options={options}
          value={days[i + 1] ?? ''}
          onChange={(routineId) => setDays((d) => ({ ...d, [i + 1]: routineId }))}
        />
      ))}
      <FormMessage text={error} />
      <Button label="Save program" onPress={() => save(false)} />
      {existing?.active ? (
        <ThemedText themeColor="textSecondary">This is your active program.</ThemedText>
      ) : (
        <Button label="Save and activate" variant="secondary" onPress={() => save(true)} />
      )}
      {existing ? (
        <Row>
          <SmallButton
            label="Delete program"
            onPress={() =>
              confirmDestructive('Delete program?', 'Its routines and past workouts are kept.', 'Delete', () => {
                repos.programs.delete(existing.id);
                router.back();
              })
            }
          />
        </Row>
      ) : null}
    </Screen>
  );
}
