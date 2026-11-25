-- Performance indexes (review 2026-11-25).
--
-- private.reconcile_week (20261125140000_m4_rewards.sql) counts a user's sessions with
--   owner_id = p_owner and coalesce(completed_at, started_at) between p_week - 2 and p_week + 9
-- on every session write. sessions_owner_completed_idx (owner_id, completed_at) only narrows by owner,
-- so the check scanned the owner's whole history. This expression index makes it a range scan.
-- `if not exists` keeps the migration re-runnable.
create index if not exists sessions_owner_activity_ts_idx
  on public.sessions (owner_id, (coalesce(completed_at, started_at)));
