import { router } from 'expo-router';
import { memo, useCallback, useEffect, useState, type ReactNode } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TextField } from '@/components/form';
import { ChipRow, Row, SmallButton } from '@/components/ui/layout';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useLocalQuery } from '@/db/repositories-context';
import type { ExerciseSummary } from '@/domain/repositories';

const SEARCH_DEBOUNCE_MS = 200;
/** Bounded result set: the FlatList virtualizes, the query never materializes the whole 1324-item catalog. */
const RESULT_LIMIT = 100;

/** Offline catalog search + filters (CAT-01). `onSelect` turns it into a picker. */
export function CatalogBrowser({ onSelect, header }: { onSelect: (e: ExerciseSummary) => void; header?: ReactNode }) {
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const search = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  // Facets scan json_each over the whole catalog: read them once, not on every keystroke.
  const facets = useLocalQuery((r) => ({ muscles: r.catalog.muscles(), equipment: r.catalog.equipment() }), []);
  const results = useLocalQuery(
    (r) =>
      r.catalog.search(
        { query: search || undefined, muscle: muscle ?? undefined, equipment: equipment ?? undefined, includeArchived: showArchived },
        RESULT_LIMIT,
      ),
    [search, muscle, equipment, showArchived],
  );
  const renderItem = useCallback(({ item }: { item: ExerciseSummary }) => <ExerciseRow exercise={item} onSelect={onSelect} />, [onSelect]);

  return (
    <FlatList
      data={results}
      keyExtractor={(e) => e.key}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
      ListHeaderComponent={
        <View style={styles.header}>
          {header}
          <TextField label="Search exercises" value={query} onChangeText={setQuery} placeholder="Name" autoCorrect={false} />
          <ChipRow label="Muscle" options={facets.muscles} value={muscle} onChange={setMuscle} />
          <ChipRow label="Equipment" options={facets.equipment} value={equipment} onChange={setEquipment} />
          <Row>
            <SmallButton
              label={showArchived ? 'Hide archived' : 'Show archived'}
              selected={showArchived}
              onPress={() => setShowArchived((v) => !v)}
            />
          </Row>
        </View>
      }
      ListEmptyComponent={
        <ThemedText themeColor="textSecondary">No exercises match. Clear a filter or create a custom exercise.</ThemedText>
      }
      ListFooterComponent={
        results.length === RESULT_LIMIT ? (
          <ThemedText type="small" themeColor="textSecondary">
            Showing the first {RESULT_LIMIT} matches. Refine the search or filters to see more.
          </ThemedText>
        ) : undefined
      }
      renderItem={renderItem}
    />
  );
}

/** Value that follows `value` after it stops changing for `ms` (catalog search keystrokes). */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

const ExerciseRow = memo(function ExerciseRow({ exercise, onSelect }: { exercise: ExerciseSummary; onSelect: (e: ExerciseSummary) => void }) {
  const onPress = () => onSelect(exercise);
  const meta = [exercise.primaryMuscles.join(', '), exercise.equipment.join(', ')].filter(Boolean).join(' · ');
  const tags = [exercise.custom ? 'Custom' : null, exercise.archived ? 'Archived' : null].filter(Boolean).join(', ');
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={[exercise.name, meta, tags].filter(Boolean).join(', ')} onPress={onPress}>
      <ThemedView type="backgroundElement" style={styles.item}>
        <ThemedText type="smallBold">{exercise.name}</ThemedText>
        {meta ? (
          <ThemedText type="small" themeColor="textSecondary">
            {meta}
          </ThemedText>
        ) : null}
        {tags ? <ThemedText type="small">{tags}</ThemedText> : null}
      </ThemedView>
    </Pressable>
  );
});

export function CatalogScreen() {
  return (
    <ThemedView style={styles.flex}>
      <CatalogBrowser
        header={
          <Row>
            <SmallButton label="New custom exercise" onPress={() => router.push('/training/custom-exercise')} />
          </Row>
        }
        onSelect={(e) => router.push({ pathname: '/training/exercise', params: { key: e.key } })}
      />
    </ThemedView>
  );
}

/** Modal picker reused by the routine editor and the logger. */
export function ExercisePicker({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (e: ExerciseSummary) => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ThemedView style={styles.flex}>
        <SafeAreaView style={styles.flex}>
          <View style={styles.modalHeader}>
            <ThemedText type="smallBold" accessibilityRole="header">
              Add exercise
            </ThemedText>
            <SmallButton label="Close" accessibilityLabel="Close exercise picker" onPress={onClose} />
          </View>
          {visible ? (
            <CatalogBrowser
              onSelect={(e) => {
                onSelect(e);
                onClose();
              }}
            />
          ) : null}
        </SafeAreaView>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.two },
  header: { gap: Spacing.three, paddingBottom: Spacing.two },
  item: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.half, minHeight: 44 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
});
