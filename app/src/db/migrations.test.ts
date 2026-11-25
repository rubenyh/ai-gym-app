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

  it('re-running migrations on a current database keeps training history and pending outbox rows', () => {
    const first = openTestRepos();
    const s = first.repos.sessions.startEmpty();
    first.sqlite.close();
    const again = openTestRepos(first.path);
    expect(again.repos.sessions.active()?.id).toBe(s.id);
    expect(count(again.sqlite, 'outbox', "status = 'pending'")).toBe(1);
  });
});
