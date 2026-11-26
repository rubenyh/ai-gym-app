/** @jest-environment node */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { count, MIGRATIONS, openTestRepos, tempDbPath } from './testing';

/** A migrations folder containing only the first `n` journal entries (an older app version). */
function olderMigrations(n: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'gym-migrations-'));
  mkdirSync(join(dir, 'meta'));
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'));
  journal.entries = journal.entries.slice(0, n);
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify(journal));
  for (const e of journal.entries) copyFileSync(join(MIGRATIONS, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
  return dir;
}

describe('SQLite migration upgrades (NFR-03)', () => {
  it('upgrades an M1 database (migration 0000) to the current schema without losing data', () => {
    const path = tempDbPath();
    const old = new Database(path);
    migrate(drizzle(old), { migrationsFolder: olderMigrations(1) });
    old.prepare(`INSERT INTO account_profile VALUES ('11111111-1111-4111-8111-111111111111','ana','Ana','private',NULL,'2026-11-01T00:00:00Z')`).run();
    old.prepare(`INSERT INTO user_settings VALUES (1,'kg','cm','Europe/Madrid','2026-11-01T00:00:00Z')`).run();
    old.prepare(`INSERT INTO weekly_goals VALUES ('2026-10-26',3,'Europe/Madrid')`).run();
    old.close();

    const { repos, sqlite } = openTestRepos(path);
    expect(sqlite.prepare('SELECT handle, visibility FROM account_profile').get()).toEqual({ handle: 'ana', visibility: 'private' });
    expect(sqlite.prepare('SELECT timezone FROM user_settings WHERE id = 1').get()).toEqual({ timezone: 'Europe/Madrid' });
    expect(count(sqlite, 'weekly_goals')).toBe(1);
    // New tables work on the upgraded file.
    repos.sessions.startEmpty();
    expect(count(sqlite, 'outbox')).toBe(1);
  });

  it('upgrades a 0001-era database with history and pending/inflight outbox rows, keeping them sendable', () => {
    const path = tempDbPath();
    const old = new Database(path);
    migrate(drizzle(old), { migrationsFolder: olderMigrations(2) });
    const uid = '11111111-1111-4111-8111-111111111111';
    const s1 = '22222222-2222-4222-8222-222222222222';
    const s2 = '33333333-3333-4333-8333-333333333333';
    old.exec(`
      INSERT INTO account_profile VALUES ('${uid}','ana','Ana','private',NULL,'2026-11-01T00:00:00Z');
      INSERT INTO user_settings VALUES (1,'kg','cm','UTC','2026-11-01T00:00:00Z');
      INSERT INTO weekly_goals VALUES ('2026-10-26',3,'UTC');
      INSERT INTO sessions (id, routine_id, name, status, started_at, completed_at, timezone, local_date, notes, server_revision, deleted, updated_at) VALUES
        ('${s1}', NULL, 'A', 'completed', '2026-11-20T09:00:00.000Z', '2026-11-20T10:00:00.000Z', 'UTC', '2026-11-20', '', 1, 0, '2026-11-20T10:00:00.000Z'),
        ('${s2}', NULL, 'B', 'completed', '2026-11-20T09:00:00.000Z', '2026-11-20T10:00:00.000Z', 'UTC', '2026-11-20', '', NULL, 0, '2026-11-20T10:00:00.000Z');
      INSERT INTO outbox (op_id, aggregate_type, aggregate_id, action, status, base_revision, payload, attempts, created_at) VALUES
        ('44444444-4444-4444-8444-444444444444', 'session', '${s2}', 'upsert', 'inflight', NULL, '{"frozen":true}', 2, '2026-11-20T10:00:00.000Z'),
        ('55555555-5555-4555-8555-555555555555', 'session', '${s1}', 'upsert', 'pending', NULL, NULL, 0, '2026-11-20T10:01:00.000Z');`);
    old.close();

    const { repos, sqlite } = openTestRepos(path);
    expect(repos.sessions.history().map((s) => s.id)).toEqual([s2, s1]); // equal timestamps: id DESC
    expect(sqlite.prepare('SELECT op_id, status, attempts, payload FROM outbox ORDER BY seq').all()).toEqual([
      { op_id: '44444444-4444-4444-8444-444444444444', status: 'inflight', attempts: 2, payload: '{"frozen":true}' },
      { op_id: '55555555-5555-4555-8555-555555555555', status: 'pending', attempts: 0, payload: null },
    ]);
    // The inflight op is resent unchanged first (same op id + frozen payload).
    expect(repos.sync.nextOp(true)).toMatchObject({ op: { opId: '44444444-4444-4444-8444-444444444444', doc: { frozen: true } } });
    // Upgraded M1 cache rows are the account_settings aggregate (never acknowledged yet).
    expect(repos.accountSettings.get()).toMatchObject({ id: uid, visibility: 'private', serverRevision: null, pendingOps: 0 });
  });

  it('re-running migrations on a current database keeps training history and pending outbox rows', () => {
    const first = openTestRepos();
    const s = first.repos.sessions.startEmpty();
    first.sqlite.close();
    const again = openTestRepos(first.path);
    expect(again.repos.sessions.active()?.id).toBe(s.id);
    expect(count(again.sqlite, 'outbox', "status = 'pending'")).toBe(1);
  });
});
