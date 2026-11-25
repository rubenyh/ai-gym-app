-- Security hardening from the M1-M6 review (NFR-04, NFR-05, SOCIAL-03/04, PROFILE-02).
-- Tests: supabase/tests/database/12_security_regressions.test.sql, supabase/tests/api/security-regressions.test.mjs.

-- 1. has_weekly_goal(uid) is security definer and callable over /rest/v1/rpc: any signed-in user could ask
--    whether another account has a weekly goal (onboarding oracle). It only exists for the weekly_goals insert
--    policy, which passes auth.uid(); answer for the caller only.
create or replace function public.has_weekly_goal(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select uid = (select auth.uid()) and exists (select 1 from public.weekly_goals where owner_id = uid)
$$;

-- 2. Avatars were readable by every signed-in user, including blocked accounts (both directions).
--    Blocking hides identity both ways (docs/DATA_AND_SYNC.md#social-permissions), so the avatar too.
create function private.can_view_avatar(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and not exists (
    select 1 from public.blocks b
     where (b.blocker_id = (select auth.uid()) and b.blocked_id::text = (storage.foldername(p_name))[1])
        or (b.blocked_id = (select auth.uid()) and b.blocker_id::text = (storage.foldername(p_name))[1]))
$$;
revoke execute on function private.can_view_avatar(text) from public;
grant execute on function private.can_view_avatar(text) to authenticated;

drop policy avatars_select_signed_in on storage.objects;
create policy avatars_select_unblocked on storage.objects
  for select to authenticated using (bucket_id = 'avatars' and private.can_view_avatar(name));

-- 3. Supabase default privileges grant anon EXECUTE on every new public function and ALL on sequences.
--    Nothing in this app is callable signed out: remove the leftovers and stop future ones.
revoke execute on function public.is_valid_timezone(text), public.week_start(timestamptz, text),
  public.set_updated_at(), public.carry_goal_timezone() from public, anon;
-- Trigger functions are never called directly (trigger firing does not check EXECUTE).
revoke execute on function public.set_updated_at(), public.carry_goal_timezone() from authenticated;
-- Sequences are only used by security definer reward functions (owner privileges).
revoke all on sequence public.reward_events_id_seq, public.reward_event_log_id_seq from anon, authenticated;

alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon;
