-- account_settings sync aggregate (PROFILE-02, SETTINGS-01, AUTH-02, NFR-09, supersedes D-28): revisions,
-- receipts, conflicts, frozen weekly goals for offline-queued changes, ownership, pull isolation.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a@test.local'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'b@test.local');

create temp table r (k text primary key, v jsonb);
grant all on r to authenticated;

-- Account-settings document for A with the given fields; weeklyGoals = [requested goal].
create function pg_temp.doc(p_name text, p_vis text, p_tz text, p_week date, p_days int) returns jsonb
language sql as $$
  select jsonb_build_object('id', 'aaaaaaaa-0000-4000-8000-000000000001', 'displayName', p_name,
    'visibility', p_vis, 'weightUnit', 'lb', 'lengthUnit', 'cm', 'timezone', p_tz,
    'weeklyGoals', jsonb_build_array(jsonb_build_object('effectiveWeek', p_week, 'targetDays', p_days, 'timezone', p_tz)))
$$;
create function pg_temp.op(p_op text, p_base int, p_doc jsonb, p_id text default 'aaaaaaaa-0000-4000-8000-000000000001',
  p_action text default 'upsert') returns jsonb
language sql as $$
  select jsonb_build_object('opId', p_op, 'aggregateType', 'account_settings', 'aggregateId', p_id,
    'action', p_action, 'baseRevision', p_base, 'doc', p_doc)
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- ----------------------------------------------------------------- A
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select public.complete_onboarding('alice', 'Alice', 'kg', 'cm', 'UTC', 3::smallint);
select is((select revision from public.user_settings), 2, 'onboarding creates account settings (settings insert + first goal)');
select is(
  (select array_agg(array[aggregate_type, revision::text]) from public.server_change_log),
  array[array['account_settings', '2']], 'onboarding logs one account_settings change');

insert into r values ('pull0', public.sync_pull(0, 500) -> 'changes' -> 0 -> 'doc');
select is((select v from r where k = 'pull0'),
  jsonb_build_object('id', 'aaaaaaaa-0000-4000-8000-000000000001', 'displayName', 'Alice', 'visibility', 'private',
    'weightUnit', 'kg', 'lengthUnit', 'cm', 'timezone', 'UTC',
    'weeklyGoals', jsonb_build_array(jsonb_build_object('effectiveWeek', public.week_start(now(), 'UTC'),
      'targetDays', 3, 'timezone', 'UTC'))),
  'pull returns the whole settings document');

-- Offline edit queued two weeks ago: goal "from next week" (relative to the edit) is now in the past.
insert into r values ('apply', public.sync_push(pg_temp.op('a1000000-0000-4000-8000-000000000001', 2,
  pg_temp.doc('Ali', 'public', 'UTC', public.week_start(now(), 'UTC') - 7, 5))));
select is((select v from r where k = 'apply'),
  '{"status":"applied","opId":"a1000000-0000-4000-8000-000000000001","revision":3,"deleted":false}'::jsonb,
  'upsert on the current base applies at revision 3 (one bump for profile + settings + goal)');
select is((select array[display_name, visibility::text] from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'), array['Ali', 'public'],
  'display name and visibility applied');
select is((select weight_unit::text from public.user_settings), 'lb', 'units applied');
select is(
  (select array_agg(array[(effective_week - public.week_start(now(), 'UTC'))::text, target_days::text] order by effective_week)
     from public.weekly_goals),
  array[array['0', '3'], array['7', '5']],
  'a stale requested week is moved to next week; the current week stays frozen');

-- Lost acknowledgement / same op id re-sent (even with another payload): receipt, no new effect.
select is(public.sync_push(pg_temp.op('a1000000-0000-4000-8000-000000000001', 2,
  pg_temp.doc('Hijack', 'private', 'UTC', public.week_start(now(), 'UTC') + 7, 1))) ->> 'status',
  'duplicate', 'repeated op id returns the stored receipt');
select is((select array[display_name, revision::text] from public.profiles, public.user_settings where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  array['Ali', '3'], 'repeated op id never applies a different payload');

-- Stale base revision: conflict with the server copy (no last-write-wins).
insert into r values ('stale', public.sync_push(pg_temp.op('a1000000-0000-4000-8000-000000000002', 2,
  pg_temp.doc('Other', 'private', 'UTC', public.week_start(now(), 'UTC') + 7, 2))));
select is((select array[v ->> 'status', v ->> 'serverRevision', v -> 'serverDoc' ->> 'displayName'] from r where k = 'stale'),
  array['conflict', '3', 'Ali'], 'stale base returns conflict with the server document');
select is((select display_name from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'), 'Ali', 'conflict changed nothing');

-- Goal requested for a later future week is kept.
select is(public.sync_push(pg_temp.op('a1000000-0000-4000-8000-000000000003', 3,
  pg_temp.doc('Ali', 'public', 'UTC', public.week_start(now(), 'UTC') + 14, 6))) ->> 'revision',
  '4', 'future goal request applies');
select is(
  (select target_days::int from public.weekly_goals where effective_week = public.week_start(now(), 'UTC') + 14),
  6, 'goal starts at the requested future week');
select is(
  (select target_days::int from public.weekly_goals where effective_week = public.week_start(now(), 'UTC') + 7),
  5, 'next week keeps the previously scheduled goal');

-- Unchanged document: applied without a new revision.
select is(public.sync_push(pg_temp.op('a1000000-0000-4000-8000-000000000004', 4,
  pg_temp.doc('Ali', 'public', 'UTC', public.week_start(now(), 'UTC') + 14, 6))) ->> 'revision',
  '4', 'no-op upsert keeps the revision');

-- Timezone change: carried forward from the next week boundary only.
select is(public.sync_push(pg_temp.op('a1000000-0000-4000-8000-000000000005', 4,
  pg_temp.doc('Ali', 'public', 'Asia/Tokyo', public.week_start(now(), 'UTC') + 14, 6))) ->> 'revision',
  '5', 'timezone change applies');
select is((select timezone from public.weekly_goals where effective_week = public.week_start(now(), 'UTC')),
  'UTC', 'current week keeps its timezone');

-- Rejections leave everything untouched and are not receipted.
select is(public.sync_push(pg_temp.op('a1000000-0000-4000-8000-000000000006', 5,
  pg_temp.doc('Ali', 'public', 'Mars/Olympus', public.week_start(now(), 'UTC') + 14, 6))) ->> 'code',
  'invalid_doc', 'invalid timezone rejected');
select is(public.sync_push(pg_temp.op('a1000000-0000-4000-8000-000000000007', 5, null,
  'aaaaaaaa-0000-4000-8000-000000000001', 'delete')) ->> 'code', 'invalid_doc', 'account settings cannot be deleted');
select is(public.sync_push(pg_temp.op('a1000000-0000-4000-8000-000000000008', 1,
  pg_temp.doc('Ali', 'public', 'UTC', public.week_start(now(), 'UTC') + 7, 2) || '{"id":"bbbbbbbb-0000-4000-8000-000000000002"}',
  'bbbbbbbb-0000-4000-8000-000000000002')) ->> 'code', 'forbidden', 'another account''s settings are forbidden');
select is((select revision from public.user_settings), 5, 'rejections did not bump the revision');

-- Writes outside sync_push (old clients, RPCs) still bump the revision once and reach the change log.
update public.profiles set display_name = 'Alice B', visibility = 'private' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
select is(
  (select array[s.revision::text, c.revision::text] from public.user_settings s, public.server_change_log c
    where c.aggregate_type = 'account_settings'),
  array['6', '6'], 'direct write bumps the revision once and logs it');

-- ----------------------------------------------------------------- B
reset role;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

select is(public.sync_pull(0, 500) -> 'changes', '[]'::jsonb, 'B pulls nothing of A');
select is(public.sync_push(pg_temp.op('b1000000-0000-4000-8000-000000000001', null,
  pg_temp.doc('x', 'public', 'UTC', public.week_start(now(), 'UTC') + 7, 2) || '{"id":"bbbbbbbb-0000-4000-8000-000000000002"}',
  'bbbbbbbb-0000-4000-8000-000000000002')) ->> 'code', 'not_onboarded', 'settings push requires onboarding');

reset role;
select * from finish();
rollback;
