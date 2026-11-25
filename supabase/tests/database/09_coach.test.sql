-- Coach (COACH-01/02, NFR-10): idempotent requests, rate limit, owner-only drafts, explicit approval applied
-- once, stale/duplicate approvals rejected, failed drafts never change the active program.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a@test.local'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'b@test.local');

create temp table r (k text primary key, v jsonb);
grant all on r to authenticated;

create function pg_temp.content() returns jsonb language sql as $$
  select '{"title":"Back focus","explanation":"More rows","assumptions":[],"days":[{"weekday":1,"routineName":"Pull",
    "exercises":[{"exerciseKey":"catalog:0027","exerciseName":"Row","sets":3,"repsMin":8,"repsMax":12,"restSeconds":90}]}]}'::jsonb
$$;
create function pg_temp.approval(p_approval text, p_draft text, p_base_id text, p_base_rev int, p_program text) returns jsonb
language sql as $$
  select jsonb_build_object('opId', gen_random_uuid(), 'aggregateType', 'coach_approval', 'aggregateId', p_approval,
    'action', 'upsert', 'baseRevision', null, 'doc', jsonb_build_object(
      'approvalId', p_approval, 'draftId', p_draft, 'baseProgramId', p_base_id, 'baseProgramRevision', p_base_rev,
      'program', jsonb_build_object('id', p_program, 'name', 'Coach plan', 'active', true, 'origin', 'coach',
        'coachDraftId', p_draft, 'days', jsonb_build_array(jsonb_build_object('weekday', 1,
          'routineId', '10000000-0000-4000-8000-0000000000c1'))),
      'routines', jsonb_build_array(jsonb_build_object('id', '10000000-0000-4000-8000-0000000000c1', 'name', 'Pull',
        'notes', '', 'archived', false, 'origin', 'coach', 'exercises', '[]'::jsonb))))
$$;
grant execute on all functions in schema pg_temp to authenticated;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

insert into r values ('req1', public.coach_begin_request('e0000000-0000-4000-8000-000000000001', 'create', null, null,
  '{"preferencesText":"more back"}'));
select is(array[r.v ->> 'created', r.v -> 'draft' ->> 'status'], array['true', 'pending'], 'request creates a pending draft')
  from r where k = 'req1';
select is(public.coach_begin_request('e0000000-0000-4000-8000-000000000001', 'create', null, null, '{}') -> 'draft' ->> 'draftId',
  (select v -> 'draft' ->> 'draftId' from r where k = 'req1'), 'repeated request id returns the existing draft');
select is(public.coach_begin_request('e0000000-0000-4000-8000-000000000001', 'create', null, null, '{}') ->> 'created',
  'false', 'repeated request id is reported as not created');
select is((select count(*)::int from public.coach_drafts), 1, 'no duplicate draft for a repeated request');

select throws_ok(format($$select public.coach_save_draft(%L, 'ready', '{"title":"x"}', null, null, 'm')$$,
  (select v -> 'draft' ->> 'draftId' from r where k = 'req1')), '22023', null, 'invalid draft content is rejected');
select is(public.coach_save_draft((select (v -> 'draft' ->> 'draftId')::uuid from r where k = 'req1'), 'ready',
  pg_temp.content(), null, null, 'gemini-test') ->> 'status', 'ready', 'valid draft saved as ready');
select throws_ok($$insert into public.coach_drafts (request_id) values ('e0000000-0000-4000-8000-000000000009')$$,
  '42501', null, 'drafts cannot be written directly');

-- B cannot see or touch A drafts
reset role;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.coach_drafts) + (select count(*)::int from public.coach_requests), 0,
  'B cannot read A coach rows');
select throws_ok(format($$select public.coach_save_draft(%L, 'failed', null, null,
  '{"code":"x","message":"y","retryable":false}', 'm')$$, (select v -> 'draft' ->> 'draftId' from r where k = 'req1')),
  'P0002', null, 'B cannot save A draft');
select throws_ok(format($$select public.coach_cancel_draft(%L)$$, (select v -> 'draft' ->> 'draftId' from r where k = 'req1')),
  'P0002', null, 'B cannot cancel A draft');
select is(public.sync_push(pg_temp.approval('e1000000-0000-4000-8000-0000000000b1',
  (select v -> 'draft' ->> 'draftId' from r where k = 'req1'), null, null, '30000000-0000-4000-8000-0000000000b1')) ->> 'code',
  'draft_not_found', 'B cannot approve A draft');

-- A approves
reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into r values ('ap1', pg_temp.approval('e1000000-0000-4000-8000-000000000001',
  (select v -> 'draft' ->> 'draftId' from r where k = 'req1'), null, null, '30000000-0000-4000-8000-0000000000c1'));
select is(public.sync_push((select v from r where k = 'ap1')) ->> 'status', 'applied', 'ready draft approved');
select is((select array[active::text, revision::text] from public.programs), array['true', '1'], 'approved program is active');
select is((select status from public.coach_drafts), 'approved', 'draft marked approved');
select is(public.sync_push((select v from r where k = 'ap1')) ->> 'status', 'duplicate', 'retried approval op is a duplicate');
select is(public.sync_push(pg_temp.approval('e1000000-0000-4000-8000-000000000002',
  (select v -> 'draft' ->> 'draftId' from r where k = 'req1'), null, null, '30000000-0000-4000-8000-0000000000c1')) ->> 'code',
  'already_approved', 'second approval of the same draft is rejected');

-- stale: new draft reviewed against "no program", but program c1 revision 1 is now active
insert into r values ('req2', public.coach_begin_request('e0000000-0000-4000-8000-000000000002', 'create', null, null, '{}'));
select public.coach_save_draft((select (v -> 'draft' ->> 'draftId')::uuid from r where k = 'req2'), 'ready', pg_temp.content(), null, null, 'm');
select is(
  (select array[x ->> 'status', x ->> 'serverRevision'] from public.sync_push(pg_temp.approval('e1000000-0000-4000-8000-000000000003',
    (select v -> 'draft' ->> 'draftId' from r where k = 'req2'), null, null, '30000000-0000-4000-8000-0000000000c2')) x),
  array['conflict', '1'], 'stale approval returns conflict with the active program revision');

-- failed draft never changes the active program
insert into r values ('req3', public.coach_begin_request('e0000000-0000-4000-8000-000000000003', 'adjust',
  '30000000-0000-4000-8000-0000000000c1', 1, '{}'));
select public.coach_save_draft((select (v -> 'draft' ->> 'draftId')::uuid from r where k = 'req3'), 'failed', null, null,
  '{"code":"provider_timeout","message":"timeout","retryable":true}', 'm');
select is(public.sync_push(pg_temp.approval('e1000000-0000-4000-8000-000000000004',
  (select v -> 'draft' ->> 'draftId' from r where k = 'req3'), '30000000-0000-4000-8000-0000000000c1', 1,
  '30000000-0000-4000-8000-0000000000c3')) ->> 'code', 'draft_not_ready', 'failed draft cannot be approved');
select is((select array_agg(id::text) from public.programs where active), array['30000000-0000-4000-8000-0000000000c1'],
  'active program unchanged by failed/stale approvals');
select throws_ok(format($$select public.coach_cancel_draft(%L)$$, (select v -> 'draft' ->> 'draftId' from r where k = 'req1')),
  '55000', null, 'approved draft cannot be cancelled');

select is(public.coach_get_context() -> 'activeProgram' ->> 'id', '30000000-0000-4000-8000-0000000000c1',
  'coach context includes the active program');

-- rate limit: 10 new requests per hour
reset role;
insert into public.coach_requests (owner_id, request_id, mode, input)
select 'aaaaaaaa-0000-4000-8000-000000000001', gen_random_uuid(), 'create', '{}' from generate_series(1, 7);
set local role authenticated;
select throws_ok($$select public.coach_begin_request('e0000000-0000-4000-8000-000000000099', 'create', null, null, '{}')$$,
  'PT429', null, 'eleventh request within an hour is rate limited');

select * from finish();
rollback;
