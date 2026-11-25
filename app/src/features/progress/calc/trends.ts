import type { ExerciseKey, LoadMode, SessionDoc } from '@/domain/contracts';

import { completedHistory, isCountedSet, sessionLocalDate } from './history';
import { sessionVolume } from './volume';

export type TrendPoint = {
  sessionId: string;
  completedAt: string;
  localDate: string | null;
  /** Heaviest completed external load in the session; null when no external sets. */
  topLoadGrams: number | null;
  /** Reps of the best set (top load, or most reps when no load). */
  topReps: number;
  totalReps: number;
  volumeGramReps: number;
  sets: { reps: number; loadGrams: number | null; loadMode: LoadMode }[];
};

export type ExerciseTrend = { points: TrendPoint[]; insufficientData: boolean };

/** Actual per-session results for one exercise, oldest first. Never invents a trend: < 2 points = insufficient. */
export function exerciseTrend(sessions: readonly SessionDoc[], key: ExerciseKey): ExerciseTrend {
  const points: TrendPoint[] = [];
  for (const s of completedHistory(sessions).reverse()) {
    const sets = s.exercises
      .filter((e) => e.exerciseKey === key)
      .flatMap((e) => e.sets)
      .filter(isCountedSet)
      .map((x) => ({ reps: x.reps!, loadGrams: x.loadGrams, loadMode: x.loadMode }));
    if (!sets.length) continue;
    const external = sets.filter((x) => x.loadMode === 'external' && x.loadGrams !== null);
    const top = external.length
      ? external.reduce((a, b) => (b.loadGrams! > a.loadGrams! || (b.loadGrams === a.loadGrams && b.reps > a.reps) ? b : a))
      : sets.reduce((a, b) => (b.reps > a.reps ? b : a));
    points.push({
      sessionId: s.id,
      completedAt: s.completedAt!,
      localDate: sessionLocalDate(s),
      topLoadGrams: external.length ? top.loadGrams : null,
      topReps: top.reps,
      totalReps: sets.reduce((n, x) => n + x.reps, 0),
      volumeGramReps: sessionVolume({ ...s, exercises: s.exercises.filter((e) => e.exerciseKey === key) }),
      sets,
    });
  }
  return { points, insufficientData: points.length < 2 };
}

/** Distinct exercises appearing in completed history, by name. */
export function performedExercises(sessions: readonly SessionDoc[]): { key: ExerciseKey; name: string }[] {
  const map = new Map<string, string>();
  for (const s of completedHistory(sessions))
    for (const e of s.exercises) if (!map.has(e.exerciseKey) && e.sets.some(isCountedSet)) map.set(e.exerciseKey, e.exerciseName);
  return [...map].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name));
}
