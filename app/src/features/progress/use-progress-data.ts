import { useMemo } from 'react';

import { useLocalQuery } from '@/db/repositories-context';
import type { RewardSummary } from '@/domain/contracts';
import type { Repositories } from '@/domain/repositories';
import type { WeightUnit } from '@/domain/units';
import { useAccount } from '@/features/account/account-provider';
import { progressionView } from '@/features/gamification/rules';

import type { WeeklyGoal } from './calc/consistency';
import { localDateIn } from './calc/dates';

/** Server reward summary cached locally by the sync worker (null until the first successful fetch). */
export function readRewardSummary(r: Repositories): RewardSummary | null {
  const cache = (r as Repositories & { rewardCache?: { get(): RewardSummary | null } }).rewardCache;
  return cache?.get() ?? null;
}

/** Local data + account settings every progress screen needs. Pure calculations live in ./calc. */
export function useProgressData() {
  const { state } = useAccount();
  const account = state.kind === 'ready' ? state.account : null;
  const unit: WeightUnit = account?.settings.weightUnit ?? 'kg';
  const timezone = account?.settings.timezone ?? 'UTC';
  const goals: WeeklyGoal[] = useMemo(() => account?.goals ?? [], [account]);

  const sessions = useLocalQuery((r) => r.sessions.history(), []);
  const summary = useLocalQuery(readRewardSummary, []);
  const progression = useMemo(() => progressionView(summary, sessions), [summary, sessions]);
  const today = localDateIn(new Date(), timezone);

  return { unit, timezone, goals, sessions, summary, progression, today };
}
