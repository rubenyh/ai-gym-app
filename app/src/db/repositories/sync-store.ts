/**
 * Local half of the sync protocol (docs/architecture/CONTRACTS.md "Outbox", DATA_AND_SYNC.md). Every method is one
 * SQLite transaction. The network half lives in services/sync/engine.ts.
 */
import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm';

import {
  docSchemas,
  type AggregateType,
  type ChangePage,
  type PushOp,
  type PushResult,
  type RewardSummary,
} from '@/domain/contracts';

import * as s from '../schema';
import { enqueue, type RepoCtx } from './context';
import { purgeDoc, readDoc, readRootMeta, setServerRevision, writeDoc, type Db, type SyncedType } from './docs';
import { NotFoundError } from './errors';

type OutboxRow = typeof s.outbox.$inferSelect;
const UNACKED = ['pending', 'inflight', 'conflict', 'failed'] as const;

export type NextOp = { op: PushOp; attempts: number } | { waitUntil: Date } | null;

export type SyncConflict = {
  aggregateType: AggregateType;
  aggregateId: string;
  localDoc: unknown;
  serverDoc: unknown;
  serverRevision: number;
  serverDeleted: boolean;
  createdAt: string;
};

export type FailedOp = { opId: string; aggregateType: AggregateType; aggregateId: string; action: 'upsert' | 'delete'; lastError: string | null };

export type SyncStore = ReturnType<typeof createSyncStore>;

export function createSyncStore(ctx: RepoCtx) {
  const { db } = ctx;
  const iso = () => ctx.now().toISOString();

  const state = () => db.select().from(s.syncState).where(eq(s.syncState.id, 1)).get();
  function patchState(tx: Db, patch: Partial<typeof s.syncState.$inferInsert>) {
    tx.insert(s.syncState).values({ id: 1, ...patch }).onConflictDoUpdate({ target: s.syncState.id, set: patch }).run();
  }

  const toPushOp = (r: OutboxRow): PushOp => ({
    opId: r.opId,
    aggregateType: r.aggregateType,
    aggregateId: r.aggregateId,
    action: r.action,
    baseRevision: r.baseRevision,
    doc: r.action === 'delete' ? null : r.payload,
  });

  const hasUnacked = (tx: Db, type: string, id: string) =>
    !!tx
      .select({ seq: s.outbox.seq })
      .from(s.outbox)
      .where(and(eq(s.outbox.aggregateType, type as AggregateType), eq(s.outbox.aggregateId, id), inArray(s.outbox.status, [...UNACKED])))
      .get();

  const supersede = (tx: Db, type: AggregateType, id: string, statuses: OutboxRow['status'][], beforeSeq?: number) =>
    tx
      .update(s.outbox)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(s.outbox.aggregateType, type),
          eq(s.outbox.aggregateId, id),
          inArray(s.outbox.status, statuses),
          beforeSeq === undefined ? undefined : lt(s.outbox.seq, beforeSeq),
        ),
      )
      .run();

  /** Superseded rows only matter until the op that replaced them is settled. */
  const dropSuperseded = (tx: Db, type: AggregateType, id: string) =>
    tx.delete(s.outbox).where(and(eq(s.outbox.aggregateType, type), eq(s.outbox.aggregateId, id), eq(s.outbox.status, 'superseded'))).run();

  /**
   * Picks the op to send. An inflight op is always resent unchanged (lost-ack retry, same opId + payload).
   * Otherwise the oldest pending aggregate (no open conflict) is coalesced into its newest op, which is
   * frozen with the current document and base revision and becomes inflight.
   */
  function nextOp(force: boolean): NextOp {
    let result: NextOp = null;
    db.transaction((tx) => {
      const inflight = tx.select().from(s.outbox).where(eq(s.outbox.status, 'inflight')).orderBy(asc(s.outbox.seq)).get();
      if (inflight) {
        const due = !inflight.nextAttemptAt || force || inflight.nextAttemptAt <= iso();
        result = due ? { op: toPushOp(inflight), attempts: inflight.attempts } : { waitUntil: new Date(inflight.nextAttemptAt!) };
        return;
      }
      const blocked = new Set(
        tx.select({ t: s.outbox.aggregateType, id: s.outbox.aggregateId }).from(s.outbox).where(eq(s.outbox.status, 'conflict')).all().map((r) => `${r.t}:${r.id}`),
      );
      const pending = tx.select().from(s.outbox).where(eq(s.outbox.status, 'pending')).orderBy(asc(s.outbox.seq)).all();
      for (const first of pending) {
        if (blocked.has(`${first.aggregateType}:${first.aggregateId}`)) continue;
        const newest = pending.filter((p) => p.aggregateType === first.aggregateType && p.aggregateId === first.aggregateId).at(-1)!;
        supersede(tx, newest.aggregateType, newest.aggregateId, ['pending'], newest.seq);

        if (newest.aggregateType === 'coach_approval') {
          tx.update(s.outbox).set({ status: 'inflight', baseRevision: null }).where(eq(s.outbox.seq, newest.seq)).run();
          result = { op: toPushOp({ ...newest, baseRevision: null }), attempts: newest.attempts };
          return;
        }
        const type = newest.aggregateType as SyncedType;
        const meta = readRootMeta(tx, type, newest.aggregateId);
        if (newest.action === 'delete') {
          if (!meta || meta.serverRevision === null) {
            // Never reached the server: nothing to delete remotely.
            if (meta) purgeDoc(tx, type, newest.aggregateId);
            tx.update(s.outbox).set({ status: 'superseded' }).where(eq(s.outbox.seq, newest.seq)).run();
            dropSuperseded(tx, type, newest.aggregateId);
            continue;
          }
          tx.update(s.outbox).set({ status: 'inflight', baseRevision: meta.serverRevision, payload: null }).where(eq(s.outbox.seq, newest.seq)).run();
          result = { op: toPushOp({ ...newest, baseRevision: meta.serverRevision, payload: null }), attempts: newest.attempts };
          return;
        }
        const doc = readDoc(tx, type, newest.aggregateId);
        if (!doc || meta?.deleted) {
          tx.update(s.outbox).set({ status: 'superseded' }).where(eq(s.outbox.seq, newest.seq)).run();
          continue;
        }
        const valid = docSchemas[type].safeParse(doc);
        if (!valid.success) {
          tx.update(s.outbox).set({ status: 'failed', lastError: `Invalid local data: ${valid.error.issues[0]?.message ?? 'unknown'}` }).where(eq(s.outbox.seq, newest.seq)).run();
          continue;
        }
        const base = meta?.serverRevision ?? null;
        tx.update(s.outbox).set({ status: 'inflight', baseRevision: base, payload: valid.data }).where(eq(s.outbox.seq, newest.seq)).run();
        result = { op: toPushOp({ ...newest, baseRevision: base, payload: valid.data }), attempts: newest.attempts };
        return;
      }
    });
    if (result === null) ctx.notify();
    return result;
  }

  /** Stores the definitive answer for an inflight op (one transaction). */
  function applyResult(op: PushOp, res: PushResult): void {
    ctx.mutate((tx) => {
      const row = tx.select().from(s.outbox).where(eq(s.outbox.opId, op.opId)).get();
      if (!row || row.status !== 'inflight') return;
      const synced = op.aggregateType !== 'coach_approval' ? (op.aggregateType as SyncedType) : null;
      if (res.status === 'applied' || res.status === 'duplicate') {
        // Acknowledged: drop the op; the next op for this aggregate rebases on `revision`.
        tx.delete(s.outbox).where(eq(s.outbox.seq, row.seq)).run();
        supersede(tx, op.aggregateType, op.aggregateId, ['failed'], row.seq);
        dropSuperseded(tx, op.aggregateType, op.aggregateId);
        if (synced) {
          if (res.deleted) purgeDoc(tx, synced, op.aggregateId);
          else setServerRevision(tx, synced, op.aggregateId, res.revision);
        }
        patchState(tx, { lastSyncAt: iso(), lastError: null });
      } else if (res.status === 'conflict') {
        tx.update(s.outbox).set({ status: 'conflict', lastError: 'Changed on another device' }).where(eq(s.outbox.seq, row.seq)).run();
        const values = {
          aggregateType: op.aggregateType,
          aggregateId: op.aggregateId,
          opId: op.opId,
          localDoc: op.doc,
          serverDoc: res.serverDoc,
          serverRevision: res.serverRevision,
          serverDeleted: res.serverDeleted,
          createdAt: iso(),
        };
        tx.insert(s.syncConflicts).values(values).onConflictDoUpdate({ target: [s.syncConflicts.aggregateType, s.syncConflicts.aggregateId], set: values }).run();
      } else if (res.status === 'rejected') {
        tx.update(s.outbox).set({ status: 'failed', lastError: `${res.code}: ${res.message}` }).where(eq(s.outbox.seq, row.seq)).run();
      }
    });
  }

  /** Transport failure: the frozen op stays inflight and is resent unchanged at `nextAttemptAt`. */
  function recordRetry(opId: string, error: string, nextAttemptAt: Date): void {
    ctx.mutate((tx) => {
      const row = tx.select({ attempts: s.outbox.attempts }).from(s.outbox).where(eq(s.outbox.opId, opId)).get();
      if (row) tx.update(s.outbox).set({ attempts: row.attempts + 1, lastError: error, nextAttemptAt: nextAttemptAt.toISOString() }).where(eq(s.outbox.opId, opId)).run();
      patchState(tx, { lastError: error });
    });
  }

  /**
   * Applies one pull page and advances the cursor in ONE transaction. Aggregates with unacknowledged
   * local ops are never overwritten (their push will reconcile or conflict); stale revisions are skipped.
   */
  function applyPage(page: ChangePage): { skippedInvalid: number } {
    let skippedInvalid = 0;
    ctx.mutate((tx) => {
      for (const c of page.changes) {
        if (hasUnacked(tx, c.aggregateType, c.aggregateId)) continue;
        const meta = readRootMeta(tx, c.aggregateType, c.aggregateId);
        if (meta?.serverRevision != null && c.revision <= meta.serverRevision) continue;
        if (c.deleted) {
          purgeDoc(tx, c.aggregateType, c.aggregateId);
          continue;
        }
        const doc = docSchemas[c.aggregateType].safeParse(c.doc);
        if (!doc.success) {
          skippedInvalid++;
          continue;
        }
        try {
          // Savepoint: a change that violates a local constraint (e.g. a second active workout from
          // another device) is skipped without undoing the rest of the page.
          tx.transaction((sp) => writeDoc(sp, c.aggregateType, doc.data as never, iso(), c.revision));
        } catch {
          skippedInvalid++;
        }
      }
      // ponytail: skipped changes are lost on this device until a full re-hydration; store them for retry if this shows up.
      patchState(tx, {
        cursor: page.nextCursor,
        ...(page.hasMore ? {} : { hydrated: true, lastSyncAt: iso() }),
        ...(skippedInvalid ? { lastError: `${skippedInvalid} server change(s) could not be applied on this device` } : {}),
      });
    });
    return { skippedInvalid };
  }

  return {
    nextOp,
    applyResult,
    recordRetry,
    applyPage,
    cursor: () => state()?.cursor ?? 0,
    hydrated: () => state()?.hydrated ?? false,
    setError(error: string | null) {
      ctx.mutate((tx) => patchState(tx, { lastError: error }));
    },

    conflicts(): SyncConflict[] {
      return db
        .select()
        .from(s.syncConflicts)
        .orderBy(desc(s.syncConflicts.createdAt))
        .all()
        .map(({ opId: _op, ...c }) => ({ ...c, aggregateType: c.aggregateType as AggregateType }));
    },

    failed(): FailedOp[] {
      return db
        .select({ opId: s.outbox.opId, aggregateType: s.outbox.aggregateType, aggregateId: s.outbox.aggregateId, action: s.outbox.action, lastError: s.outbox.lastError })
        .from(s.outbox)
        .where(eq(s.outbox.status, 'failed'))
        .orderBy(asc(s.outbox.seq))
        .all();
    },

    /** Re-queues a rejected op with a NEW op id (the server already holds a receipt for the old one). */
    retryFailed(opId: string) {
      ctx.mutate((tx) => {
        const row = tx.select().from(s.outbox).where(and(eq(s.outbox.opId, opId), eq(s.outbox.status, 'failed'))).get();
        if (!row) throw new NotFoundError('Failed change');
        tx.update(s.outbox).set({ status: 'superseded' }).where(eq(s.outbox.seq, row.seq)).run();
        enqueue(ctx, tx, row.aggregateType, row.aggregateId, row.action, row.aggregateType === 'coach_approval' ? row.payload : null);
      });
    },

    /**
     * User decision for a conflict (no silent last-write-wins).
     * - `mine`: rebase the local draft on the server revision and queue it again under a new op id.
     * - `server`: replace the local draft with the server copy and drop pending local ops for it.
     */
    resolveConflict(aggregateType: AggregateType, aggregateId: string, choice: 'mine' | 'server') {
      ctx.mutate((tx) => {
        const c = tx
          .select()
          .from(s.syncConflicts)
          .where(and(eq(s.syncConflicts.aggregateType, aggregateType), eq(s.syncConflicts.aggregateId, aggregateId)))
          .get();
        if (!c) throw new NotFoundError('Conflict');
        const conflictOp = tx.select().from(s.outbox).where(eq(s.outbox.opId, c.opId)).get();
        tx.delete(s.syncConflicts).where(and(eq(s.syncConflicts.aggregateType, aggregateType), eq(s.syncConflicts.aggregateId, aggregateId))).run();
        supersede(tx, aggregateType, aggregateId, ['conflict']);

        if (aggregateType === 'coach_approval') {
          // A stale approval cannot be "kept": the draft must be reviewed again against the new program.
          supersede(tx, aggregateType, aggregateId, ['pending', 'failed']);
          if (choice === 'mine' && conflictOp) enqueue(ctx, tx, aggregateType, aggregateId, 'upsert', conflictOp.payload);
          return;
        }
        const type = aggregateType as SyncedType;
        if (choice === 'mine') {
          const meta = readRootMeta(tx, type, aggregateId);
          if (meta) setServerRevision(tx, type, aggregateId, c.serverRevision);
          const newer = tx
            .select({ seq: s.outbox.seq })
            .from(s.outbox)
            .where(and(eq(s.outbox.aggregateType, type), eq(s.outbox.aggregateId, aggregateId), eq(s.outbox.status, 'pending')))
            .get();
          // Pending newer edits already carry the latest draft; otherwise queue the kept draft again.
          if (!newer) enqueue(ctx, tx, type, aggregateId, meta?.deleted || !meta ? 'delete' : 'upsert');
          return;
        }
        supersede(tx, type, aggregateId, ['pending', 'failed']);
        const serverDoc = c.serverDeleted ? null : docSchemas[type].safeParse(c.serverDoc);
        if (!serverDoc || !serverDoc.success) purgeDoc(tx, type, aggregateId);
        else writeDoc(tx, type, serverDoc.data as never, iso(), c.serverRevision);
      });
    },

    hasPendingWork: () =>
      !!db.select({ seq: s.outbox.seq }).from(s.outbox).where(inArray(s.outbox.status, ['pending', 'inflight'])).get(),


    setRewardSummary(summary: RewardSummary) {
      ctx.mutate((tx) => {
        const values = { id: 1, summary, fetchedAt: iso() };
        tx.insert(s.rewardCache).values(values).onConflictDoUpdate({ target: s.rewardCache.id, set: values }).run();
      });
    },
  };
}
