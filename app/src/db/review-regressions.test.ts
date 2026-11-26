/** @jest-environment node */
// Data-integrity regressions from the 2026-11-25 review: history pagination order, offline account
// settings week rules, canonical grams, atomic settings writes. Real SQLite (better-sqlite3).
import { randomUUID } from 'node:crypto';

import { ValidationError } from './repositories';
import { count, openTestRepos } from './testing';

const userId = randomUUID();
function seedAccount(sqlite: ReturnType<typeof openTestRepos>['sqlite'], tz = 'UTC') {
  sqlite.exec(`INSERT INTO account_profile (id, handle, display_name, visibility, avatar_path, updated_at, server_revision)
               VALUES ('${userId}', 'ana', 'Ana', 'public', NULL, '2026-11-01T00:00:00Z', 2);
               INSERT INTO user_settings VALUES (1, 'kg', 'cm', '${tz}', '2026-11-01T00:00:00Z');
               INSERT INTO weekly_goals VALUES ('2026-11-02', 3, '${tz}');`);
}

describe('session history pagination (deterministic total order)', () => {
  it('pages through equal completedAt timestamps without duplicates or omissions', () => {
    const { repos, sqlite } = openTestRepos();
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      const s = repos.sessions.startEmpty();
      const ex = repos.sessions.addExercise(s.id, 'catalog:0025');
      const set = repos.sessions.active()!.exercises.find((e) => e.id === ex)!.sets[0];
      repos.sessions.updateSet(s.id, set.id, { reps: 5 });
      repos.sessions.setCompleted(s.id, set.id, true);
      // 5 sessions share one instant, straddling the page boundary.
      repos.sessions.finish(s.id, new Date(i < 5 ? '2026-11-20T10:00:00.000Z' : `2026-11-2${i - 4}T10:00:00.000Z`));
      ids.push(s.id);
    }
    const seen: string[] = [];
    let before: { completedAt: string; id: string } | undefined;
    for (;;) {
      const page = repos.sessions.history({ limit: 3, before });
      seen.push(...page.map((p) => p.id));
      if (page.length < 3) break;
      before = { completedAt: page.at(-1)!.completedAt!, id: page.at(-1)!.id };
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen)).toEqual(new Set(ids));
    const all = repos.sessions.history({ limit: 100 }).map((s) => s.id);
    expect(seen).toEqual(all);
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'sessions_history_idx'").get()).toBeTruthy();
  });
});

describe('account settings (offline PROFILE-02 / SETTINGS-01)', () => {
  const input = { displayName: 'Ana', visibility: 'public' as const, weightUnit: 'kg' as const, lengthUnit: 'cm' as const, timezone: 'UTC', targetDays: 3 };

  it('a goal change targets the week after the edit, never the current one', () => {
    const { repos, sqlite } = openTestRepos(undefined, { now: () => new Date('2026-11-25T12:00:00Z') }); // Wednesday
    seedAccount(sqlite);
    repos.accountSettings.save({ ...input, targetDays: 5 });
    expect(repos.accountSettings.get()!.weeklyGoals).toEqual([
      { effectiveWeek: '2026-11-02', targetDays: 3, timezone: 'UTC' },
      { effectiveWeek: '2026-11-30', targetDays: 5, timezone: 'UTC' },
    ]);
    // Changing it again before next week replaces the scheduled row (one queued op per save).
    repos.accountSettings.save({ ...input, targetDays: 4 });
    expect(repos.accountSettings.get()!.weeklyGoals.at(-1)).toEqual({ effectiveWeek: '2026-11-30', targetDays: 4, timezone: 'UTC' });
    expect(count(sqlite, 'outbox', "aggregate_type = 'account_settings'")).toBe(2);
  });

  it('a timezone change carries the goal forward from the later of both zones\' next Monday', () => {
    // Sunday 23:30 UTC = already Monday in Tokyo.
    const { repos, sqlite } = openTestRepos(undefined, { now: () => new Date('2026-11-29T23:30:00Z') });
    seedAccount(sqlite);
    repos.accountSettings.save({ ...input, timezone: 'Asia/Tokyo' });
    expect(repos.accountSettings.get()!.weeklyGoals).toEqual([
      { effectiveWeek: '2026-11-02', targetDays: 3, timezone: 'UTC' },
      { effectiveWeek: '2026-12-07', targetDays: 3, timezone: 'Asia/Tokyo' },
    ]);
  });

  it('invalid input writes nothing; an unknown account throws', () => {
    const { repos, sqlite } = openTestRepos();
    expect(() => repos.accountSettings.save(input)).toThrow('Account not found');
    seedAccount(sqlite);
    expect(() => repos.accountSettings.save({ ...input, displayName: '   ' })).toThrow(ValidationError);
    expect(count(sqlite, 'outbox')).toBe(0);
    expect(repos.accountSettings.get()?.displayName).toBe('Ana');
  });

  it('settings row and outbox op commit together or not at all', () => {
    const { repos, sqlite } = openTestRepos();
    seedAccount(sqlite);
    sqlite.exec(`CREATE TRIGGER fail_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'disk full'); END;`);
    expect(() => repos.accountSettings.save({ ...input, displayName: 'Changed' })).toThrow('disk full');
    expect(repos.accountSettings.get()?.displayName).toBe('Ana');
  });
});

describe('canonical units', () => {
  it('stores integer grams only; fractional or negative grams are rejected before any write', () => {
    const { repos, sqlite } = openTestRepos();
    const s = repos.sessions.startEmpty();
    const ex = repos.sessions.addExercise(s.id, 'catalog:0025');
    const set = repos.sessions.active()!.exercises.find((e) => e.id === ex)!.sets[0];
    const before = count(sqlite, 'outbox');
    expect(() => repos.sessions.updateSet(s.id, set.id, { loadGrams: 45359.2 })).toThrow(ValidationError);
    expect(() => repos.sessions.updateSet(s.id, set.id, { loadGrams: -1 })).toThrow(ValidationError);
    expect(() => repos.bodyWeight.save({ measuredAt: '2026-11-25T07:00:00.000Z', weightGrams: 80000.5 })).toThrow(ValidationError);
    expect(count(sqlite, 'outbox')).toBe(before);
    repos.sessions.updateSet(s.id, set.id, { loadGrams: 45359 }); // 100 lb entered, stored as grams
    expect(sqlite.prepare('SELECT typeof(load_grams) AS t, load_grams AS g FROM performed_sets WHERE id = ?').get(set.id)).toEqual({ t: 'integer', g: 45359 });
  });
});
