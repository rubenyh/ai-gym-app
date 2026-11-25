import type { RewardSummary, SessionDoc } from '@/domain/contracts';
import rulesJson from '@/domain/reward-rules.v1.json';
import { isQualifyingSession } from '@/features/progress/calc/history';

/** Single source of reward numbers (D-03). UI never hardcodes XP, thresholds or stages. */
export const rules = rulesJson;

export type BadgeRule = (typeof rules.badges)[number];

/** Cumulative XP to reach level n: base*(n-1) + step/2*(n-1)*(n-2) = 200(n-1) + 25(n-1)(n-2). */
export function xpToReachLevel(n: number): number {
  return rules.levelBaseXp * (n - 1) + (rules.levelStepXp / 2) * (n - 1) * (n - 2);
}

export function levelForXp(totalXp: number): { level: number; xpIntoLevel: number; xpForNextLevel: number } {
  const xp = Math.max(0, totalXp);
  let level = 1;
  while (xpToReachLevel(level + 1) <= xp) level++;
  return { level, xpIntoLevel: xp - xpToReachLevel(level), xpForNextLevel: xpToReachLevel(level + 1) - xpToReachLevel(level) };
}

/** Pet stage (1-based index into petStageLevels) reached at a level. */
export function petStageForLevel(level: number): number {
  return rules.petStageLevels.filter((l) => level >= l).length;
}

export type ProgressionView = {
  totalXp: number;
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  /** XP not yet confirmed by the server (local qualifying sessions missing from awardedSessionIds). */
  pendingXp: number;
  pendingSessionIds: string[];
  /** Highest stage: permanent unlocks from the server, or reached by the provisional level. */
  petStage: number;
  /** False when no server summary has been cached yet. */
  confirmed: boolean;
};

/**
 * Authoritative = server summary. Each locally completed qualifying session not yet in
 * `awardedSessionIds` adds a provisional session award labelled pending. Never negative.
 * Weekly-goal bonus is left to the server (not estimated client-side).
 */
export function progressionView(summary: RewardSummary | null, sessions: readonly SessionDoc[]): ProgressionView {
  const awarded = new Set(summary?.awardedSessionIds ?? []);
  const pendingSessionIds = sessions.filter((s) => isQualifyingSession(s) && !awarded.has(s.id)).map((s) => s.id);
  const pendingXp = pendingSessionIds.length * rules.sessionCompletionXp;
  const totalXp = Math.max(0, (summary?.totalXp ?? 0) + pendingXp);
  const lv = levelForXp(totalXp);
  const unlocked = Math.max(0, ...(summary?.petStages ?? []).map((p) => p.stage));
  return { totalXp, ...lv, pendingXp, pendingSessionIds, petStage: Math.max(unlocked, petStageForLevel(lv.level)), confirmed: summary !== null };
}

const BADGE_LABELS: Record<string, string> = {
  first_workout: 'First workout',
  workouts_10: '10 workouts',
  workouts_25: '25 workouts',
  workouts_50: '50 workouts',
  workouts_100: '100 workouts',
  first_weekly_goal: 'First weekly goal',
  four_week_streak: 'Four-week streak',
};

export function badgeLabel(id: string): string {
  return BADGE_LABELS[id] ?? id;
}

export function badgeDescription(b: BadgeRule): string {
  if (b.kind === 'qualifying_sessions') return `Complete ${b.threshold} qualifying workout${b.threshold === 1 ? '' : 's'}`;
  if (b.kind === 'achieved_weeks') return `Reach your weekly goal ${b.threshold === 1 ? 'once' : `${b.threshold} times`}`;
  return `Reach your weekly goal ${b.threshold} weeks in a row`;
}
