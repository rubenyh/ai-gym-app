import type { SessionDoc } from '@/domain/contracts';

import { isCountedSet } from './history';

/** Logged external-load volume in gram·reps: completed external sets only (bodyweight/assisted excluded). */
export function sessionVolume(s: SessionDoc): number {
  let total = 0;
  for (const e of s.exercises)
    for (const set of e.sets)
      if (isCountedSet(set) && set.loadMode === 'external' && set.loadGrams !== null) total += set.loadGrams * set.reps!;
  return total;
}

export function totalVolume(sessions: readonly SessionDoc[]): number {
  return sessions.filter((s) => s.status === 'completed').reduce((n, s) => n + sessionVolume(s), 0);
}
