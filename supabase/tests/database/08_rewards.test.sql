-- Rewards (GAME-01, SESSION-04): save/edit/delete/restore never multiplies XP; weekly bonus follows the frozen
-- goal week (timezone + target); unlocks are permanent; clients cannot write reward tables.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a@test.local'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'b@test.local');

-- Frozen goal history (inserted as the migration owner: past weeks cannot be written by clients).
-- No goal before 2026-11-02. 2026-11-02: 2 days in UTC. From 2026-11-09: 1 day in UTC+14.
insert into public.weekly_goals (owner_id, effective_week, target_days, timezone) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '2026-11-02', 2, 'UTC'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '2026-11-09', 1, 'Pacific/Kiritimati');

create function pg_temp.sess(p_id text, p_completed_at text, p_done boolean) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'routineId', null, 'name', 'Legs', 'status', 'completed',
    'startedAt', p_completed_at, 'completedAt', p_completed_at, 'timezone', 'UTC', 'localDate', left(p_completed_at, 10),
    'notes', 'private', 'exercises', jsonb_build_array(jsonb_build_object(
      'id', '0e000000-0000-4000-8000-000000000001', 'position', 0, 'exerciseKey', 'catalog:0043', 'exerciseName', 'Squat',
      'notes', '', 'restSeconds', null, 'sets', jsonb_build_array(jsonb_build_object(
        'id', '0f000000-0000-4000-8000-000000000001', 'position', 0, 'targetReps', 5, 'targetLoadGrams', 100000,
        'reps', 5, 'loadGrams', 100000, 'loadMode', 'external', 'completed', p_done, 'completedAt', null)))))
$$;
-- push(op suffix, session id, action, base, doc)
create function pg_temp.push(p_n int, p_id text, p_action text, p_base int, p_doc jsonb) returns jsonb language sql as $$
  select public.sync_push(jsonb_build_object('opId', format('a0000000-0000-4000-8000-%s', lpad(p_n::text, 12, '0')),
    'aggregateType', 'session', 'aggregateId', p_id, 'action', p_action, 'baseRevision', p_base, 'doc', p_doc))
$$;
create function pg_temp.xp() returns int language sql as $$ select (public.get_reward_summary() ->> 'totalXp')::int $$;
grant execute on all functions in schema pg_temp to authenticated;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select is(public.get_reward_summary() -> 'petStages' -> 0 ->> 'stage', '1', 'pet stage 1 unlocked on first summary');

-- s1: Tue 2026-11-03
select pg_temp.push(1, '20000000-0000-4000-8000-000000000001', 'upsert', null,
  pg_temp.sess('20000000-0000-4000-8000-000000000001', '2026-11-03T10:00:00Z', true));
select is(pg_temp.xp(), 100, 'qualifying session awards 100 XP');
select is(public.get_reward_summary() -> 'awardedSessionIds', '["20000000-0000-4000-8000-000000000001"]',
  'awardedSessionIds lists the awarded session');
select pg_temp.push(1, '20000000-0000-4000-8000-000000000001', 'upsert', null,
  pg_temp.sess('20000000-0000-4000-8000-000000000001', '2026-11-03T10:00:00Z', true));
select pg_temp.push(2, '20000000-0000-4000-8000-000000000001', 'upsert', 1,
  pg_temp.sess('20000000-0000-4000-8000-000000000001', '2026-11-03T10:00:00Z', true));
select is(pg_temp.xp(), 100, 'duplicate push and re-save earn nothing extra');

select pg_temp.push(3, '20000000-0000-4000-8000-000000000001', 'upsert', 2,
  pg_temp.sess('20000000-0000-4000-8000-000000000001', '2026-11-03T10:00:00Z', false));
select is(pg_temp.xp(), 0, 'removing all completed sets revokes the award');
select pg_temp.push(4, '20000000-0000-4000-8000-000000000001', 'upsert', 3,
  pg_temp.sess('20000000-0000-4000-8000-000000000001', '2026-11-03T10:00:00Z', true));
select is(pg_temp.xp(), 100, 'correcting it back restores the same award');
select pg_temp.push(5, '20000000-0000-4000-8000-000000000001', 'delete', 4, null);
select is(pg_temp.xp(), 0, 'deleting the session revokes the award');
select pg_temp.push(6, '20000000-0000-4000-8000-000000000001', 'upsert', 5,
  pg_temp.sess('20000000-0000-4000-8000-000000000001', '2026-11-03T10:00:00Z', true));
select is(pg_temp.xp(), 100, 'restoring the session restores the award');
select is((select count(*)::int from public.reward_events where reason = 'session_completed'), 1,
  'one reward event per session after all corrections');
select is((select array_agg(action order by id) from public.reward_event_log),
  array['award', 'revoke', 'restore', 'revoke', 'restore'], 'every correction is audited');

-- s2 same day: XP yes, but one distinct day < target 2
select pg_temp.push(7, '20000000-0000-4000-8000-000000000002', 'upsert', null,
  pg_temp.sess('20000000-0000-4000-8000-000000000002', '2026-11-03T20:00:00Z', true));
select is(pg_temp.xp(), 200, 'second session the same day earns session XP');
select is((select count(*)::int from public.reward_events where reason = 'weekly_goal'), 0,
  'two sessions on one day are one consistency day');

-- s3 Thu: 2 distinct days -> weekly bonus once
select pg_temp.push(8, '20000000-0000-4000-8000-000000000003', 'upsert', null,
  pg_temp.sess('20000000-0000-4000-8000-000000000003', '2026-11-05T09:00:00Z', true));
select is(pg_temp.xp(), 400, 'reaching the weekly target adds the 100 XP weekly bonus');
select is((select source_id from public.reward_events where reason = 'weekly_goal' and active), '2026-11-02',
  'weekly bonus is keyed by the goal week');
select is((select count(*)::int from public.achievement_unlocks where badge_id in ('first_workout', 'first_weekly_goal')), 2,
  'first_workout and first_weekly_goal badges unlocked');

select pg_temp.push(9, '20000000-0000-4000-8000-000000000003', 'delete', 1, null);
select is(pg_temp.xp(), 200, 'deleting a session below the target revokes the weekly bonus');
select ok(exists (select 1 from public.achievement_unlocks where badge_id = 'first_weekly_goal'),
  'badge stays unlocked after the source is revoked');
select pg_temp.push(10, '20000000-0000-4000-8000-000000000003', 'upsert', 2,
  pg_temp.sess('20000000-0000-4000-8000-000000000003', '2026-11-05T09:00:00Z', true));
select is(pg_temp.xp(), 400, 'restoring the session restores the weekly bonus');
select is((select count(*)::int from public.reward_events where reason = 'weekly_goal'), 1, 'weekly bonus never duplicated');

-- Weeks before the first goal never count.
select pg_temp.push(11, '20000000-0000-4000-8000-000000000004', 'upsert', null,
  pg_temp.sess('20000000-0000-4000-8000-000000000004', '2026-10-27T09:00:00Z', true));
select pg_temp.push(12, '20000000-0000-4000-8000-000000000005', 'upsert', null,
  pg_temp.sess('20000000-0000-4000-8000-000000000005', '2026-10-28T09:00:00Z', true));
select is((select count(*)::int from public.reward_events where reason = 'weekly_goal'), 1,
  'week without a goal earns no bonus');

-- Frozen timezone: 2026-11-15T12:00Z is Monday 2026-11-16 02:00 in Pacific/Kiritimati (goal zone from 11-09).
select pg_temp.push(13, '20000000-0000-4000-8000-000000000006', 'upsert', null,
  pg_temp.sess('20000000-0000-4000-8000-000000000006', '2026-11-15T12:00:00Z', true));
select ok(exists (select 1 from public.reward_events where reason = 'weekly_goal' and source_id = '2026-11-16' and active),
  'week boundaries come from the frozen goal timezone, not UTC');

select is(
  (select array[v ->> 'totalXp', v ->> 'level', v ->> 'xpIntoLevel', v ->> 'xpForNextLevel', v ->> 'qualifyingSessions']
     from public.get_reward_summary() v),
  array['800', '4', '50', '350', '6'], 'summary derives level from cumulative XP (200*(n-1)+25*(n-1)*(n-2))');

-- clients cannot write reward tables
select throws_ok($$insert into public.reward_events (owner_id, source_type, source_id, reason, rule_version, xp, active)
  values ('aaaaaaaa-0000-4000-8000-000000000001', 'session', 'x', 'session_completed', 1, 100000, true)$$,
  '42501', null, 'client cannot insert reward events');
select throws_ok($$update public.reward_events set xp = 100000$$, '42501', null, 'client cannot update reward events');
select throws_ok($$delete from public.pet_unlocks$$, '42501', null, 'client cannot delete pet unlocks');

reset role;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.reward_events) + (select count(*)::int from public.achievement_unlocks),
  0, 'B cannot read A rewards');
select is(public.get_reward_summary() ->> 'totalXp', '0', 'B summary only counts B');

-- Pet stages are permanent: reach level 5 (1100 XP) then lose it.
reset role;
insert into public.reward_events (owner_id, source_type, source_id, reason, rule_version, xp, active)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'session', 'bonus-fixture', 'session_completed', 1, 300, true);
select private.refresh_unlocks('aaaaaaaa-0000-4000-8000-000000000001', public.get_reward_rules());
update public.reward_events set active = false where source_id = 'bonus-fixture';
select private.refresh_unlocks('aaaaaaaa-0000-4000-8000-000000000001', public.get_reward_rules());
select is((select array_agg(stage::int order by stage) from public.pet_unlocks
            where owner_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  array[1, 2], 'pet stage 2 (level 5) stays unlocked after XP drops');

select * from finish();
rollback;
