import { accountDatabaseName, closeAccountDb, openAccountDb } from './account-db';

const mockOpened: { name: string; closed: boolean }[] = [];
const mockMigrate = jest.fn(async () => {});

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: (name: string) => {
    const handle = { name, closed: false };
    mockOpened.push(handle);
    return {
      execSync: () => {},
      closeAsync: async () => {
        handle.closed = true;
      },
    };
  },
}));
jest.mock('drizzle-orm/expo-sqlite', () => ({ drizzle: (sqlite: unknown) => ({ sqlite }) }));
jest.mock('drizzle-orm/expo-sqlite/migrator', () => ({ migrate: () => mockMigrate() }));
jest.mock('./migrations/migrations', () => ({ journal: { entries: [] }, migrations: {} }));

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';

describe('account database isolation (NFR-08)', () => {
  beforeEach(async () => {
    await closeAccountDb();
    mockOpened.length = 0;
    mockMigrate.mockClear();
  });

  it('uses one file per account and rejects non-UUID ids', () => {
    expect(accountDatabaseName(A)).toBe(`account-${A}.db`);
    expect(() => accountDatabaseName('../other')).toThrow();
  });

  it('runs migrations before returning the database', async () => {
    await openAccountDb(A);
    expect(mockMigrate).toHaveBeenCalledTimes(1);
  });

  it('closes the previous account file when another account signs in', async () => {
    await openAccountDb(A);
    await openAccountDb(B);
    expect(mockOpened.map((o) => [o.name, o.closed])).toEqual([
      [`account-${A}.db`, true],
      [`account-${B}.db`, false],
    ]);
  });

  it('reuses the open database for the same account', async () => {
    const first = await openAccountDb(A);
    expect(await openAccountDb(A)).toBe(first);
    expect(mockOpened).toHaveLength(1);
  });
});
