import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { FormMessage, FormScreen } from '@/components/form';
import { friendlyError } from '@/features/account/errors';
import { exchangeCode } from '@/features/auth/auth-actions';

// A code can be exchanged once. Effects may run twice for one link (React dev remount, re-render after
// navigation), so every run for the same code shares the first exchange instead of failing the second time.
const exchanges = new Map<string, Promise<void>>();
function exchangeOnce(code: string): Promise<void> {
  let pending = exchanges.get(code);
  if (!pending) {
    pending = exchangeCode(code);
    exchanges.set(code, pending);
  }
  return pending;
}

/** Return route for email confirmation, password recovery and OAuth (aigym://auth/callback). */
export default function AuthCallbackRoute() {
  const { code, next, error_description } = useLocalSearchParams<{
    code?: string;
    next?: string;
    error_description?: string;
  }>();
  const [exchangeError, setExchangeError] = useState<string | null>(null);
  const error =
    error_description ?? (code ? exchangeError : 'This link is invalid or expired. Request a new one.');

  useEffect(() => {
    if (!code) return;
    exchangeOnce(code)
      .then(() => router.replace(next === 'reset-password' ? '/reset-password' : '/'))
      .catch((e) => setExchangeError(friendlyError(e)));
  }, [code, next]);

  return (
    <FormScreen title="Signing you in…">
      <FormMessage text={error} />
    </FormScreen>
  );
}
