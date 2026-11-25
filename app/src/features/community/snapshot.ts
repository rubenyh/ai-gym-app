import { randomUUID } from 'expo-crypto';

import type { PostSnapshot, RoutineDoc, SessionDoc } from '@/domain/contracts';
import type { CatalogRepository } from '@/domain/repositories';

/**
 * Client-side preview of the public snapshot (SOCIAL-02). Mirrors what `publish_post` builds on the
 * server from the synced session: only the allowlisted fields. Session notes, exercise notes,
 * timezone, routine IDs and custom exercise IDs never enter it.
 */
export function previewSnapshot(session: SessionDoc): PostSnapshot {
  const ms = session.completedAt ? Date.parse(session.completedAt) - Date.parse(session.startedAt) : 0;
  return {
    version: 1,
    title: session.name,
    completedOn: session.localDate ?? (session.completedAt ?? session.startedAt).slice(0, 10),
    durationMinutes: Math.max(0, Math.round(ms / 60000)),
    exercises: session.exercises
      .map((e) => ({
        exerciseKey: e.exerciseKey.startsWith('catalog:') ? e.exerciseKey : null,
        exerciseName: e.exerciseName,
        loadMode: e.sets[0]?.loadMode ?? 'external',
        sets: e.sets.filter((s) => s.completed).map((s) => ({ reps: s.reps, loadGrams: s.loadGrams })),
      }))
      .filter((e) => e.sets.length > 0),
  };
}

/**
 * SOCIAL-03 copy: an independent routine with new IDs and origin 'copy' (no XP; nothing is logged).
 * Catalog keys are kept; custom exercises (key null in the snapshot) become the copier's own custom
 * exercises by name, so the author's custom-exercise rows are never referenced.
 * ponytail: custom exercises and the routine are saved in separate transactions; a crash between them
 * leaves an unused custom exercise, which is harmless.
 */
export function routineFromSnapshot(
  snapshot: PostSnapshot,
  saveCustom: CatalogRepository['saveCustom'],
  newId: () => string = randomUUID,
): RoutineDoc {
  return {
    id: newId(),
    name: snapshot.title,
    notes: '',
    archived: false,
    origin: 'copy',
    exercises: snapshot.exercises.map((e, position) => {
      const key =
        e.exerciseKey ??
        `custom:${
          saveCustom({
            name: e.exerciseName,
            primaryMuscles: [],
            secondaryMuscles: [],
            equipment: [],
            instructions: [],
            loadMode: e.loadMode,
            archived: false,
          }).id
        }`;
      return {
        id: newId(),
        position,
        exerciseKey: key,
        exerciseName: e.exerciseName,
        notes: '',
        restSeconds: null,
        sets: e.sets.map((s, i) => ({
          id: newId(),
          position: i,
          targetReps: s.reps,
          targetLoadGrams: s.loadGrams,
          loadMode: e.loadMode,
        })),
      };
    }),
  };
}
