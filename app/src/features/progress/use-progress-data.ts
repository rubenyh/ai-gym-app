import { useIsFocused } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useRepositories } from '@/db/repositories-context';
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

/**
 * All-time records, volume and pending XP need every completed session; `history()` defaults to 50.
 * ponytail: N+1 session reads per refresh; add a summary table/incremental cache if history grows to thousands.
 */
export const ALL_HISTORY = Number.MAX_SAFE_INTEGER;

/**
 * useLocalQuery variant for screens that stay mounted under other screens (tabs under the logger):
 * writes made while unfocused only mark the data dirty, so each set save does not recompute full
 * history in every mounted tab. The read runs once when the screen regains focus.
 */
export function useFocusedLocalQuery<T>(read: (r: Repositories) => T): T {
  // Reads mutable database state keyed by `version`, which `read` never mentions: keep React Compiler from
  // re-deriving the memo dependencies (see useLocalQuery).
  'use no memo';
  const repos = useRepositories();
  const focused = useIsFocused();
  const [version, setVersion] = useState(0);
  const state = useRef({ focused, dirty: false });

  useEffect(
    () =>
      repos.subscribe(() => {
        if (state.current.focused) setVersion((v) => v + 1);
        else state.current.dirty = true;
      }),
    [repos],
  );
  useEffect(() => {
    state.current.focused = focused;
    if (focused && state.current.dirty) {
      state.current.dirty = false;
      setVersion((v) => v + 1);
    }
  }, [focused]);

  // `read` is a stable module-level reader at every call site; re-read only on data changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => read(repos), [repos, version]);
}

const readAllHistory = (r: Repositories) => r.sessions.history({ limit: ALL_HISTORY });

/** Local data + account settings every progress screen needs. Pure calculations live in ./calc. */
export function useProgressData() {
  const { state } = useAccount();
  const account = state.kind === 'ready' ? state.account : null;
  const unit: WeightUnit = account?.settings.weightUnit ?? 'kg';
  const timezone = account?.settings.timezone ?? 'UTC';
  const goals: WeeklyGoal[] = useMemo(() => account?.goals ?? [], [account]);

  const sessions = useFocusedLocalQuery(readAllHistory);
  const summary = useFocusedLocalQuery(readRewardSummary);
  const progression = useMemo(() => progressionView(summary, sessions), [summary, sessions]);
  const today = localDateIn(new Date(), timezone);

  return { unit, timezone, goals, sessions, summary, progression, today };
}
