-- Sync protocol (SYNC-01, NFR-02/03/04): idempotent push, lost acks, stale conflicts, tombstones,
-- cross-owner rejection, ordered pulls, and no direct client writes.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a@test.local'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'b@test.local');

create temp table r (k text primary key, v jsonb);
grant all on r to authenticated;

create function pg_temp.routine(p_id text, p_name text) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'name', p_name, 'notes', '', 'archived', false, 'origin', 'manual',
    'exercises', jsonb_build_array(jsonb_build_object(
      'id', '0e000000-0000-4000-8000-000000000001', 'position', 0, 'exerciseKey', 'catalog:0025',
      'exerciseName', 'Bench', 'notes', '', 'restSeconds', 90,
      'sets', jsonb_build_array(jsonb_build_object('id', '0f000000-0000-4000-8000-000000000001', 'position', 0,
        'targetReps', 8, 'targetLoadGrams', 60000, 'loadMode', 'external')))))
$$;
create function pg_temp.op(p_op text, p_type text, p_id text, p_action text, p_base int, p_doc jsonb) returns jsonb
language sql as $$
  select jsonb_build_object('opId', p_op, 'aggregateType', p_type, 'aggregateId', p_id, 'action', p_action,
    'baseRevision', p_base, 'doc', p_doc)
$$;
create function pg_temp.session(p_id text, p_status text) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'routineId', null, 'name', 'Push', 'status', p_status,
    'startedAt', '2026-11-23T17:00:00.000Z', 'completedAt', case when p_status = 'completed' then '2026-11-23T18:00:00Z' end,
    'timezone', 'Europe/Madrid', 'localDate', case when p_status = 'completed' then '2026-11-23' end,
    'notes', '', 'exercises', '[]'::jsonb)
$$;
create function pg_temp.program(p_id text, p_active boolean) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'name', 'Plan', 'active', p_active, 'origin', 'manual', 'coachDraftId', null,
    'days', jsonb_build_array(jsonb_build_object('weekday', 1, 'routineId', '10000000-0000-4000-8000-000000000001')))
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- ----------------------------------------------------------------- A
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

insert into r values ('create', public.sync_push(pg_temp.op('a0000000-0000-4000-8000-000000000001', 'routine',
  '10000000-0000-4000-8000-000000000001', 'upsert', null, pg_temp.routine('10000000-0000-4000-8000-000000000001', 'Push A'))));
select is(r.v, '{"status":"applied","opId":"a0000000-0000-4000-8000-000000000001","revision":1,"deleted":false}'::jsonb,
  'create applies at revision 1') from r where k = 'create';

insert into r values ('seq_after_create', (select to_jsonb(max(seq)) from public.server_change_log));
insert into r values ('dup', public.sync_push(pg_temp.op('a0000000-0000-4000-8000-000000000001', 'routine',
  '10000000-0000-4000-8000-000000000001', 'upsert', null, pg_temp.routine('10000000-0000-4000-8000-000000000001', 'Push A'))));
select is(r.v, '{"status":"duplicate","opId":"a0000000-0000-4000-8000-000000000001","revision":1,"deleted":false}'::jsonb,
  'lost-ack retry with the same opId returns the stored receipt as duplicate') from r where k = 'dup';
select is((select to_jsonb(max(seq)) from public.server_change_log), (select v from r where k = 'seq_after_create'),
  'duplicate push writes no new change');
select is((select revision from public.routines), 1, 'duplicate push did not bump the revision');

insert into r values ('create_again', public.sync_push(pg_temp.op('a0000000-0000-4000-8000-000000000002', 'routine',
  '10000000-0000-4000-8000-000000000001', 'upsert', null, pg_temp.routine('10000000-0000-4000-8000-000000000001', 'Other'))));
select is(r.v ->> 'status', 'conflict', 'create over an existing aggregate is a conflict') from r where k = 'create_again';
select is(r.v -> 'serverDoc' ->> 'name', 'Push A', 'conflict carries the server document') from r where k = 'create_again';

select is(public.sync_push(pg_temp.op('a0000000-0000-4000-8000-000000000003', 'routine',
  '10000000-0000-4000-8000-000000000001', 'upsert', 1, pg_temp.routine('10000000-0000-4000-8000-000000000001', 'Push B'))) ->> 'revision',
  '2', 'update on the current base revision applies at revision 2');

insert into r values ('stale', public.sync_push(pg_temp.op('a0000000-0000-4000-8000-000000000004', 'routine',
  '10000000-0000-4000-8000-000000000001', 'upsert', 1, pg_temp.routine('10000000-0000-4000-8000-000000000001', 'Stale'))));
select is(array[r.v ->> 'status', r.v ->> 'serverRevision', r.v -> 'serverDoc' ->> 'name'], array['conflict', '2', 'Push B'],
  'stale base revision returns conflict with the server copy (no last-write-wins)') from r where k = 'stale';
select is((select name from public.routines), 'Push B', 'stale write did not change the server row');

select is(public.sync_push(pg_temp.op('a0000000-0000-4000-8000-000000000005', 'routine',
  '10000000-0000-4000-8000-000000000002', 'upsert', null,
  pg_temp.routine('10000000-0000-4000-8000-000000000002', 'X') || '{"ownerId":"x"}')) ->> 'code',
  'invalid_doc', 'unknown root key is rejected');
select is(public.sync_push(pg_temp.op('a0000000-0000-4000-8000-000000000006', 'routine',
  '10000000-0000-4000-8000-000000000002', 'upsert', null,
  jsonb_set(pg_temp.routine('10000000-0000-4000-8000-000000000002', 'X'), '{exercises,0,sets,0,targetReps}', '2000'))) ->> 'code',
  'invalid_doc', 'out-of-bounds nested value is rejected');
select is(public.sync_push(pg_temp.op('a0000000-0000-4000-8000-000000000007', 'routine',
  '10000000-0000-4000-8000-000000000002', 'upsert', null, pg_temp.routine('10000000-0000-4000-8000-000000000003', 'X'))) ->> 'code',
  'invalid_doc', 'doc.id must equal aggregateId');
select is(public.sync_push(pg_temp.op('a0000000-0000-4000-8000-000000000008', 'routine',
  '10000000-0000-4000-8000-000000000009', 'upsert', 3, pg_temp.routine('10000000-0000-4000-8000-000000000009', 'X'))) ->> 'code',
  'unknown_aggregate', 'base revision for an unknown aggregate is rejected');
select throws_ok('select * from public.operation_receipts', '42501', null, 'clients cannot read operation receipts');

-- delete -> tombstone
select is(public.sync_push(pg_temp.op('a0000000-0000-4000-8000-000000000009', 'routine',
  '10000000-0000-4000-8000-000000000001', 'delete', 2, null)),
  '{"status":"applied","opId":"a0000000-0000-4000-8000-000000000009","revision":3,"deleted":true}'::jsonb,
  'delete produces a tombstone with a new revision');
select is(public.sync_push(pg_temp.op('a0000000-0000-4000-8000-00000000000a', 'routine',
  '10000000-0000-4000-8000-00000000000a', 'delete', null, null)) ->> 'deleted', 'true',
  'deleting an aggregate the server never saw is acknowledged');

-- sessions: one active at a time
select is(public.sync_push(pg_temp.op('a0000000-0000-4000-8000-00000000000b', 'session',
  '20000000-0000-4000-8000-000000000001', 'upsert', null, pg_temp.session('20000000-0000-4000-8000-000000000001', 'active'))) ->> 'status',
  'applied', 'active session saved');
select is(public.sync_push(pg_temp.op('a0000000-0000-4000-8000-00000000000c', 'session',
  '20000000-0000-4000-8000-000000000002', 'upsert', null, pg_temp.session('20000000-0000-4000-8000-000000000002', 'active'))) ->> 'code',
  'active_session_exists', 'second active session is rejected');

-- programs: activating one deactivates the previous
select public.sync_push(pg_temp.op('a0000000-0000-4000-8000-00000000000d', 'program',
  '30000000-0000-4000-8000-000000000001', 'upsert', null, pg_temp.program('30000000-0000-4000-8000-000000000001', true)));
select public.sync_push(pg_temp.op('a0000000-0000-4000-8000-00000000000e', 'program',
  '30000000-0000-4000-8000-000000000002', 'upsert', null, pg_temp.program('30000000-0000-4000-8000-000000000002', true)));
select is(
  (select array_agg(array[id::text, active::text, revision::text, (doc ->> 'active')] order by id) from public.programs),
  array[array['30000000-0000-4000-8000-000000000001', 'false', '2', 'false'],
        array['30000000-0000-4000-8000-000000000002', 'true', '1', 'true']],
  'activating a program deactivates the previous one with a new revision');

-- body weight aggregate
select is(public.sync_push(pg_temp.op('a0000000-0000-4000-8000-00000000000f', 'body_weight',
  '40000000-0000-4000-8000-000000000001', 'upsert', null,
  '{"id":"40000000-0000-4000-8000-000000000001","measuredAt":"2026-11-20T08:00:00Z","weightGrams":80500}')) ->> 'status',
  'applied', 'body weight saved through sync_push');
select is(public.sync_push(pg_temp.op('a0000000-0000-4000-8000-000000000010', 'body_weight',
  '40000000-0000-4000-8000-000000000002', 'upsert', null,
  '{"id":"40000000-0000-4000-8000-000000000002","measuredAt":"2026-11-20T08:00:00Z","weightGrams":5}')) ->> 'code',
  'invalid_doc', 'implausible body weight rejected');

-- pull
insert into r values ('pull', public.sync_pull(0, 500));
select is(
  (select jsonb_agg(c ->> 'aggregateType' order by (c ->> 'seq')::int) from r, jsonb_array_elements(r.v -> 'changes') c where k = 'pull'),
  '["routine","session","program","program","body_weight"]'::jsonb,
  'pull returns one change per aggregate in commit (seq) order');
select ok(
  (select bool_and(c -> 'doc' = 'null'::jsonb) from r, jsonb_array_elements(r.v -> 'changes') c
    where k = 'pull' and (c ->> 'deleted')::boolean),
  'tombstones are pulled with a null doc');
select is(
  (select c -> 'doc' ->> 'weightGrams' from r, jsonb_array_elements(r.v -> 'changes') c
    where k = 'pull' and c ->> 'aggregateType' = 'body_weight'),
  '80500', 'body weight document is rebuilt from its columns');
select is(
  (select r.v ->> 'nextCursor' from r where k = 'pull')::bigint,
  (select max(seq) from public.server_change_log), 'nextCursor is the last seq of the page');
insert into r values ('page', public.sync_pull(0, 2));
select is(
  (select array[jsonb_array_length(v -> 'changes')::text, v ->> 'hasMore'] from r where k = 'page'),
  array['2', 'true'], 'limited page reports hasMore');
select is(
  jsonb_array_length(public.sync_pull((select (v ->> 'nextCursor')::bigint from r where k = 'page'), 500) -> 'changes'),
  3, 'next page continues after the cursor');

-- direct writes are denied
select throws_ok($$insert into public.routines (id, revision, name, archived, origin, doc)
  values ('10000000-0000-4000-8000-0000000000ff', 1, 'x', false, 'manual', '{}')$$,
  '42501', null, 'direct insert into routines is denied');
select throws_ok($$update public.sessions set status = 'completed'$$, '42501', null, 'direct session update is denied');
select throws_ok($$delete from public.body_weight_entries$$, '42501', null, 'direct body weight delete is denied');

-- ----------------------------------------------------------------- B
reset role;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

select is(public.sync_push(pg_temp.op('b0000000-0000-4000-8000-000000000001', 'session',
  '20000000-0000-4000-8000-000000000001', 'upsert', 1, pg_temp.session('20000000-0000-4000-8000-000000000001', 'completed'))) ->> 'code',
  'forbidden', 'B cannot overwrite an aggregate owned by A');
select is((select count(*)::int from public.sessions) + (select count(*)::int from public.routines)
  + (select count(*)::int from public.server_change_log), 0, 'B reads none of A training rows');
select is(public.sync_pull(0, 500) -> 'changes', '[]'::jsonb, 'B pull returns nothing of A');

reset role;
select is((select status from public.sessions where id = '20000000-0000-4000-8000-000000000001'), 'active',
  'A session untouched by B');

select * from finish();
rollback;
