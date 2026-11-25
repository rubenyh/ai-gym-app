/**
 * Test-only helpers: a real SQLite database (better-sqlite3) migrated with the same drizzle SQL files the
 * app ships. Never imported by app code.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRepositories, type LocalRepositories, type RepositoryOptions } from './repositories';
import type { CatalogAsset } from './repositories/catalog';
import * as schema from './schema';

export const MIGRATIONS = join(__dirname, 'migrations');

export const tinyCatalog: CatalogAsset = {
  version: 1,
  count: 3,
  source: { url: 'test', sha: 'test' },
  exercises: [
    { sourceId: '0025', name: 'Barbell Bench Press', bodyPart: 'chest', target: 'pectorals', primaryMuscles: ['pectorals'], secondaryMuscles: ['triceps'], equipment: ['barbell'], instructions: ['Press.'], loadMode: 'external', mediaRights: 'unresolved' },
    { sourceId: '0652', name: 'Pull-Up', bodyPart: 'back', target: 'lats', primaryMuscles: ['lats'], secondaryMuscles: ['biceps'], equipment: ['body weight'], instructions: ['Pull.'], loadMode: 'bodyweight', mediaRights: 'unresolved' },
    { sourceId: '0017', name: 'Assisted Dip', bodyPart: 'chest', target: 'pectorals', primaryMuscles: ['pectorals'], secondaryMuscles: [], equipment: ['assisted'], instructions: ['Dip.'], loadMode: 'assisted', mediaRights: 'unresolved' },
  ],
};

export const tempDbPath = () => join(mkdtempSync(join(tmpdir(), 'gym-db-')), 'account.db');

/** Opens (or reopens) a database file, runs all migrations, and returns repositories over it. */
export function openTestRepos(path = tempDbPath(), opts: RepositoryOptions = {}) {
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS });
  const repos: LocalRepositories = createRepositories(db, { newId: randomUUID, catalog: tinyCatalog, ...opts });
  return { sqlite, db, repos, path };
}

export const count = (sqlite: Database.Database, table: string, where = '1=1') =>
  (sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;
