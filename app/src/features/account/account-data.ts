import { and, eq, inArray } from 'drizzle-orm';

import type { AccountDb } from '@/db/account-db';
import { accountProfile, outbox, syncConflicts, userSettings, weeklyGoals } from '@/db/schema';
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
  /** `revision` = server revision of the `account_settings` aggregate (absent in local reads). */
  settings: { weightUnit: 'kg' | 'lb'; lengthUnit: 'cm' | 'ft_in'; timezone: string; updatedAt: string; revision?: number };
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
      revision: settings.data.revision,
    },
    goals: (goals.data ?? []).map((g) => ({
      effectiveWeek: g.effective_week,
      targetDays: g.target_days,
      timezone: g.timezone,
    })),
  };
}

/**
 * Refreshes the local cache from a server snapshot in one transaction. Handle and avatar (online-only) are
 * always taken from the server. The offline-editable fields (account_settings aggregate) are NOT overwritten
 * while that aggregate has unsynced ops or a conflict, nor by a snapshot older than the revision already
 * applied by a pull.
 */
export async function cacheAccount(db: AccountDb, snapshot: AccountSnapshot): Promise<void> {
  // expo-sqlite's Drizzle transaction is synchronous: an async callback would let writes escape it.
  db.transaction((tx) => {
    const { revision, ...settings } = snapshot.settings;
    const local = tx.select().from(accountProfile).where(eq(accountProfile.id, snapshot.profile.id)).get();
    const unsynced =
      !!tx
        .select({ seq: outbox.seq })
        .from(outbox)
        .where(and(eq(outbox.aggregateType, 'account_settings'), inArray(outbox.status, ['pending', 'inflight', 'conflict', 'failed'])))
        .get() || !!tx.select({ id: syncConflicts.aggregateId }).from(syncConflicts).where(eq(syncConflicts.aggregateType, 'account_settings')).get();
    const older = local?.serverRevision != null && (revision ?? 0) < local.serverRevision;
    if (local && (unsynced || older)) {
      tx.update(accountProfile).set({ handle: snapshot.profile.handle, avatarPath: snapshot.profile.avatarPath }).where(eq(accountProfile.id, local.id)).run();
      return;
    }
    tx.delete(accountProfile).run();
    tx.insert(accountProfile).values({ ...snapshot.profile, serverRevision: revision ?? null }).run();
    tx.delete(userSettings).run();
    tx.insert(userSettings).values({ id: 1, ...settings }).run();
    tx.delete(weeklyGoals).run();
    if (snapshot.goals.length) tx.insert(weeklyGoals).values(snapshot.goals).run();
  });
}

/** Local view of the account, including unsynced settings edits. */
export async function readCachedAccount(db: AccountDb): Promise<AccountSnapshot | null> {
  const [p] = await db.select().from(accountProfile).limit(1);
  const [st] = await db.select().from(userSettings).limit(1);
  if (!p || !st) return null;
  const goals = await db.select().from(weeklyGoals).orderBy(weeklyGoals.effectiveWeek);
  return {
    profile: { id: p.id, handle: p.handle, displayName: p.displayName, visibility: p.visibility, avatarPath: p.avatarPath, updatedAt: p.updatedAt },
    settings: { weightUnit: st.weightUnit, lengthUnit: st.lengthUnit, timezone: st.timezone, updatedAt: st.updatedAt },
    goals,
  };
}
