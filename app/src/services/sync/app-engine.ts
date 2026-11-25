/** React Native wiring for the sync worker: Supabase RPCs + foreground/reconnection triggers. */
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';

import type { LocalRepositories } from '@/db/repositories';
import type { PushOp } from '@/domain/contracts';
import { supabase } from '@/services/supabase/client';

import { createSyncEngine, SyncAuthError, type SyncEngine, type SyncRpc } from './engine';

type RpcError = { message: string; code?: string; status?: number } | null;
// The sync RPCs are not in the generated Database types until the backend migration lands.
const callRpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args?: object) => PromiseLike<{ data: unknown; error: RpcError; status?: number }>;

const isAuthFailure = (error: NonNullable<RpcError>, status?: number) =>
  status === 401 || error.code === 'PGRST301' || error.code === '42501' || /jwt|not authenticated/i.test(error.message);

async function rpc(fn: string, args?: object): Promise<unknown> {
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) throw new SyncAuthError();
  const { data, error, status } = await callRpc(fn, args);
  if (error) {
    if (isAuthFailure(error, status)) throw new SyncAuthError();
    throw new Error(error.message);
  }
  return data;
}

export const supabaseSyncRpc: SyncRpc = {
  push: (op: PushOp) => rpc('sync_push', { p_op: op }),
  pull: (after, limit) => rpc('sync_pull', { p_after: after, p_limit: limit }),
  rewardSummary: () => rpc('get_reward_summary'),
};

/** Engine for the signed-in account; triggers attach on start and detach on stop. */
export function createAppSyncEngine(repos: LocalRepositories): SyncEngine {
  const engine = createSyncEngine(repos, supabaseSyncRpc);
  let detach: (() => void) | null = null;
  return {
    ...engine,
    start() {
      engine.start();
      const app = AppState.addEventListener('change', (s) => s === 'active' && void engine.trigger('online'));
      let wasConnected: boolean | null = null;
      const net = NetInfo.addEventListener((s) => {
        if (s.isConnected && wasConnected === false) void engine.trigger('online');
        wasConnected = s.isConnected;
      });
      const auth = supabase.auth.onAuthStateChange((event) => {
        // A refreshed/restored session resumes an auth pause.
        if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') void engine.syncNow();
      });
      detach = () => {
        app.remove();
        net();
        auth.data.subscription.unsubscribe();
      };
    },
    stop() {
      detach?.();
      detach = null;
      engine.stop();
    },
  };
}
