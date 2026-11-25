import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Local account database (one SQLite file per signed-in account, docs/DECISIONS.md D-10).
 * M1 caches the account's identity, settings and weekly-goal history so a previously
 * authenticated user can open the app offline (AUTH-02). Server rows are authoritative.
 * Training tables and the outbox arrive in M2.
 */

export const accountProfile = sqliteTable('account_profile', {
  id: text('id').primaryKey(),
  handle: text('handle').notNull(),
  displayName: text('display_name').notNull(),
  visibility: text('visibility', { enum: ['public', 'private'] }).notNull(),
  avatarPath: text('avatar_path'),
  updatedAt: text('updated_at').notNull(),
});

/** Single row (id = 1). */
export const userSettings = sqliteTable('user_settings', {
  id: integer('id').primaryKey(),
  weightUnit: text('weight_unit', { enum: ['kg', 'lb'] }).notNull(),
  lengthUnit: text('length_unit', { enum: ['cm', 'ft_in'] }).notNull(),
  timezone: text('timezone').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const weeklyGoals = sqliteTable('weekly_goals', {
  /** ISO date (Monday) the target applies from. */
  effectiveWeek: text('effective_week').primaryKey(),
  targetDays: integer('target_days').notNull(),
  timezone: text('timezone').notNull(),
});
