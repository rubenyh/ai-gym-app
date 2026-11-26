import type { Session } from '@supabase/supabase-js';
import { createContext, use, useCallback, useEffect, useState, type ReactNode } from 'react';

import { closeAccountDb, deleteAccountDb, getOpenAccountDb, openAccountDb, retireAccountDb } from '@/db/account-db';
import { AccountInUseError } from '@/db/account-lock';
import { supabase } from '@/services/supabase/client';

import { cacheAccount, fetchRemoteAccount, readCachedAccount } from './account-data';
import { resolveAccountState, type AccountState } from './account-state';

type AccountContextValue = {
  state: AccountState;
  /** Re-reads the account from the server and refreshes the local cache. */
  refresh: () => Promise<void>;
  /** Re-reads the local account view only (after an offline settings edit or a pulled change). */
  reloadLocal: () => Promise<void>;
  /**
   * Signs out of this device. Callers must first warn about unsynced changes (NFR-08, settings screen);
   * `discard: true` deletes this account's local database including unsynced changes.
   */
  signOut: (options?: { discard?: boolean }) => Promise<void>;
};

const AccountContext = createContext<AccountContextValue | null>(null);

export function useAccount(): AccountContextValue {
  const value = use(AccountContext);
  if (!value) throw new Error('useAccount must be used inside AccountProvider');
  return value;
}

async function loadAccountState(userId: string | null): Promise<AccountState> {
  if (!userId) {
    await closeAccountDb();
    return { kind: 'signed-out' };
  }
  const db = await openAccountDb(userId);
  const cached = await readCachedAccount(db);
  try {
    const account = await fetchRemoteAccount(userId);
    if (account) await cacheAccount(db, account);
    // Show the local view: it keeps unsynced offline settings edits (cacheAccount never overwrites them).
    const local = account ? await readCachedAccount(db) : null;
    return resolveAccountState(userId, cached, { ok: true, account: local ?? account });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server unreachable';
    return resolveAccountState(userId, cached, { ok: false, message });
  }
}

/** Local database failure: surface it with a retry instead of an endless splash screen. */
function localFailureState(userId: string | null, e: unknown): AccountState {
  if (!userId) return { kind: 'signed-out' };
  if (e instanceof AccountInUseError) return { kind: 'offline', userId, message: e.message, openInOtherTab: true };
  return { kind: 'offline', userId, message: String(e) };
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  // Keyed by account so a switch shows 'loading' instead of the previous account's state.
  const [loaded, setLoaded] = useState<{ userId: string | null; state: AccountState } | null>(null);
  const userId = session === undefined ? undefined : (session?.user.id ?? null);
  const state: AccountState =
    loaded && userId !== undefined && loaded.userId === userId ? loaded.state : { kind: 'loading' };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  // Reload only when the signed-in account changes, not on every token refresh.
  useEffect(() => {
    if (userId === undefined) return;
    let cancelled = false;
    loadAccountState(userId)
      .catch((e) => localFailureState(userId, e))
      .then((next) => !cancelled && setLoaded({ userId, state: next }));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const refresh = useCallback(async () => {
    if (userId === undefined) return;
    const next = await loadAccountState(userId).catch((e) => localFailureState(userId, e));
    setLoaded({ userId, state: next });
  }, [userId]);

  const reloadLocal = useCallback(async () => {
    const db = userId ? getOpenAccountDb(userId) : null;
    const account = db ? await readCachedAccount(db) : null;
    if (!userId || !account) return;
    setLoaded((prev) =>
      prev?.userId === userId && prev.state.kind === 'ready' ? { userId, state: { ...prev.state, account } } : prev,
    );
  }, [userId]);

  const signOut = useCallback(
    async (options?: { discard?: boolean }) => {
      // 'local' clears this device's session even when the network is down. Without an explicit discard
      // the account file (and its outbox) stays on the device and syncs on the next sign-in.
      // In-flight sync results for this account are discarded from here on (never written after sign-out).
      retireAccountDb();
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch (e) {
        retireAccountDb(false);
        throw e;
      }
      if (options?.discard && userId) await deleteAccountDb(userId);
      else await closeAccountDb();
    },
    [userId],
  );

  return <AccountContext value={{ state, refresh, reloadLocal, signOut }}>{children}</AccountContext>;
}
