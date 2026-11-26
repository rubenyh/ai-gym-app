/**
 * One browser tab per account database. On the web, expo-sqlite keeps the database in OPFS through an exclusive
 * access handle, so a second tab cannot open it (it failed with a raw browser error and an "offline" screen).
 * A Web Lock held while the database is open makes the rule explicit. Native has no Web Locks: no-op.
 */
type LockManagerLike = {
  request(name: string, options: { signal: AbortSignal }, callback: () => Promise<void>): Promise<void>;
};

export class AccountInUseError extends Error {
  constructor() {
    super('AI Gym is already open in another tab or window of this browser. Close it there, then press Retry here.');
    this.name = 'AccountInUseError';
  }
}

type Held = { name: string; ready: Promise<void>; release?: () => void };
let held: Held | null = null;

/**
 * Waits briefly (a reloading tab frees its lock as it unloads), then fails with AccountInUseError.
 * Reentrant per name: a second call for the lock this tab holds (or is waiting for) shares it.
 */
export function acquireAccountLock(name: string, waitMs = 3000): Promise<void> {
  const locks = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator?.locks;
  if (!locks) return Promise.resolve();
  if (held?.name === name) return held.ready;
  releaseAccountLock();
  const entry: Held = { name, ready: Promise.resolve() };
  held = entry; // before requesting: a grant can arrive at once
  entry.ready = new Promise<void>((resolve, reject) => {
    locks
      .request(`aigym:${name}`, { signal: AbortSignal.timeout(waitMs) }, () => {
        // Released (or replaced) while still waiting: give the lock straight back.
        if (held !== entry) {
          reject(new AccountInUseError());
          return Promise.resolve();
        }
        resolve();
        return new Promise<void>((done) => {
          entry.release = done;
        });
      })
      .catch((e: { name?: string }) => {
        if (held === entry) held = null;
        reject(e?.name === 'TimeoutError' || e?.name === 'AbortError' ? new AccountInUseError() : e);
      });
  });
  return entry.ready;
}

export function releaseAccountLock(): void {
  held?.release?.();
  held = null;
}
