-- Security regressions (NFR-04, NFR-05, SOCIAL-03/04): privilege sweep, cross-account ids in RPCs,
-- avatar visibility under blocks, protected columns. A owner, B stranger, X blocked by A.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a@test.local'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'b@test.local'),
  ('cccccccc-0000-4000-8000-000000000003', 'x@test.local');
insert into public.profiles (id, handle, display_name, visibility) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'alice', 'Alice', 'public'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'bob', 'Bob', 'public'),
  ('cccccccc-0000-4000-8000-000000000003', 'xavier', 'Xavier', 'public');
insert into public.weekly_goals (owner_id, effective_week, target_days, timezone)
values ('aaaaaaaa-0000-4000-8000-000000000001', public.week_start(now(), 'UTC'), 3, 'UTC');
insert into storage.objects (bucket_id, name, owner_id) values
  ('avatars', 'aaaaaaaa-0000-4000-8000-000000000001/a.png', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('avatars', 'cccccccc-0000-4000-8000-000000000003/x.png', 'cccccccc-0000-4000-8000-000000000003');
insert into public.blocks (blocker_id, blocked_id)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000003');

create temp table r (k text primary key, v jsonb);
grant all on r to authenticated;
create function pg_temp.as_user(p_id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true)
$$;
create function pg_temp.avatars() returns text[] language sql as $$
  select coalesce(array_agg(name order by name), '{}') from storage.objects where bucket_id = 'avatars'
    and name ~ '^(aaaaaaaa|cccccccc)-0000-4000-8000-'
$$;
create function pg_temp.approval(p_draft text, p_program text, p_routine text) returns jsonb language sql as $$
  select jsonb_build_object('opId', gen_random_uuid(), 'aggregateType', 'coach_approval',
    'aggregateId', a.id, 'action', 'upsert', 'baseRevision', null,
    'doc', jsonb_build_object('approvalId', a.id, 'draftId', p_draft, 'baseProgramId', null, 'baseProgramRevision', null,
      'program', jsonb_build_object('id', p_program, 'name', 'Hijack', 'active', true, 'origin', 'coach',
        'coachDraftId', p_draft, 'days', jsonb_build_array(jsonb_build_object('weekday', 1, 'routineId', p_routine))),
      'routines', jsonb_build_array(jsonb_build_object('id', p_routine, 'name', 'Hijack', 'notes', '',
        'archived', false, 'origin', 'coach', 'exercises', '[]'::jsonb))))
    from (select gen_random_uuid() as id) a
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- Privilege sweep -------------------------------------------------------------------------------
select is_empty($$select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace
  and has_function_privilege('anon', p.oid, 'execute')$$, 'anon cannot execute any public function');
select is_empty($$select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.prorettype = 'trigger'::regtype and has_function_privilege('authenticated', p.oid, 'execute')$$,
  'trigger functions are not callable by clients');
select is_empty($$select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
  and not coalesce(p.proconfig::text like '%search_path=%', false)$$, 'every security definer function pins search_path');
select is_empty($$select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
  and (has_sequence_privilege('anon', c.oid, 'usage,select,update')
       or has_sequence_privilege('authenticated', c.oid, 'usage,select,update'))$$, 'sequences are not client-accessible');
select is_empty($$select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
  and not c.relrowsecurity$$, 'every public table has RLS enabled');
select is_empty($$select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm')
  and has_table_privilege('anon', c.oid, 'select,insert,update,delete')$$, 'anon has no table privileges');
select is_empty($$select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  and not coalesce(c.reloptions::text like '%security_invoker=true%', false)$$, 'views are security_invoker');

-- has_weekly_goal answers only for the caller ----------------------------------------------------
select pg_temp.as_user('bbbbbbbb-0000-4000-8000-000000000002');
set local role authenticated;
select is(public.has_weekly_goal('aaaaaaaa-0000-4000-8000-000000000001'), false, 'B cannot probe A weekly goal');
reset role;
select pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.has_weekly_goal('aaaaaaaa-0000-4000-8000-000000000001'), true, 'A sees own weekly goal');

-- Avatars under blocks (both directions) ---------------------------------------------------------
select is(pg_temp.avatars(), array['aaaaaaaa-0000-4000-8000-000000000001/a.png'], 'blocker cannot read blocked avatar');
reset role;
select pg_temp.as_user('cccccccc-0000-4000-8000-000000000003');
set local role authenticated;
select is(pg_temp.avatars(), array['cccccccc-0000-4000-8000-000000000003/x.png'], 'blocked user cannot read blocker avatar');
reset role;
select pg_temp.as_user('bbbbbbbb-0000-4000-8000-000000000002');
set local role authenticated;
select is(cardinality(pg_temp.avatars()), 2, 'unrelated user still reads both avatars');

-- Cross-account ids in coach approval -----------------------------------------------------------
-- A owns routine c1 and program p1.
reset role;
select pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
set local role authenticated;
select public.sync_push(jsonb_build_object('opId', gen_random_uuid(), 'aggregateType', 'routine',
  'aggregateId', '10000000-0000-4000-8000-0000000000c1', 'action', 'upsert', 'baseRevision', null,
  'doc', jsonb_build_object('id', '10000000-0000-4000-8000-0000000000c1', 'name', 'A routine', 'notes', '',
    'archived', false, 'origin', 'manual', 'exercises', '[]'::jsonb)));
select public.sync_push(jsonb_build_object('opId', gen_random_uuid(), 'aggregateType', 'program',
  'aggregateId', '30000000-0000-4000-8000-0000000000a1', 'action', 'upsert', 'baseRevision', null,
  'doc', jsonb_build_object('id', '30000000-0000-4000-8000-0000000000a1', 'name', 'A program', 'active', false,
    'origin', 'manual', 'coachDraftId', null, 'days', '[]'::jsonb)));
-- B gets a ready draft of their own.
reset role;
select pg_temp.as_user('bbbbbbbb-0000-4000-8000-000000000002');
set local role authenticated;
insert into r values ('req', public.coach_begin_request('e0000000-0000-4000-8000-0000000000b1', 'create', null, null, '{}'));
select public.coach_save_draft((select (v -> 'draft' ->> 'draftId')::uuid from r where k = 'req'), 'ready',
  '{"title":"t","explanation":"e","assumptions":[],"days":[{"weekday":1,"routineName":"P","exercises":[{"exerciseKey":
   "catalog:0027","exerciseName":"Row","sets":3,"repsMin":8,"repsMax":12,"restSeconds":90}]}]}', null, null, 'm');
select is(public.sync_push(pg_temp.approval((select v -> 'draft' ->> 'draftId' from r where k = 'req'),
  '30000000-0000-4000-8000-0000000000b9', '10000000-0000-4000-8000-0000000000c1')) ->> 'code', 'forbidden',
  'approval cannot overwrite another user routine');
select is(public.sync_push(pg_temp.approval((select v -> 'draft' ->> 'draftId' from r where k = 'req'),
  '30000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000b8')) ->> 'code', 'forbidden',
  'approval cannot overwrite another user program');
select throws_ok($$select public.coach_begin_request('e0000000-0000-4000-8000-0000000000b2', 'adjust',
  '30000000-0000-4000-8000-0000000000a1', 1, '{}')$$, 'P0002', null, 'coach request cannot reference another user program');
reset role;
select is((select array[name, revision::text, owner_id::text] from public.routines where id = '10000000-0000-4000-8000-0000000000c1'),
  array['A routine', '1', 'aaaaaaaa-0000-4000-8000-000000000001'], 'A routine untouched');
select is((select status from public.coach_drafts where owner_id = 'bbbbbbbb-0000-4000-8000-000000000002'), 'ready',
  'rejected approvals leave the draft ready');

-- Protected columns and spoofed owners on social rows ------------------------------------------
-- A publishes from a synced completed session.
select pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
set local role authenticated;
select public.sync_push(jsonb_build_object('opId', gen_random_uuid(), 'aggregateType', 'session',
  'aggregateId', '20000000-0000-4000-8000-0000000000a1', 'action', 'upsert', 'baseRevision', null,
  'doc', jsonb_build_object('id', '20000000-0000-4000-8000-0000000000a1', 'routineId', null, 'name', 'S',
    'status', 'completed', 'startedAt', '2026-11-23T17:00:00Z', 'completedAt', '2026-11-23T18:00:00Z',
    'timezone', 'UTC', 'localDate', '2026-11-23', 'notes', 'SECRET', 'exercises', '[]'::jsonb)));
select public.publish_post('40000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1', 'hi', null);
select throws_ok($$update public.posts set deleted = false, revision = 99, author_id = 'bbbbbbbb-0000-4000-8000-000000000002'$$,
  '42501', null, 'author cannot update protected post columns directly');
select throws_ok($$insert into public.comments (post_id, body, author_id) values
  ('40000000-0000-4000-8000-0000000000a1', 'spoof', 'bbbbbbbb-0000-4000-8000-000000000002')$$,
  '42501', null, 'comment author cannot be spoofed');
select throws_ok($$insert into public.likes (post_id, user_id) values
  ('40000000-0000-4000-8000-0000000000a1', 'bbbbbbbb-0000-4000-8000-000000000002')$$,
  '42501', null, 'like owner cannot be spoofed');
select ok(not (public.publish_post('40000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1', null, null)
  -> 'snapshot')::text like '%SECRET%', 'snapshot never contains session notes');

-- X (blocked by A) cannot interact with A's public post.
reset role;
select pg_temp.as_user('cccccccc-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok($$insert into public.likes (post_id) values ('40000000-0000-4000-8000-0000000000a1')$$,
  '42501', null, 'blocked user cannot like');
select throws_ok($$insert into public.comments (post_id, body) values ('40000000-0000-4000-8000-0000000000a1', 'x')$$,
  '42501', null, 'blocked user cannot comment');
-- B (stranger) cannot republish/snapshot/delete A's post.
reset role;
select pg_temp.as_user('bbbbbbbb-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok($$select public.publish_post('40000000-0000-4000-8000-0000000000a1', null, null, null)$$,
  '42501', null, 'B cannot claim A post id');
select throws_ok($$select public.delete_post('40000000-0000-4000-8000-0000000000a1')$$, 'P0002', null, 'B cannot delete A post');

select * from finish();
rollback;
