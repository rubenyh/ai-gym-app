import { createClient } from '@supabase/supabase-js';
import * as SessionStore from './session-store';
import { AppState } from 'react-native';

import { createChunkedStorage } from './chunked-storage';
import type { Database } from './database.types';

// Public values only (bundled into the app). See app/.env.example.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy app/.env.example to app/.env.local.',
  );
}

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    // Session tokens live in platform secure storage, never in workout tables or logs.
    storage: createChunkedStorage(SessionStore),
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    // PKCE: email confirmation, password recovery and Google return a code to aigym://auth/callback.
    flowType: 'pkce',
  },
});

// Refresh tokens only while the app is in the foreground (no background guarantees).
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
