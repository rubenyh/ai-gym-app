import { randomUUID } from 'expo-crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { bodyWeightDoc, rewardSummary, type RewardSummary } from '@/domain/contracts';
import type { BodyWeightRepository, OutboxRepository, Repositories } from '@/domain/repositories';

import * as s from '../schema';
import { createAccountSettingsRepository } from './account-settings';
import { createCatalogRepository, seedCatalog, type CatalogAsset } from './catalog';
import { enqueue, parse, syncMetaFor, type RepoCtx } from './context';
import { markDeleted, readBodyWeight, type Db } from './docs';
import { NotFoundError } from './errors';
import { createProgramRepository, createRoutineRepository } from './plans';
import { createSessionRepository } from './sessions';
import { createSyncStore, type SyncStore } from './sync-store';

export * from './errors';
export type { Db } from './docs';
export type { SyncConflict, FailedOp, SyncStore } from './sync-store';

/** Repositories plus the local half of the sync protocol (used only by services/sync). */
export type LocalRepositories = Repositories & { sync: SyncStore };

export type RepositoryOptions = {
  newId?: () => string;
  now?: () => Date;
  /** Defaults to the bundled assets/catalog/exercises.v1.json. */
  catalog?: CatalogAsset | null;
};

const bundledCatalog = (): CatalogAsset => require('../../../assets/catalog/exercises.v1.json');

/** Wires all repositories to one account database (already migrated by openAccountDb / tests). */
export function createRepositories(db: Db, opts: RepositoryOptions = {}): LocalRepositories {
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  const ctx: RepoCtx = {
    db,
    newId: opts.newId ?? randomUUID,
    now: opts.now ?? (() => new Date()),
    notify,
    mutate(fn) {
      const result = db.transaction(fn);
      notify();
      return result;
    },
  };

  const catalogAsset = opts.catalog === undefined ? bundledCatalog() : opts.catalog;
  if (catalogAsset) seedCatalog(db, catalogAsset);

  const catalog = createCatalogRepository(ctx);
  const sync = createSyncStore(ctx);
  return {
    catalog,
    routines: createRoutineRepository(ctx),
    programs: createProgramRepository(ctx),
    sessions: createSessionRepository(ctx, catalog),
    bodyWeight: createBodyWeightRepository(ctx),
    accountSettings: createAccountSettingsRepository(ctx),
    outbox: createOutboxRepository(db),
    rewardCache: {
      get() {
        const r = db.select().from(s.rewardCache).where(eq(s.rewardCache.id, 1)).get();
        const parsed = r ? rewardSummary.safeParse(r.summary) : null;
        return parsed?.success ? parsed.data : null;
      },
      set(summary: RewardSummary) {
        sync.setRewardSummary(parse(rewardSummary, summary, 'reward summary'));
      },
    },
    sync,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function createBodyWeightRepository(ctx: RepoCtx): BodyWeightRepository {
  const { db } = ctx;
  return {
    list() {
      const meta = syncMetaFor(db, 'body_weight');
      return db
        .select()
        .from(s.bodyWeightEntries)
        .where(eq(s.bodyWeightEntries.deleted, false))
        .orderBy(desc(s.bodyWeightEntries.measuredAt), desc(s.bodyWeightEntries.id))
        .all()
        .map((r) => ({ id: r.id, measuredAt: r.measuredAt, weightGrams: r.weightGrams, ...meta(r.id, r.serverRevision) }));
    },
    save(input) {
      const doc = parse(bodyWeightDoc, { ...input, id: input.id ?? ctx.newId() }, 'body weight');
      return ctx.mutate((tx) => {
        const existing = readBodyWeight(tx, doc.id);
        const values = { ...doc, updatedAt: ctx.now().toISOString() };
        if (existing) tx.update(s.bodyWeightEntries).set(values).where(and(eq(s.bodyWeightEntries.id, doc.id), eq(s.bodyWeightEntries.deleted, false))).run();
        else tx.insert(s.bodyWeightEntries).values(values).run();
        enqueue(ctx, tx, 'body_weight', doc.id, 'upsert');
        return doc;
      });
    },
    delete(id) {
      ctx.mutate((tx) => {
        if (!markDeleted(tx, 'body_weight', id, ctx.now().toISOString())) throw new NotFoundError('Body weight entry');
        enqueue(ctx, tx, 'body_weight', id, 'delete');
      });
    },
  };
}

function createOutboxRepository(db: Db): OutboxRepository {
  const count = (statuses: (typeof s.outbox.$inferSelect)['status'][]) =>
    db.select({ n: sql<number>`count(*)` }).from(s.outbox).where(inArray(s.outbox.status, statuses)).get()?.n ?? 0;
  return {
    summary() {
      const state = db.select().from(s.syncState).where(eq(s.syncState.id, 1)).get();
      return {
        pending: count(['pending']),
        inflight: count(['inflight']),
        failed: count(['failed']),
        conflicts: db.select({ n: sql<number>`count(*)` }).from(s.syncConflicts).get()?.n ?? 0,
        lastSyncAt: state?.lastSyncAt ?? null,
        lastError: state?.lastError ?? null,
      };
    },
    hasUnsynced: () => count(['pending', 'inflight', 'conflict', 'failed']) > 0,
  };
}
