/** @jest-environment node */
import { randomUUID } from 'node:crypto';

import { count, openTestRepos } from '@/db/testing';
import { accountProfile } from '@/db/schema';
import type { AccountSettingsDoc, PushOp, PushResult, RewardSummary, RoutineDoc } from '@/domain/contracts';
import { cacheAccount } from '@/features/account/account-data';

import { backoffDelay, createSyncEngine, SyncAuthError, type SyncRpc } from './engine';
import { createSupabaseSyncRpc } from './supabase-rpc';

// account-data imports the app client; these tests only use its local cache function.
jest.mock('@/services/supabase/client', () => ({ supabase: {} }));

type Agg = { revision: number; deleted: boolean; doc: unknown };

/** In-memory server following docs/CONTRACTS.md: receipts per opId, revisions, ordered change log. */
class FakeServer implements SyncRpc {
  aggregates = new Map<string, Agg>();
  receipts = new Map<string, PushResult>();
  log: { seq: number; aggregateType: string; aggregateId: string; revision: number; deleted: boolean; doc: unknown }[] = [];
  pushes: PushOp[] = [];
  /** Hooks: throw before applying (offline) or after applying (lost acknowledgement). */
  failBefore = 0;
  loseAck = 0;
  authFail = false;
  reject: string | null = null;
  hold: Promise<void> | null = null;
  rewards: RewardSummary = { ruleVersion: 1, totalXp: 50, level: 1, xpIntoLevel: 50, xpForNextLevel: 100, qualifyingSessions: 1, badges: [], petStages: [], awardedSessionIds: [] };

  write(type: string, id: string, doc: unknown, deleted = false) {
    const key = `${type}:${id}`;
    const revision = (this.aggregates.get(key)?.revision ?? 0) + 1;
    this.aggregates.set(key, { revision, deleted, doc: deleted ? null : doc });
    this.log.push({ seq: this.log.length + 1, aggregateType: type, aggregateId: id, revision, deleted, doc: deleted ? null : doc });
    return revision;
  }

  async push(op: PushOp): Promise<unknown> {
    this.pushes.push(structuredClone(op));
    if (this.authFail) throw new SyncAuthError();
    if (this.failBefore > 0 && this.failBefore--) throw new Error('Network request failed');
    if (this.hold) await this.hold;
    const prior = this.receipts.get(op.opId);
    if (prior) return prior.status === 'applied' ? { ...prior, status: 'duplicate' } : prior;
    const key = `${op.aggregateType}:${op.aggregateId}`;
    const current = this.aggregates.get(key);
    let result: PushResult;
    if (this.reject) {
      result = { status: 'rejected', opId: op.opId, code: 'invalid', message: this.reject };
    } else if ((current?.revision ?? null) !== op.baseRevision) {
      result = { status: 'conflict', opId: op.opId, serverRevision: current!.revision, serverDeleted: current!.deleted, serverDoc: current!.doc };
    } else {
      const deleted = op.action === 'delete';
      result = { status: 'applied', opId: op.opId, revision: this.write(op.aggregateType, op.aggregateId, op.doc, deleted), deleted };
    }
    this.receipts.set(op.opId, result);
    if (this.loseAck > 0 && this.loseAck--) throw new Error('Connection reset');
    return result;
  }

  async pull(after: number, limit: number) {
    if (this.authFail) throw new SyncAuthError();
    const changes = this.log.filter((c) => c.seq > after).slice(0, limit);
    const nextCursor = changes.at(-1)?.seq ?? after;
    return { changes, nextCursor, hasMore: this.log.some((c) => c.seq > nextCursor) };
  }

  async rewardSummary() {
    return this.rewards;
  }
}

const routineDoc = (name = 'Push A'): RoutineDoc => ({
  id: randomUUID(),
  name,
  notes: '',
  archived: false,
  origin: 'manual',
  exercises: [{ id: randomUUID(), position: 0, exerciseKey: 'catalog:0025', exerciseName: 'Barbell Bench Press', notes: '', restSeconds: 90, sets: [] }],
});

function setup(server = new FakeServer(), path?: string) {
  const local = openTestRepos(path);
  const engine = createSyncEngine(local.repos, server, { writeDebounceMs: 0, random: () => 0, pageSize: 2 });
  engine.start();
  return { ...local, server, engine };
}

let cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.forEach((f) => f());
  cleanup = [];
});
function tracked(...args: Parameters<typeof setup>) {
  const t = setup(...args);
  cleanup.push(() => t.engine.stop());
  return t;
}

describe('push (SYNC-01)', () => {
  it('coalesces pending ops into one frozen op, then rebases the next op on the acknowledged revision', async () => {
    const { repos, server, engine, sqlite } = tracked();
    const doc = repos.routines.save(routineDoc());
    repos.routines.save({ ...doc, name: 'Push B' });
    repos.routines.save({ ...doc, name: 'Push C' });
    await engine.syncNow();
    expect(server.pushes).toHaveLength(1);
    expect(server.pushes[0]).toMatchObject({ baseRevision: null, action: 'upsert', doc: { name: 'Push C' } });
    expect(repos.routines.get(doc.id)).toMatchObject({ serverRevision: 1, pendingOps: 0 });
    expect(count(sqlite, 'outbox')).toBe(0);

    repos.routines.save({ ...doc, name: 'Push D' });
    await engine.syncNow();
    expect(server.pushes[1]).toMatchObject({ baseRevision: 1, doc: { name: 'Push D' } });
    expect(server.aggregates.get(`routine:${doc.id}`)?.revision).toBe(2);
  });

  it('keeps the inflight payload frozen while the user keeps editing', async () => {
    const { repos, server, engine } = tracked();
    const doc = repos.routines.save(routineDoc());
    let release!: () => void;
    server.hold = new Promise((r) => (release = r));
    const sending = engine.syncNow();
    await new Promise((r) => setImmediate(r));
    repos.routines.save({ ...doc, name: 'Edited while sending' });
    server.hold = null;
    release();
    await sending;
    await engine.syncNow();
    expect(server.pushes.map((p) => [p.baseRevision, (p.doc as RoutineDoc).name])).toEqual([
      [null, 'Push A'],
      [1, 'Edited while sending'],
    ]);
  });

  it('retries a lost acknowledgement with the same op id and payload, without a duplicate effect', async () => {
    const server = new FakeServer();
    server.loseAck = 1;
    const { repos, engine } = tracked(server);
    const doc = repos.routines.save(routineDoc());
    await engine.syncNow();
    expect(repos.outbox.summary()).toMatchObject({ inflight: 1, lastError: 'Connection reset' });
    expect(engine.status().phase).toBe('retry-scheduled');
    await engine.syncNow();
    expect(server.pushes).toHaveLength(2);
    expect(server.pushes[1]).toEqual(server.pushes[0]);
    expect(server.log).toHaveLength(1);
    expect(repos.routines.get(doc.id)?.serverRevision).toBe(1);
    expect(repos.outbox.hasUnsynced()).toBe(false);
  });

  it('survives a restart while an op is inflight (offline) and resends the frozen op', async () => {
    const server = new FakeServer();
    server.failBefore = 1;
    const first = setup(server);
    const s = first.repos.sessions.startEmpty();
    await first.engine.syncNow();
    first.engine.stop();
    first.repos.sessions.setNotes(s.id, 'after crash');
    first.sqlite.close();

    const again = tracked(server, first.path);
    await again.engine.syncNow();
    expect(server.pushes.map((p) => p.opId)[0]).toBe(server.pushes[1].opId);
    expect(server.pushes[1]).toEqual(server.pushes[0]); // same frozen payload, not the post-crash edit
    // Inflight op went first (frozen), then the edit made while offline, rebased on revision 1.
    expect(server.pushes[2]).toMatchObject({ baseRevision: 1, doc: { notes: 'after crash' } });
    expect(again.repos.outbox.hasUnsynced()).toBe(false);
  });

  it('never sends deletes for aggregates the server never saw', async () => {
    const { repos, server, engine, sqlite } = tracked();
    const s = repos.sessions.startEmpty();
    repos.sessions.discard(s.id);
    await engine.syncNow();
    expect(server.pushes).toHaveLength(0);
    expect(count(sqlite, 'sessions')).toBe(0);
  });

  it('propagates deletes and purges the row after acknowledgement', async () => {
    const { repos, server, engine, sqlite } = tracked();
    const doc = repos.routines.save(routineDoc());
    await engine.syncNow();
    repos.routines.delete(doc.id);
    expect(repos.routines.get(doc.id)).toBeNull();
    await engine.syncNow();
    expect(server.pushes[1]).toMatchObject({ action: 'delete', baseRevision: 1, doc: null });
    expect(server.aggregates.get(`routine:${doc.id}`)?.deleted).toBe(true);
    expect(count(sqlite, 'routines')).toBe(0);
  });

  it('marks rejected ops failed with the server message and requeues them under a new op id', async () => {
    const server = new FakeServer();
    server.reject = 'Program has two active days';
    const { repos, engine } = tracked(server);
    repos.routines.save(routineDoc());
    await engine.syncNow();
    const [failed] = repos.sync.failed();
    expect(failed.lastError).toBe('invalid: Program has two active days');
    expect(repos.outbox.summary().failed).toBe(1);
    server.reject = null;
    repos.sync.retryFailed(failed.opId);
    await engine.syncNow();
    expect(server.pushes[1].opId).not.toBe(failed.opId);
    expect(repos.outbox.hasUnsynced()).toBe(false);
  });
});

describe('conflicts (no silent last-write-wins)', () => {
  async function conflicted() {
    const t = tracked();
    const doc = t.repos.routines.save(routineDoc());
    await t.engine.syncNow();
    t.server.write('routine', doc.id, { ...doc, name: 'Edited on phone B' });
    t.repos.routines.save({ ...doc, name: 'Edited on phone A' });
    await t.engine.syncNow();
    return { ...t, doc };
  }

  it('keeps the local draft and stores the server copy; pull does not overwrite it', async () => {
    const { repos } = await conflicted();
    expect(repos.routines.get(repos.routines.list()[0].id)).toMatchObject({ name: 'Edited on phone A', conflict: true });
    const [c] = repos.sync.conflicts();
    expect(c).toMatchObject({ serverRevision: 2, serverDeleted: false, serverDoc: { name: 'Edited on phone B' }, localDoc: { name: 'Edited on phone A' } });
    expect(repos.outbox.summary().conflicts).toBe(1);
  });

  it('"keep mine" re-queues the draft on the server revision', async () => {
    const { repos, engine, server, doc } = await conflicted();
    repos.sync.resolveConflict('routine', doc.id, 'mine');
    await engine.syncNow();
    expect(server.pushes.at(-1)).toMatchObject({ baseRevision: 2, doc: { name: 'Edited on phone A' } });
    expect(server.aggregates.get(`routine:${doc.id}`)?.revision).toBe(3);
    expect(repos.routines.get(doc.id)).toMatchObject({ name: 'Edited on phone A', conflict: false, pendingOps: 0, serverRevision: 3 });
  });

  it('"use server copy" replaces the local draft and drops local ops', async () => {
    const { repos, engine, doc } = await conflicted();
    repos.sync.resolveConflict('routine', doc.id, 'server');
    await engine.syncNow();
    expect(repos.routines.get(doc.id)).toMatchObject({ name: 'Edited on phone B', serverRevision: 2, conflict: false, pendingOps: 0 });
  });
});

describe('pull', () => {
  it('hydrates a new device page by page and refreshes the reward cache', async () => {
    const server = new FakeServer();
    const docs = [routineDoc('A'), routineDoc('B'), routineDoc('C')];
    docs.forEach((d) => server.write('routine', d.id, d));
    const pulls = jest.spyOn(server, 'pull');
    const { repos, engine } = tracked(server);
    await engine.syncNow();
    expect(pulls.mock.calls.slice(0, 2)).toEqual([[0, 2], [2, 2]]);
    expect(repos.routines.list().map((r) => r.name)).toEqual(['A', 'B', 'C']);
    expect(repos.sync.hydrated()).toBe(true);
    expect(repos.rewardCache.get()?.totalXp).toBe(50);
  });

  it('never overwrites an aggregate with a pending local edit, skips stale revisions, applies tombstones', () => {
    const { repos } = tracked();
    const pending = repos.routines.save(routineDoc('Local draft'));
    const synced = routineDoc('Synced');
    repos.sync.applyPage({ changes: [{ seq: 1, aggregateType: 'routine', aggregateId: synced.id, revision: 3, deleted: false, doc: synced }], nextCursor: 1, hasMore: false });
    repos.sync.applyPage({
      changes: [
        { seq: 2, aggregateType: 'routine', aggregateId: pending.id, revision: 1, deleted: false, doc: { ...pending, name: 'Server' } },
        { seq: 3, aggregateType: 'routine', aggregateId: synced.id, revision: 2, deleted: false, doc: { ...synced, name: 'Older' } },
      ],
      nextCursor: 3,
      hasMore: false,
    });
    expect(repos.routines.get(pending.id)?.name).toBe('Local draft');
    expect(repos.routines.get(synced.id)?.name).toBe('Synced');
    repos.sync.applyPage({ changes: [{ seq: 4, aggregateType: 'routine', aggregateId: synced.id, revision: 4, deleted: true, doc: null }], nextCursor: 4, hasMore: false });
    expect(repos.routines.get(synced.id)).toBeNull();
    expect(repos.sync.cursor()).toBe(4);
  });

  it('applies a page and its cursor advance atomically', () => {
    const { repos, sqlite } = openTestRepos();
    const d = routineDoc();
    // Force the cursor write (last statement of the page) to fail.
    sqlite.exec(`CREATE TRIGGER fail_cursor BEFORE UPDATE ON sync_state BEGIN SELECT RAISE(ABORT, 'disk full'); END;
                 CREATE TRIGGER fail_cursor_insert BEFORE INSERT ON sync_state BEGIN SELECT RAISE(ABORT, 'disk full'); END;`);
    expect(() =>
      repos.sync.applyPage({ changes: [{ seq: 1, aggregateType: 'routine', aggregateId: d.id, revision: 1, deleted: false, doc: d }], nextCursor: 1, hasMore: false }),
    ).toThrow('disk full');
    expect(count(sqlite, 'routines')).toBe(0);
    expect(repos.sync.cursor()).toBe(0);
  });
});

describe('worker behaviour', () => {
  it('pauses on auth failure instead of retrying, and resumes on manual sync', async () => {
    const server = new FakeServer();
    server.authFail = true;
    const { repos, engine } = tracked(server);
    repos.routines.save(routineDoc());
    await engine.syncNow();
    expect(engine.status().phase).toBe('paused-auth');
    const calls = server.pushes.length;
    await engine.trigger('online');
    expect(server.pushes.length).toBe(calls);
    server.authFail = false;
    await engine.syncNow();
    expect(engine.status().phase).toBe('idle');
    expect(repos.outbox.hasUnsynced()).toBe(false);
  });

  it('uses bounded exponential backoff with jitter', () => {
    expect(backoffDelay(0, () => 1)).toBe(2000);
    expect(backoffDelay(3, () => 1)).toBe(16000);
    expect(backoffDelay(50, () => 1)).toBe(300000);
    expect(backoffDelay(50, () => 0)).toBe(150000);
  });
});

describe('review regressions (2026-11-25)', () => {
  it('pull never overwrites an aggregate whose op is inflight or in conflict', async () => {
    const server = new FakeServer();
    const { repos, engine } = tracked(server);
    const doc = repos.routines.save(routineDoc('Mine'));
    server.failBefore = 1; // op becomes inflight, request lost
    await engine.syncNow();
    expect(repos.outbox.summary().inflight).toBe(1);
    repos.sync.applyPage({ changes: [{ seq: 1, aggregateType: 'routine', aggregateId: doc.id, revision: 9, deleted: false, doc: { ...doc, name: 'Remote' } }], nextCursor: 1, hasMore: false });
    expect(repos.routines.get(doc.id)?.name).toBe('Mine');
    repos.sync.applyPage({ changes: [{ seq: 2, aggregateType: 'routine', aggregateId: doc.id, revision: 10, deleted: true, doc: null }], nextCursor: 2, hasMore: false });
    expect(repos.routines.get(doc.id)?.name).toBe('Mine');
  });

  it("an account switch mid-cycle never sends this account's ops under another session", async () => {
    const A = randomUUID();
    let sessionUser = A;
    const rpcCalls: string[] = [];
    const client = {
      auth: { getSession: async () => ({ data: { session: { user: { id: sessionUser } } } }) },
      rpc: async (fn: string) => (rpcCalls.push(fn), { data: null, error: null }),
    };
    const rpc = createSupabaseSyncRpc(client as never, A);
    const { repos, engine } = tracked(new FakeServer());
    engine.stop();
    const own = createSyncEngine(repos, rpc, { writeDebounceMs: 0, random: () => 0 });
    repos.routines.save(routineDoc());
    sessionUser = randomUUID(); // another account signed in on this device
    own.start();
    cleanup.push(() => own.stop());
    await own.syncNow();
    expect(rpcCalls).toEqual([]);
    expect(own.status().phase).toBe('paused-auth');
    expect(repos.outbox.summary().inflight).toBe(1); // still queued for account A
  });

  describe('account_settings aggregate (offline PROFILE-02 / SETTINGS-01)', () => {
    const userId = randomUUID();
    function withAccount(server = new FakeServer(), revision = 2) {
      const t = tracked(server);
      t.sqlite.exec(`INSERT INTO account_profile (id, handle, display_name, visibility, avatar_path, updated_at, server_revision)
                     VALUES ('${userId}', 'ana', 'Ana', 'public', NULL, '2026-11-01T00:00:00Z', ${revision});
                     INSERT INTO user_settings VALUES (1, 'kg', 'cm', 'UTC', '2026-11-01T00:00:00Z');
                     INSERT INTO weekly_goals VALUES ('2026-11-02', 3, 'UTC');`);
      const serverDoc: AccountSettingsDoc = {
        id: userId, displayName: 'Ana', visibility: 'public', weightUnit: 'kg', lengthUnit: 'cm', timezone: 'UTC',
        weeklyGoals: [{ effectiveWeek: '2026-11-02', targetDays: 3, timezone: 'UTC' }],
      };
      for (let i = 0; i < revision; i++) server.write('account_settings', userId, serverDoc);
      return { ...t, serverDoc };
    }
    const input = { displayName: 'Ana', visibility: 'public' as const, weightUnit: 'kg' as const, lengthUnit: 'cm' as const, timezone: 'UTC', targetDays: 3 };

    it('saves offline as a pending op; private is not shown as applied until acknowledged', async () => {
      const server = new FakeServer();
      const { repos, engine } = withAccount(server);
      server.failBefore = 1;
      repos.accountSettings.save({ ...input, visibility: 'private', weightUnit: 'lb', targetDays: 5 });
      expect(repos.accountSettings.get()).toMatchObject({ visibility: 'private', pendingOps: 1, serverRevision: 2 });
      expect(repos.accountSettings.get()!.weeklyGoals.at(-1)).toMatchObject({ targetDays: 5, timezone: 'UTC' });
      // Saving the same values again queues nothing.
      repos.accountSettings.save({ ...input, visibility: 'private', weightUnit: 'lb', targetDays: 5 });
      expect(repos.outbox.summary().pending).toBe(1);

      await engine.syncNow(); // offline
      expect(repos.accountSettings.get()).toMatchObject({ pendingOps: 1, serverRevision: 2 });
      await engine.syncNow();
      expect(server.pushes.at(-1)).toMatchObject({ aggregateType: 'account_settings', aggregateId: userId, baseRevision: 2, doc: { visibility: 'private', weightUnit: 'lb' } });
      expect(repos.accountSettings.get()).toMatchObject({ visibility: 'private', pendingOps: 0, serverRevision: 3 });
    });

    it('two offline edits rebase: the second push uses the first acknowledged revision', async () => {
      const { repos, engine, server } = withAccount();
      repos.accountSettings.save({ ...input, displayName: 'Ana B' });
      await engine.syncNow();
      repos.accountSettings.save({ ...input, displayName: 'Ana C' });
      await engine.syncNow();
      const ops = server.pushes.filter((p) => p.aggregateType === 'account_settings');
      expect(ops.map((p) => [p.baseRevision, (p.doc as AccountSettingsDoc).displayName])).toEqual([[2, 'Ana B'], [3, 'Ana C']]);
      expect(new Set(ops.map((p) => p.opId)).size).toBe(2);
    });

    it('server refresh and pulls never overwrite a pending edit; a conflict keeps the local draft', async () => {
      const { repos, engine, server, serverDoc, db } = withAccount();
      repos.accountSettings.save({ ...input, displayName: 'Offline name' });
      // Account loader refresh with the (older) server snapshot while the edit is pending.
      await cacheAccount(db as never, {
        profile: { id: userId, handle: 'ana_new', displayName: 'Ana', visibility: 'public', avatarPath: null, updatedAt: '2026-11-02T00:00:00Z' },
        settings: { weightUnit: 'kg', lengthUnit: 'cm', timezone: 'UTC', updatedAt: '2026-11-02T00:00:00Z', revision: 2 },
        goals: serverDoc.weeklyGoals,
      });
      expect(repos.accountSettings.get()).toMatchObject({ displayName: 'Offline name', pendingOps: 1 });
      expect(db.select().from(accountProfile).get()?.handle).toBe('ana_new');

      server.write('account_settings', userId, { ...serverDoc, displayName: 'Other phone' });
      await engine.syncNow();
      expect(repos.accountSettings.get()).toMatchObject({ displayName: 'Offline name', conflict: true });
      expect(repos.sync.conflicts()[0]).toMatchObject({ aggregateType: 'account_settings', serverDoc: { displayName: 'Other phone' } });
      repos.sync.resolveConflict('account_settings', userId, 'mine');
      await engine.syncNow();
      expect(server.aggregates.get(`account_settings:${userId}`)).toMatchObject({ revision: 4, doc: { displayName: 'Offline name' } });
      expect(repos.accountSettings.get()).toMatchObject({ displayName: 'Offline name', conflict: false, pendingOps: 0, serverRevision: 4 });
    });

    it('a synced account is refreshed from the server snapshot, but never to an older revision than a pull applied', async () => {
      const { repos, serverDoc, db } = withAccount();
      const snap = (revision: number, displayName: string) => ({
        profile: { id: userId, handle: 'ana', displayName, visibility: 'public' as const, avatarPath: null, updatedAt: '2026-11-02T00:00:00Z' },
        settings: { weightUnit: 'kg' as const, lengthUnit: 'cm' as const, timezone: 'UTC', updatedAt: '2026-11-02T00:00:00Z', revision },
        goals: serverDoc.weeklyGoals,
      });
      await cacheAccount(db as never, snap(3, 'Fresh'));
      expect(repos.accountSettings.get()).toMatchObject({ displayName: 'Fresh', serverRevision: 3 });
      await cacheAccount(db as never, snap(1, 'Stale'));
      expect(repos.accountSettings.get()).toMatchObject({ displayName: 'Fresh', serverRevision: 3 });
    });

    it('a pulled server document (e.g. goal moved to a later week) replaces the synced local copy', () => {
      const { repos, serverDoc } = withAccount();
      const moved = { ...serverDoc, weeklyGoals: [...serverDoc.weeklyGoals, { effectiveWeek: '2026-12-07', targetDays: 5, timezone: 'UTC' }] };
      repos.sync.applyPage({ changes: [{ seq: 1, aggregateType: 'account_settings', aggregateId: userId, revision: 5, deleted: false, doc: moved }], nextCursor: 1, hasMore: false });
      expect(repos.accountSettings.get()).toMatchObject({ serverRevision: 5, weeklyGoals: moved.weeklyGoals });
    });
  });
});
