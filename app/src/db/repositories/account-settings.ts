/**
 * `account_settings` aggregate (PROFILE-02, SETTINGS-01, supersedes D-28): display name, visibility, units,
 * timezone and weekly goal are edited offline and synced through the outbox like training data. The local
 * goal rows mirror the server rules (supabase/migrations/20261125180000_account_settings_sync.sql) for the
 * provisional view; the pulled server document wins once synced.
 */
import { accountSettingsDoc, type WeeklyGoalEntry } from '@/domain/contracts';
import type { AccountSettingsRepository } from '@/domain/repositories';

import * as s from '../schema';
import { enqueue, parse, syncMetaFor, type RepoCtx } from './context';
import { readAccountSettings, writeDoc } from './docs';
import { NotFoundError } from './errors';
import { localDateIn } from './sessions';

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Monday (YYYY-MM-DD) of the local week containing `at` in `timeZone` (server `week_start`). */
export function weekStartIn(at: Date, timeZone: string): string {
  const day = localDateIn(at, timeZone);
  return addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
}

/** Upserts `entry` by week and keeps the list ascending. */
function put(goals: WeeklyGoalEntry[], entry: WeeklyGoalEntry): WeeklyGoalEntry[] {
  return [...goals.filter((g) => g.effectiveWeek !== entry.effectiveWeek), entry].sort((a, b) => a.effectiveWeek.localeCompare(b.effectiveWeek));
}

export function createAccountSettingsRepository(ctx: RepoCtx): AccountSettingsRepository {
  const { db } = ctx;
  const root = () => db.select({ id: s.accountProfile.id, rev: s.accountProfile.serverRevision }).from(s.accountProfile).get();

  return {
    get() {
      const r = root();
      const doc = r ? readAccountSettings(db, r.id) : null;
      return r && doc ? { ...doc, ...syncMetaFor(db, 'account_settings')(r.id, r.rev) } : null;
    },

    save(input) {
      const r = root();
      const cur = r ? readAccountSettings(db, r.id) : null;
      if (!cur) throw new NotFoundError('Account');
      const now = ctx.now();
      let goals = cur.weeklyGoals;
      // Both zones' next Monday, so the change is in the future in either (server carry_goal_timezone).
      const nextWeek = [cur.timezone, input.timezone].map((tz) => addDays(weekStartIn(now, tz), 7)).sort().at(-1)!;
      if (input.timezone !== cur.timezone) {
        const inForce = goals.filter((g) => g.effectiveWeek <= nextWeek).at(-1);
        if (inForce) goals = put(goals, { effectiveWeek: nextWeek, targetDays: inForce.targetDays, timezone: input.timezone });
      }
      if (input.targetDays !== goals.at(-1)?.targetDays) {
        goals = put(goals, { effectiveWeek: nextWeek, targetDays: input.targetDays, timezone: input.timezone }).map((g) =>
          g.effectiveWeek > nextWeek ? { ...g, targetDays: input.targetDays } : g,
        );
      }
      const { targetDays: _t, ...fields } = input;
      const doc = parse(accountSettingsDoc, { ...cur, ...fields, weeklyGoals: goals }, 'settings');
      if (JSON.stringify(doc) === JSON.stringify(cur)) return cur;
      return ctx.mutate((tx) => {
        writeDoc(tx, 'account_settings', doc, now.toISOString());
        enqueue(ctx, tx, 'account_settings', doc.id, 'upsert');
        return doc;
      });
    },
  };
}
