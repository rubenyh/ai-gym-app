import { router } from 'expo-router';

import { Card, Row, Screen, SectionTitle, SmallButton } from '@/components/ui/layout';
import { ThemedText } from '@/components/themed-text';
import { useLocalQuery, useRepositories } from '@/db/repositories-context';

const LOAD_MODE_LABEL = { external: 'External load', bodyweight: 'Bodyweight', assisted: 'Assisted' } as const;

/** Exercise detail with English instructions; media stays a placeholder until O-01 is resolved (CAT-01). */
export function ExerciseDetailScreen({ exerciseKey }: { exerciseKey: string }) {
  const repos = useRepositories();
  const exercise = useLocalQuery((r) => r.catalog.get(exerciseKey), [exerciseKey]);

  if (!exercise) {
    return (
      <Screen>
        <ThemedText>This exercise is not available on this device.</ThemedText>
      </Screen>
    );
  }
  const customId = exercise.custom ? exercise.key.replace(/^custom:/, '') : null;

  return (
    <Screen>
      <ThemedText type="subtitle" accessibilityRole="header">
        {exercise.name}
      </ThemedText>
      {exercise.archived ? <ThemedText themeColor="textSecondary">Archived</ThemedText> : null}
      <Card>
        <ThemedText type="small" accessibilityLabel="Exercise media: Media not available (rights pending)">
          Media not available (rights pending)
        </ThemedText>
        {exercise.attribution ? (
          <ThemedText type="small" themeColor="textSecondary">
            Source: {exercise.attribution}
          </ThemedText>
        ) : null}
      </Card>
      <Info label="Primary muscles" value={exercise.primaryMuscles.join(', ')} />
      <Info label="Secondary muscles" value={exercise.secondaryMuscles.join(', ')} />
      <Info label="Equipment" value={exercise.equipment.join(', ')} />
      <Info label="Load" value={LOAD_MODE_LABEL[exercise.loadMode]} />
      <SectionTitle>Instructions</SectionTitle>
      {exercise.instructions.length === 0 ? (
        <ThemedText themeColor="textSecondary">No instructions available.</ThemedText>
      ) : (
        exercise.instructions.map((step, i) => (
          <ThemedText key={i}>
            {i + 1}. {step}
          </ThemedText>
        ))
      )}
      {customId ? (
        <Row>
          <SmallButton
            label="Edit"
            accessibilityLabel={`Edit ${exercise.name}`}
            onPress={() => router.push({ pathname: '/training/custom-exercise', params: { id: customId } })}
          />
          <SmallButton
            label={exercise.archived ? 'Unarchive' : 'Archive'}
            accessibilityLabel={`${exercise.archived ? 'Unarchive' : 'Archive'} ${exercise.name}`}
            onPress={() => repos.catalog.setCustomArchived(customId, !exercise.archived)}
          />
        </Row>
      ) : null}
      {exercise.custom ? (
        <ThemedText type="small" themeColor="textSecondary">
          Archived custom exercises stay readable in existing routines and workouts.
        </ThemedText>
      ) : null}
    </Screen>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <ThemedText>
      <ThemedText type="smallBold">{label}: </ThemedText>
      {value}
    </ThemedText>
  );
}
