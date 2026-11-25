/** @jest-environment node */
import { randomUUID } from 'node:crypto';

import { catalogExercise, type RoutineDoc } from '@/domain/contracts';

import { ActiveSessionExistsError, EmptySessionError, ValidationError } from './repositories';
import { count, openTestRepos } from './testing';

const routine = (): RoutineDoc => ({
  id: randomUUID(),
  name: 'Push A',
  notes: '',
  archived: false,
  origin: 'manual',
  exercises: [
    {
      id: randomUUID(),
      position: 0,
      exerciseKey: 'catalog:0025',
      exerciseName: 'Barbell Bench Press',
      notes: '',
      restSeconds: 90,
      sets: [
        { id: randomUUID(), position: 0, targetReps: 8, targetLoadGrams: 60000, loadMode: 'external' },
        { id: randomUUID(), position: 1, targetReps: 8, targetLoadGrams: 60000, loadMode: 'external' },
      ],
    },
  ],
});

describe('catalog (CAT-01/02)', () => {
  it('seeds once, searches with filters, keeps string ids', () => {
    const { repos } = openTestRepos();
    expect(repos.catalog.search({ query: 'bench' }).map((e) => e.key)).toEqual(['catalog:0025']);
    expect(repos.catalog.search({ muscle: 'lats' })[0].loadMode).toBe('bodyweight');
    expect(repos.catalog.search({ equipment: 'assisted' })[0].key).toBe('catalog:0017');
    expect(repos.catalog.muscles()).toEqual(['lats', 'pectorals']);
    expect(repos.catalog.get('catalog:0025')?.mediaUri).toBeNull();
  });

  it('archived custom exercise stays readable in routines and sessions', () => {
    const { repos } = openTestRepos();
    const custom = repos.catalog.saveCustom({ name: 'Landmine Press', primaryMuscles: ['shoulders'], secondaryMuscles: [], equipment: ['barbell'], instructions: [], loadMode: 'external', archived: false });
    const session = repos.sessions.startEmpty();
    repos.sessions.addExercise(session.id, `custom:${custom.id}`);
    repos.catalog.setCustomArchived(custom.id, true);
    expect(repos.catalog.search({ query: 'landmine' })).toHaveLength(0);
    expect(repos.catalog.search({ query: 'landmine', includeArchived: true })[0].archived).toBe(true);
    expect(repos.catalog.get(`custom:${custom.id}`)?.name).toBe('Landmine Press');
    expect(repos.sessions.active()?.exercises[0].exerciseName).toBe('Landmine Press');
  });
});

describe('bundled catalog asset (O-02)', () => {
  it('every entry matches the contract and carries no media', () => {
    const asset = require('../../assets/catalog/exercises.v1.json');
    expect(asset.exercises).toHaveLength(asset.count);
    expect(asset.count).toBe(1324);
    for (const e of asset.exercises) expect(catalogExercise.safeParse(e).success).toBe(true);
    expect(JSON.stringify(asset)).not.toMatch(/\.gif|\.jpe?g|\.png|images\/|videos\//i);
    const { repos } = openTestRepos(undefined, { catalog: asset });
    expect(repos.catalog.get('catalog:0001')?.name).toBe('3/4 Sit-Up');
  });
});

describe('atomic local writes (NFR-02)', () => {
  it('a failure after the domain write rolls back both the set and its outbox row', () => {
    let failOnCall = 0;
    let calls = 0;
    const { repos, sqlite } = openTestRepos(undefined, {
      newId: () => {
        if (++calls === failOnCall) throw new Error('crash before outbox insert');
        return randomUUID();
      },
    });
    const session = repos.sessions.startEmpty();
    const exId = repos.sessions.addExercise(session.id, 'catalog:0025');
    const before = { sets: count(sqlite, 'performed_sets'), ops: count(sqlite, 'outbox'), touched: repos.sessions.get(session.id) };
    // addSet: call 1 = set id (row inserted), call 2 = outbox op id -> throws inside the transaction.
    failOnCall = calls + 2;
    expect(() => repos.sessions.addSet(session.id, exId)).toThrow('crash before outbox insert');
    expect({ sets: count(sqlite, 'performed_sets'), ops: count(sqlite, 'outbox'), touched: repos.sessions.get(session.id) }).toEqual(before);
    // The database is still usable and the next write commits both parts.
    repos.sessions.addSet(session.id, exId);
    expect([count(sqlite, 'performed_sets'), count(sqlite, 'outbox')]).toEqual([before.sets + 1, before.ops + 1]);
  });
});

describe('sessions (SESSION-01..04)', () => {
  it('allows one active session at a time', () => {
    const { repos } = openTestRepos();
    const first = repos.sessions.startEmpty();
    expect(() => repos.sessions.startEmpty()).toThrow(ActiveSessionExistsError);
    try {
      repos.sessions.startEmpty();
    } catch (e) {
      expect((e as ActiveSessionExistsError).activeSessionId).toBe(first.id);
    }
  });

  it('snapshots the routine: later routine edits never change the session', () => {
    const { repos } = openTestRepos();
    const r = repos.routines.save(routine());
    const session = repos.sessions.startFromRoutine(r.id);
    repos.routines.save({ ...r, name: 'Renamed', exercises: [{ ...r.exercises[0], exerciseName: 'Changed', sets: [] }] });
    const after = repos.sessions.get(session.id)!;
    expect(after.name).toBe('Push A');
    expect(after.exercises[0].exerciseName).toBe('Barbell Bench Press');
    expect(after.exercises[0].sets).toHaveLength(2);
    expect(after.routineId).toBe(r.id);
  });

  it('completing requires reps > 0 and starts the persisted rest timer', () => {
    const { repos } = openTestRepos();
    const r = repos.routines.save(routine());
    const s = repos.sessions.startFromRoutine(r.id);
    const setId = s.exercises[0].sets[0].id;
    expect(() => repos.sessions.setCompleted(s.id, setId, true)).toThrow(ValidationError);
    repos.sessions.updateSet(s.id, setId, { reps: 8, loadGrams: 60000 });
    const now = new Date('2026-11-25T10:00:00.000Z');
    repos.sessions.setCompleted(s.id, setId, true, now);
    expect(repos.sessions.restTimer()).toEqual({ sessionId: s.id, endsAt: '2026-11-25T10:01:30.000Z', durationSeconds: 90 });
    expect(() => repos.sessions.updateSet(s.id, setId, { reps: 0 })).toThrow(ValidationError);
    expect(() => repos.sessions.updateSet(s.id, setId, { loadGrams: 1.5 })).toThrow(ValidationError);
  });

  it('finish captures completion, timezone and local date; empty sessions cannot finish', () => {
    const { repos } = openTestRepos();
    const s = repos.sessions.startEmpty('Legs');
    expect(() => repos.sessions.finish(s.id)).toThrow(EmptySessionError);
    const ex = repos.sessions.addExercise(s.id, 'catalog:0652');
    const setId = repos.sessions.active()!.exercises[0].sets[0].id;
    expect(repos.sessions.active()!.exercises[0].sets[0].loadMode).toBe('bodyweight');
    repos.sessions.updateSet(s.id, setId, { reps: 10 });
    repos.sessions.setCompleted(s.id, setId, true);
    void ex;
    const done = repos.sessions.finish(s.id, new Date('2026-11-25T23:30:00.000Z'));
    expect(done.status).toBe('completed');
    expect(done.completedAt).toBe('2026-11-25T23:30:00.000Z');
    expect(done.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(done.localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(repos.sessions.active()).toBeNull();
    expect(repos.sessions.history()[0].id).toBe(s.id);
    expect(repos.sessions.previousResults('catalog:0652')).toMatchObject({ sessionId: s.id, sets: [{ reps: 10, loadGrams: null, loadMode: 'bodyweight' }] });
    expect(repos.sessions.previousResults('catalog:0652', s.id)).toBeNull();
  });

  it('survives force-close: reopening the file restores the active session, sets and timer deadline', () => {
    const first = openTestRepos();
    const s = first.repos.sessions.startEmpty();
    first.repos.sessions.addExercise(s.id, 'catalog:0025');
    const setId = first.repos.sessions.active()!.exercises[0].sets[0].id;
    first.repos.sessions.updateSet(s.id, setId, { reps: 5, loadGrams: 100000 });
    first.repos.sessions.setCompleted(s.id, setId, true);
    first.repos.sessions.startRestTimer(s.id, 120, new Date('2026-11-25T10:00:00.000Z'));
    // Simulated force-close: drop the connection without any shutdown logic.
    first.sqlite.close();

    const again = openTestRepos(first.path);
    const active = again.repos.sessions.active()!;
    expect(active.id).toBe(s.id);
    expect(active.exercises[0].sets[0]).toMatchObject({ reps: 5, loadGrams: 100000, completed: true });
    expect(again.repos.sessions.restTimer()?.endsAt).toBe('2026-11-25T10:02:00.000Z');
    expect(again.repos.outbox.hasUnsynced()).toBe(true);
  });

  it('every mutation queues an outbox op for its aggregate', () => {
    const { repos, sqlite } = openTestRepos();
    const r = repos.routines.save(routine());
    repos.routines.setArchived(r.id, true);
    expect(repos.routines.list()).toHaveLength(0);
    expect(repos.routines.list({ includeArchived: true })[0]).toMatchObject({ archived: true, pendingOps: 2, serverRevision: null });
    repos.bodyWeight.save({ measuredAt: '2026-11-25T08:00:00.000Z', weightGrams: 80000 });
    expect(count(sqlite, 'outbox', "aggregate_type = 'body_weight'")).toBe(1);
    const copy = repos.routines.createFromSession(repos.sessions.startFromRoutine(r.id).id, 'From session');
    expect(copy.origin).toBe('session');
  });
});
