import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { FormMessage } from '@/components/form';
import { SmallButton } from '@/components/ui/layout';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { PerformedSet } from '@/domain/contracts';
import { formatWeight, parseWeight, type WeightUnit } from '@/domain/units';
import { useTheme } from '@/hooks/use-theme';

import { parseReps, REPS_REQUIRED } from './common';

export type SetRowHandlers = {
  onCommitReps: (reps: number | null) => void;
  onCommitLoad: (grams: number | null) => void;
  onToggle: (completed: boolean) => void;
  onRemove: () => void;
};

export function loadLabel(mode: PerformedSet['loadMode'], unit: WeightUnit) {
  return mode === 'assisted' ? `Assistance (${unit})` : `Weight (${unit})`;
}

export function targetText(targetReps: number | null, targetLoadGrams: number | null, unit: WeightUnit) {
  if (targetReps === null && targetLoadGrams === null) return null;
  const parts = [targetReps !== null ? `${targetReps} reps` : null, targetLoadGrams !== null ? formatWeight(targetLoadGrams, unit) : null];
  return `Target ${parts.filter(Boolean).join(' × ')}`;
}

/**
 * One performed set. Text is committed on blur/submit and before completing, so a tap on "Complete"
 * while the keyboard is open never loses typed reps. Key the row by set id only: a commit must not remount it
 * (that dropped focus and the other field's typed text).
 */
export function SetRow({
  set,
  index,
  unit,
  handlers,
}: {
  set: PerformedSet;
  index: number;
  unit: WeightUnit;
  handlers: SetRowHandlers;
}) {
  const theme = useTheme();
  const [repsText, setRepsText] = useState(set.reps === null ? '' : String(set.reps));
  const [loadText, setLoadText] = useState(formatWeight(set.loadGrams, unit, false));
  const [error, setError] = useState<string | null>(null);
  // Stored values changed outside this input (undo, server pull, unit switch): show them. A commit of the
  // field being typed into round-trips to the same value; the other field keeps its in-progress text.
  const [shown, setShown] = useState({ reps: set.reps, loadGrams: set.loadGrams, unit });
  if (shown.reps !== set.reps || shown.loadGrams !== set.loadGrams || shown.unit !== unit) {
    if (shown.reps !== set.reps) setRepsText(set.reps === null ? '' : String(set.reps));
    if (shown.loadGrams !== set.loadGrams || shown.unit !== unit) setLoadText(formatWeight(set.loadGrams, unit, false));
    setShown({ reps: set.reps, loadGrams: set.loadGrams, unit });
  }
  const n = index + 1;
  const showLoad = set.loadMode !== 'bodyweight';

  /** Returns the committed reps value, or undefined when the input is invalid. */
  function commitReps(): number | null | undefined {
    const reps = parseReps(repsText);
    if (Number.isNaN(reps)) {
      setError('Reps must be a whole number from 0 to 1000.');
      return undefined;
    }
    if (reps !== set.reps) handlers.onCommitReps(reps);
    setError(null);
    return reps;
  }

  function commitLoad(): boolean {
    if (!showLoad) return true;
    const grams = parseWeight(loadText, unit);
    if (grams !== null && (Number.isNaN(grams) || grams > 1_000_000)) {
      setError(`Enter a valid ${unit} value.`);
      return false;
    }
    if (grams !== set.loadGrams) handlers.onCommitLoad(grams);
    setError(null);
    return true;
  }

  function toggle() {
    if (set.completed) return handlers.onToggle(false);
    const reps = commitReps();
    if (reps === undefined || !commitLoad()) return;
    if (reps === null || reps <= 0) {
      setError(REPS_REQUIRED);
      return;
    }
    handlers.onToggle(true);
  }

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.background }];
  const target = targetText(set.targetReps, set.targetLoadGrams, unit);

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <ThemedText type="smallBold" style={styles.index}>
          {n}
        </ThemedText>
        <View style={styles.field}>
          <ThemedText type="small" themeColor="textSecondary">
            Reps
          </ThemedText>
          <TextInput
            accessibilityLabel={`Set ${n} reps`}
            keyboardType="number-pad"
            value={repsText}
            onChangeText={setRepsText}
            onBlur={commitReps}
            onSubmitEditing={commitReps}
            placeholder={set.targetReps !== null ? String(set.targetReps) : '0'}
            placeholderTextColor={theme.textSecondary}
            style={inputStyle}
          />
        </View>
        {showLoad ? (
          <View style={styles.field}>
            <ThemedText type="small" themeColor="textSecondary">
              {loadLabel(set.loadMode, unit)}
            </ThemedText>
            <TextInput
              accessibilityLabel={`Set ${n} ${loadLabel(set.loadMode, unit)}`}
              keyboardType="decimal-pad"
              value={loadText}
              onChangeText={setLoadText}
              onBlur={commitLoad}
              onSubmitEditing={commitLoad}
              placeholder={set.targetLoadGrams !== null ? formatWeight(set.targetLoadGrams, unit, false) : 'Optional'}
              placeholderTextColor={theme.textSecondary}
              style={inputStyle}
            />
          </View>
        ) : (
          <ThemedText type="small" themeColor="textSecondary" style={styles.field}>
            Bodyweight
          </ThemedText>
        )}
      </View>
      <View style={styles.row}>
        {target ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
            {target}
          </ThemedText>
        ) : (
          <View style={styles.grow} />
        )}
        <SmallButton
          label={set.completed ? 'Done ✓' : 'Complete'}
          accessibilityLabel={set.completed ? `Set ${n} completed. Mark not completed` : `Complete set ${n}`}
          selected={set.completed}
          onPress={toggle}
        />
        <SmallButton label="Remove" accessibilityLabel={`Remove set ${n}`} onPress={handlers.onRemove} />
      </View>
      <FormMessage text={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.one, paddingVertical: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  index: { minWidth: 24 },
  field: { flex: 1, minWidth: 96, gap: Spacing.half },
  grow: { flex: 1 },
  input: { minHeight: 44, borderRadius: Spacing.two, paddingHorizontal: Spacing.two, fontSize: 16 },
});
