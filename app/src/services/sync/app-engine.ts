/** React Native wiring for the sync worker: Supabase RPCs + foreground/reconnection triggers. */
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';

import type { LocalRepositories } from '@/db/repositories';
import { supabase } from '@/services/supabase/client';

import { createSyncEngine, type SyncEngine } from './engine';
import { createSupabaseSyncRpc } from './supabase-rpc';

/** Engine for the signed-in account `userId`; triggers attach on start and detach on stop. */
export function createAppSyncEngine(repos: LocalRepositories, userId: string): SyncEngine {
  const engine = createSyncEngine(repos, createSupabaseSyncRpc(supabase, userId));
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
