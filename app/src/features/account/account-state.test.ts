import type { AccountSnapshot } from './account-data';
import { resolveAccountState } from './account-state';

const USER = 'aaaaaaaa-0000-4000-8000-000000000001';
const account: AccountSnapshot = {
  profile: { id: USER, handle: 'ana', displayName: 'Ana', visibility: 'private', avatarPath: null, updatedAt: 't' },
  settings: { weightUnit: 'kg', lengthUnit: 'cm', timezone: 'Europe/Madrid', updatedAt: 't' },
  goals: [{ effectiveWeek: '2026-11-23', targetDays: 3, timezone: 'Europe/Madrid' }],
};

describe('resolveAccountState (AUTH-02)', () => {
  it('signed out without a session', () => {
    expect(resolveAccountState(null, account, { ok: false, message: 'x' })).toEqual({ kind: 'signed-out' });
  });

  it('needs onboarding when the server has no profile', () => {
    expect(resolveAccountState(USER, null, { ok: true, account: null })).toEqual({
      kind: 'needs-onboarding',
      userId: USER,
    });
  });

  it('uses fresh server data when reachable', () => {
    expect(resolveAccountState(USER, null, { ok: true, account })).toMatchObject({ kind: 'ready', stale: false });
  });

  it('opens from the local cache offline instead of forcing a login loop', () => {
    expect(resolveAccountState(USER, account, { ok: false, message: 'Network request failed' })).toMatchObject({
      kind: 'ready',
      stale: true,
      account,
    });
  });

  it('reports offline when nothing is cached and the server is unreachable', () => {
    expect(resolveAccountState(USER, null, { ok: false, message: 'Network request failed' })).toEqual({
      kind: 'offline',
      userId: USER,
      message: 'Network request failed',
    });
  });
});
