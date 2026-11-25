/**
 * Frozen repository interface between the local data layer (owner: data agent, app/src/db/**) and
 * feature UI. Every mutating method runs ONE synchronous SQLite transaction that writes the domain rows
 * AND inserts an outbox row (NFR-02); it returns only after commit. UI never writes SQLite directly.
 * Reads are synchronous snapshots; screens re-read after mutations or via `subscribe`.
 */
import type {
  BodyWeightDoc,
  CoachApprovalDoc,
  CustomExerciseDoc,
  ExerciseKey,
  LoadMode,
  OutboxStatus,
  ProgramDoc,
  RewardSummary,
  RoutineDoc,
  SessionDoc,
} from './contracts';

export type ExerciseSummary = {
  key: ExerciseKey;
  name: string;
  primaryMuscles: string[];
  equipment: string[];
  loadMode: LoadMode;
  custom: boolean;
  archived: boolean;
};

export type ExerciseDetail = ExerciseSummary & {
  secondaryMuscles: string[];
  instructions: string[];
  /** Always null until O-01 media rights are resolved; UI shows a placeholder. */
  mediaUri: string | null;
  attribution: string | null;
};

export type CatalogFilter = { query?: string; muscle?: string; equipment?: string; includeArchived?: boolean };

export type SyncMeta = { serverRevision: number | null; pendingOps: number; conflict: boolean };

export type PreviousResult = { sessionId: string; completedAt: string; sets: { reps: number | null; loadGrams: number | null; loadMode: LoadMode }[] };

export type RestTimer = { sessionId: string; endsAt: string; durationSeconds: number } | null;

export type SetPatch = Partial<{ reps: number | null; loadGrams: number | null; loadMode: LoadMode; targetReps: number | null; targetLoadGrams: number | null }>;

export interface CatalogRepository {
  search(filter: CatalogFilter, limit?: number): ExerciseSummary[];
  get(key: ExerciseKey): ExerciseDetail | null;
  muscles(): string[];
  equipment(): string[];
  saveCustom(doc: Omit<CustomExerciseDoc, 'id'> & { id?: string }): CustomExerciseDoc;
  setCustomArchived(id: string, archived: boolean): void;
}

export interface RoutineRepository {
  list(opts?: { includeArchived?: boolean }): (RoutineDoc & SyncMeta)[];
  get(id: string): (RoutineDoc & SyncMeta) | null;
  /** Whole-document save (create or replace children). Validates with routineDoc. */
  save(doc: RoutineDoc): RoutineDoc;
  setArchived(id: string, archived: boolean): void;
  delete(id: string): void;
  createFromSession(sessionId: string, name: string): RoutineDoc;
}

export interface ProgramRepository {
  list(): (ProgramDoc & SyncMeta)[];
  active(): (ProgramDoc & SyncMeta) | null;
  save(doc: ProgramDoc): ProgramDoc;
  /** Deactivates any other active program in the same transaction. */
  activate(id: string): void;
  delete(id: string): void;
  /** Queues a coach approval op and writes program + routines locally (pending until acked). */
  applyCoachApproval(doc: CoachApprovalDoc): void;
}

export interface SessionRepository {
  active(): SessionDoc | null;
  get(id: string): (SessionDoc & SyncMeta) | null;
  history(opts?: { limit?: number; before?: string }): (SessionDoc & SyncMeta)[];
  /** Throws ActiveSessionExistsError when another session is active (SESSION-01). */
  startEmpty(name?: string): SessionDoc;
  startFromRoutine(routineId: string): SessionDoc;
  discard(id: string): void;
  addExercise(sessionId: string, key: ExerciseKey): string;
  removeExercise(sessionId: string, sessionExerciseId: string): void;
  moveExercise(sessionId: string, sessionExerciseId: string, toPosition: number): void;
  setExerciseNotes(sessionId: string, sessionExerciseId: string, notes: string): void;
  addSet(sessionId: string, sessionExerciseId: string): string;
  removeSet(sessionId: string, setId: string): void;
  updateSet(sessionId: string, setId: string, patch: SetPatch): void;
  /** Completing requires reps > 0; may start the rest timer in the same transaction. */
  setCompleted(sessionId: string, setId: string, completed: boolean, now?: Date): void;
  setNotes(sessionId: string, notes: string): void;
  /** Captures completedAt, timezone and localDate. Empty sessions (no completed set) must be discarded instead. */
  finish(sessionId: string, now?: Date): SessionDoc;
  /** Edit a completed session (full document replace, validated). */
  saveCompleted(doc: SessionDoc): void;
  delete(id: string): void;
  previousResults(key: ExerciseKey, excludeSessionId?: string): PreviousResult | null;
  restTimer(): RestTimer;
  startRestTimer(sessionId: string, seconds: number, now?: Date): void;
  clearRestTimer(): void;
}

export interface BodyWeightRepository {
  list(): (BodyWeightDoc & SyncMeta)[];
  save(doc: Omit<BodyWeightDoc, 'id'> & { id?: string }): BodyWeightDoc;
  delete(id: string): void;
}

export type OutboxSummary = { pending: number; inflight: number; failed: number; conflicts: number; lastSyncAt: string | null; lastError: string | null };

export interface OutboxRepository {
  summary(): OutboxSummary;
  /** True when any op is not yet acknowledged (sign-out warning, NFR-08). */
  hasUnsynced(): boolean;
}

export type Repositories = {
  catalog: CatalogRepository;
  routines: RoutineRepository;
  programs: ProgramRepository;
  sessions: SessionRepository;
  bodyWeight: BodyWeightRepository;
  outbox: OutboxRepository;
  /** Last server reward summary (written by the sync worker after push/pull; display only). */
  rewardCache: { get(): RewardSummary | null; set(summary: RewardSummary): void };
  /** Notifies after any committed local write or applied pull page. Returns unsubscribe. */
  subscribe(listener: () => void): () => void;
};

export type { OutboxStatus };
