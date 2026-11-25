import { drizzle, type ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

import migrations from './migrations/migrations';
import * as schema from './schema';

export type AccountDb = ExpoSQLiteDatabase<typeof schema>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One database file per account keeps accounts isolated on a shared device (NFR-08). */
export function accountDatabaseName(userId: string): string {
  if (!UUID.test(userId)) throw new Error('Invalid account id');
  return `account-${userId.toLowerCase()}.db`;
}

let current: { userId: string; sqlite: SQLiteDatabase; db: AccountDb } | null = null;

/** Opens (or reuses) the signed-in account's database and runs migrations before any query. */
export async function openAccountDb(userId: string): Promise<AccountDb> {
  if (current?.userId === userId) return current.db;
  await closeAccountDb();
  const sqlite = openDatabaseSync(accountDatabaseName(userId));
  sqlite.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const db = drizzle(sqlite, { schema });
  await migrate(db, migrations);
  current = { userId, sqlite, db };
  return db;
}

export async function closeAccountDb(): Promise<void> {
  const open = current;
  current = null;
  await open?.sqlite.closeAsync();
}
