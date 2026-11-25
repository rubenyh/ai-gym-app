import {
  coachApprovalDoc,
  coachDraftContent,
  type CoachApprovalDoc,
  type CoachDraftContent,
  type CoachDraftResponse,
  type LoadMode,
  type ProgramDoc,
  type RoutineDoc,
} from '@/domain/contracts';
import type { SyncMeta } from '@/domain/repositories';

/** COACH-02: a draft becomes a program only through this explicit approval command. */

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const weekdayLabel = (w: number) => WEEKDAYS[w - 1] ?? `Day ${w}`;

/** User edits are validated again against the frozen draft contract before approval. */
export function validateEdited(content: CoachDraftContent): string | null {
  const r = coachDraftContent.safeParse(content);
  if (r.success) {
    const bad = content.days.flatMap((d) => d.exercises).find((e) => e.repsMin > e.repsMax);
    return bad ? `${bad.exerciseName}: minimum reps must not exceed maximum reps.` : null;
  }
  const issue = r.error.issues[0];
  if (issue.path.includes('exercises') && issue.code === 'too_small') return 'Every day needs at least one exercise.';
  return `Check ${issue.path.join(' › ')}: ${issue.message}`;
}

type Active = (ProgramDoc & SyncMeta) | null;

/** The local active program no longer matches what the draft was generated against (stale draft). */
export function isStale(draft: CoachDraftResponse, active: Active): boolean {
  return (active?.id ?? null) !== draft.baseProgramId || (active?.serverRevision ?? null) !== draft.baseProgramRevision;
}

export function buildApprovalDoc(
  approvalId: string,
  draft: CoachDraftResponse,
  content: CoachDraftContent,
  newId: () => string,
  loadModeOf: (exerciseKey: string) => LoadMode,
): CoachApprovalDoc {
  const routines: RoutineDoc[] = content.days.map((day) => ({
    id: newId(),
    name: day.routineName,
    notes: '',
    archived: false,
    origin: 'coach',
    exercises: day.exercises.map((e, position) => ({
      id: newId(),
      position,
      exerciseKey: e.exerciseKey,
      exerciseName: e.exerciseName,
      notes: e.repsMin === e.repsMax ? `${e.repsMax} reps` : `${e.repsMin}–${e.repsMax} reps`,
      restSeconds: e.restSeconds,
      // No invented loads: targets carry reps only; the user picks the weight (AI_COACH.md).
      sets: Array.from({ length: e.sets }, (_, i) => ({
        id: newId(),
        position: i,
        targetReps: e.repsMax,
        targetLoadGrams: null,
        loadMode: loadModeOf(e.exerciseKey),
      })),
    })),
  }));
  return coachApprovalDoc.parse({
    approvalId,
    draftId: draft.draftId,
    baseProgramId: draft.baseProgramId,
    baseProgramRevision: draft.baseProgramRevision,
    program: {
      id: newId(),
      name: content.title,
      active: true,
      origin: 'coach',
      coachDraftId: draft.draftId,
      days: content.days.map((d, i) => ({ weekday: d.weekday, routineId: routines[i].id })),
    },
    routines,
  });
}

/** Human-readable differences between the active program and the draft, per weekday. */
export function changeSummary(
  content: CoachDraftContent,
  active: Active,
  routineOf: (id: string) => RoutineDoc | null,
): string[] {
  if (!active) return ['No active program: approving creates your first program.'];
  const before = new Map(active.days.map((d) => [d.weekday, routineOf(d.routineId)?.exercises.map((e) => e.exerciseName) ?? []]));
  const after = new Map(content.days.map((d) => [d.weekday, d.exercises.map((e) => e.exerciseName)]));
  const lines: string[] = [`Replaces "${active.name}".`];
  for (let w = 1; w <= 7; w++) {
    const b = before.get(w);
    const a = after.get(w);
    if (!b && !a) continue;
    if (!b) lines.push(`${weekdayLabel(w)}: new training day.`);
    else if (!a) lines.push(`${weekdayLabel(w)}: becomes a rest day.`);
    else {
      const added = a.filter((n) => !b.includes(n));
      const removed = b.filter((n) => !a.includes(n));
      if (added.length || removed.length) {
        lines.push(
          `${weekdayLabel(w)}: ${[added.length ? `adds ${added.join(', ')}` : '', removed.length ? `removes ${removed.join(', ')}` : '']
            .filter(Boolean)
            .join('; ')}.`,
        );
      } else lines.push(`${weekdayLabel(w)}: same exercises.`);
    }
  }
  return lines;
}
