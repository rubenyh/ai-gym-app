import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { Button, FormScreen, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { useLocalQuery, useRepositories } from '@/db/repositories-context';
import { bodyWeightDoc } from '@/domain/contracts';
import { formatWeight, parseWeight } from '@/domain/units';
import { useWeightUnit } from '@/features/workouts/common';

import { Muted, PENDING_LABEL, Section } from './ui';

/** Private body-weight time series (PROGRESS-01). Stored in grams; entered/shown in the user's unit. */
export function BodyWeightScreen() {
  const repos = useRepositories();
  const unit = useWeightUnit();
  const entries = useLocalQuery((r) => [...r.bodyWeight.list()].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt)), []);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<{ id: string; measuredAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function save() {
    const grams = parseWeight(text, unit);
    const parsed = bodyWeightDoc.shape.weightGrams.safeParse(grams);
    if (grams === null || !parsed.success) {
      setError(`Enter a body weight between ${formatWeight(20_000, unit)} and ${formatWeight(400_000, unit)}.`);
      return;
    }
    try {
      repos.bodyWeight.save({ id: editing?.id, measuredAt: editing?.measuredAt ?? new Date().toISOString(), weightGrams: parsed.data });
      setText('');
      setEditing(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
  }

  return (
    <FormScreen title="Body weight">
      <Muted>Private: never shown on your profile or in posts.</Muted>
      <TextField
        label={`${editing ? 'Edit entry' : 'Today'} (${unit})`}
        keyboardType="decimal-pad"
        value={text}
        onChangeText={setText}
        error={error ?? undefined}
      />
      <Button label={editing ? 'Save changes' : 'Add entry'} onPress={save} />
      {editing && (
        <Button
          label="Cancel edit"
          variant="secondary"
          onPress={() => {
            setEditing(null);
            setText('');
          }}
        />
      )}
      <Section title="History">
        {entries.length === 0 && <Muted>No entries yet.</Muted>}
        {entries.map((e) => (
          <View key={e.id}>
            <ThemedText type="small">
              {e.measuredAt.slice(0, 10)} · {formatWeight(e.weightGrams, unit)}
              {e.pendingOps > 0 ? ` · ${PENDING_LABEL}` : ''}
            </ThemedText>
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Edit entry from ${e.measuredAt.slice(0, 10)}`}
                style={{ minHeight: 44, minWidth: 44, justifyContent: 'center' }}
                onPress={() => {
                  setEditing({ id: e.id, measuredAt: e.measuredAt });
                  setText(formatWeight(e.weightGrams, unit, false));
                }}>
                <ThemedText type="linkPrimary">Edit</ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete entry from ${e.measuredAt.slice(0, 10)}`}
                style={{ minHeight: 44, minWidth: 44, justifyContent: 'center' }}
                onPress={() =>
                  Alert.alert('Delete entry?', 'This body-weight measurement will be removed from your history.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => repos.bodyWeight.delete(e.id) },
                  ])
                }>
                <ThemedText type="linkPrimary">Delete</ThemedText>
              </Pressable>
            </View>
          </View>
        ))}
      </Section>
    </FormScreen>
  );
}
