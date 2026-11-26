/**
 * @jest-environment node
 *
 * End-to-end sync against the LOCAL Supabase stack: real repositories (better-sqlite3), the real sync
 * engine and real supabase-js clients signed in as fresh test users. Skipped unless local keys are set:
 *
 *   cd app && set -a && eval "$(supabase status -o env)" && set +a && npm run test:integration
 *
 * SERVICE_ROLE_KEY is used only to create/delete confirmed test users and to inspect server rows.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

import { openTestRepos } from '@/db/testing';
import { sessionDoc, type PushOp, type RoutineDoc } from '@/domain/contracts';

import { createSyncEngine, type SyncRpc } from './engine';
import { createSupabaseSyncRpc } from './supabase-rpc';

const URL_ = process.env.SUPABASE_URL ?? process.env.API_URL;
const ANON_KEY = process.env.ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY;
// Runs only through jest.integration.config.js (real fetch) and only with local keys exported.
const enabled = Boolean((globalThis as { __SYNC_INTEGRATION__?: boolean }).__SYNC_INTEGRATION__ && URL_ && ANON_KEY && SERVICE_ROLE_KEY);
if (enabled && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(URL_!)) {
  throw new Error('Refusing to run sync integration tests against a non-local Supabase URL');
}

// expo-crypto is a native module; tests pass their own id generator, this only satisfies the import.
jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID() }));
jest.setTimeout(60_000);
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const run = Date.now().toString(36);

/** Network faults injected around the real RPC adapter. */
type Faulty = SyncRpc & { offline: boolean; dropNextAck: boolean };
function faulty(rpc: SyncRpc): Faulty {
  const f: Faulty = {
    offline: false,
    dropNextAck: false,
    async push(op: PushOp) {
      if (f.offline) throw new Error('Network request failed');
      const res = await rpc.push(op);
      if (f.dropNextAck) {
        f.dropNextAck = false;
        throw new Error('Connection reset (response lost)');
      }
      return res;
    },
    pull: (after, limit) => (f.offline ? Promise.reject(new Error('Network request failed')) : rpc.pull(after, limit)),
    rewardSummary: () => (f.offline ? Promise.reject(new Error('Network request failed')) : rpc.rewardSummary()),
  };
  return f;
}

(enabled ? describe : describe.skip)('sync against local Supabase (SYNC-01, NFR-03, NFR-04)', () => {
  const admin = enabled ? createClient(URL_!, SERVICE_ROLE_KEY!, opts) : (null as unknown as SupabaseClient);
  const userIds: string[] = [];
  const devices: ReturnType<typeof device>[] = [];
  const creds: Record<'a' | 'b', { email: string; password: string }> = {
    a: { email: `sync-a-${run}@test.local`, password: `pw-${run}-a` },
    b: { email: `sync-b-${run}@test.local`, password: `pw-${run}-b` },
  };

  async function signIn(who: 'a' | 'b') {
    const client = createClient(URL_!, ANON_KEY!, opts);
    const { error } = await client.auth.signInWithPassword(creds[who]);
    if (error) throw error;
    return client;
  }

  /** One phone: its own SQLite file, engine and signed-in client. */
  function device(client: SupabaseClient) {
    const local = openTestRepos();
    const rpc = faulty(createSupabaseSyncRpc(client));
    const engine = createSyncEngine(local.repos, rpc, { writeDebounceMs: 0, random: () => 0, pageSize: 2 });
    engine.start();
    return { ...local, rpc, engine, client };
  }
  const track = (d: ReturnType<typeof device>) => (devices.push(d), d);

  const serverRow = async (table: string, id: string) => {
    const { data, error } = await admin.from(table).select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data as Record<string, unknown> | null;
  };

  const routine = (): RoutineDoc => ({
    id: randomUUID(),
    name: 'Push A',
    notes: '',
    archived: false,
    origin: 'manual',
    exercises: [
      {
        id: randomUUID(),
        position: 0,
        exerciseKey: 'catalog:0025',
        exerciseName: 'Barbell Bench Press',
        notes: '',
        restSeconds: 90,
        sets: [{ id: randomUUID(), position: 0, targetReps: 8, targetLoadGrams: 60000, loadMode: 'external' }],
      },
    ],
  });

  let phone1: ReturnType<typeof device>;
  let phone2: ReturnType<typeof device>;
  let routineId: string;
  let sessionId: string;

  beforeAll(async () => {
    for (const who of ['a', 'b'] as const) {
      const { data, error } = await admin.auth.admin.createUser({ ...creds[who], email_confirm: true });
      if (error) throw error;
      userIds.push(data.user.id);
    }
    phone1 = track(device(await signIn('a')));
  });

  afterAll(async () => {
    devices.forEach((d) => {
      d.engine.stop();
      d.sqlite.close();
    });
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  });

  it('queues work offline, then pushes routine + completed session and receives the reward award', async () => {
    const { repos, rpc, engine } = phone1;
    rpc.offline = true;
    routineId = repos.routines.save(routine()).id;
    repos.bodyWeight.save({ measuredAt: '2026-11-25T07:30:00.000Z', weightGrams: 81500 });
    repos.catalog.saveCustom({ name: 'Landmine Press', primaryMuscles: ['shoulders'], secondaryMuscles: [], equipment: ['barbell'], instructions: [], loadMode: 'external', archived: false });
    const s = repos.sessions.startFromRoutine(routineId);
    sessionId = s.id;
    const setId = s.exercises[0].sets[0].id;
    repos.sessions.updateSet(s.id, setId, { reps: 8, loadGrams: 60000 });
    repos.sessions.setCompleted(s.id, setId, true);
    repos.sessions.finish(s.id);
    await engine.syncNow();
    expect(engine.status().phase).toBe('retry-scheduled');
    expect(await serverRow('routines', routineId)).toBeNull();

    rpc.offline = false;
    await engine.syncNow();
    expect(repos.outbox.hasUnsynced()).toBe(false);
    expect(await serverRow('routines', routineId)).toMatchObject({ owner_id: userIds[0], revision: 1, name: 'Push A' });
    expect(await serverRow('sessions', sessionId)).toMatchObject({ status: 'completed', revision: 1 });
    expect(repos.sessions.get(sessionId)?.serverRevision).toBe(1);
    expect(repos.rewardCache.get()?.awardedSessionIds).toContain(sessionId);
    expect(repos.rewardCache.get()!.totalXp).toBeGreaterThan(0);
  });

  it('bumps the revision on edit and survives a lost acknowledgement without a duplicate effect', async () => {
    const { repos, rpc, engine } = phone1;
    repos.routines.save({ ...repos.routines.get(routineId)!, name: 'Push B' });
    await engine.syncNow();
    expect(await serverRow('routines', routineId)).toMatchObject({ revision: 2, name: 'Push B' });

    repos.routines.save({ ...repos.routines.get(routineId)!, name: 'Push C' });
    rpc.dropNextAck = true;
    await engine.syncNow();
    expect(repos.outbox.summary().inflight).toBe(1);
    expect(await serverRow('routines', routineId)).toMatchObject({ revision: 3, name: 'Push C' });
    await engine.syncNow();
    expect(await serverRow('routines', routineId)).toMatchObject({ revision: 3 });
    expect(repos.routines.get(routineId)).toMatchObject({ serverRevision: 3, pendingOps: 0 });
    const receipts = await admin.from('operation_receipts').select('op_id').eq('aggregate_id', routineId);
    expect(receipts.data).toHaveLength(3);
  });

  it('a second device of the same user hydrates everything page by page', async () => {
    phone2 = track(device(await signIn('a')));
    await phone2.engine.syncNow();
    expect(phone2.repos.sync.hydrated()).toBe(true);
    expect(phone2.repos.routines.get(routineId)).toMatchObject({ name: 'Push C', serverRevision: 3 });
    expect(phone2.repos.sessions.history().map((s) => s.id)).toContain(sessionId);
    // Server-rebuilt docs (typed columns) must round-trip through the client contracts.
    expect(phone2.repos.bodyWeight.list()).toMatchObject([{ weightGrams: 81500, serverRevision: 1 }]);
    expect(Date.parse(phone2.repos.bodyWeight.list()[0].measuredAt)).toBe(Date.parse('2026-11-25T07:30:00.000Z'));
    expect(phone2.repos.catalog.search({ query: 'landmine' })[0]).toMatchObject({ custom: true });
    expect(phone2.repos.sync.conflicts()).toHaveLength(0);
    expect(phone2.repos.outbox.summary().lastError).toBeNull();
  });

  it('concurrent edits surface a conflict; "keep mine" wins only by explicit choice', async () => {
    phone1.repos.routines.save({ ...phone1.repos.routines.get(routineId)!, name: 'Phone 1' });
    phone2.repos.routines.save({ ...phone2.repos.routines.get(routineId)!, name: 'Phone 2' });
    await phone1.engine.syncNow();
    await phone2.engine.syncNow();
    expect(phone2.repos.routines.get(routineId)).toMatchObject({ name: 'Phone 2', conflict: true });
    expect(phone2.repos.sync.conflicts()[0]).toMatchObject({ serverRevision: 4, serverDoc: { name: 'Phone 1' } });

    phone2.repos.sync.resolveConflict('routine', routineId, 'mine');
    await phone2.engine.syncNow();
    expect(await serverRow('routines', routineId)).toMatchObject({ revision: 5, name: 'Phone 2' });
    await phone1.engine.syncNow();
    expect(phone1.repos.routines.get(routineId)).toMatchObject({ name: 'Phone 2', serverRevision: 5 });
  });

  it('"use server copy" replaces the local draft', async () => {
    phone1.repos.routines.save({ ...phone1.repos.routines.get(routineId)!, name: 'Local X' });
    phone2.repos.routines.save({ ...phone2.repos.routines.get(routineId)!, name: 'Server Y' });
    await phone2.engine.syncNow();
    await phone1.engine.syncNow();
    expect(phone1.repos.sync.conflicts()).toHaveLength(1);
    phone1.repos.sync.resolveConflict('routine', routineId, 'server');
    await phone1.engine.syncNow();
    expect(phone1.repos.routines.get(routineId)).toMatchObject({ name: 'Server Y', serverRevision: 6, conflict: false, pendingOps: 0 });
    expect(await serverRow('routines', routineId)).toMatchObject({ revision: 6 });
  });

  it('a delete propagates as a tombstone to the other device', async () => {
    phone1.repos.routines.delete(routineId);
    await phone1.engine.syncNow();
    expect(await serverRow('routines', routineId)).toMatchObject({ deleted: true, revision: 7 });
    await phone2.engine.syncNow();
    expect(phone2.repos.routines.get(routineId)).toBeNull();
    expect(phone2.repos.routines.list({ includeArchived: true })).toHaveLength(0);
  });

  it("user B neither pulls nor can overwrite A's data", async () => {
    const b = track(device(await signIn('b')));
    await b.engine.syncNow();
    expect(b.repos.sessions.history()).toHaveLength(0);
    expect(b.repos.sessions.get(sessionId)).toBeNull();
    const direct = await b.client.from('sessions').select('id').eq('id', sessionId);
    expect(direct.data).toEqual([]);
    const doc = sessionDoc.parse(phone1.repos.sessions.get(sessionId));
    const res = (await createSupabaseSyncRpc(b.client).push({
      opId: randomUUID(),
      aggregateType: 'session',
      aggregateId: sessionId,
      action: 'upsert',
      baseRevision: 1,
      doc: { ...doc, notes: 'hijack' },
    })) as { status: string; code?: string };
    expect(res).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await serverRow('sessions', sessionId)).toMatchObject({ owner_id: userIds[0] });
  });

  it('duplicate op ids (two clients at once, or a reused id with another payload) apply exactly once', async () => {
    const id = randomUUID();
    const op: PushOp = { opId: randomUUID(), aggregateType: 'routine', aggregateId: id, action: 'upsert', baseRevision: null, doc: { ...routine(), id, name: 'Once' } };
    const [c1, c2] = [createSupabaseSyncRpc(phone1.client), createSupabaseSyncRpc(await signIn('a'))];
    const results = (await Promise.all([c1.push(op), c2.push(op)])) as { status: string; revision: number }[];
    expect(results.map((r) => r.status).sort()).toEqual(['applied', 'duplicate']);
    expect(results.map((r) => r.revision)).toEqual([1, 1]);
    // Same op id, different payload: the stored receipt is returned and the new payload is NOT applied.
    // (The app never produces this: op ids are random and frozen with their payload.)
    const reused = (await c1.push({ ...op, doc: { ...(op.doc as RoutineDoc), name: 'Other payload' } })) as { status: string };
    expect(reused.status).toBe('duplicate');
    expect(await serverRow('routines', id)).toMatchObject({ revision: 1, name: 'Once' });
  });

  it('reward corrections follow synced edits and deletes of a completed session', async () => {
    const { repos, engine } = phone1;
    const s = repos.sessions.startEmpty();
    const ex = repos.sessions.addExercise(s.id, 'catalog:0025');
    const set = repos.sessions.active()!.exercises.find((e) => e.id === ex)!.sets[0];
    repos.sessions.updateSet(s.id, set.id, { reps: 5, loadGrams: 50000 });
    repos.sessions.setCompleted(s.id, set.id, true);
    repos.sessions.finish(s.id);
    await engine.syncNow();
    expect(repos.rewardCache.get()?.awardedSessionIds).toContain(s.id);
    const xp = repos.rewardCache.get()!.totalXp;

    // Edit: no completed set any more -> award revoked.
    const doc = repos.sessions.get(s.id)!;
    repos.sessions.saveCompleted({ ...sessionDoc.parse(doc), exercises: doc.exercises.map((e) => ({ ...e, sets: e.sets.map((x) => ({ ...x, completed: false, completedAt: null })) })) });
    await engine.syncNow();
    expect(repos.rewardCache.get()?.awardedSessionIds).not.toContain(s.id);
    expect(repos.rewardCache.get()!.totalXp).toBeLessThan(xp);

    // Restore by editing it back, then delete: restored, then revoked again; never double-counted.
    repos.sessions.saveCompleted(sessionDoc.parse(doc));
    await engine.syncNow();
    expect(repos.rewardCache.get()).toMatchObject({ totalXp: xp });
    repos.sessions.delete(s.id);
    await engine.syncNow();
    expect(repos.rewardCache.get()?.awardedSessionIds).not.toContain(s.id);
    expect(repos.rewardCache.get()!.totalXp).toBeLessThan(xp);
  });

  it('account settings edited offline sync later; the goal never lands in the current week', async () => {
    const client = await signIn('b');
    const { error } = await client.rpc('complete_onboarding', { p_handle: `b_${run}`.slice(0, 30), p_display_name: 'Bea', p_weight_unit: 'kg', p_length_unit: 'cm', p_timezone: 'UTC', p_target_days: 3 });
    if (error) throw error;
    const d = track(device(client));
    // Cached account (as the account loader writes it); the first pull fills the server revision.
    d.sqlite.exec(`INSERT INTO account_profile (id, handle, display_name, visibility, avatar_path, updated_at)
                   VALUES ('${userIds[1]}', 'b', 'Bea', 'private', NULL, '2026-11-25T00:00:00Z');
                   INSERT INTO user_settings VALUES (1, 'kg', 'cm', 'UTC', '2026-11-25T00:00:00Z');`);
    await d.engine.syncNow();
    const rev = d.repos.accountSettings.get()!.serverRevision!;
    expect(rev).toBeGreaterThanOrEqual(1);

    d.rpc.offline = true;
    d.repos.accountSettings.save({ displayName: 'Bea Offline', visibility: 'public', weightUnit: 'lb', lengthUnit: 'cm', timezone: 'UTC', targetDays: 5 });
    await d.engine.syncNow();
    expect(d.repos.accountSettings.get()).toMatchObject({ visibility: 'public', pendingOps: 1, serverRevision: rev });
    expect(await serverRow('profiles', userIds[1])).toMatchObject({ visibility: 'private', display_name: 'Bea' });

    d.rpc.offline = false;
    await d.engine.syncNow();
    expect(await serverRow('profiles', userIds[1])).toMatchObject({ visibility: 'public', display_name: 'Bea Offline' });
    const { data: goals } = await admin.from('weekly_goals').select('effective_week, target_days').eq('owner_id', userIds[1]).order('effective_week');
    expect(goals!.map((g) => g.target_days)).toEqual([3, 5]);
    expect(goals![1].effective_week > goals![0].effective_week).toBe(true);
    expect(d.repos.accountSettings.get()).toMatchObject({ pendingOps: 0, serverRevision: rev + 1, weightUnit: 'lb' });
    expect(d.repos.accountSettings.get()!.weeklyGoals.map((g) => g.targetDays)).toEqual([3, 5]);
  });
});
