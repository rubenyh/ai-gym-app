import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { FormMessage, FormScreen } from '@/components/form';
import { friendlyError } from '@/features/account/errors';
import { exchangeCode } from '@/features/auth/auth-actions';

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
    exchangeCode(code)
      .then(() => router.replace(next === 'reset-password' ? '/reset-password' : '/'))
      .catch((e) => setExchangeError(friendlyError(e)));
  }, [code, next]);

  return (
    <FormScreen title="Signing you in…">
      <FormMessage text={error} />
    </FormScreen>
  );
}
