/** Maps Supabase/Postgres errors to actionable messages (AUTH-01). Never echoes tokens. */
export function friendlyError(error: unknown): string {
  const e = error as { code?: string; message?: string; status?: number } | null;
  const message = e?.message ?? '';
  if (e?.code === '23505') return 'That handle is already taken.';
  if (e?.code === '23514') return 'Some values are out of range. Check the form and try again.';
  if (e?.code === 'invalid_credentials' || /invalid login credentials/i.test(message))
    return 'Email or password is incorrect.';
  if (e?.code === 'email_not_confirmed') return 'Confirm your email first, then sign in.';
  if (e?.code === 'user_already_exists') return 'An account with this email already exists. Sign in instead.';
  if (/provider is not enabled/i.test(message)) return 'Google sign-in is not configured yet.';
  if (/network|fetch/i.test(message)) return 'No connection. Check your network and try again.';
  return message || 'Something went wrong. Try again.';
}
