import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { SmallButton } from '@/components/ui/layout';
import { ThemedText } from '@/components/themed-text';
import type { SessionDoc } from '@/domain/contracts';
import type { SyncMeta } from '@/domain/repositories';
import type { WeightUnit } from '@/domain/units';
import { useAccount } from '@/features/account/account-provider';

/** Display/input unit from the cached account settings (SETTINGS-01); storage stays in grams. */
export function useWeightUnit(): WeightUnit {
  const { state } = useAccount();
  return state.kind === 'ready' ? state.account.settings.weightUnit : 'kg';
}

/** Pending/conflict indicator for one aggregate (NFR-09). Local data is saved either way. */
export function SyncBadge({ meta }: { meta: SyncMeta | null | undefined }) {
  if (!meta) return null;
  if (meta.conflict) {
    return (
      <SmallButton
        label="Needs review"
        accessibilityLabel="Sync conflict, needs review. Open sync status"
        onPress={() => router.push('/sync-status' as Href)}
      />
    );
  }
  if (meta.pendingOps > 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary" accessibilityLabel="Saved on this device, pending sync">
        Pending sync
      </ThemedText>
    );
  }
  return null;
}

/** Wall-clock ticker; values are always recomputed from Date.now(), never accumulated. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

export function confirmDestructive(title: string, message: string, confirmLabel: string, onConfirm: () => void) {
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const REPS_REQUIRED = 'Enter reps above 0 before completing this set.';

/** Parses a reps field: null when empty, NaN when invalid. */
export function parseReps(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 && n <= 1000 ? n : Number.NaN;
}

/** Completed-set totals. Volume = completed external load × reps only (PROGRESS_AND_GAMIFICATION.md). */
export function sessionStats(doc: SessionDoc) {
  let sets = 0;
  let volumeGramReps = 0;
  let exercises = 0;
  for (const ex of doc.exercises) {
    const done = ex.sets.filter((s) => s.completed);
    if (done.length) exercises += 1;
    sets += done.length;
    for (const s of done) {
      if (s.loadMode === 'external' && s.loadGrams !== null && s.reps !== null) volumeGramReps += s.loadGrams * s.reps;
    }
  }
  const durationMs = doc.completedAt ? Date.parse(doc.completedAt) - Date.parse(doc.startedAt) : 0;
  return { exercises, sets, volumeGramReps, durationMs };
}

/** ISO weekday 1 = Monday … 7 = Sunday (programDoc.days). */
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
