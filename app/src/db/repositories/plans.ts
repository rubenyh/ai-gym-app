import { and, asc, eq, ne } from 'drizzle-orm';

import { coachApprovalDoc, programDoc, routineDoc, type ProgramDoc, type RoutineDoc } from '@/domain/contracts';
import type { ProgramRepository, RoutineRepository } from '@/domain/repositories';

import * as s from '../schema';
import { enqueue, parse, syncMetaFor, type RepoCtx } from './context';
import { markDeleted, readProgram, readRoutine, readSession, writeDoc, type Db } from './docs';
import { NotFoundError } from './errors';

export function createRoutineRepository(ctx: RepoCtx): RoutineRepository {
  const { db } = ctx;
  const withMeta = (doc: RoutineDoc, rev: number | null, meta = syncMetaFor(db, 'routine')) => ({ ...doc, ...meta(doc.id, rev) });

  function save(doc: RoutineDoc): RoutineDoc {
    const valid = parse(routineDoc, doc, 'routine');
    return ctx.mutate((tx) => {
      const existing = tx.select({ deleted: s.routines.deleted }).from(s.routines).where(eq(s.routines.id, valid.id)).get();
      if (existing?.deleted) throw new NotFoundError('Routine');
      writeDoc(tx, 'routine', valid, ctx.now().toISOString());
      enqueue(ctx, tx, 'routine', valid.id, 'upsert');
      return valid;
    });
  }

  return {
    list(opts) {
      const rows = db
        .select({ id: s.routines.id, rev: s.routines.serverRevision })
        .from(s.routines)
        .where(and(eq(s.routines.deleted, false), opts?.includeArchived ? undefined : eq(s.routines.archived, false)))
        .orderBy(asc(s.routines.name))
        .all();
      const meta = syncMetaFor(db, 'routine');
      // ponytail: N+1 child reads; fine for personal routine counts, batch if lists grow to hundreds.
      return rows.map((r) => withMeta(readRoutine(db, r.id)!, r.rev, meta));
    },
    get(id) {
      const r = db.select({ rev: s.routines.serverRevision, deleted: s.routines.deleted }).from(s.routines).where(eq(s.routines.id, id)).get();
      return r && !r.deleted ? withMeta(readRoutine(db, id)!, r.rev) : null;
    },
    save,
    setArchived(id, archived) {
      const doc = readRoutine(db, id);
      if (!doc) throw new NotFoundError('Routine');
      save({ ...doc, archived });
    },
    delete(id) {
      ctx.mutate((tx) => {
        if (!markDeleted(tx, 'routine', id, ctx.now().toISOString())) throw new NotFoundError('Routine');
        enqueue(ctx, tx, 'routine', id, 'delete');
      });
    },
    createFromSession(sessionId, name) {
      const session = readSession(db, sessionId);
      if (!session) throw new NotFoundError('Session');
      return save({
        id: ctx.newId(),
        name,
        notes: '',
        archived: false,
        origin: 'session',
        exercises: session.exercises.map((e, i) => ({
          id: ctx.newId(),
          position: i,
          exerciseKey: e.exerciseKey,
          exerciseName: e.exerciseName,
          notes: e.notes,
          restSeconds: e.restSeconds,
          sets: e.sets.map((set, j) => ({
            id: ctx.newId(),
            position: j,
            targetReps: set.reps ?? set.targetReps,
            targetLoadGrams: set.loadGrams ?? set.targetLoadGrams,
            loadMode: set.loadMode,
          })),
        })),
      });
    },
  };
}

export function createProgramRepository(ctx: RepoCtx): ProgramRepository {
  const { db } = ctx;

  /** Deactivates other active programs, each with its own op queued BEFORE the new active one (server keeps one active). */
  function deactivateOthers(tx: Db, keepId: string, queue: boolean) {
    const others = tx
      .select({ id: s.programs.id })
      .from(s.programs)
      .where(and(eq(s.programs.active, true), eq(s.programs.deleted, false), ne(s.programs.id, keepId)))
      .all();
    for (const o of others) {
      tx.update(s.programs).set({ active: false, updatedAt: ctx.now().toISOString() }).where(eq(s.programs.id, o.id)).run();
      if (queue) enqueue(ctx, tx, 'program', o.id, 'upsert');
    }
  }

  function writeProgram(tx: Db, doc: ProgramDoc) {
    const existing = tx.select({ deleted: s.programs.deleted }).from(s.programs).where(eq(s.programs.id, doc.id)).get();
    if (existing?.deleted) throw new NotFoundError('Program');
    if (doc.active) deactivateOthers(tx, doc.id, true);
    writeDoc(tx, 'program', doc, ctx.now().toISOString());
    enqueue(ctx, tx, 'program', doc.id, 'upsert');
  }

  const listRows = (activeOnly: boolean) => {
    const rows = db
      .select({ id: s.programs.id, rev: s.programs.serverRevision })
      .from(s.programs)
      .where(and(eq(s.programs.deleted, false), activeOnly ? eq(s.programs.active, true) : undefined))
      .orderBy(asc(s.programs.name))
      .all();
    const meta = syncMetaFor(db, 'program');
    return rows.map((r) => ({ ...readProgram(db, r.id)!, ...meta(r.id, r.rev) }));
  };

  return {
    list: () => listRows(false),
    active: () => listRows(true)[0] ?? null,
    save(doc) {
      const valid = parse(programDoc, doc, 'program');
      ctx.mutate((tx) => writeProgram(tx, valid));
      return valid;
    },
    activate(id) {
      const doc = readProgram(db, id);
      if (!doc) throw new NotFoundError('Program');
      ctx.mutate((tx) => writeProgram(tx, { ...doc, active: true }));
    },
    delete(id) {
      ctx.mutate((tx) => {
        if (!markDeleted(tx, 'program', id, ctx.now().toISOString())) throw new NotFoundError('Program');
        enqueue(ctx, tx, 'program', id, 'delete');
      });
    },
    applyCoachApproval(input) {
      const doc = parse(coachApprovalDoc, input, 'coach approval');
      ctx.mutate((tx) => {
        // Applied once: a repeated tap on the same approval is a no-op locally (the server also dedupes).
        const queued = tx.select({ seq: s.outbox.seq }).from(s.outbox)
          .where(and(eq(s.outbox.aggregateType, 'coach_approval'), eq(s.outbox.aggregateId, doc.approvalId))).get();
        if (queued) return;
        const now = ctx.now().toISOString();
        // The server applies the whole command (and deactivates the previous program) in one transaction;
        // local rows mirror it now and receive their revisions from the next pull.
        for (const r of doc.routines) writeDoc(tx, 'routine', r, now);
        if (doc.program.active) deactivateOthers(tx, doc.program.id, false);
        writeDoc(tx, 'program', doc.program, now);
        enqueue(ctx, tx, 'coach_approval', doc.approvalId, 'upsert', doc);
      });
    },
  };
}
