import { and, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';

import type { AggregateType } from '@/domain/contracts';

import * as s from '../schema';
import type { Db } from './docs';
import { ValidationError } from './errors';

/** Shared plumbing handed to every repository. */
export type RepoCtx = {
  db: Db;
  newId: () => string;
  now: () => Date;
  /** Runs `fn` in ONE synchronous SQLite transaction, then notifies subscribers after commit. */
  mutate: <T>(fn: (tx: Db) => T) => T;
  notify: () => void;
};

/**
 * Queues a sync op inside the caller's transaction (NFR-02). Upserts carry no payload: the worker
 * coalesces pending ops and freezes the current document when sending (docs/CONTRACTS.md "Outbox").
 */
export function enqueue(
  ctx: RepoCtx,
  tx: Db,
  aggregateType: AggregateType,
  aggregateId: string,
  action: 'upsert' | 'delete',
  payload: unknown = null,
): string {
  const opId = ctx.newId();
  tx.insert(s.outbox)
    .values({ opId, aggregateType, aggregateId, action, status: 'pending', payload, createdAt: ctx.now().toISOString() })
    .run();
  return opId;
}

export function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new ValidationError(`Invalid ${what}: ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  return r.data;
}

/** Builds SyncMeta for every aggregate of `type` with two queries (no per-row lookups). */
export function syncMetaFor(db: Db, type: AggregateType) {
  const counts = new Map<string, number>();
  for (const r of db
    .select({ id: s.outbox.aggregateId, status: s.outbox.status })
    .from(s.outbox)
    .where(and(eq(s.outbox.aggregateType, type), inArray(s.outbox.status, ['pending', 'inflight', 'failed', 'conflict'])))
    .all()) {
    counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
  }
  const conflicts = new Set(
    db.select({ id: s.syncConflicts.aggregateId }).from(s.syncConflicts).where(eq(s.syncConflicts.aggregateType, type)).all().map((r) => r.id),
  );
  return (id: string, serverRevision: number | null) => ({ serverRevision, pendingOps: counts.get(id) ?? 0, conflict: conflicts.has(id) });
}
