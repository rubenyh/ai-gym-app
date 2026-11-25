import type { PerformedSet, SessionDoc } from '@/domain/contracts';

import { localDateIn } from './dates';

/** Completed sessions, newest first, ordered by performed time (completedAt), never sync time. */
export function completedHistory<T extends SessionDoc>(sessions: readonly T[]): T[] {
  return sessions
    .filter((s) => s.status === 'completed' && s.completedAt)
    .sort((a, b) => Date.parse(b.completedAt!) - Date.parse(a.completedAt!) || a.id.localeCompare(b.id));
}

/** Frozen local completion date; falls back to deriving it from completedAt in the session zone. */
export function sessionLocalDate(s: SessionDoc): string | null {
  if (s.localDate) return s.localDate;
  return s.completedAt ? localDateIn(s.completedAt, s.timezone) : null;
}

/** A set that counts for metrics: completed with at least one rep. */
export function isCountedSet(set: PerformedSet): boolean {
  return set.completed && (set.reps ?? 0) > 0;
}

/** Session qualifies for completion XP: at least one counted set. */
export function isQualifyingSession(s: SessionDoc): boolean {
  return s.status === 'completed' && s.exercises.some((e) => e.sets.some(isCountedSet));
}
