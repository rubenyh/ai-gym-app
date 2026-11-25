-- Coach hardening (20261125200000): late results never flip cancelled drafts, approval revalidates the edited
-- command against the stored draft and its base, atomic daily cap, lowered hourly limit, stale pending expiry.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (id, email) values ('aaaaaaaa-0000-4000-8000-0000000000d1', 'hard-a@test.local');

create temp table r (k text primary key, v jsonb);
grant all on r to authenticated;
-- Today's global usage before this test (other runs may have committed rows).
insert into r select 'used0', to_jsonb(coalesce((select requests from private.coach_daily_usage
  where day = (now() at time zone 'utc')::date), 0));

create function pg_temp.content() returns jsonb language sql as $$
  select '{"title":"Plan","explanation":"x","assumptions":[],"days":[
    {"weekday":1,"routineName":"A","exercises":[{"exerciseKey":"catalog:0001","exerciseName":"Push-up","sets":3,"repsMin":8,"repsMax":12,"restSeconds":90}]},
    {"weekday":3,"routineName":"B","exercises":[{"exerciseKey":"catalog:0002","exerciseName":"Squat","sets":3,"repsMin":8,"repsMax":12,"restSeconds":90}]}]}'::jsonb
$$;
-- One-day approval command; parameters let each test break exactly one rule.
create function pg_temp.approval(p_approval uuid, p_draft text, p_base_id uuid, p_base_rev int, p_program uuid,
  p_routine uuid, p_weekday int default 1, p_key text default 'catalog:0001', p_sets int default 3,
  p_load int default null, p_day_routine uuid default null) returns jsonb
language sql as $$
  select jsonb_build_object('opId', gen_random_uuid(), 'aggregateType', 'coach_approval', 'aggregateId', p_approval,
    'action', 'upsert', 'baseRevision', null, 'doc', jsonb_build_object(
      'approvalId', p_approval, 'draftId', p_draft, 'baseProgramId', p_base_id, 'baseProgramRevision', p_base_rev,
      'program', jsonb_build_object('id', p_program, 'name', 'Coach plan', 'active', true, 'origin', 'coach',
        'coachDraftId', p_draft, 'days', jsonb_build_array(jsonb_build_object('weekday', p_weekday,
          'routineId', coalesce(p_day_routine, p_routine)))),
      'routines', jsonb_build_array(jsonb_build_object('id', p_routine, 'name', 'A', 'notes', '', 'archived', false,
        'origin', 'coach', 'exercises', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'position', 0,
          'exerciseKey', p_key, 'exerciseName', 'Push-up', 'notes', '', 'restSeconds', 90,
          'sets', coalesce((select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'position', i, 'targetReps', 10,
            'targetLoadGrams', p_load, 'loadMode', 'bodyweight')) from generate_series(1, p_sets) i), '[]'::jsonb)))))))
$$;
create function pg_temp.draft(p_key text) returns text language sql as $$ select v -> 'draft' ->> 'draftId' from r where k = p_key $$;
create function pg_temp.push_code(p_op jsonb) returns text language sql as $$
  select coalesce(x ->> 'code', x ->> 'status') from public.sync_push(p_op) x
$$;
grant execute on all functions in schema pg_temp to authenticated;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;

-- Late result after cancel: stays cancelled; approval of a cancelled draft is rejected.
insert into r values ('c', public.coach_begin_request('e2000000-0000-4000-8000-000000000001', 'create', null, null, '{}'));
select public.coach_cancel_draft(pg_temp.draft('c')::uuid);
select is(public.coach_save_draft(pg_temp.draft('c')::uuid, 'ready', pg_temp.content(), null, null, 'm') ->> 'status',
  'cancelled', 'late provider result does not flip a cancelled draft');
select is((select status from public.coach_drafts where id = pg_temp.draft('c')::uuid), 'cancelled', 'cancelled draft stays cancelled');
select is(pg_temp.push_code(pg_temp.approval(gen_random_uuid(), pg_temp.draft('c'), null, null, gen_random_uuid(),
  gen_random_uuid())), 'draft_not_ready', 'cancelled draft cannot be approved');

-- First terminal write wins: a failed draft is not overwritten by a later ready result.
insert into r values ('f', public.coach_begin_request('e2000000-0000-4000-8000-000000000002', 'create', null, null, '{}'));
select public.coach_save_draft(pg_temp.draft('f')::uuid, 'failed', null, null, '{"code":"timeout","message":"t","retryable":true}', 'm');
select is(public.coach_save_draft(pg_temp.draft('f')::uuid, 'ready', pg_temp.content(), null, null, 'm') ->> 'status',
  'failed', 'late result after timeout is discarded');

-- Ready draft against "no program": edited-command revalidation.
insert into r values ('ok', public.coach_begin_request('e2000000-0000-4000-8000-000000000003', 'create', null, null, '{}'));
select public.coach_save_draft(pg_temp.draft('ok')::uuid, 'ready', pg_temp.content(), null, null, 'm');
select is(pg_temp.push_code(pg_temp.approval(gen_random_uuid(), pg_temp.draft('ok'),
  '30000000-0000-4000-8000-0000000000d9', 1, gen_random_uuid(), gen_random_uuid())),
  'stale_approval', 'approval base must equal the draft base');
select is(pg_temp.push_code(pg_temp.approval(gen_random_uuid(), pg_temp.draft('ok'), null, null, gen_random_uuid(),
  gen_random_uuid(), p_key => 'catalog:9999')), 'invalid_doc', 'exercise key outside the draft is rejected');
select is(pg_temp.push_code(pg_temp.approval(gen_random_uuid(), pg_temp.draft('ok'), null, null, gen_random_uuid(),
  gen_random_uuid(), p_weekday => 2)), 'invalid_doc', 'weekday outside the draft is rejected');
select is(pg_temp.push_code(pg_temp.approval(gen_random_uuid(), pg_temp.draft('ok'), null, null, gen_random_uuid(),
  gen_random_uuid(), p_day_routine => gen_random_uuid())), 'invalid_doc', 'day must reference a routine of the approval');
select is(pg_temp.push_code(pg_temp.approval(gen_random_uuid(), pg_temp.draft('ok'), null, null, gen_random_uuid(),
  gen_random_uuid(), p_sets => 11)), 'invalid_doc', 'more than 10 sets is rejected');
select is(pg_temp.push_code(pg_temp.approval(gen_random_uuid(), pg_temp.draft('ok'), null, null, gen_random_uuid(),
  gen_random_uuid(), p_load => 50000)), 'invalid_doc', 'invented load target is rejected');
select is((select count(*)::int from public.programs), 0, 'rejected approvals change nothing');

-- Second ready draft against the same (empty) base: only the first approval applies.
insert into r values ('ok2', public.coach_begin_request('e2000000-0000-4000-8000-000000000004', 'create', null, null, '{}'));
select public.coach_save_draft(pg_temp.draft('ok2')::uuid, 'ready', pg_temp.content(), null, null, 'm');
select is(pg_temp.push_code(pg_temp.approval(gen_random_uuid(), pg_temp.draft('ok'), null, null,
  '30000000-0000-4000-8000-0000000000d1', '10000000-0000-4000-8000-0000000000d1')), 'applied', 'valid edited approval applies');
select is(pg_temp.push_code(pg_temp.approval(gen_random_uuid(), pg_temp.draft('ok2'), null, null, gen_random_uuid(),
  gen_random_uuid())), 'conflict', 'second draft against the same base conflicts');
select is((select array_agg(id::text) from public.programs where active), array['30000000-0000-4000-8000-0000000000d1'],
  'only the first approval is active');

-- Approval never overwrites an existing snapshot.
insert into r values ('ok3', public.coach_begin_request('e2000000-0000-4000-8000-000000000005', 'adjust',
  '30000000-0000-4000-8000-0000000000d1', 1, '{}'));
select public.coach_save_draft(pg_temp.draft('ok3')::uuid, 'ready', pg_temp.content(), null, null, 'm');
select is(pg_temp.push_code(pg_temp.approval(gen_random_uuid(), pg_temp.draft('ok3'), '30000000-0000-4000-8000-0000000000d1', 1,
  gen_random_uuid(), '10000000-0000-4000-8000-0000000000d1')), 'id_conflict', 'existing routine id is not overwritten');

-- Limits: caller can only lower the hourly limit; the daily cap is global and atomic.
select throws_ok($$select public.coach_begin_request(gen_random_uuid(), 'create', null, null, '{}', 1)$$,
  'PT429', 'rate_limited', 'lowered hourly limit is enforced');
select throws_ok(format($$select public.coach_begin_request(gen_random_uuid(), 'create', null, null, '{}', null, %s)$$,
  (select (v #>> '{}')::int + 5 from r where k = 'used0')), 'PT429', 'budget_exhausted', 'daily cap is enforced');
reset role;
select is((select requests from private.coach_daily_usage where day = (now() at time zone 'utc')::date),
  (select (v #>> '{}')::int + 5 from r where k = 'used0'), 'rejected request does not consume the daily budget');

-- A pending draft abandoned by a crashed service expires on its repeated request id.
update public.coach_drafts set status = 'pending', created_at = now() - interval '10 minutes'
 where id = pg_temp.draft('ok2')::uuid;
set local role authenticated;
select is(public.coach_begin_request('e2000000-0000-4000-8000-000000000004', 'create', null, null, '{}')
  -> 'draft' -> 'error' ->> 'code', 'timeout', 'stale pending draft expires to a retryable failure');

select * from finish();
rollback;
