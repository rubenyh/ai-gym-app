import type { LoadMode, SessionDoc } from '@/domain/contracts';
import { parseWeight } from '@/domain/units';

import { goalForWeek, weeklyConsistency } from './consistency';
import { localDateIn, weekStart } from './dates';
import { completedHistory } from './history';
import { computeRecords, detectNewPrs } from './records';
import { exerciseTrend } from './trends';
import { sessionVolume, totalVolume } from './volume';

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

type S = { reps: number | null; load?: number | null; mode?: LoadMode; done?: boolean };
function session(completedAt: string, localDate: string, exercises: Record<string, S[]>, timezone = 'UTC'): SessionDoc {
  return {
    id: id(),
    routineId: null,
    name: 'Workout',
    status: 'completed',
    startedAt: completedAt,
    completedAt,
    timezone,
    localDate,
    notes: '',
    exercises: Object.entries(exercises).map(([key, sets], i) => ({
      id: id(),
      position: i,
      exerciseKey: key,
      exerciseName: key.replace('catalog:', 'Ex '),
      notes: '',
      restSeconds: null,
      sets: sets.map((s, j) => ({
        id: id(),
        position: j,
        targetReps: null,
        targetLoadGrams: null,
        reps: s.reps,
        loadGrams: s.load ?? null,
        loadMode: s.mode ?? 'external',
        completed: s.done ?? true,
        completedAt: s.done === false ? null : completedAt,
      })),
    })),
  };
}

const BENCH = 'catalog:0025';

describe('dates', () => {
  it('weeks run Monday to Sunday', () => {
    expect(weekStart('2026-11-23')).toBe('2026-11-23'); // Monday
    expect(weekStart('2026-11-29')).toBe('2026-11-23'); // Sunday
    expect(weekStart('2026-11-30')).toBe('2026-11-30');
    expect(weekStart('2027-01-01')).toBe('2026-12-28');
  });
  it('derives a local date in a zone', () => {
    expect(localDateIn('2026-11-29T23:30:00Z', 'Europe/Madrid')).toBe('2026-11-30');
    expect(localDateIn('2026-11-30T03:00:00Z', 'America/Los_Angeles')).toBe('2026-11-29');
  });
});

describe('history', () => {
  it('orders completed sessions by completedAt, newest first, ignoring active ones', () => {
    const a = session('2026-11-20T10:00:00Z', '2026-11-20', {});
    const b = session('2026-11-22T10:00:00Z', '2026-11-22', {});
    const active = { ...session('2026-11-25T10:00:00Z', '2026-11-25', {}), status: 'active' as const, completedAt: null };
    expect(completedHistory([a, active, b]).map((s) => s.id)).toEqual([b.id, a.id]);
  });
});

describe('records and PRs', () => {
  it('weight PR is highest completed external load; incomplete sets ignored', () => {
    const s1 = session('2026-11-02T10:00:00Z', '2026-11-02', { [BENCH]: [{ reps: 5, load: 60000 }, { reps: 5, load: 90000, done: false }] });
    const [rec] = computeRecords([s1]);
    expect(rec.weightPr?.loadGrams).toBe(60000);
  });

  it('first performance is not a PR; higher load is; ties are not', () => {
    const s1 = session('2026-11-02T10:00:00Z', '2026-11-02', { [BENCH]: [{ reps: 5, load: 60000 }] });
    const s2 = session('2026-11-04T10:00:00Z', '2026-11-04', { [BENCH]: [{ reps: 5, load: 60000 }] });
    const s3 = session('2026-11-06T10:00:00Z', '2026-11-06', { [BENCH]: [{ reps: 3, load: 62500 }] });
    const all = [s1, s2, s3];
    expect(detectNewPrs(all, s1.id)).toEqual([]);
    expect(detectNewPrs(all, s2.id)).toEqual([]);
    expect(detectNewPrs(all, s3.id)).toEqual([expect.objectContaining({ kind: 'weight', loadGrams: 62500, reps: 3 })]);
  });

  it('rep PR at the same canonical load within tolerance', () => {
    const s1 = session('2026-11-02T10:00:00Z', '2026-11-02', { [BENCH]: [{ reps: 5, load: 60000 }] });
    const s2 = session('2026-11-04T10:00:00Z', '2026-11-04', { [BENCH]: [{ reps: 7, load: 60020 }] });
    expect(detectNewPrs([s1, s2], s2.id)).toEqual([expect.objectContaining({ kind: 'reps', reps: 7 })]);
  });

  it('unit switching cannot create a PR (inputs are canonical grams)', () => {
    const kg = parseWeight('100', 'kg')!;
    const lb = parseWeight('220.5', 'lb')!; // displays as ~100 kg
    const s1 = session('2026-11-02T10:00:00Z', '2026-11-02', { [BENCH]: [{ reps: 5, load: kg }] });
    const s2 = session('2026-11-04T10:00:00Z', '2026-11-04', { [BENCH]: [{ reps: 5, load: lb }] });
    expect(lb).toBeGreaterThan(kg); // 17 g heavier after conversion rounding
    expect(detectNewPrs([s1, s2], s2.id)).toEqual([]);
    const same = session('2026-11-06T10:00:00Z', '2026-11-06', { [BENCH]: [{ reps: 5, load: parseWeight('100.0', 'kg')! }] });
    expect(detectNewPrs([s1, s2, same], same.id)).toEqual([]);
  });

  it('dumbbell load is the logged value, never doubled', () => {
    const s = session('2026-11-02T10:00:00Z', '2026-11-02', { 'catalog:db': [{ reps: 10, load: 20000 }] });
    expect(computeRecords([s])[0].weightPr?.loadGrams).toBe(20000);
    expect(sessionVolume(s)).toBe(200000);
  });

  it('assisted sets are excluded from records and volume; bodyweight has rep records only', () => {
    const s = session('2026-11-02T10:00:00Z', '2026-11-02', {
      'catalog:pullup': [{ reps: 8, load: 30000, mode: 'assisted' }],
      'catalog:pushup': [{ reps: 20, mode: 'bodyweight' }],
    });
    const recs = computeRecords([s]);
    expect(recs.map((r) => r.exerciseKey)).toEqual(['catalog:pushup']);
    expect(recs[0].weightPr).toBeNull();
    expect(recs[0].repPrs[0].reps).toBe(20);
    expect(sessionVolume(s)).toBe(0);
  });

  it('deleting a session lowers records', () => {
    const s1 = session('2026-11-02T10:00:00Z', '2026-11-02', { [BENCH]: [{ reps: 5, load: 60000 }] });
    const s2 = session('2026-11-04T10:00:00Z', '2026-11-04', { [BENCH]: [{ reps: 5, load: 80000 }] });
    expect(computeRecords([s1, s2])[0].weightPr?.loadGrams).toBe(80000);
    expect(computeRecords([s1])[0].weightPr?.loadGrams).toBe(60000);
  });
});

describe('trends', () => {
  it('reports insufficient data under two points and orders oldest first', () => {
    const s1 = session('2026-11-02T10:00:00Z', '2026-11-02', { [BENCH]: [{ reps: 5, load: 60000 }, { reps: 8, load: 50000 }] });
    expect(exerciseTrend([s1], BENCH).insufficientData).toBe(true);
    const s2 = session('2026-11-04T10:00:00Z', '2026-11-04', { [BENCH]: [{ reps: 5, load: 62500 }] });
    const t = exerciseTrend([s2, s1], BENCH);
    expect(t.insufficientData).toBe(false);
    expect(t.points.map((p) => p.topLoadGrams)).toEqual([60000, 62500]);
    expect(t.points[0].sets).toHaveLength(2);
    expect(t.points[0].totalReps).toBe(13);
  });
});

describe('volume', () => {
  it('sums grams x reps of completed external sets', () => {
    const s = session('2026-11-02T10:00:00Z', '2026-11-02', { [BENCH]: [{ reps: 5, load: 60000 }, { reps: 5, load: 60000, done: false }] });
    expect(totalVolume([s])).toBe(300000);
  });
});

describe('weekly consistency', () => {
  const goals = [
    { effectiveWeek: '2026-11-09', targetDays: 2, timezone: 'Europe/Madrid' },
    { effectiveWeek: '2026-11-23', targetDays: 3, timezone: 'America/New_York' },
  ];

  it('uses the frozen goal row per week and skips weeks before the first goal', () => {
    expect(goalForWeek(goals, '2026-11-02')).toBeNull();
    expect(goalForWeek(goals, '2026-11-16')?.targetDays).toBe(2);
    expect(goalForWeek(goals, '2026-11-23')?.targetDays).toBe(3);
    const weeks = weeklyConsistency([], goals, '2026-11-25');
    expect(weeks.map((w) => w.weekStart)).toEqual(['2026-11-23', '2026-11-16', '2026-11-09']);
  });

  it('counts distinct local dates; multiple sessions per day count once', () => {
    const a = session('2026-11-10T08:00:00Z', '2026-11-10', { [BENCH]: [{ reps: 5, load: 60000 }] });
    const b = session('2026-11-10T18:00:00Z', '2026-11-10', { [BENCH]: [{ reps: 5, load: 60000 }] });
    const c = session('2026-11-12T18:00:00Z', '2026-11-12', { [BENCH]: [{ reps: 5, load: 60000 }] });
    const empty = session('2026-11-13T18:00:00Z', '2026-11-13', { [BENCH]: [{ reps: 5, load: 60000, done: false }] });
    const week = weeklyConsistency([a, b, c, empty], goals, '2026-11-15').find((w) => w.weekStart === '2026-11-09')!;
    expect(week).toMatchObject({ days: 2, targetDays: 2, achieved: true });
  });

  it('week boundary uses the frozen local date across a timezone change, not the UTC date', () => {
    // Sunday 23:30 UTC is already Monday in Madrid: belongs to the next week.
    const madrid = session('2026-11-29T23:30:00Z', '2026-11-30', { [BENCH]: [{ reps: 5, load: 60000 }] }, 'Europe/Madrid');
    // Monday 03:00 UTC is still Sunday in New York: belongs to the earlier week.
    const ny = session('2026-11-30T03:00:00Z', '2026-11-29', { [BENCH]: [{ reps: 5, load: 60000 }] }, 'America/New_York');
    const weeks = weeklyConsistency([madrid, ny], goals, '2026-12-01');
    expect(weeks.find((w) => w.weekStart === '2026-11-30')?.days).toBe(1);
    expect(weeks.find((w) => w.weekStart === '2026-11-23')?.days).toBe(1);
  });

  it('deleting a session recomputes the week', () => {
    const a = session('2026-11-10T08:00:00Z', '2026-11-10', { [BENCH]: [{ reps: 5, load: 60000 }] });
    const c = session('2026-11-12T18:00:00Z', '2026-11-12', { [BENCH]: [{ reps: 5, load: 60000 }] });
    const week = (ss: SessionDoc[]) => weeklyConsistency(ss, goals, '2026-11-15').find((w) => w.weekStart === '2026-11-09')!;
    expect(week([a, c]).achieved).toBe(true);
    expect(week([a]).achieved).toBe(false);
  });
});
