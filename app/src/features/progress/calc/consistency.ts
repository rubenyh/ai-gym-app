import type { SessionDoc } from '@/domain/contracts';

import { addDays, weekStart } from './dates';
import { isQualifyingSession, sessionLocalDate } from './history';

/** Frozen weekly goal row (account snapshot `goals`). */
export type WeeklyGoal = { effectiveWeek: string; targetDays: number; timezone: string };

export type WeekConsistency = {
  weekStart: string;
  targetDays: number;
  timezone: string;
  /** Distinct local completion dates with a qualifying session. */
  days: number;
  achieved: boolean;
};

/** Goal row in force for a week: latest row whose effective week is <= that week. Null before the first goal. */
export function goalForWeek(goals: readonly WeeklyGoal[], week: string): WeeklyGoal | null {
  let found: WeeklyGoal | null = null;
  for (const g of [...goals].sort((a, b) => a.effectiveWeek.localeCompare(b.effectiveWeek)))
    if (weekStart(g.effectiveWeek) <= week) found = g;
  return found;
}

/**
 * Monday–Sunday weeks from the first goal's week to `today`'s week, newest first. A session counts on
 * its frozen completion `localDate` (captured in its own zone), so later timezone changes never move
 * history. Weeks before the first goal are not listed (not failed).
 */
export function weeklyConsistency(sessions: readonly SessionDoc[], goals: readonly WeeklyGoal[], today: string): WeekConsistency[] {
  if (!goals.length) return [];
  const daysByWeek = new Map<string, Set<string>>();
  for (const s of sessions) {
    if (!isQualifyingSession(s)) continue;
    const d = sessionLocalDate(s);
    if (!d) continue;
    const w = weekStart(d);
    if (!daysByWeek.has(w)) daysByWeek.set(w, new Set());
    daysByWeek.get(w)!.add(d);
  }
  const first = weekStart([...goals].map((g) => g.effectiveWeek).sort()[0]);
  const out: WeekConsistency[] = [];
  for (let w = weekStart(today); w >= first; w = addDays(w, -7)) {
    const goal = goalForWeek(goals, w)!;
    const days = daysByWeek.get(w)?.size ?? 0;
    out.push({ weekStart: w, targetDays: goal.targetDays, timezone: goal.timezone, days, achieved: days >= goal.targetDays });
  }
  return out;
}
