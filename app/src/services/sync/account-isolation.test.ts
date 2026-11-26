/**
 * @jest-environment node
 *
 * Account isolation of the sync worker across sign-out / account switch (NFR-08). Deterministic: the
 * switch is injected at the exact await boundary through fakes at the auth/RPC boundary (no timers).
 */
import { randomUUID } from 'node:crypto';

import { count, openTestRepos } from '@/db/testing';
import type { PushOp, RoutineDoc } from '@/domain/contracts';

import { createSyncEngine, type SyncRpc } from './engine';
import { createSupabaseSyncRpc, jwtSubject } from './supabase-rpc';

const A = randomUUID();
const B = randomUUID();
const tokenFor = (sub: string) => `h.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.sig`;
const sessionOf = (id: string, sub = id) => ({ user: { id }, access_token: tokenFor(sub) });

/**
 * Fake supabase-js client. Like the real one, a request without an explicit Authorization header goes out
 * with the AMBIENT session token at dispatch time. `afterGetSession` runs between the account check and
 * the dispatch (the race window).
 */
function fakeClient(initial: ReturnType<typeof sessionOf>) {
  const f = {
    session: initial,
    afterGetSession: null as null | (() => void),
    sent: [] as { fn: string; authorization: string }[],
    auth: {
      getSession: async () => {
        const s = f.session;
        f.afterGetSession?.();
        return { data: { session: s } };
      },
    },
    rpc(fn: string) {
      const headers: Record<string, string> = {};
      const builder = {
        setHeader(name: string, value: string) {
          headers[name] = value;
          return builder;
        },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          f.sent.push({ fn, authorization: headers.Authorization ?? `Bearer ${f.session.access_token}` });
          return Promise.resolve({ data: { changes: [], nextCursor: 0, hasMore: false }, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return f;
}

const routine = (): RoutineDoc => ({ id: randomUUID(), name: 'Push A', notes: '', archived: false, origin: 'manual', exercises: [] });

describe('request-scoped auth (supabase-rpc)', () => {
  it('a switch to account B between the account check and dispatch still sends A\'s captured token', async () => {
    const client = fakeClient(sessionOf(A));
    client.afterGetSession = () => (client.session = sessionOf(B)); // B signs in right after the check
    const rpc = createSupabaseSyncRpc(client as never, A);
    await rpc.pull(0, 10);
    expect(client.sent).toEqual([{ fn: 'sync_pull', authorization: `Bearer ${tokenFor(A)}` }]);
  });

  it('nothing is sent when the session (or its token subject) is not the expected account', async () => {
    const client = fakeClient(sessionOf(B));
    await expect(createSupabaseSyncRpc(client as never, A).pull(0, 10)).rejects.toThrow('another account');
    client.session = sessionOf(A, B); // user id says A, token is B's
    await expect(createSupabaseSyncRpc(client as never, A).pull(0, 10)).rejects.toThrow('another account');
    expect(client.sent).toEqual([]);
  });

  it('decodes the token subject', () => {
    expect(jwtSubject(tokenFor(A))).toBe(A);
    expect(jwtSubject('garbage')).toBeNull();
  });
});

describe('results arriving after sign-out / account switch are discarded (engine)', () => {
  /** RPC whose next push/pull is held until released; `reached` resolves when the request is in flight. */
  function heldRpc() {
    let release!: (v: unknown) => void;
    let reached!: () => void;
    const inFlight = new Promise<void>((r) => (reached = r));
    const answer = new Promise((r) => (release = r));
    const pushes: PushOp[] = [];
    const rpc: SyncRpc = {
      async push(op) {
        pushes.push(op);
        reached();
        return answer;
      },
      async pull() {
        reached();
        return answer;
      },
      rewardSummary: async () => null,
    };
    return { rpc, pushes, inFlight, release };
  }

  it('sign-out after dispatch, before the ack: nothing is written; the same op is resent after re-sign-in', async () => {
    const local = openTestRepos();
    const held = heldRpc();
    const engine = createSyncEngine(local.repos, held.rpc, { writeDebounceMs: 0, random: () => 0 });
    const doc = local.repos.routines.save(routine());
    engine.start();
    const cycle = engine.syncNow();
    await held.inFlight;
    engine.stop(); // sign-out
    const op = held.pushes.at(-1)!;
    held.release({ status: 'applied', opId: op.opId, revision: 1, deleted: false });
    await cycle;
    expect(local.sqlite.prepare('SELECT op_id, status FROM outbox').all()).toEqual([{ op_id: op.opId, status: 'inflight' }]);
    expect(local.repos.routines.get(doc.id)?.serverRevision).toBeNull();
    expect(local.repos.outbox.summary().lastSyncAt).toBeNull();

    // Re-sign-in: the frozen op is resent unchanged and the server's receipt settles it.
    const resent: PushOp[] = [];
    const again = createSyncEngine(local.repos, {
      push: async (o) => (resent.push(o), { status: 'duplicate', opId: o.opId, revision: 1, deleted: false }),
      pull: async () => ({ changes: [], nextCursor: 0, hasMore: false }),
      rewardSummary: async () => null,
    }, { writeDebounceMs: 0 });
    again.start();
    await again.syncNow();
    again.stop();
    expect(resent[0]).toEqual(op);
    expect(local.repos.routines.get(doc.id)?.serverRevision).toBe(1);
    expect(count(local.sqlite, 'outbox')).toBe(0);
  });

  it('account switch while a pull page is in flight: the page is not applied to either account DB', async () => {
    const a = openTestRepos();
    const b = openTestRepos();
    let current = 'A';
    const held = heldRpc();
    const engine = createSyncEngine(a.repos, held.rpc, { writeDebounceMs: 0, isCurrent: () => current === 'A' });
    engine.start();
    const cycle = engine.syncNow();
    await held.inFlight;
    current = 'B'; // account B's database is now the open one; A's engine not yet stopped
    const r = routine();
    held.release({ changes: [{ seq: 1, aggregateType: 'routine', aggregateId: r.id, revision: 1, deleted: false, doc: r }], nextCursor: 1, hasMore: false });
    await cycle;
    engine.stop();
    for (const db of [a, b]) {
      expect(count(db.sqlite, 'routines')).toBe(0);
      expect(db.repos.sync.cursor()).toBe(0);
    }
  });
});
