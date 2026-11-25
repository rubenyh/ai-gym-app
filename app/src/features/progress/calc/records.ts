import type { ExerciseKey, LoadMode, SessionDoc } from '@/domain/contracts';
import { rules } from '@/features/gamification/rules';

import { completedHistory, isCountedSet } from './history';

export type RecordEntry = { loadGrams: number | null; reps: number; sessionId: string; completedAt: string };

/**
 * Records per exercise + load mode. Assisted sets are excluded entirely (more assistance is never
 * "stronger"). Bodyweight has rep records only (load null; body mass is never assumed as load).
 */
export type ExerciseRecords = {
  exerciseKey: ExerciseKey;
  exerciseName: string;
  loadMode: Exclude<LoadMode, 'assisted'>;
  weightPr: RecordEntry | null;
  /** Best reps per canonical load, buckets merged within `repPrToleranceGrams`. Sorted by load desc. */
  repPrs: RecordEntry[];
};

export type NewPr = { exerciseKey: ExerciseKey; exerciseName: string; kind: 'weight' | 'reps'; loadGrams: number | null; reps: number };

type FlatSet = { exerciseKey: ExerciseKey; exerciseName: string; loadMode: 'external' | 'bodyweight'; loadGrams: number | null; reps: number };

function recordKey(key: ExerciseKey, mode: string) {
  return `${key}|${mode}`;
}

function flatSets(s: SessionDoc): FlatSet[] {
  const out: FlatSet[] = [];
  for (const e of s.exercises) {
    for (const set of [...e.sets].sort((a, b) => a.position - b.position)) {
      if (!isCountedSet(set) || set.loadMode === 'assisted') continue;
      const loadGrams = set.loadMode === 'external' ? set.loadGrams : null;
      if (set.loadMode === 'external' && loadGrams === null) continue; // external without load is not comparable
      out.push({ exerciseKey: e.exerciseKey, exerciseName: e.exerciseName, loadMode: set.loadMode, loadGrams, reps: set.reps! });
    }
  }
  return out;
}

function sameLoad(a: number | null, b: number | null) {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= rules.repPrToleranceGrams;
}

/** Applies one set; returns which PR kinds it beat (strictly; ties never count, first-ever never counts). */
function applySet(map: Map<string, ExerciseRecords>, f: FlatSet, session: SessionDoc): ('weight' | 'reps')[] {
  const k = recordKey(f.exerciseKey, f.loadMode);
  const entry: RecordEntry = { loadGrams: f.loadGrams, reps: f.reps, sessionId: session.id, completedAt: session.completedAt! };
  let rec = map.get(k);
  if (!rec) {
    rec = { exerciseKey: f.exerciseKey, exerciseName: f.exerciseName, loadMode: f.loadMode, weightPr: null, repPrs: [] };
    map.set(k, rec);
  }
  rec.exerciseName = f.exerciseName;
  const beaten: ('weight' | 'reps')[] = [];
  const hadAny = rec.repPrs.length > 0;

  if (f.loadMode === 'external') {
    if (!rec.weightPr) rec.weightPr = entry;
    else if (f.loadGrams! > rec.weightPr.loadGrams! + rules.repPrToleranceGrams) {
      // Same tolerance as rep PRs: re-entering a load in another unit (rounding) is never a PR.
      rec.weightPr = entry;
      beaten.push('weight');
    }
  }
  const bucket = rec.repPrs.find((r) => sameLoad(r.loadGrams, f.loadGrams));
  if (!bucket) rec.repPrs.push(entry);
  else if (f.reps > bucket.reps) {
    Object.assign(bucket, entry, { loadGrams: bucket.loadGrams });
    beaten.push('reps');
  }
  return hadAny ? beaten : [];
}

function build(sessions: readonly SessionDoc[]) {
  const map = new Map<string, ExerciseRecords>();
  for (const s of completedHistory(sessions).reverse()) for (const f of flatSets(s)) applySet(map, f, s);
  return map;
}

/** All current records, recomputed from scratch (edits/deletes simply recompute). */
export function computeRecords(sessions: readonly SessionDoc[]): ExerciseRecords[] {
  return [...build(sessions).values()]
    .map((r) => ({ ...r, repPrs: [...r.repPrs].sort((a, b) => (b.loadGrams ?? 0) - (a.loadGrams ?? 0)) }))
    .sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));
}

/** New PRs set by `sessionId` compared with sessions completed before it. One per exercise/kind/load. */
export function detectNewPrs(sessions: readonly SessionDoc[], sessionId: string): NewPr[] {
  const target = sessions.find((s) => s.id === sessionId);
  if (!target || target.status !== 'completed' || !target.completedAt) return [];
  const at = Date.parse(target.completedAt);
  const map = build(sessions.filter((s) => s.id !== sessionId && s.completedAt && Date.parse(s.completedAt) <= at));
  const found = new Map<string, NewPr>();
  for (const f of flatSets(target)) {
    for (const kind of applySet(map, f, target)) {
      const bucketKey = kind === 'weight' ? '' : String(f.loadGrams);
      found.set(`${f.exerciseKey}|${f.loadMode}|${kind}|${bucketKey}`, {
        exerciseKey: f.exerciseKey,
        exerciseName: f.exerciseName,
        kind,
        loadGrams: f.loadGrams,
        reps: f.reps,
      });
    }
  }
  return [...found.values()];
}
