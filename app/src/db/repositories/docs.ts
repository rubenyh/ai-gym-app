/**
 * Aggregate document <-> row mapping shared by repositories (local writes) and the sync worker (frozen
 * payloads, pulled server documents). Children are always replaced as a whole (D-23 document sync).
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type {
  AggregateDocMap,
  AggregateType,
  BodyWeightDoc,
  CustomExerciseDoc,
  ProgramDoc,
  RoutineDoc,
  SessionDoc,
} from '@/domain/contracts';

import * as s from '../schema';

/** Sync drizzle database or transaction: runs on expo-sqlite (app) and better-sqlite3 (tests). */
export type Db = BaseSQLiteDatabase<'sync', any, typeof s>;

export type SyncedType = Exclude<AggregateType, 'coach_approval'>;

export const roots = {
  custom_exercise: s.customExercises,
  routine: s.routines,
  program: s.programs,
  session: s.sessions,
  body_weight: s.bodyWeightEntries,
} as const;

export type RootMeta = { serverRevision: number | null; deleted: boolean };

export function readRootMeta(db: Db, type: SyncedType, id: string): RootMeta | null {
  const t = roots[type];
  return db.select({ serverRevision: t.serverRevision, deleted: t.deleted }).from(t).where(eq(t.id, id)).get() ?? null;
}

// ---------------------------------------------------------------- reads

export function readCustomExercise(db: Db, id: string): CustomExerciseDoc | null {
  const r = db.select().from(s.customExercises).where(eq(s.customExercises.id, id)).get();
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    primaryMuscles: r.primaryMuscles,
    secondaryMuscles: r.secondaryMuscles,
    equipment: r.equipment,
    instructions: r.instructions,
    loadMode: r.loadMode,
    archived: r.archived,
  };
}

export function readRoutine(db: Db, id: string): RoutineDoc | null {
  const r = db.select().from(s.routines).where(eq(s.routines.id, id)).get();
  if (!r) return null;
  const exercises = db
    .select()
    .from(s.routineExercises)
    .where(eq(s.routineExercises.routineId, id))
    .orderBy(asc(s.routineExercises.position))
    .all();
  const sets = exercises.length
    ? db
        .select()
        .from(s.plannedSets)
        .where(inArray(s.plannedSets.routineExerciseId, exercises.map((e) => e.id)))
        .orderBy(asc(s.plannedSets.position))
        .all()
    : [];
  return {
    id: r.id,
    name: r.name,
    notes: r.notes,
    archived: r.archived,
    origin: r.origin,
    exercises: exercises.map((e) => ({
      id: e.id,
      position: e.position,
      exerciseKey: e.exerciseKey,
      exerciseName: e.exerciseName,
      notes: e.notes,
      restSeconds: e.restSeconds,
      sets: sets
        .filter((p) => p.routineExerciseId === e.id)
        .map((p) => ({ id: p.id, position: p.position, targetReps: p.targetReps, targetLoadGrams: p.targetLoadGrams, loadMode: p.loadMode })),
    })),
  };
}

export function readProgram(db: Db, id: string): ProgramDoc | null {
  const r = db.select().from(s.programs).where(eq(s.programs.id, id)).get();
  if (!r) return null;
  const days = db.select().from(s.programDays).where(eq(s.programDays.programId, id)).orderBy(asc(s.programDays.weekday)).all();
  return {
    id: r.id,
    name: r.name,
    active: r.active,
    origin: r.origin,
    coachDraftId: r.coachDraftId,
    days: days.map((d) => ({ weekday: d.weekday, routineId: d.routineId })),
  };
}

export function readSession(db: Db, id: string): SessionDoc | null {
  const r = db.select().from(s.sessions).where(eq(s.sessions.id, id)).get();
  if (!r) return null;
  const exercises = db
    .select()
    .from(s.sessionExercises)
    .where(eq(s.sessionExercises.sessionId, id))
    .orderBy(asc(s.sessionExercises.position))
    .all();
  const sets = exercises.length
    ? db
        .select()
        .from(s.performedSets)
        .where(inArray(s.performedSets.sessionExerciseId, exercises.map((e) => e.id)))
        .orderBy(asc(s.performedSets.position))
        .all()
    : [];
  return {
    id: r.id,
    routineId: r.routineId,
    name: r.name,
    status: r.status,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    timezone: r.timezone,
    localDate: r.localDate,
    notes: r.notes,
    exercises: exercises.map((e) => ({
      id: e.id,
      position: e.position,
      exerciseKey: e.exerciseKey,
      exerciseName: e.exerciseName,
      notes: e.notes,
      restSeconds: e.restSeconds,
      sets: sets
        .filter((p) => p.sessionExerciseId === e.id)
        .map(({ sessionExerciseId: _parent, ...set }) => set),
    })),
  };
}

export function readBodyWeight(db: Db, id: string): BodyWeightDoc | null {
  const r = db.select().from(s.bodyWeightEntries).where(eq(s.bodyWeightEntries.id, id)).get();
  return r ? { id: r.id, measuredAt: r.measuredAt, weightGrams: r.weightGrams } : null;
}

export function readDoc<T extends SyncedType>(db: Db, type: T, id: string): AggregateDocMap[T] | null {
  const readers: { [K in SyncedType]: (db: Db, id: string) => AggregateDocMap[K] | null } = {
    custom_exercise: readCustomExercise,
    routine: readRoutine,
    program: readProgram,
    session: readSession,
    body_weight: readBodyWeight,
  };
  return readers[type](db, id) as AggregateDocMap[T] | null;
}

// ---------------------------------------------------------------- writes

/**
 * Replaces the aggregate (root + children). `serverRevision` undefined keeps the stored revision (local
 * edit); a number records the server copy being applied. Always clears `deleted`.
 */
export function writeDoc<T extends SyncedType>(
  db: Db,
  type: T,
  doc: AggregateDocMap[T],
  updatedAt: string,
  serverRevision?: number,
): void {
  const rev = serverRevision === undefined ? {} : { serverRevision };
  const meta = { deleted: false, updatedAt, ...rev };
  switch (type) {
    case 'custom_exercise': {
      const d = doc as CustomExerciseDoc;
      const values = { ...d, ...meta };
      db.insert(s.customExercises).values(values).onConflictDoUpdate({ target: s.customExercises.id, set: values }).run();
      return;
    }
    case 'routine': {
      const { exercises, ...root } = doc as RoutineDoc;
      const values = { ...root, ...meta };
      db.insert(s.routines).values(values).onConflictDoUpdate({ target: s.routines.id, set: values }).run();
      db.delete(s.routineExercises).where(eq(s.routineExercises.routineId, root.id)).run();
      for (const { sets, ...e } of exercises) {
        db.insert(s.routineExercises).values({ ...e, routineId: root.id }).run();
        for (const p of sets) db.insert(s.plannedSets).values({ ...p, routineExerciseId: e.id }).run();
      }
      return;
    }
    case 'program': {
      const { days, ...root } = doc as ProgramDoc;
      const values = { ...root, ...meta };
      db.insert(s.programs).values(values).onConflictDoUpdate({ target: s.programs.id, set: values }).run();
      db.delete(s.programDays).where(eq(s.programDays.programId, root.id)).run();
      for (const d of days) db.insert(s.programDays).values({ ...d, programId: root.id }).run();
      return;
    }
    case 'session': {
      const { exercises, ...root } = doc as SessionDoc;
      const values = { ...root, ...meta };
      db.insert(s.sessions).values(values).onConflictDoUpdate({ target: s.sessions.id, set: values }).run();
      db.delete(s.sessionExercises).where(eq(s.sessionExercises.sessionId, root.id)).run();
      for (const { sets, ...e } of exercises) {
        db.insert(s.sessionExercises).values({ ...e, sessionId: root.id }).run();
        for (const p of sets) db.insert(s.performedSets).values({ ...p, sessionExerciseId: e.id }).run();
      }
      return;
    }
    case 'body_weight': {
      const values = { ...(doc as BodyWeightDoc), ...meta };
      db.insert(s.bodyWeightEntries).values(values).onConflictDoUpdate({ target: s.bodyWeightEntries.id, set: values }).run();
      return;
    }
  }
}

/** Removes the aggregate row; children cascade. Used once a delete is acknowledged or a tombstone arrives. */
export function purgeDoc(db: Db, type: SyncedType, id: string): void {
  const t = roots[type];
  db.delete(t).where(eq(t.id, id)).run();
  if (type === 'session') db.delete(s.restTimer).where(eq(s.restTimer.sessionId, id)).run();
}

export function setServerRevision(db: Db, type: SyncedType, id: string, revision: number): void {
  const t = roots[type];
  db.update(t).set({ serverRevision: revision }).where(eq(t.id, id)).run();
}

export function markDeleted(db: Db, type: SyncedType, id: string, updatedAt: string): boolean {
  const t = roots[type];
  const r = db.update(t).set({ deleted: true, updatedAt }).where(and(eq(t.id, id), eq(t.deleted, false))).run();
  return changes(r) > 0;
}

/** Row count from a sync run result on either driver (better-sqlite3 / expo-sqlite). */
export function changes(result: unknown): number {
  return (result as { changes?: number }).changes ?? 0;
}
