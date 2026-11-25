import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from '@/services/supabase/client';

/** Deep link Supabase returns to (allow-listed as aigym://** in supabase/config.toml). */
export function authCallbackUrl(next?: string): string {
  return Linking.createURL('auth/callback', next ? { queryParams: { next } } : undefined);
}

export async function signInWithPassword(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

/** Returns true when the user must confirm the email before a session exists. */
export async function signUp(email: string, password: string): Promise<boolean> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: authCallbackUrl() },
  });
  if (error) throw error;
  return !data.session;
}

export async function requestPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: authCallbackUrl('reset-password'),
  });
  if (error) throw error;
}

export async function updatePassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

export async function exchangeCode(code: string) {
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;
}

/**
 * Google OAuth through the system browser with PKCE. Unverified until Google credentials exist
 * (docs/DECISIONS.md O-07); the provider is disabled in supabase/config.toml.
 */
export async function signInWithGoogle(): Promise<'signed-in' | 'cancelled'> {
  const redirectTo = authCallbackUrl();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return 'cancelled';
  const { queryParams } = Linking.parse(result.url);
  const code = typeof queryParams?.code === 'string' ? queryParams.code : null;
  if (!code) throw new Error(String(queryParams?.error_description ?? 'Google sign-in did not return a code.'));
  await exchangeCode(code);
  return 'signed-in';
}
