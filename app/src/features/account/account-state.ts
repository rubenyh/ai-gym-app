import type { AccountSnapshot } from './account-data';

/** What the app shell should show for the current session (drives route guards). */
export type AccountState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'needs-onboarding'; userId: string }
  | { kind: 'ready'; userId: string; account: AccountSnapshot; stale: boolean }
  /** Signed in, nothing cached, and the server is unreachable: onboarding status unknown. */
  | { kind: 'offline'; userId: string; message: string; openInOtherTab?: boolean };

type Remote = { ok: true; account: AccountSnapshot | null } | { ok: false; message: string };

/**
 * Pure decision used at start-up and on refresh. A cached account always wins when the server is
 * unreachable, so a previously authenticated user is never forced into a network login loop (AUTH-02).
 */
export function resolveAccountState(
  userId: string | null,
  cached: AccountSnapshot | null,
  remote: Remote,
): AccountState {
  if (!userId) return { kind: 'signed-out' };
  if (remote.ok) {
    return remote.account
      ? { kind: 'ready', userId, account: remote.account, stale: false }
      : { kind: 'needs-onboarding', userId };
  }
  if (cached) return { kind: 'ready', userId, account: cached, stale: true };
  return { kind: 'offline', userId, message: remote.message };
}
