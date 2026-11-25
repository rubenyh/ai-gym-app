import { Link } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { Button, Choice, FormMessage, FormScreen, linkTarget, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { useRepositories, useSyncEngine } from '@/db/repositories-context';
import { supabase } from '@/services/supabase/client';

import type { AccountSnapshot } from './account-data';
import { useAccount } from './account-provider';
import { AvatarPicker } from './avatar-picker';
import { friendlyError } from './errors';
import { LENGTH_UNITS, TARGET_DAYS, WEIGHT_UNITS } from './onboarding-screen';
import { displayNameSchema, timezoneSchema } from './validation';

const VISIBILITY = [
  { value: 'private', label: 'Private' },
  { value: 'public', label: 'Public' },
] as const;

/** Goal in force for the latest scheduled week (rows are ordered by effective week). */
function latestGoal(account: AccountSnapshot) {
  return account.goals.at(-1)?.targetDays ?? 3;
}

/** Identity and preferences (PROFILE-02, SETTINGS-01). Identity/preference edits are online-only (server rows authoritative, D-22); training data syncs via the outbox. */
export function SettingsScreen() {
  const { state, refresh, signOut } = useAccount();
  const account = state.kind === 'ready' ? state.account : null;
  const [displayName, setDisplayName] = useState(account?.profile.displayName ?? '');
  const [visibility, setVisibility] = useState(account?.profile.visibility ?? 'private');
  const [weightUnit, setWeightUnit] = useState(account?.settings.weightUnit ?? 'kg');
  const [lengthUnit, setLengthUnit] = useState(account?.settings.lengthUnit ?? 'cm');
  const [timezone, setTimezone] = useState(account?.settings.timezone ?? '');
  const [targetDays, setTargetDays] = useState(account ? latestGoal(account) : 3);
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);
  const [busy, setBusy] = useState(false);
  const repos = useRepositories();
  const sync = useSyncEngine();

  if (!account || state.kind !== 'ready') return null;

  const save = async () => {
    const name = displayNameSchema.safeParse(displayName);
    const tz = timezoneSchema.safeParse(timezone);
    if (!name.success || !tz.success) {
      return setMessage({ text: (name.error ?? tz.error)!.issues[0].message, tone: 'error' });
    }
    setBusy(true);
    setMessage(null);
    try {
      const profile = await supabase
        .from('profiles')
        .update({ display_name: name.data, visibility })
        .eq('id', state.userId);
      if (profile.error) throw profile.error;
      // A timezone change applies from next week; the database carries the goal forward.
      const settings = await supabase
        .from('user_settings')
        .update({ weight_unit: weightUnit, length_unit: lengthUnit, timezone: tz.data })
        .eq('owner_id', state.userId);
      if (settings.error) throw settings.error;
      let note = 'Saved.';
      if (targetDays !== latestGoal(account)) {
        const goal = await supabase.rpc('schedule_weekly_goal', { p_target_days: targetDays });
        if (goal.error) throw goal.error;
        note = `Saved. New weekly goal starts the week of ${goal.data}.`;
      }
      await refresh();
      setMessage({ text: note, tone: 'info' });
    } catch (e) {
      setMessage({ text: friendlyError(e), tone: 'error' });
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
      'Some workouts or plans on this device have not reached the server yet. Signing out with "Discard" deletes them from this device.',
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
      {state.stale ? (
        <ThemedText type="small" themeColor="textSecondary">
          Offline: showing saved settings. Changes need a connection.
        </ThemedText>
      ) : null}
      <ThemedText>@{account.profile.handle}</ThemedText>
      <AvatarPicker userId={account.profile.id} avatarPath={account.profile.avatarPath} onChanged={refresh} />
      <Link href="/coach-draft/profile" accessibilityRole="button" style={linkTarget}>
        <ThemedText type="linkPrimary">Training profile (private)</ThemedText>
      </Link>
      <Link href="/sync-status" accessibilityRole="button" style={linkTarget}>
        <ThemedText type="linkPrimary">Sync status</ThemedText>
      </Link>
      <TextField label="Display name" value={displayName} onChangeText={setDisplayName} />
      <Choice label="Profile visibility" options={VISIBILITY} value={visibility} onChange={setVisibility} />
      <Choice label="Weight unit" options={WEIGHT_UNITS} value={weightUnit} onChange={setWeightUnit} />
      <Choice label="Height unit" options={LENGTH_UNITS} value={lengthUnit} onChange={setLengthUnit} />
      <TextField label="Time zone" value={timezone} onChangeText={setTimezone} autoCapitalize="none" autoCorrect={false} />
      <Choice label="Weekly goal (applies from next week)" options={TARGET_DAYS} value={targetDays} onChange={setTargetDays} />
      <FormMessage text={message?.text} tone={message?.tone} />
      <Button label="Save" onPress={save} busy={busy} />
      <Button label="Sign out" variant="secondary" onPress={confirmSignOut} busy={busy} />
    </FormScreen>
  );
}
