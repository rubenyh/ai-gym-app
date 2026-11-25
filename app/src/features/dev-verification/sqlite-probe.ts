import * as SQLite from 'expo-sqlite';

/**
 * Dev-only persistence probe for M0. Uses its own database file so it never mixes with
 * future account-scoped training databases (docs/DECISIONS.md D-10).
 */
const DATABASE_NAME = 'dev-probe.db';

export type ProbeValue = { count: number; updatedAt: string | null };

let db: SQLite.SQLiteDatabase | null = null;

async function open(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync(DATABASE_NAME);
    await db.execAsync(
      'CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY NOT NULL, count INTEGER NOT NULL, updated_at TEXT NOT NULL);',
    );
  }
  return db;
}

export async function readProbe(): Promise<ProbeValue> {
  const conn = await open();
  const row = await conn.getFirstAsync<{ count: number; updated_at: string }>(
    'SELECT count, updated_at FROM probe WHERE id = 1',
  );
  return { count: row?.count ?? 0, updatedAt: row?.updated_at ?? null };
}

/** Increments inside a transaction; the returned value is read back from disk, not from memory. */
export async function incrementProbe(): Promise<ProbeValue> {
  const conn = await open();
  await conn.withTransactionAsync(async () => {
    await conn.runAsync(
      'INSERT INTO probe (id, count, updated_at) VALUES (1, 1, ?) ON CONFLICT(id) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at',
      new Date().toISOString(),
    );
  });
  return readProbe();
}
