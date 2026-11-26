import { and, desc, eq, lt, max, or, sql } from 'drizzle-orm';

import { grams, reps, restSeconds, sessionDoc, type ExerciseKey, type LoadMode, type SessionDoc } from '@/domain/contracts';
import type { CatalogRepository, SessionRepository, SetPatch } from '@/domain/repositories';

import * as s from '../schema';
import { enqueue, parse, syncMetaFor, type RepoCtx } from './context';
import { markDeleted, readRoutine, readSession, writeDoc, type Db } from './docs';
import { ActiveSessionExistsError, EmptySessionError, NotFoundError, ValidationError } from './errors';

const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** YYYY-MM-DD of `at` in `timeZone` (frozen at completion so history weeks never move). */
export function localDateIn(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function createSessionRepository(ctx: RepoCtx, catalog: CatalogRepository): SessionRepository {
  const { db } = ctx;
  const iso = (d?: Date) => (d ?? ctx.now()).toISOString();

  const activeId = (tx: Db) =>
    tx.select({ id: s.sessions.id }).from(s.sessions).where(and(eq(s.sessions.status, 'active'), eq(s.sessions.deleted, false))).get()?.id ?? null;

  /** Every session edit: check it exists, touch the root, run the change and queue ONE op, atomically. */
  function edit<T>(sessionId: string, fn: (tx: Db) => T): T {
    return ctx.mutate((tx) => {
      const r = tx
        .update(s.sessions)
        .set({ updatedAt: iso() })
        .where(and(eq(s.sessions.id, sessionId), eq(s.sessions.deleted, false)))
        .returning({ id: s.sessions.id })
        .all();
      if (!r.length) throw new NotFoundError('Session');
      const out = fn(tx);
      enqueue(ctx, tx, 'session', sessionId, 'upsert');
      return out;
    });
  }

  function exerciseOf(tx: Db, sessionId: string, sessionExerciseId: string) {
    const e = tx
      .select()
      .from(s.sessionExercises)
      .where(and(eq(s.sessionExercises.id, sessionExerciseId), eq(s.sessionExercises.sessionId, sessionId)))
      .get();
    if (!e) throw new NotFoundError('Session exercise');
    return e;
  }

  function setOf(tx: Db, sessionId: string, setId: string) {
    const row = tx
      .select({ set: s.performedSets, restSeconds: s.sessionExercises.restSeconds, status: s.sessions.status })
      .from(s.performedSets)
      .innerJoin(s.sessionExercises, eq(s.performedSets.sessionExerciseId, s.sessionExercises.id))
      .innerJoin(s.sessions, eq(s.sessionExercises.sessionId, s.sessions.id))
      .where(and(eq(s.performedSets.id, setId), eq(s.sessionExercises.sessionId, sessionId)))
      .get();
    if (!row) throw new NotFoundError('Set');
    return row;
  }

  function renumber(tx: Db, table: typeof s.sessionExercises | typeof s.performedSets, ids: string[]) {
    ids.forEach((id, position) => tx.update(table).set({ position }).where(eq(table.id, id)).run());
  }

  function start(doc: SessionDoc): SessionDoc {
    const valid = parse(sessionDoc, doc, 'session');
    return ctx.mutate((tx) => {
      const existing = activeId(tx);
      if (existing) throw new ActiveSessionExistsError(existing);
      writeDoc(tx, 'session', valid, iso());
      enqueue(ctx, tx, 'session', valid.id, 'upsert');
      return valid;
    });
  }

  function startTimer(tx: Db, sessionId: string, seconds: number, now?: Date) {
    const endsAt = new Date((now ?? ctx.now()).getTime() + seconds * 1000).toISOString();
    const values = { id: 1, sessionId, endsAt, durationSeconds: seconds };
    tx.insert(s.restTimer).values(values).onConflictDoUpdate({ target: s.restTimer.id, set: values }).run();
  }

  const clearTimerFor = (tx: Db, sessionId: string) => tx.delete(s.restTimer).where(eq(s.restTimer.sessionId, sessionId)).run();

  return {
    active() {
      const id = activeId(db);
      return id ? readSession(db, id) : null;
    },

    get(id) {
      const r = db.select({ rev: s.sessions.serverRevision, deleted: s.sessions.deleted }).from(s.sessions).where(eq(s.sessions.id, id)).get();
      return r && !r.deleted ? { ...readSession(db, id)!, ...syncMetaFor(db, 'session')(id, r.rev) } : null;
    },

    history(opts) {
      const rows = db
        .select({ id: s.sessions.id, rev: s.sessions.serverRevision })
        .from(s.sessions)
        .where(
          and(
            eq(s.sessions.status, 'completed'),
            eq(s.sessions.deleted, false),
            // Composite cursor: rows strictly after (completedAt, id) in (DESC, DESC) order.
            opts?.before
              ? or(
                  lt(s.sessions.completedAt, opts.before.completedAt),
                  and(eq(s.sessions.completedAt, opts.before.completedAt), lt(s.sessions.id, opts.before.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(s.sessions.completedAt), desc(s.sessions.id))
        .limit(opts?.limit ?? 50)
        .all();
      const meta = syncMetaFor(db, 'session');
      return rows.map((r) => ({ ...readSession(db, r.id)!, ...meta(r.id, r.rev) }));
    },

    startEmpty(name = 'Workout') {
      return start({
        id: ctx.newId(),
        routineId: null,
        name,
        status: 'active',
        startedAt: iso(),
        completedAt: null,
        timezone: deviceTimeZone(),
        localDate: null,
        notes: '',
        exercises: [],
      });
    },

    startFromRoutine(routineId) {
      const routine = readRoutine(db, routineId);
      if (!routine) throw new NotFoundError('Routine');
      // Snapshot: later routine edits never touch this session (SESSION-01, separate snapshots rule).
      return start({
        id: ctx.newId(),
        routineId,
        name: routine.name,
        status: 'active',
        startedAt: iso(),
        completedAt: null,
        timezone: deviceTimeZone(),
        localDate: null,
        notes: '',
        exercises: routine.exercises.map((e) => ({
          id: ctx.newId(),
          position: e.position,
          exerciseKey: e.exerciseKey,
          exerciseName: e.exerciseName,
          notes: e.notes,
          restSeconds: e.restSeconds,
          sets: e.sets.map((p) => ({
            id: ctx.newId(),
            position: p.position,
            targetReps: p.targetReps,
            targetLoadGrams: p.targetLoadGrams,
            reps: null,
            loadGrams: null,
            loadMode: p.loadMode,
            completed: false,
            completedAt: null,
          })),
        })),
      });
    },

    discard(id) {
      ctx.mutate((tx) => {
        if (!markDeleted(tx, 'session', id, iso())) throw new NotFoundError('Session');
        clearTimerFor(tx, id);
        enqueue(ctx, tx, 'session', id, 'delete');
      });
    },

    addExercise(sessionId, key: ExerciseKey) {
      const exercise = catalog.get(key);
      if (!exercise) throw new NotFoundError('Exercise');
      return edit(sessionId, (tx) => {
        const id = ctx.newId();
        const pos = tx.select({ m: max(s.sessionExercises.position) }).from(s.sessionExercises).where(eq(s.sessionExercises.sessionId, sessionId)).get()?.m;
        tx.insert(s.sessionExercises)
          .values({ id, sessionId, position: (pos ?? -1) + 1, exerciseKey: key, exerciseName: exercise.name, notes: '', restSeconds: null })
          .run();
        insertSet(tx, id, 0, exercise.loadMode);
        return id;
      });
    },

    removeExercise(sessionId, sessionExerciseId) {
      edit(sessionId, (tx) => {
        exerciseOf(tx, sessionId, sessionExerciseId);
        tx.delete(s.sessionExercises).where(eq(s.sessionExercises.id, sessionExerciseId)).run();
        const rest = tx.select({ id: s.sessionExercises.id }).from(s.sessionExercises).where(eq(s.sessionExercises.sessionId, sessionId)).orderBy(s.sessionExercises.position).all();
        renumber(tx, s.sessionExercises, rest.map((r) => r.id));
      });
    },

    moveExercise(sessionId, sessionExerciseId, toPosition) {
      edit(sessionId, (tx) => {
        exerciseOf(tx, sessionId, sessionExerciseId);
        const ids = tx.select({ id: s.sessionExercises.id }).from(s.sessionExercises).where(eq(s.sessionExercises.sessionId, sessionId)).orderBy(s.sessionExercises.position).all().map((r) => r.id).filter((id) => id !== sessionExerciseId);
        ids.splice(Math.max(0, Math.min(toPosition, ids.length)), 0, sessionExerciseId);
        renumber(tx, s.sessionExercises, ids);
      });
    },

    setExerciseNotes(sessionId, sessionExerciseId, notes) {
      if (notes.length > 2000) throw new ValidationError('Notes are too long');
      edit(sessionId, (tx) => {
        exerciseOf(tx, sessionId, sessionExerciseId);
        tx.update(s.sessionExercises).set({ notes }).where(eq(s.sessionExercises.id, sessionExerciseId)).run();
      });
    },

    addSet(sessionId, sessionExerciseId) {
      return edit(sessionId, (tx) => {
        exerciseOf(tx, sessionId, sessionExerciseId);
        const last = tx
          .select()
          .from(s.performedSets)
          .where(eq(s.performedSets.sessionExerciseId, sessionExerciseId))
          .orderBy(desc(s.performedSets.position))
          .get();
        const loadMode = last?.loadMode ?? catalog.get(exerciseOf(tx, sessionId, sessionExerciseId).exerciseKey)?.loadMode ?? 'external';
        return insertSet(tx, sessionExerciseId, (last?.position ?? -1) + 1, loadMode, last?.targetReps ?? null, last?.targetLoadGrams ?? null);
      });
    },

    removeSet(sessionId, setId) {
      edit(sessionId, (tx) => {
        const { set } = setOf(tx, sessionId, setId);
        tx.delete(s.performedSets).where(eq(s.performedSets.id, setId)).run();
        const rest = tx.select({ id: s.performedSets.id }).from(s.performedSets).where(eq(s.performedSets.sessionExerciseId, set.sessionExerciseId)).orderBy(s.performedSets.position).all();
        renumber(tx, s.performedSets, rest.map((r) => r.id));
      });
    },

    updateSet(sessionId, setId, patch: SetPatch) {
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || k === 'loadMode') continue;
        parse(k.toLowerCase().includes('grams') ? grams : reps, v, k);
      }
      edit(sessionId, (tx) => {
        const { set } = setOf(tx, sessionId, setId);
        const next = { ...set, ...patch };
        // A completed set can never be left without reps (the completion rule).
        if (next.completed && !(next.reps && next.reps > 0)) throw new ValidationError('A completed set needs reps > 0');
        tx.update(s.performedSets).set(patch).where(eq(s.performedSets.id, setId)).run();
      });
    },

    setCompleted(sessionId, setId, completed, now) {
      edit(sessionId, (tx) => {
        const { set, restSeconds, status } = setOf(tx, sessionId, setId);
        if (completed && !(set.reps && set.reps > 0)) throw new ValidationError('Enter reps before completing the set');
        tx.update(s.performedSets)
          .set({ completed, completedAt: completed ? (set.completedAt ?? iso(now)) : null })
          .where(eq(s.performedSets.id, setId))
          .run();
        if (completed && restSeconds && status === 'active') startTimer(tx, sessionId, restSeconds, now);
      });
    },

    setNotes(sessionId, notes) {
      if (notes.length > 2000) throw new ValidationError('Notes are too long');
      edit(sessionId, (tx) => tx.update(s.sessions).set({ notes }).where(eq(s.sessions.id, sessionId)).run());
    },

    finish(sessionId, now) {
      const at = now ?? ctx.now();
      return edit(sessionId, (tx) => {
        const doc = readSession(tx, sessionId)!;
        if (doc.status !== 'active') throw new ValidationError('Session is already finished');
        if (!doc.exercises.some((e) => e.sets.some((x) => x.completed))) throw new EmptySessionError();
        const timezone = deviceTimeZone();
        const done = { status: 'completed' as const, completedAt: at.toISOString(), timezone, localDate: localDateIn(at, timezone) };
        tx.update(s.sessions).set(done).where(eq(s.sessions.id, sessionId)).run();
        clearTimerFor(tx, sessionId);
        return { ...doc, ...done };
      });
    },

    saveCompleted(input) {
      const doc = parse(sessionDoc, input, 'session');
      if (doc.status !== 'completed' || !doc.completedAt || !doc.localDate) throw new ValidationError('Only completed sessions can be saved this way');
      if (doc.exercises.some((e) => e.sets.some((x) => x.completed && !(x.reps && x.reps > 0)))) {
        throw new ValidationError('A completed set needs reps > 0');
      }
      ctx.mutate((tx) => {
        const r = tx.select({ status: s.sessions.status, deleted: s.sessions.deleted }).from(s.sessions).where(eq(s.sessions.id, doc.id)).get();
        if (!r || r.deleted) throw new NotFoundError('Session');
        if (r.status !== 'completed') throw new ValidationError('Finish the workout before editing it as history');
        writeDoc(tx, 'session', doc, iso());
        enqueue(ctx, tx, 'session', doc.id, 'upsert');
      });
    },

    delete(id) {
      ctx.mutate((tx) => {
        if (!markDeleted(tx, 'session', id, iso())) throw new NotFoundError('Session');
        clearTimerFor(tx, id);
        enqueue(ctx, tx, 'session', id, 'delete');
      });
    },

    previousResults(key, excludeSessionId) {
      const last = db
        .select({ sessionId: s.sessions.id, completedAt: s.sessions.completedAt, sessionExerciseId: s.sessionExercises.id })
        .from(s.sessionExercises)
        .innerJoin(s.sessions, eq(s.sessionExercises.sessionId, s.sessions.id))
        .where(
          and(
            eq(s.sessionExercises.exerciseKey, key),
            eq(s.sessions.status, 'completed'),
            eq(s.sessions.deleted, false),
            excludeSessionId ? sql`${s.sessions.id} <> ${excludeSessionId}` : undefined,
          ),
        )
        .orderBy(desc(s.sessions.completedAt), desc(s.sessions.id), s.sessionExercises.position)
        .get();
      if (!last) return null;
      const sets = db
        .select({ reps: s.performedSets.reps, loadGrams: s.performedSets.loadGrams, loadMode: s.performedSets.loadMode })
        .from(s.performedSets)
        .where(and(eq(s.performedSets.sessionExerciseId, last.sessionExerciseId), eq(s.performedSets.completed, true)))
        .orderBy(s.performedSets.position)
        .all();
      return { sessionId: last.sessionId, completedAt: last.completedAt!, sets };
    },

    restTimer() {
      const r = db.select().from(s.restTimer).where(eq(s.restTimer.id, 1)).get();
      return r ? { sessionId: r.sessionId, endsAt: r.endsAt, durationSeconds: r.durationSeconds } : null;
    },

    startRestTimer(sessionId, seconds, now) {
      parse(restSeconds, seconds, 'rest seconds');
      // Local UI state only: persisted so the deadline survives force-close, not synced.
      ctx.mutate((tx) => startTimer(tx, sessionId, seconds, now));
    },

    clearRestTimer() {
      ctx.mutate((tx) => tx.delete(s.restTimer).run());
    },
  };

  function insertSet(tx: Db, sessionExerciseId: string, position: number, loadMode: LoadMode, targetReps: number | null = null, targetLoadGrams: number | null = null) {
    const id = ctx.newId();
    tx.insert(s.performedSets)
      .values({ id, sessionExerciseId, position, targetReps, targetLoadGrams, reps: null, loadGrams: null, loadMode, completed: false, completedAt: null })
      .run();
    return id;
  }
}
