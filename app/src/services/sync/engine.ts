/**
 * Per-account sync worker (SYNC-01, NFR-03, NFR-09). One serialized loop: push the outbox one frozen op at
 * a time in local commit order, then pull change pages until `hasMore = false`, then refresh the reward
 * summary. Network I/O is injected (`SyncRpc`) so tests use fakes. Runs only while the app is in the
 * foreground; nothing here claims to run while the OS suspends the app.
 */
import { changePage, pushResult, rewardSummary, type PushOp } from '@/domain/contracts';
import type { LocalRepositories, SyncStore } from '@/db/repositories';

/** Thrown by the RPC adapter when the session is missing/expired: sync pauses instead of spinning. */
export class SyncAuthError extends Error {
  constructor(message = 'Sign in again to sync') {
    super(message);
    this.name = 'SyncAuthError';
  }
}

export type SyncRpc = {
  push(op: PushOp): Promise<unknown>;
  pull(after: number, limit: number): Promise<unknown>;
  rewardSummary(): Promise<unknown>;
};

export type SyncPhase = 'idle' | 'syncing' | 'retry-scheduled' | 'paused-auth' | 'stopped';
export type SyncStatus = { phase: SyncPhase; nextRetryAt: string | null };

export type SyncEngine = {
  start(): void;
  stop(): void;
  /** Manual sync ("Retry", "Sync now"): ignores backoff and resumes an auth pause. */
  syncNow(): Promise<void>;
  /**
   * Automatic triggers. 'online' (foreground, reconnection) skips the backoff wait; 'auto' (timers, local
   * writes) respects it. Neither resumes an auth pause.
   */
  trigger(kind?: 'online' | 'auto'): Promise<void>;
  status(): SyncStatus;
  subscribe(listener: () => void): () => void;
  store: SyncStore;
};

export type SyncEngineOptions = {
  pageSize?: number;
  random?: () => number;
  now?: () => number;
  /** Delay before syncing after a local write (0 disables auto-sync on write). */
  writeDebounceMs?: number;
};

const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 5 * 60_000;

/** Bounded exponential backoff with jitter (50–100 % of the capped delay). */
export function backoffDelay(attempts: number, random: () => number = Math.random): number {
  const capped = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.min(attempts, 20));
  return Math.round(capped * (0.5 + random() / 2));
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createSyncEngine(repos: LocalRepositories, rpc: SyncRpc, opts: SyncEngineOptions = {}): SyncEngine {
  const store = repos.sync;
  const pageSize = opts.pageSize ?? 200;
  const random = opts.random ?? Math.random;
  const now = opts.now ?? Date.now;
  const writeDebounceMs = opts.writeDebounceMs ?? 1500;

  let status: SyncStatus = { phase: 'stopped', nextRetryAt: null };
  let running: Promise<void> | null = null;
  let again = false;
  let againForce = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribeRepos: (() => void) | null = null;
  const listeners = new Set<() => void>();

  let stopped = true;
  const setStatus = (next: SyncStatus) => {
    if (stopped && next.phase !== 'stopped') return;
    status = next;
    listeners.forEach((l) => l());
  };
  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const schedule = (atMs: number) => {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void run('auto');
    }, Math.max(0, atMs - now()));
    setStatus({ phase: 'retry-scheduled', nextRetryAt: new Date(atMs).toISOString() });
  };

  /** Recording the error must never turn a failed cycle into an unhandled rejection. */
  const safeSetError = (m: string) => {
    try {
      store.setError(m);
    } catch {
      // Local database unavailable; the in-memory status still reflects the failure.
    }
  };

  /** One full cycle. Returns normally on success or after scheduling a retry. */
  async function cycle(force: boolean): Promise<void> {
    setStatus({ phase: 'syncing', nextRetryAt: null });
    try {
      for (;;) {
        const next = store.nextOp(force);
        if (!next) break;
        if ('waitUntil' in next) return schedule(next.waitUntil.getTime());
        let raw: unknown;
        try {
          raw = await rpc.push(next.op);
        } catch (e) {
          if (e instanceof SyncAuthError) throw e;
          // Lost request or acknowledgement: resend the same frozen op later.
          const at = now() + backoffDelay(next.attempts, random);
          store.recordRetry(next.op.opId, message(e), new Date(at));
          return schedule(at);
        }
        const res = pushResult.safeParse(raw);
        if (!res.success || res.data.opId !== next.op.opId) {
          const at = now() + backoffDelay(next.attempts, random);
          store.recordRetry(next.op.opId, 'Unexpected server response', new Date(at));
          return schedule(at);
        }
        store.applyResult(next.op, res.data);
        force = false;
        if (stopped) return;
      }
      for (;;) {
        const page = changePage.parse(await rpc.pull(store.cursor(), pageSize));
        store.applyPage(page);
        if (!page.hasMore || stopped) break;
      }
      const summary = rewardSummary.safeParse(await rpc.rewardSummary());
      if (summary.success) store.setRewardSummary(summary.data);
      failures = 0;
      setStatus({ phase: 'idle', nextRetryAt: null });
    } catch (e) {
      if (e instanceof SyncAuthError) {
        clearTimer();
        safeSetError(e.message);
        setStatus({ phase: 'paused-auth', nextRetryAt: null });
        return;
      }
      safeSetError(message(e));
      failures++;
      schedule(now() + backoffDelay(failures - 1, random));
    }
  }

  type Mode = 'auto' | 'online' | 'manual';
  function run(mode: Mode): Promise<void> {
    if (stopped) return Promise.resolve();
    if (mode !== 'manual' && status.phase === 'paused-auth') return Promise.resolve();
    if (mode === 'auto' && status.phase === 'retry-scheduled' && timer) return Promise.resolve();
    if (running) {
      again = true;
      againForce ||= mode !== 'auto';
      return running;
    }
    clearTimer();
    running = (async () => {
      let force = mode !== 'auto';
      do {
        again = false;
        await cycle(force);
        force = againForce;
        againForce = false;
      } while (again && !stopped && (status.phase === 'idle' || force));
    })().finally(() => {
      running = null;
    });
    return running;
  }

  let debounce: ReturnType<typeof setTimeout> | null = null;
  function onLocalChange() {
    if (!writeDebounceMs || status.phase !== 'idle' || running || debounce || !store.hasPendingWork()) return;
    debounce = setTimeout(() => {
      debounce = null;
      void run('auto');
    }, writeDebounceMs);
  }

  return {
    store,
    start() {
      if (!stopped) return;
      stopped = false;
      setStatus({ phase: 'idle', nextRetryAt: null });
      unsubscribeRepos = repos.subscribe(onLocalChange);
      void run('online');
    },
    stop() {
      clearTimer();
      if (debounce) clearTimeout(debounce);
      debounce = null;
      unsubscribeRepos?.();
      unsubscribeRepos = null;
      setStatus({ phase: 'stopped', nextRetryAt: null });
      stopped = true;
    },
    syncNow: () => run('manual'),
    trigger: (kind = 'online') => run(kind),
    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
