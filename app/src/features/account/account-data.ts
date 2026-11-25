import type { AccountDb } from '@/db/account-db';
import { accountProfile, userSettings, weeklyGoals } from '@/db/schema';
import { supabase } from '@/services/supabase/client';

/** Server-owned account snapshot cached locally for offline start (AUTH-02). */
export type AccountSnapshot = {
  profile: {
    id: string;
    handle: string;
    displayName: string;
    visibility: 'public' | 'private';
    avatarPath: string | null;
    updatedAt: string;
  };
  settings: { weightUnit: 'kg' | 'lb'; lengthUnit: 'cm' | 'ft_in'; timezone: string; updatedAt: string };
  goals: { effectiveWeek: string; targetDays: number; timezone: string }[];
};

/** null = signed in but onboarding not completed. Throws on network/server failure. */
export async function fetchRemoteAccount(userId: string): Promise<AccountSnapshot | null> {
  const [profile, settings, goals] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('user_settings').select('*').maybeSingle(),
    supabase.from('weekly_goals').select('*').order('effective_week'),
  ]);
  const error = profile.error ?? settings.error ?? goals.error;
  if (error) throw error;
  // complete_onboarding creates all three atomically, so a profile implies settings.
  if (!profile.data || !settings.data) return null;
  return {
    profile: {
      id: profile.data.id,
      handle: profile.data.handle,
      displayName: profile.data.display_name,
      visibility: profile.data.visibility,
      avatarPath: profile.data.avatar_path,
      updatedAt: profile.data.updated_at,
    },
    settings: {
      weightUnit: settings.data.weight_unit,
      lengthUnit: settings.data.length_unit,
      timezone: settings.data.timezone,
      updatedAt: settings.data.updated_at,
    },
    goals: (goals.data ?? []).map((g) => ({
      effectiveWeek: g.effective_week,
      targetDays: g.target_days,
      timezone: g.timezone,
    })),
  };
}

/** Replaces the local cache with the server snapshot in one transaction. */
export async function cacheAccount(db: AccountDb, snapshot: AccountSnapshot): Promise<void> {
  // expo-sqlite's Drizzle transaction is synchronous: an async callback would let writes escape it.
  db.transaction((tx) => {
    tx.delete(accountProfile).run();
    tx.insert(accountProfile).values(snapshot.profile).run();
    tx.delete(userSettings).run();
    tx.insert(userSettings).values({ id: 1, ...snapshot.settings }).run();
    tx.delete(weeklyGoals).run();
    if (snapshot.goals.length) tx.insert(weeklyGoals).values(snapshot.goals).run();
  });
}

export async function readCachedAccount(db: AccountDb): Promise<AccountSnapshot | null> {
  const [profile] = await db.select().from(accountProfile).limit(1);
  const [settings] = await db.select().from(userSettings).limit(1);
  if (!profile || !settings) return null;
  const goals = await db.select().from(weeklyGoals).orderBy(weeklyGoals.effectiveWeek);
  const { id: _id, ...settingsFields } = settings;
  return { profile, settings: settingsFields, goals };
}
