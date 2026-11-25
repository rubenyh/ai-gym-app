import { useState } from 'react';

import { Button, Choice, FormMessage, FormScreen, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { supabase } from '@/services/supabase/client';

import { useAccount } from './account-provider';
import { friendlyError } from './errors';
import { deviceTimeZone, fieldErrors, onboardingSchema } from './validation';

export const WEIGHT_UNITS = [
  { value: 'kg', label: 'kg' },
  { value: 'lb', label: 'lb' },
] as const;
export const LENGTH_UNITS = [
  { value: 'cm', label: 'cm' },
  { value: 'ft_in', label: 'ft / in' },
] as const;
export const TARGET_DAYS = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: String(n) }));

/** Basic onboarding (docs/SCREENS_AND_FLOWS.md#first-use). The training profile stays optional. */
export function OnboardingScreen() {
  const { refresh } = useAccount();
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>('kg');
  const [lengthUnit, setLengthUnit] = useState<'cm' | 'ft_in'>('cm');
  const [timezone, setTimezone] = useState(deviceTimeZone);
  const [targetDays, setTargetDays] = useState(3);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const parsed = onboardingSchema.safeParse({ handle, displayName, weightUnit, lengthUnit, timezone, targetDays });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    setBusy(true);
    const v = parsed.data;
    // One transactional RPC: profile, settings and the first weekly goal (or nothing).
    const { error } = await supabase.rpc('complete_onboarding', {
      p_handle: v.handle,
      p_display_name: v.displayName,
      p_weight_unit: v.weightUnit,
      p_length_unit: v.lengthUnit,
      p_timezone: v.timezone,
      p_target_days: v.targetDays,
    });
    setBusy(false);
    if (error) return setErrors({ form: friendlyError(error) });
    await refresh();
  };

  return (
    <FormScreen title="Welcome">
      <TextField label="Handle" value={handle} onChangeText={setHandle} error={errors.handle}
        autoCapitalize="none" autoCorrect={false} placeholder="e.g. lifter_ana" />
      <TextField label="Display name" value={displayName} onChangeText={setDisplayName} error={errors.displayName} />
      <Choice label="Weight unit" options={WEIGHT_UNITS} value={weightUnit} onChange={setWeightUnit} />
      <Choice label="Height unit" options={LENGTH_UNITS} value={lengthUnit} onChange={setLengthUnit} />
      <TextField label="Time zone" value={timezone} onChangeText={setTimezone} error={errors.timezone}
        autoCapitalize="none" autoCorrect={false} />
      <Choice label="Weekly goal (training days)" options={TARGET_DAYS} value={targetDays} onChange={setTargetDays} />
      <ThemedText type="small" themeColor="textSecondary">
        Your profile starts private. You can change visibility, units and goal later in Settings.
      </ThemedText>
      <FormMessage text={errors.form} />
      <Button label="Continue" onPress={submit} busy={busy} />
    </FormScreen>
  );
}
