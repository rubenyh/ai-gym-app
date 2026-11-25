import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TextField } from '@/components/form';
import { ChipRow, Row, SmallButton } from '@/components/ui/layout';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useLocalQuery } from '@/db/repositories-context';
import type { ExerciseSummary } from '@/domain/repositories';

/** Offline catalog search + filters (CAT-01). `onSelect` turns it into a picker. */
export function CatalogBrowser({ onSelect, header }: { onSelect: (e: ExerciseSummary) => void; header?: ReactNode }) {
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const data = useLocalQuery(
    (r) => ({
      results: r.catalog.search(
        { query: query.trim() || undefined, muscle: muscle ?? undefined, equipment: equipment ?? undefined, includeArchived: showArchived },
        100,
      ),
      muscles: r.catalog.muscles(),
      equipment: r.catalog.equipment(),
    }),
    [query, muscle, equipment, showArchived],
  );

  return (
    <FlatList
      data={data.results}
      keyExtractor={(e) => e.key}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
      ListHeaderComponent={
        <View style={styles.header}>
          {header}
          <TextField label="Search exercises" value={query} onChangeText={setQuery} placeholder="Name" autoCorrect={false} />
          <ChipRow label="Muscle" options={data.muscles} value={muscle} onChange={setMuscle} />
          <ChipRow label="Equipment" options={data.equipment} value={equipment} onChange={setEquipment} />
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
      renderItem={({ item }) => <ExerciseRow exercise={item} onPress={() => onSelect(item)} />}
    />
  );
}

function ExerciseRow({ exercise, onPress }: { exercise: ExerciseSummary; onPress: () => void }) {
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
}

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
