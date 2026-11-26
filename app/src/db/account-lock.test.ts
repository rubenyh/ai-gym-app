import { AccountInUseError, acquireAccountLock, releaseAccountLock } from './account-lock';

// Exclusive locks with the Web Locks semantics the app relies on: a waiting request is granted on release or
// rejected when its signal aborts.
function fakeLocks() {
  const held = new Set<string>();
  const waiting: { name: string; grant: () => void }[] = [];
  return {
    held,
    request(name: string, { signal }: { signal: AbortSignal }, callback: () => Promise<void>): Promise<void> {
      return new Promise((resolve, reject) => {
        const grant = () => {
          held.add(name);
          callback().then(() => {
            held.delete(name);
            resolve();
            const next = waiting.findIndex((w) => w.name === name);
            if (next >= 0) waiting.splice(next, 1)[0].grant();
          });
        };
        if (!held.has(name)) return grant();
        const entry = { name, grant };
        waiting.push(entry);
        signal.addEventListener('abort', () => {
          waiting.splice(waiting.indexOf(entry), 1);
          reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
        });
      });
    },
  };
}

describe('account lock (one tab per account database)', () => {
  const original = (globalThis as { navigator?: unknown }).navigator;
  afterEach(() => {
    releaseAccountLock();
    Object.defineProperty(globalThis, 'navigator', { value: original, configurable: true });
  });

  it('is a no-op without Web Locks (native)', async () => {
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
    await expect(acquireAccountLock('account-a.db')).resolves.toBeUndefined();
  });

  it('refuses a second holder with AccountInUseError and grants it after release', async () => {
    const locks = fakeLocks();
    Object.defineProperty(globalThis, 'navigator', { value: { locks }, configurable: true });
    await acquireAccountLock('account-a.db');
    expect(locks.held.has('aigym:account-a.db')).toBe(true);

    // A second tab: same lock, already held. Simulate it by requesting directly with a short wait.
    const otherTab = locks.request('aigym:account-a.db', { signal: AbortSignal.timeout(20) }, async () => {});
    await expect(otherTab).rejects.toMatchObject({ name: 'TimeoutError' });

    releaseAccountLock();
    await Promise.resolve();
    expect(locks.held.has('aigym:account-a.db')).toBe(false);
    await acquireAccountLock('account-a.db', 20);
    expect(locks.held.has('aigym:account-a.db')).toBe(true);
  });

  it('maps a timed-out wait to AccountInUseError', async () => {
    const locks = fakeLocks();
    Object.defineProperty(globalThis, 'navigator', { value: { locks }, configurable: true });
    const blocker = locks.request('aigym:account-b.db', { signal: AbortSignal.timeout(1000) }, () => new Promise(() => {}));
    void blocker;
    await expect(acquireAccountLock('account-b.db', 20)).rejects.toBeInstanceOf(AccountInUseError);
  });

  it('shares the lock between concurrent acquisitions in one tab instead of releasing it', async () => {
    const locks = fakeLocks();
    Object.defineProperty(globalThis, 'navigator', { value: { locks }, configurable: true });
    await Promise.all([acquireAccountLock('account-c.db'), acquireAccountLock('account-c.db')]);
    expect(locks.held.has('aigym:account-c.db')).toBe(true);
    const otherTab = locks.request('aigym:account-c.db', { signal: AbortSignal.timeout(20) }, async () => {});
    await expect(otherTab).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
