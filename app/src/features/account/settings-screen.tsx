import { Link } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { Button, Choice, FormMessage, FormScreen, linkTarget, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { useLocalQuery, useRepositories, useSyncEngine } from '@/db/repositories-context';
import { supabase } from '@/services/supabase/client';

import { useAccount } from './account-provider';
import { AvatarPicker } from './avatar-picker';
import { friendlyError } from './errors';
import { LENGTH_UNITS, TARGET_DAYS, WEIGHT_UNITS } from './onboarding-screen';
import { displayNameSchema, handleSchema, timezoneSchema } from './validation';

const VISIBILITY = [
  { value: 'private', label: 'Private' },
  { value: 'public', label: 'Public' },
] as const;

/** Identity and preferences (PROFILE-02, SETTINGS-01). Display name, visibility, units, timezone and weekly
 * goal save on the device and sync through the outbox (works offline; supersedes D-28). Handle (server
 * uniqueness) and avatar (upload) need a connection. */
export function SettingsScreen() {
  const { state, refresh, signOut } = useAccount();
  const repos = useRepositories();
  const sync = useSyncEngine();
  const local = useLocalQuery((r) => r.accountSettings.get(), []);
  const account = state.kind === 'ready' ? state.account : null;
  const [displayName, setDisplayName] = useState(local?.displayName ?? account?.profile.displayName ?? '');
  const [visibility, setVisibility] = useState(local?.visibility ?? account?.profile.visibility ?? 'private');
  const [weightUnit, setWeightUnit] = useState(local?.weightUnit ?? account?.settings.weightUnit ?? 'kg');
  const [lengthUnit, setLengthUnit] = useState(local?.lengthUnit ?? account?.settings.lengthUnit ?? 'cm');
  const [timezone, setTimezone] = useState(local?.timezone ?? account?.settings.timezone ?? '');
  const [targetDays, setTargetDays] = useState(local?.weeklyGoals.at(-1)?.targetDays ?? 3);
  const [handle, setHandle] = useState(account?.profile.handle ?? '');
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!account || state.kind !== 'ready') return null;
  const pending = !!local && (local.pendingOps > 0 || local.conflict);
  const latestGoal = local?.weeklyGoals.at(-1);

  const save = () => {
    const name = displayNameSchema.safeParse(displayName);
    const tz = timezoneSchema.safeParse(timezone);
    if (!name.success || !tz.success) {
      return setMessage({ text: (name.error ?? tz.error)!.issues[0].message, tone: 'error' });
    }
    try {
      // Local transaction + outbox op; never waits on the network.
      repos.accountSettings.save({ displayName: name.data, visibility, weightUnit, lengthUnit, timezone: tz.data, targetDays });
      setMessage({ text: 'Saved on this device. It syncs automatically when you are online.', tone: 'info' });
    } catch (e) {
      setMessage({ text: friendlyError(e), tone: 'error' });
    }
  };

  /** Handle uniqueness is checked by the server, so this one needs a connection. */
  const saveHandle = async () => {
    const h = handleSchema.safeParse(handle);
    if (!h.success) return setMessage({ text: h.error.issues[0].message, tone: 'error' });
    setBusy(true);
    setMessage(null);
    try {
      const res = await supabase.from('profiles').update({ handle: h.data }).eq('id', state.userId);
      if (res.error) throw res.error;
      await refresh();
      setMessage({ text: 'Handle changed.', tone: 'info' });
    } catch (e) {
      setMessage({ text: `${friendlyError(e)} Changing your handle needs a connection.`, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const finishSignOut = async (discard: boolean) => {
    sync.stop();
    await signOut({ discard });
  };

  /** NFR-08: never drop unsynced training data silently. */
  const confirmSignOut = () => {
    if (!repos.outbox.hasUnsynced()) return void finishSignOut(false);
    Alert.alert(
      'Unsynced changes',
      'Some workouts, plans or settings on this device have not reached the server yet. Signing out with "Discard" deletes them from this device.',
      [
        {
          text: 'Sync now',
          onPress: async () => {
            setBusy(true);
            await sync.syncNow();
            setBusy(false);
            if (repos.outbox.hasUnsynced()) {
              const { lastError } = repos.outbox.summary();
              const detail = lastError ? `: ${lastError}` : '';
              setMessage({ text: `Some changes could not sync${detail}. See Sync status.`, tone: 'error' });
            } else {
              await finishSignOut(false);
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
        { text: 'Discard and sign out', style: 'destructive', onPress: () => void finishSignOut(true) },
      ],
    );
  };

  return (
    <FormScreen title="Profile & settings">
      {pending ? (
        <ThemedText type="small" accessibilityRole="alert">
          {local?.conflict
            ? 'Your settings changed on another device. Resolve it in Sync status.'
            : 'Waiting to sync: these settings are saved on this device but NOT yet applied on the server. Until then others still see your previous name and visibility.'}
        </ThemedText>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary">
        Handle and avatar changes need a connection.
      </ThemedText>
      <TextField label="Handle" value={handle} onChangeText={setHandle} autoCapitalize="none" autoCorrect={false} />
      {handle.trim().toLowerCase() !== account.profile.handle ? (
        <Button label="Change handle" variant="secondary" onPress={saveHandle} busy={busy} />
      ) : null}
      <AvatarPicker userId={account.profile.id} avatarPath={account.profile.avatarPath} onChanged={refresh} />
      <Link href="/coach-draft/profile" accessibilityRole="button" style={linkTarget}>
        <ThemedText type="linkPrimary">Training profile (private)</ThemedText>
      </Link>
      <Link href="/sync-status" accessibilityRole="button" style={linkTarget}>
        <ThemedText type="linkPrimary">Sync status</ThemedText>
      </Link>
      <TextField label="Display name" value={displayName} onChangeText={setDisplayName} />
      <Choice label={pending && local?.visibility ? `Profile visibility (${local.visibility}: pending sync)` : 'Profile visibility'} options={VISIBILITY} value={visibility} onChange={setVisibility} />
      <Choice label="Weight unit" options={WEIGHT_UNITS} value={weightUnit} onChange={setWeightUnit} />
      <Choice label="Height unit" options={LENGTH_UNITS} value={lengthUnit} onChange={setLengthUnit} />
      <TextField label="Time zone" value={timezone} onChangeText={setTimezone} autoCapitalize="none" autoCorrect={false} />
      <Choice label="Weekly goal (applies from next week)" options={TARGET_DAYS} value={targetDays} onChange={setTargetDays} />
      {latestGoal ? (
        <ThemedText type="small" themeColor="textSecondary">
          {`Goal ${latestGoal.targetDays} days/week from the week of ${latestGoal.effectiveWeek}${pending ? ' (requested; if that week has started when it syncs, it starts the week after)' : ''}.`}
        </ThemedText>
      ) : null}
      <FormMessage text={message?.text} tone={message?.tone} />
      <Button label="Save" onPress={save} />
      <Button label="Sign out" variant="secondary" onPress={confirmSignOut} busy={busy} />
    </FormScreen>
  );
}
