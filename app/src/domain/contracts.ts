/**
 * Frozen shared contracts (M2–M6). Client, Supabase RPCs (SQL) and the coach service (Pydantic) all
 * implement these shapes. Change them only through the lead and record the change in docs/CONTRACTS.md.
 *
 * Conventions
 * - App-owned IDs are lowercase UUID v4 (expo-crypto randomUUID).
 * - Exercise references are `ExerciseKey` strings: `catalog:<sourceId>` (source ID kept as a string,
 *   leading zeros preserved) or `custom:<uuid>`.
 * - Weight is integer grams. Timestamps are ISO-8601 UTC strings. `localDate` is `YYYY-MM-DD`.
 * - Sync unit = aggregate document. Children have no independent sync identity.
 * - `revision` is assigned by the server only (integer >= 1). Local rows keep `serverRevision` (null = never synced).
 */
import { z } from 'zod';

export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const isoTimestamp = z.string().datetime({ offset: true });
export const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const exerciseKey = z.string().regex(/^(catalog:[A-Za-z0-9_-]{1,64}|custom:[0-9a-f-]{36})$/);
export type ExerciseKey = z.infer<typeof exerciseKey>;

/** Load modes (DATA_AND_SYNC.md): assistance is never ordinary lifted weight. */
export const loadMode = z.enum(['external', 'bodyweight', 'assisted']);
export type LoadMode = z.infer<typeof loadMode>;

export const grams = z.number().int().min(0).max(1_000_000);
export const reps = z.number().int().min(0).max(1000);
export const restSeconds = z.number().int().min(0).max(3600);

const name = z.string().trim().min(1).max(100);
const notes = z.string().max(2000);

// ---------------------------------------------------------------- catalog (local only, read-only)

export const catalogExercise = z.object({
  sourceId: z.string().min(1).max(64),
  name,
  bodyPart: z.string().nullable(),
  target: z.string().nullable(),
  primaryMuscles: z.array(z.string()),
  secondaryMuscles: z.array(z.string()),
  equipment: z.array(z.string()),
  instructions: z.array(z.string()),
  loadMode,
  /** Media reference is metadata only; restricted media is never bundled (O-01). */
  mediaRights: z.literal('unresolved'),
});
export type CatalogExercise = z.infer<typeof catalogExercise>;

// ---------------------------------------------------------------- synced aggregate documents

export const customExerciseDoc = z.object({
  id: uuid,
  name,
  primaryMuscles: z.array(z.string().max(50)).max(10),
  secondaryMuscles: z.array(z.string().max(50)).max(10),
  equipment: z.array(z.string().max(50)).max(10),
  instructions: z.array(z.string().max(500)).max(30),
  loadMode,
  archived: z.boolean(),
});
export type CustomExerciseDoc = z.infer<typeof customExerciseDoc>;

export const plannedSet = z.object({
  id: uuid,
  position: z.number().int().min(0),
  targetReps: reps.nullable(),
  targetLoadGrams: grams.nullable(),
  loadMode,
});

export const routineExercise = z.object({
  id: uuid,
  position: z.number().int().min(0),
  exerciseKey,
  /** Snapshot so archived/edited definitions stay readable. */
  exerciseName: name,
  notes,
  restSeconds: restSeconds.nullable(),
  sets: z.array(plannedSet).max(50),
});

export const routineDoc = z.object({
  id: uuid,
  name,
  notes,
  archived: z.boolean(),
  /** Set when created by copying a post (no XP) or a coach approval. */
  origin: z.enum(['manual', 'session', 'copy', 'coach']),
  exercises: z.array(routineExercise).max(50),
});
export type RoutineDoc = z.infer<typeof routineDoc>;

export const programDoc = z.object({
  id: uuid,
  name,
  /** At most one active program per account (server enforces). */
  active: z.boolean(),
  origin: z.enum(['manual', 'coach']),
  coachDraftId: uuid.nullable(),
  /** ISO weekday 1 = Monday … 7 = Sunday. One routine per weekday at most. */
  days: z.array(z.object({ weekday: z.number().int().min(1).max(7), routineId: uuid })).max(7),
});
export type ProgramDoc = z.infer<typeof programDoc>;

export const performedSet = z.object({
  id: uuid,
  position: z.number().int().min(0),
  targetReps: reps.nullable(),
  targetLoadGrams: grams.nullable(),
  reps: reps.nullable(),
  /** Logged load as entered (never doubled for per-hand movements). Null for bodyweight. */
  loadGrams: grams.nullable(),
  loadMode,
  completed: z.boolean(),
  completedAt: isoTimestamp.nullable(),
});
export type PerformedSet = z.infer<typeof performedSet>;

export const sessionExercise = z.object({
  id: uuid,
  position: z.number().int().min(0),
  exerciseKey,
  exerciseName: name,
  notes,
  restSeconds: restSeconds.nullable(),
  sets: z.array(performedSet).max(100),
});

export const sessionDoc = z.object({
  id: uuid,
  routineId: uuid.nullable(),
  name,
  status: z.enum(['active', 'completed']),
  startedAt: isoTimestamp,
  completedAt: isoTimestamp.nullable(),
  /** IANA zone and local date captured at completion; history weeks never move afterwards. */
  timezone: z.string().min(1).max(64),
  localDate: localDate.nullable(),
  notes,
  exercises: z.array(sessionExercise).max(50),
});
export type SessionDoc = z.infer<typeof sessionDoc>;

export const bodyWeightDoc = z.object({
  id: uuid,
  measuredAt: isoTimestamp,
  weightGrams: z.number().int().min(20_000).max(400_000),
});
export type BodyWeightDoc = z.infer<typeof bodyWeightDoc>;

/** Coach approval command: applies a whole program (plus its new routines) once. */
export const coachApprovalDoc = z.object({
  approvalId: uuid,
  draftId: uuid,
  /** Revision of the active program the draft was reviewed against; null = no active program. */
  baseProgramId: uuid.nullable(),
  baseProgramRevision: z.number().int().min(1).nullable(),
  program: programDoc,
  routines: z.array(routineDoc).min(1).max(7),
});
export type CoachApprovalDoc = z.infer<typeof coachApprovalDoc>;

export const aggregateType = z.enum(['custom_exercise', 'routine', 'program', 'session', 'body_weight', 'coach_approval']);
export type AggregateType = z.infer<typeof aggregateType>;

export type AggregateDocMap = {
  custom_exercise: CustomExerciseDoc;
  routine: RoutineDoc;
  program: ProgramDoc;
  session: SessionDoc;
  body_weight: BodyWeightDoc;
  coach_approval: CoachApprovalDoc;
};

export const docSchemas = {
  custom_exercise: customExerciseDoc,
  routine: routineDoc,
  program: programDoc,
  session: sessionDoc,
  body_weight: bodyWeightDoc,
  coach_approval: coachApprovalDoc,
} as const;

// ---------------------------------------------------------------- outbox and sync protocol

/** Local outbox row status. `superseded` rows were coalesced into a later op for the same aggregate. */
export const outboxStatus = z.enum(['pending', 'inflight', 'conflict', 'failed', 'superseded']);
export type OutboxStatus = z.infer<typeof outboxStatus>;

/** Request body of RPC `sync_push(p_op jsonb) returns jsonb`. One op per call, one transaction per op. */
export const pushOp = z.object({
  opId: uuid,
  aggregateType,
  aggregateId: uuid,
  action: z.enum(['upsert', 'delete']),
  /** Server revision the client last saw for this aggregate; null = create. */
  baseRevision: z.number().int().min(1).nullable(),
  /** Full aggregate document for upsert; null for delete. Frozen when the op becomes inflight. */
  doc: z.unknown().nullable(),
});
export type PushOp = z.infer<typeof pushOp>;

export const pushResult = z.discriminatedUnion('status', [
  /** Applied now, or `duplicate`: this opId already had a receipt — prior result returned unchanged. */
  z.object({ status: z.enum(['applied', 'duplicate']), opId: uuid, revision: z.number().int().min(1), deleted: z.boolean() }),
  /** Base revision is stale. Client keeps its draft and stores the server copy for resolution. */
  z.object({
    status: z.literal('conflict'),
    opId: uuid,
    serverRevision: z.number().int().min(1),
    serverDeleted: z.boolean(),
    serverDoc: z.unknown().nullable(),
  }),
  /** Validation/ownership failure; needs user action, never retried automatically. */
  z.object({ status: z.literal('rejected'), opId: uuid, code: z.string(), message: z.string() }),
]);
export type PushResult = z.infer<typeof pushResult>;

/** Response of RPC `sync_pull(p_after bigint, p_limit int) returns jsonb`. Ordered by per-account `seq`. */
export const changePage = z.object({
  changes: z.array(
    z.object({
      seq: z.number().int().min(1),
      aggregateType: aggregateType.exclude(['coach_approval']),
      aggregateId: uuid,
      revision: z.number().int().min(1),
      deleted: z.boolean(),
      /** Null for tombstones. */
      doc: z.unknown().nullable(),
    }),
  ),
  nextCursor: z.number().int().min(0),
  hasMore: z.boolean(),
});
export type ChangePage = z.infer<typeof changePage>;

// ---------------------------------------------------------------- rewards (server authoritative)

/** Response of RPC `get_reward_summary() returns jsonb`. */
export const rewardSummary = z.object({
  ruleVersion: z.number().int(),
  totalXp: z.number().int().min(0),
  level: z.number().int().min(1),
  xpIntoLevel: z.number().int().min(0),
  xpForNextLevel: z.number().int().min(1),
  qualifyingSessions: z.number().int().min(0),
  badges: z.array(z.object({ badgeId: z.string(), unlockedAt: isoTimestamp })),
  petStages: z.array(z.object({ stage: z.number().int(), unlockedAt: isoTimestamp })),
  /** Session IDs that currently hold an active completion award (lets the client clear provisional flags). */
  awardedSessionIds: z.array(uuid),
});
export type RewardSummary = z.infer<typeof rewardSummary>;

// ---------------------------------------------------------------- coach

export const coachDraftContent = z.object({
  title: name,
  explanation: z.string().max(4000),
  assumptions: z.array(z.string().max(500)).max(20),
  days: z
    .array(
      z.object({
        weekday: z.number().int().min(1).max(7),
        routineName: name,
        exercises: z
          .array(
            z.object({
              exerciseKey: z.string().regex(/^catalog:[A-Za-z0-9_-]{1,64}$/),
              exerciseName: name,
              sets: z.number().int().min(1).max(10),
              repsMin: z.number().int().min(1).max(50),
              repsMax: z.number().int().min(1).max(50),
              restSeconds: restSeconds.nullable(),
            }),
          )
          .min(1)
          .max(12),
      }),
    )
    .min(1)
    .max(7),
});
export type CoachDraftContent = z.infer<typeof coachDraftContent>;

/** `POST /v1/coach/drafts` and `GET /v1/coach/drafts/{id}` response (services/coach-api). */
export const coachDraftResponse = z.object({
  draftId: uuid,
  requestId: uuid,
  status: z.enum(['pending', 'ready', 'needs_input', 'failed', 'approved', 'cancelled']),
  baseProgramId: uuid.nullable(),
  baseProgramRevision: z.number().int().nullable(),
  draft: coachDraftContent.nullable(),
  clarification: z.object({ field: z.string(), question: z.string() }).nullable(),
  error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).nullable(),
});
export type CoachDraftResponse = z.infer<typeof coachDraftResponse>;

export const coachDraftRequest = z.object({
  requestId: uuid,
  mode: z.enum(['create', 'adjust']),
  programId: uuid.nullable(),
  baseRevision: z.number().int().min(1).nullable(),
  preferencesText: z.string().trim().min(1).max(1000),
});
export type CoachDraftRequest = z.infer<typeof coachDraftRequest>;

// ---------------------------------------------------------------- community

/**
 * Public post snapshot. Built SERVER-SIDE by `publish_post` from the synced session — the client
 * never submits snapshot JSON. Only these fields exist; notes, timezone, body weight, routine IDs and
 * custom exercise IDs are excluded. Custom exercises appear by name only (exerciseKey null).
 */
export const postSnapshot = z.object({
  version: z.literal(1),
  title: name,
  completedOn: localDate,
  durationMinutes: z.number().int().min(0),
  exercises: z.array(
    z.object({
      exerciseKey: z.string().regex(/^catalog:[A-Za-z0-9_-]{1,64}$/).nullable(),
      exerciseName: name,
      loadMode,
      sets: z.array(z.object({ reps: reps.nullable(), loadGrams: grams.nullable() })),
    }),
  ),
});
export type PostSnapshot = z.infer<typeof postSnapshot>;

export const followStatus = z.enum(['none', 'pending', 'accepted', 'blocked']);
export type FollowStatus = z.infer<typeof followStatus>;
