/** Sync RPC adapter over any signed-in supabase-js client (app client, or a test client in integration tests). */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { PushOp } from '@/domain/contracts';

import { SyncAuthError, type SyncRpc } from './engine';

type RpcError = { message: string; code?: string } | null;
type RpcResponse = { data: unknown; error: RpcError; status?: number };
type RpcBuilder = PromiseLike<RpcResponse> & { setHeader(name: string, value: string): RpcBuilder };
type RpcCaller = (fn: string, args?: object) => RpcBuilder;

/** 401, expired JWT, or the RPCs' own `not authenticated` (42501) pause sync instead of retrying. */
const isAuthFailure = (error: NonNullable<RpcError>, status?: number) =>
  status === 401 || error.code === 'PGRST301' || error.code === 'PGRST303' || error.code === '42501' || /jwt|not authenticated/i.test(error.message);

/** `sub` claim of a JWT (no signature check: the server verifies; this only guards which token we send). */
export function jwtSubject(token: string): string | null {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const sub = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '='))).sub;
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
}

/**
 * Request-scoped auth. Each call captures the current session ONCE (getSession refreshes an expired
 * token), checks that it belongs to `expectedUserId` (user id and the token's `sub`), and sends the
 * request with that captured token as an explicit `Authorization` header. supabase-js only adds the
 * ambient session token when no Authorization header is set, so an account switch between the check and
 * dispatch can never send this account's op under another account's token.
 */
export function createSupabaseSyncRpc(client: SupabaseClient<any, any, any>, expectedUserId?: string): SyncRpc {
  // The sync RPCs are called by name; payloads are validated by the engine against contracts.ts.
  const callRpc = client.rpc.bind(client) as unknown as RpcCaller;
  async function rpc(fn: string, args?: object): Promise<unknown> {
    const { data } = await client.auth.getSession();
    const session = data.session;
    if (!session) throw new SyncAuthError();
    const token = session.access_token;
    if (expectedUserId && (session.user.id !== expectedUserId || jwtSubject(token) !== expectedUserId)) {
      throw new SyncAuthError('Signed in as another account');
    }
    const { data: result, error, status } = await callRpc(fn, args).setHeader('Authorization', `Bearer ${token}`);
    if (error) {
      if (isAuthFailure(error, status)) throw new SyncAuthError();
      throw new Error(error.message);
    }
    return result;
  }
  return {
    push: (op: PushOp) => rpc('sync_push', { p_op: op }),
    pull: (after, limit) => rpc('sync_pull', { p_after: after, p_limit: limit }),
    rewardSummary: () => rpc('get_reward_summary'),
  };
}
