import { createContext, use, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { Repositories } from '@/domain/repositories';
import { useAccount } from '@/features/account/account-provider';
import { createAppSyncEngine } from '@/services/sync/app-engine';
import type { SyncEngine } from '@/services/sync/engine';

import { getOpenAccountDb } from './account-db';
import { createRepositories, type LocalRepositories } from './repositories';

type Value = { repos: LocalRepositories; sync: SyncEngine } | null;
const Ctx = createContext<Value>(null);

/**
 * Exposes the signed-in account's repositories (one SQLite file per account, D-10) and runs its sync
 * worker. Renders children in every account state; only `ready` screens may call `useRepositories`.
 */
export function RepositoriesProvider({ children }: { children: ReactNode }) {
  const { state, reloadLocal } = useAccount();
  const userId = state.kind === 'ready' ? state.userId : null;
  const repos = useMemo(() => {
    const db = userId ? getOpenAccountDb(userId) : null;
    return db ? createRepositories(db) : null;
  }, [userId]);
  // Constructed without side effects; started/stopped by the effect (one worker per account).
  // The RPC adapter is bound to this account: a request never goes out under another account's session.
  const sync = useMemo(() => (repos && userId ? createAppSyncEngine(repos, userId) : null), [repos, userId]);

  // Offline settings edits and pulled settings changes update the account view (units, goals, visibility).
  useEffect(() => {
    if (!repos) return;
    let last = JSON.stringify(repos.accountSettings.get());
    return repos.subscribe(() => {
      const next = JSON.stringify(repos.accountSettings.get());
      if (next !== last) {
        last = next;
        void reloadLocal();
      }
    });
  }, [repos, reloadLocal]);

  useEffect(() => {
    if (!sync) return;
    sync.start();
    return () => sync.stop();
  }, [sync]);

  const value = useMemo<Value>(() => (repos && sync ? { repos, sync } : null), [repos, sync]);
  return <Ctx value={value}>{children}</Ctx>;
}

function useValue() {
  const value = use(Ctx);
  if (!value) throw new Error('useRepositories must be used inside a ready RepositoriesProvider');
  return value;
}

export function useRepositories(): Repositories {
  return useValue().repos;
}

/** Sync worker of the signed-in account (sync status screen, sign-out warning). */
export function useSyncEngine(): SyncEngine {
  return useValue().sync;
}

/** Non-throwing variant for code that also renders outside the ready app (e.g. account provider consumers). */
export function useOptionalSyncEngine(): SyncEngine | null {
  return use(Ctx)?.sync ?? null;
}

/**
 * Synchronous local read that re-runs after every committed local write or applied pull page.
 * `read` must only read; keep `deps` to the values it closes over.
 */
export function useLocalQuery<T>(read: (r: Repositories) => T, deps: unknown[]): T {
  // React Compiler treats calls during render as pure and would cache read(repos) while `read` and `repos` are
  // unchanged, so a committed write would never show. The database is mutable state: opt this hook out.
  'use no memo';
  const repos = useRepositories();
  const [version, setVersion] = useState(0);
  useEffect(() => repos.subscribe(() => setVersion((v) => v + 1)), [repos]);
  // Re-read only when data changed or a dep changed ("adjusting state during render" pattern).
  const [cached, setCached] = useState(() => ({ repos, version, deps, value: read(repos) }));
  if (cached.repos !== repos || cached.version !== version || !sameDeps(cached.deps, deps)) {
    const next = { repos, version, deps, value: read(repos) };
    setCached(next);
    return next.value;
  }
  return cached.value;
}

const sameDeps = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
