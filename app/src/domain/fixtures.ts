/** Representative contract fixtures shared by tests (app) and mirrored by SQL/pytest fixtures. */
import type { CoachApprovalDoc, ProgramDoc, RoutineDoc, SessionDoc } from './contracts';

export const ids = {
  userA: '11111111-1111-4111-8111-111111111111',
  userB: '22222222-2222-4222-8222-222222222222',
  routine: 'aaaaaaaa-0000-4000-8000-000000000001',
  routineEx: 'aaaaaaaa-0000-4000-8000-000000000002',
  plannedSet: 'aaaaaaaa-0000-4000-8000-000000000003',
  program: 'bbbbbbbb-0000-4000-8000-000000000001',
  session: 'cccccccc-0000-4000-8000-000000000001',
  sessionEx: 'cccccccc-0000-4000-8000-000000000002',
  set1: 'cccccccc-0000-4000-8000-000000000003',
  set2: 'cccccccc-0000-4000-8000-000000000004',
  draft: 'dddddddd-0000-4000-8000-000000000001',
  approval: 'dddddddd-0000-4000-8000-000000000002',
} as const;

export const routineFixture: RoutineDoc = {
  id: ids.routine,
  name: 'Push A',
  notes: '',
  archived: false,
  origin: 'manual',
  exercises: [
    {
      id: ids.routineEx,
      position: 0,
      exerciseKey: 'catalog:0025',
      exerciseName: 'Barbell Bench Press',
      notes: '',
      restSeconds: 120,
      sets: [{ id: ids.plannedSet, position: 0, targetReps: 8, targetLoadGrams: 60000, loadMode: 'external' }],
    },
  ],
};

export const programFixture: ProgramDoc = {
  id: ids.program,
  name: 'Three day split',
  active: true,
  origin: 'manual',
  coachDraftId: null,
  days: [{ weekday: 1, routineId: ids.routine }],
};

export const sessionFixture: SessionDoc = {
  id: ids.session,
  routineId: ids.routine,
  name: 'Push A',
  status: 'completed',
  startedAt: '2026-11-23T17:00:00.000Z',
  completedAt: '2026-11-23T18:00:00.000Z',
  timezone: 'Europe/Madrid',
  localDate: '2026-11-23',
  notes: 'private note — never published',
  exercises: [
    {
      id: ids.sessionEx,
      position: 0,
      exerciseKey: 'catalog:0025',
      exerciseName: 'Barbell Bench Press',
      notes: '',
      restSeconds: 120,
      sets: [
        { id: ids.set1, position: 0, targetReps: 8, targetLoadGrams: 60000, reps: 8, loadGrams: 60000, loadMode: 'external', completed: true, completedAt: '2026-11-23T17:10:00.000Z' },
        { id: ids.set2, position: 1, targetReps: 8, targetLoadGrams: 60000, reps: null, loadGrams: null, loadMode: 'external', completed: false, completedAt: null },
      ],
    },
  ],
};

export const coachApprovalFixture: CoachApprovalDoc = {
  approvalId: ids.approval,
  draftId: ids.draft,
  baseProgramId: null,
  baseProgramRevision: null,
  program: { ...programFixture, origin: 'coach', coachDraftId: ids.draft },
  routines: [{ ...routineFixture, origin: 'coach' }],
};
