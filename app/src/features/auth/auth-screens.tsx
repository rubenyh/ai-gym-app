import { Link, router } from 'expo-router';
import { useState } from 'react';

import { Button, FormMessage, FormScreen, linkTarget, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { friendlyError } from '@/features/account/errors';
import { emailSchema, passwordSchema } from '@/features/account/validation';

import { requestPasswordReset, signInWithGoogle, signInWithPassword, signUp, updatePassword } from './auth-actions';

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

function validateCredentials(email: string, password: string) {
  const e = emailSchema.safeParse(email.trim());
  const p = passwordSchema.safeParse(password);
  return {
    email: e.success ? undefined : e.error.issues[0].message,
    password: p.success ? undefined : p.error.issues[0].message,
  };
}

export function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const { busy, error, run } = useSubmit();

  const submit = () => {
    const next = validateCredentials(email, password);
    setErrors(next);
    if (next.email || next.password) return;
    // The account provider reacts to the new session and routes to onboarding or Home.
    run(() => signInWithPassword(email.trim(), password));
  };

  return (
    <FormScreen title="Sign in">
      <TextField label="Email" value={email} onChangeText={setEmail} error={errors.email}
        autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <TextField label="Password" value={password} onChangeText={setPassword} error={errors.password}
        secureTextEntry autoComplete="current-password" textContentType="password" />
      <FormMessage text={error} />
      <Button label="Sign in" onPress={submit} busy={busy} />
      <Button label="Continue with Google" variant="secondary" busy={busy}
        onPress={() => run(async () => void (await signInWithGoogle()))} />
      <Link href="/forgot-password" style={linkTarget}><ThemedText type="linkPrimary">Forgot password?</ThemedText></Link>
      <Link href="/sign-up" style={linkTarget}><ThemedText type="linkPrimary">Create an account</ThemedText></Link>
    </FormScreen>
  );
}

export function SignUpScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [info, setInfo] = useState<string | null>(null);
  const { busy, error, run } = useSubmit();

  const submit = () => {
    const next = validateCredentials(email, password);
    setErrors(next);
    if (next.email || next.password) return;
    run(async () => {
      const needsConfirmation = await signUp(email.trim(), password);
      if (needsConfirmation) setInfo('Check your email and open the confirmation link on this device.');
    });
  };

  return (
    <FormScreen title="Create account">
      <TextField label="Email" value={email} onChangeText={setEmail} error={errors.email}
        autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <TextField label="Password" value={password} onChangeText={setPassword} error={errors.password}
        secureTextEntry autoComplete="new-password" textContentType="newPassword" />
      <FormMessage text={error} />
      <FormMessage text={info} tone="info" />
      <Button label="Create account" onPress={submit} busy={busy} />
      <Link href="/sign-in" style={linkTarget}><ThemedText type="linkPrimary">I already have an account</ThemedText></Link>
    </FormScreen>
  );
}

export function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [info, setInfo] = useState<string | null>(null);
  const { busy, error, run } = useSubmit();

  const submit = () => {
    const parsed = emailSchema.safeParse(email.trim());
    setFieldError(parsed.success ? undefined : parsed.error.issues[0].message);
    if (!parsed.success) return;
    run(async () => {
      await requestPasswordReset(parsed.data);
      setInfo('If an account exists, a reset link was sent. Open it on this device.');
    });
  };

  return (
    <FormScreen title="Reset password">
      <TextField label="Email" value={email} onChangeText={setEmail} error={fieldError}
        autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
      <FormMessage text={error} />
      <FormMessage text={info} tone="info" />
      <Button label="Send reset link" onPress={submit} busy={busy} />
    </FormScreen>
  );
}

/** Reached from the recovery email via auth/callback?next=reset-password (session already set). */
export function ResetPasswordScreen() {
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const { busy, error, run } = useSubmit();

  const submit = () => {
    const parsed = passwordSchema.safeParse(password);
    setFieldError(parsed.success ? undefined : parsed.error.issues[0].message);
    if (!parsed.success) return;
    run(async () => {
      await updatePassword(parsed.data);
      router.replace('/');
    });
  };

  return (
    <FormScreen title="Choose a new password">
      <TextField label="New password" value={password} onChangeText={setPassword} error={fieldError}
        secureTextEntry autoComplete="new-password" textContentType="newPassword" />
      <FormMessage text={error} />
      <Button label="Save password" onPress={submit} busy={busy} />
    </FormScreen>
  );
}
