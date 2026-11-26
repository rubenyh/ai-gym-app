import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Local account database (one SQLite file per signed-in account, docs/planning/DECISIONS.md D-10).
 * M1 caches the account's identity, settings and weekly-goal history so a previously
 * authenticated user can open the app offline (AUTH-02). Server rows are authoritative.
 * M2/M3 add training data, the outbox and sync bookkeeping below.
 */

export const accountProfile = sqliteTable('account_profile', {
  id: text('id').primaryKey(),
  handle: text('handle').notNull(),
  displayName: text('display_name').notNull(),
  visibility: text('visibility', { enum: ['public', 'private'] }).notNull(),
  avatarPath: text('avatar_path'),
  updatedAt: text('updated_at').notNull(),
  /** Root of the `account_settings` sync aggregate (profile + user_settings + weekly_goals); never deleted. */
  serverRevision: integer('server_revision'),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
});

/** Single row (id = 1). */
export const userSettings = sqliteTable('user_settings', {
  id: integer('id').primaryKey(),
  weightUnit: text('weight_unit', { enum: ['kg', 'lb'] }).notNull(),
  lengthUnit: text('length_unit', { enum: ['cm', 'ft_in'] }).notNull(),
  timezone: text('timezone').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const weeklyGoals = sqliteTable('weekly_goals', {
  /** ISO date (Monday) the target applies from. */
  effectiveWeek: text('effective_week').primaryKey(),
  targetDays: integer('target_days').notNull(),
  timezone: text('timezone').notNull(),
});

// ---------------------------------------------------------------- M2 training data (CAT-01/02, PLAN-01, SESSION-01..04)
// Aggregate roots carry `server_revision` (null = never acknowledged) and `deleted` (soft delete until the
// delete op is acknowledged). Children have no sync identity and cascade with their root.
// JSON list columns hold string arrays.

const syncColumns = () => ({
  serverRevision: integer('server_revision'),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
  updatedAt: text('updated_at').notNull(),
});
const loadModeCol = () => text('load_mode', { enum: ['external', 'bodyweight', 'assisted'] }).notNull();
const jsonList = (name: string) => text(name, { mode: 'json' }).$type<string[]>().notNull();

/** Read-only catalog seeded from assets/catalog/exercises.v1.json. */
export const catalogExercises = sqliteTable(
  'catalog_exercises',
  {
    sourceId: text('source_id').primaryKey(),
    name: text('name').notNull(),
    bodyPart: text('body_part'),
    target: text('target'),
    primaryMuscles: jsonList('primary_muscles'),
    secondaryMuscles: jsonList('secondary_muscles'),
    equipment: jsonList('equipment'),
    instructions: jsonList('instructions'),
    loadMode: loadModeCol(),
  },
  (t) => [index('catalog_exercises_name_idx').on(t.name)],
);

/** Single row (id = 1): which catalog version is seeded. */
export const catalogMeta = sqliteTable('catalog_meta', {
  id: integer('id').primaryKey(),
  version: integer('version').notNull(),
  count: integer('count').notNull(),
});

export const customExercises = sqliteTable('custom_exercises', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  primaryMuscles: jsonList('primary_muscles'),
  secondaryMuscles: jsonList('secondary_muscles'),
  equipment: jsonList('equipment'),
  instructions: jsonList('instructions'),
  loadMode: loadModeCol(),
  archived: integer('archived', { mode: 'boolean' }).notNull(),
  ...syncColumns(),
});

export const routines = sqliteTable('routines', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  notes: text('notes').notNull(),
  archived: integer('archived', { mode: 'boolean' }).notNull(),
  origin: text('origin', { enum: ['manual', 'session', 'copy', 'coach'] }).notNull(),
  ...syncColumns(),
});

export const routineExercises = sqliteTable(
  'routine_exercises',
  {
    id: text('id').primaryKey(),
    routineId: text('routine_id')
      .notNull()
      .references(() => routines.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    exerciseKey: text('exercise_key').notNull(),
    exerciseName: text('exercise_name').notNull(),
    notes: text('notes').notNull(),
    restSeconds: integer('rest_seconds'),
  },
  (t) => [index('routine_exercises_routine_idx').on(t.routineId)],
);

export const plannedSets = sqliteTable(
  'planned_sets',
  {
    id: text('id').primaryKey(),
    routineExerciseId: text('routine_exercise_id')
      .notNull()
      .references(() => routineExercises.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    targetReps: integer('target_reps'),
    targetLoadGrams: integer('target_load_grams'),
    loadMode: loadModeCol(),
  },
  (t) => [index('planned_sets_exercise_idx').on(t.routineExerciseId)],
);

export const programs = sqliteTable('programs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull(),
  origin: text('origin', { enum: ['manual', 'coach'] }).notNull(),
  coachDraftId: text('coach_draft_id'),
  ...syncColumns(),
});

export const programDays = sqliteTable(
  'program_days',
  {
    programId: text('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'cascade' }),
    weekday: integer('weekday').notNull(),
    /** Plain reference (no FK): routines sync independently and may arrive later. */
    routineId: text('routine_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.programId, t.weekday] })],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    /** Source routine at start time; the session keeps its own snapshot (no FK). */
    routineId: text('routine_id'),
    name: text('name').notNull(),
    status: text('status', { enum: ['active', 'completed'] }).notNull(),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at'),
    timezone: text('timezone').notNull(),
    localDate: text('local_date'),
    notes: text('notes').notNull(),
    ...syncColumns(),
  },
  (t) => [
    // SESSION-01: at most one active workout, enforced by the database too.
    uniqueIndex('sessions_one_active_idx').on(t.status).where(sql`status = 'active' AND deleted = 0`),
    // History pages: total order (completed_at DESC, id DESC) with a composite cursor.
    index('sessions_history_idx').on(t.completedAt, t.id),
  ],
);

export const sessionExercises = sqliteTable(
  'session_exercises',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    exerciseKey: text('exercise_key').notNull(),
    exerciseName: text('exercise_name').notNull(),
    notes: text('notes').notNull(),
    restSeconds: integer('rest_seconds'),
  },
  (t) => [index('session_exercises_session_idx').on(t.sessionId), index('session_exercises_key_idx').on(t.exerciseKey)],
);

export const performedSets = sqliteTable(
  'performed_sets',
  {
    id: text('id').primaryKey(),
    sessionExerciseId: text('session_exercise_id')
      .notNull()
      .references(() => sessionExercises.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    targetReps: integer('target_reps'),
    targetLoadGrams: integer('target_load_grams'),
    reps: integer('reps'),
    loadGrams: integer('load_grams'),
    loadMode: loadModeCol(),
    completed: integer('completed', { mode: 'boolean' }).notNull(),
    completedAt: text('completed_at'),
  },
  (t) => [index('performed_sets_exercise_idx').on(t.sessionExerciseId)],
);

export const bodyWeightEntries = sqliteTable('body_weight_entries', {
  id: text('id').primaryKey(),
  measuredAt: text('measured_at').notNull(),
  weightGrams: integer('weight_grams').notNull(),
  ...syncColumns(),
});

/** Single row (id = 1). A persisted deadline, not a running clock (SESSION-03). */
export const restTimer = sqliteTable('rest_timer', {
  id: integer('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  endsAt: text('ends_at').notNull(),
  durationSeconds: integer('duration_seconds').notNull(),
});

// ---------------------------------------------------------------- M3 sync (SYNC-01, NFR-02/03)

export const outbox = sqliteTable(
  'outbox',
  {
    /** Local commit order; the worker sends in this order. */
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    opId: text('op_id').notNull().unique(),
    aggregateType: text('aggregate_type', {
      enum: ['custom_exercise', 'routine', 'program', 'session', 'body_weight', 'coach_approval', 'account_settings'],
    }).notNull(),
    aggregateId: text('aggregate_id').notNull(),
    action: text('action', { enum: ['upsert', 'delete'] }).notNull(),
    status: text('status', { enum: ['pending', 'inflight', 'conflict', 'failed', 'superseded'] }).notNull(),
    baseRevision: integer('base_revision'),
    /** Frozen document once inflight (coach_approval: the command from creation). */
    payload: text('payload', { mode: 'json' }),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: text('next_attempt_at'),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('outbox_status_idx').on(t.status), index('outbox_aggregate_idx').on(t.aggregateType, t.aggregateId)],
);

/** Single row (id = 1). */
export const syncState = sqliteTable('sync_state', {
  id: integer('id').primaryKey(),
  cursor: integer('cursor').notNull().default(0),
  /** True once the initial pull reached hasMore = false on this device. */
  hydrated: integer('hydrated', { mode: 'boolean' }).notNull().default(false),
  lastSyncAt: text('last_sync_at'),
  lastError: text('last_error'),
});

export const syncConflicts = sqliteTable(
  'sync_conflicts',
  {
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    opId: text('op_id').notNull(),
    /** The local draft as sent (kept for "keep mine"). */
    localDoc: text('local_doc', { mode: 'json' }),
    serverDoc: text('server_doc', { mode: 'json' }),
    serverRevision: integer('server_revision').notNull(),
    serverDeleted: integer('server_deleted', { mode: 'boolean' }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.aggregateType, t.aggregateId] })],
);

/** Single row (id = 1): last server reward summary (display only, never sent back). */
export const rewardCache = sqliteTable('reward_cache', {
  id: integer('id').primaryKey(),
  summary: text('summary', { mode: 'json' }).notNull(),
  fetchedAt: text('fetched_at').notNull(),
});
