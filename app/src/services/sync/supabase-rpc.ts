/** Sync RPC adapter over any signed-in supabase-js client (app client, or a test client in integration tests). */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { PushOp } from '@/domain/contracts';

import { SyncAuthError, type SyncRpc } from './engine';

type RpcError = { message: string; code?: string } | null;
type RpcCaller = (fn: string, args?: object) => PromiseLike<{ data: unknown; error: RpcError; status?: number }>;

/** 401, expired JWT, or the RPCs' own `not authenticated` (42501) pause sync instead of retrying. */
const isAuthFailure = (error: NonNullable<RpcError>, status?: number) =>
  status === 401 || error.code === 'PGRST301' || error.code === 'PGRST303' || error.code === '42501' || /jwt|not authenticated/i.test(error.message);

/**
 * `expectedUserId` binds the adapter to one account database: if the client's session belongs to another
 * user (account switch while a worker is mid-cycle), the call fails as an auth pause instead of pushing
 * this account's ops into, or pulling another account's changes into, the wrong account.
 */
export function createSupabaseSyncRpc(client: SupabaseClient<any, any, any>, expectedUserId?: string): SyncRpc {
  // The sync RPCs are called by name; payloads are validated by the engine against contracts.ts.
  const callRpc = client.rpc.bind(client) as unknown as RpcCaller;
  async function rpc(fn: string, args?: object): Promise<unknown> {
    const { data: session } = await client.auth.getSession();
    if (!session.session) throw new SyncAuthError();
    if (expectedUserId && session.session.user.id !== expectedUserId) throw new SyncAuthError('Signed in as another account');
    const { data, error, status } = await callRpc(fn, args);
    if (error) {
      if (isAuthFailure(error, status)) throw new SyncAuthError();
      throw new Error(error.message);
    }
    return data;
  }
  return {
    push: (op: PushOp) => rpc('sync_push', { p_op: op }),
    pull: (after, limit) => rpc('sync_pull', { p_after: after, p_limit: limit }),
    rewardSummary: () => rpc('get_reward_summary'),
  };
}
