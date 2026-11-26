import { drizzle, type ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { deleteDatabaseAsync, openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { acquireAccountLock, releaseAccountLock } from './account-lock';
import migrations from './migrations/migrations';
import * as schema from './schema';

export type AccountDb = ExpoSQLiteDatabase<typeof schema>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One database file per account keeps accounts isolated on a shared device (NFR-08). */
export function accountDatabaseName(userId: string): string {
  if (!UUID.test(userId)) throw new Error('Invalid account id');
  return `account-${userId.toLowerCase()}.db`;
}

let current: { userId: string; sqlite: SQLiteDatabase; db: AccountDb; retiring?: boolean } | null = null;

let opening: { userId: string; promise: Promise<AccountDb> } | null = null;

/** Opens (or reuses) the signed-in account's database and runs migrations before any query. */
export function openAccountDb(userId: string): Promise<AccountDb> {
  // Concurrent calls for one account (sign-in fires more than one load) share a single open.
  if (opening?.userId === userId) return opening.promise;
  const promise = openAccountDbOnce(userId).finally(() => {
    if (opening?.promise === promise) opening = null;
  });
  opening = { userId, promise };
  return promise;
}

async function openAccountDbOnce(userId: string): Promise<AccountDb> {
  if (current?.userId === userId) return current.db;
  await closeAccountDb();
  // Web: wa-sqlite needs SharedArrayBuffer, which only cross-origin isolated pages get (metro.config.js headers).
  if ((globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === false) {
    throw new Error('This page cannot use offline storage (it is not cross-origin isolated). Reload the page.');
  }
  await acquireAccountLock(accountDatabaseName(userId));
  let sqlite: SQLiteDatabase | null = null;
  try {
    // Async open: on the web it waits for the wa-sqlite worker, which the sync open would not.
    sqlite = await openDatabaseAsync(accountDatabaseName(userId));
    await sqlite.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  } catch (e) {
    await sqlite?.closeAsync().catch(() => undefined);
    releaseAccountLock();
    throw e;
  }
  const db = drizzle(sqlite, { schema });
  await migrate(db, migrations);
  current = { userId, sqlite, db };
  return db;
}

export async function closeAccountDb(): Promise<void> {
  const open = current;
  current = null;
  try {
    await open?.sqlite.closeAsync();
  } finally {
    if (open) releaseAccountLock();
  }
}

/**
 * True while `userId` is the open, signed-in account. The sync worker checks it before applying any network
 * result, so a response that arrives during sign-out or an account switch is discarded unwritten.
 */
export function isAccountDbCurrent(userId: string): boolean {
  return current?.userId === userId && !current.retiring;
}

/** Sign-out step 1: stop accepting sync results for this account before the session goes away. */
export function retireAccountDb(retiring = true): void {
  if (current) current.retiring = retiring;
}

/** The already-open database of the account (opened by the account provider), or null. */
export function getOpenAccountDb(userId: string): AccountDb | null {
  return current?.userId === userId ? current.db : null;
}

/**
 * Explicit discard on sign-out (NFR-08): deletes this account's local file, including unsynced
 * changes. The next sign-in re-hydrates from the server.
 */
export async function deleteAccountDb(userId: string): Promise<void> {
  if (current?.userId === userId) await closeAccountDb();
  await deleteDatabaseAsync(accountDatabaseName(userId));
}
