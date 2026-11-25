-- Social (SOCIAL-01..05, NFR-04) with three accounts: A author, B follower, C stranger.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a@test.local'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'b@test.local'),
  ('cccccccc-0000-4000-8000-000000000003', 'c@test.local');
insert into public.profiles (id, handle, display_name, visibility) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'alice', 'Alice', 'public'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'bob', 'Bob', 'private'),
  ('cccccccc-0000-4000-8000-000000000003', 'carol', 'Carol', 'private');

create function pg_temp.as_user(p_id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true)
$$;
create function pg_temp.visible_posts() returns int language sql as $$ select count(*)::int from public.posts $$;
grant execute on all functions in schema pg_temp to authenticated;

-- A: synced completed session (custom exercise + one incomplete set + private notes)
select pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
set local role authenticated;
select public.sync_push('{"opId":"a0000000-0000-4000-8000-000000000001","aggregateType":"session",
  "aggregateId":"20000000-0000-4000-8000-000000000001","action":"upsert","baseRevision":null,"doc":{
  "id":"20000000-0000-4000-8000-000000000001","routineId":null,"name":"Push day","status":"completed",
  "startedAt":"2026-11-23T17:00:00Z","completedAt":"2026-11-23T18:05:00Z","timezone":"Europe/Madrid",
  "localDate":"2026-11-23","notes":"SECRET NOTE","exercises":[
   {"id":"0e000000-0000-4000-8000-000000000001","position":0,"exerciseKey":"catalog:0025","exerciseName":"Bench",
    "notes":"SECRET EX NOTE","restSeconds":90,"sets":[
     {"id":"0f000000-0000-4000-8000-000000000001","position":0,"targetReps":8,"targetLoadGrams":60000,"reps":8,
      "loadGrams":60000,"loadMode":"external","completed":true,"completedAt":null},
     {"id":"0f000000-0000-4000-8000-000000000002","position":1,"targetReps":8,"targetLoadGrams":60000,"reps":null,
      "loadGrams":null,"loadMode":"external","completed":false,"completedAt":null}]},
   {"id":"0e000000-0000-4000-8000-000000000002","position":1,"exerciseKey":"custom:5a000000-0000-4000-8000-000000000001",
    "exerciseName":"My curl","notes":"","restSeconds":null,"sets":[
     {"id":"0f000000-0000-4000-8000-000000000003","position":0,"targetReps":null,"targetLoadGrams":null,"reps":12,
      "loadGrams":10000,"loadMode":"external","completed":true,"completedAt":null}]}]}}');

select lives_ok($$insert into storage.objects (bucket_id, name)
  values ('post-photos', 'aaaaaaaa-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000001.jpg')$$,
  'author uploads the post photo into own folder');
select throws_ok($$insert into storage.objects (bucket_id, name)
  values ('post-photos', 'bbbbbbbb-0000-4000-8000-000000000002/70000000-0000-4000-8000-000000000001.jpg')$$,
  '42501', null, 'author cannot upload into another folder');

select is(public.publish_post('70000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  'Good day', 'aaaaaaaa-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000001.jpg') -> 'snapshot',
  '{"version":1,"title":"Push day","completedOn":"2026-11-23","durationMinutes":65,"exercises":[
    {"exerciseKey":"catalog:0025","exerciseName":"Bench","loadMode":"external","sets":[{"reps":8,"loadGrams":60000}]},
    {"exerciseKey":null,"exerciseName":"My curl","loadMode":"external","sets":[{"reps":12,"loadGrams":10000}]}]}'::jsonb,
  'snapshot is built server-side with allowlisted fields only (no notes/timezone/ids, custom by name)');
select is(public.publish_post('70000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  'changed', null) ->> 'caption', 'Good day', 'publish retry with the same id returns the original post');
select is((select count(*)::int from public.posts), 1, 'publish retry creates no duplicate');
select throws_ok($$insert into public.posts (id, snapshot) values ('70000000-0000-4000-8000-0000000000ff', '{}')$$,
  '42501', null, 'posts cannot be inserted directly');

-- B: public author visible without following
reset role;
select pg_temp.as_user('bbbbbbbb-0000-4000-8000-000000000002');
set local role authenticated;
select is(pg_temp.visible_posts(), 1, 'signed-in non-follower sees a public author post');
select throws_ok($$select public.publish_post('70000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000001', null, null)$$, 'P0002', null, 'cannot publish another user session');
select is(public.follow_user('aaaaaaaa-0000-4000-8000-000000000001'), 'accepted', 'following a public profile is immediate');
select lives_ok($$insert into public.likes (post_id) values ('70000000-0000-4000-8000-000000000001')$$, 'B likes the post');
select lives_ok($$insert into public.comments (post_id, body) values ('70000000-0000-4000-8000-000000000001', 'nice')$$,
  'B comments');
select throws_ok(format($$insert into public.comments (post_id, body) values ('70000000-0000-4000-8000-000000000001', %L)$$,
  repeat('x', 1001)), '23514', null, 'comment longer than 1000 chars rejected');

-- public -> private applies immediately; accepted follower keeps access
reset role;
update public.profiles set visibility = 'private' where handle = 'alice';
select pg_temp.as_user('cccccccc-0000-4000-8000-000000000003');
set local role authenticated;
select is(pg_temp.visible_posts(), 0, 'public -> private revokes non-follower access immediately');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'post-photos'), 0, 'non-follower cannot read the photo');
select throws_ok($$insert into public.likes (post_id) values ('70000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'non-follower cannot like an inaccessible post');
select is((select count(*)::int from public.comments), 0, 'non-follower cannot read comments');
select is(public.follow_user('aaaaaaaa-0000-4000-8000-000000000001'), 'pending', 'following a private profile is pending');
select is(pg_temp.visible_posts(), 0, 'pending follower has no access');

reset role;
select pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
set local role authenticated;
select is(jsonb_array_length(public.list_follow_requests()), 1, 'author sees the pending request');
select public.respond_follow_request('cccccccc-0000-4000-8000-000000000003', true);

reset role;
select pg_temp.as_user('cccccccc-0000-4000-8000-000000000003');
set local role authenticated;
select is(jsonb_array_length(public.get_feed(null, 20)), 1, 'accepted follower sees the post in the feed');
select is((select count(*)::int from storage.objects where bucket_id = 'post-photos'), 1, 'accepted follower can read the photo');

-- remove follower
reset role;
select pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
set local role authenticated;
select public.remove_follower('cccccccc-0000-4000-8000-000000000003');
select public.block_user('bbbbbbbb-0000-4000-8000-000000000002');
reset role;
select pg_temp.as_user('cccccccc-0000-4000-8000-000000000003');
set local role authenticated;
select is(pg_temp.visible_posts(), 0, 'removed follower loses access');

-- block: follows removed both ways, no access even if public, identity hidden
reset role;
update public.profiles set visibility = 'public' where handle = 'alice';
select is((select count(*)::int from public.follows where 'bbbbbbbb-0000-4000-8000-000000000002' in (requester_id, followee_id)),
  0, 'blocking deletes follows in both directions');
select pg_temp.as_user('bbbbbbbb-0000-4000-8000-000000000002');
set local role authenticated;
select is(pg_temp.visible_posts(), 0, 'blocked user cannot see posts of a public author');
select is((select count(*)::int from public.profiles where handle = 'alice'), 0, 'blocked user cannot see the blocker profile');
select throws_ok($$select public.follow_user('aaaaaaaa-0000-4000-8000-000000000001')$$, 'P0002', null,
  'blocked user cannot follow');
select is(public.get_profile_card('alice'), null, 'profile card is hidden from a blocked user');

reset role;
select pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.get_profile_card('bob') ->> 'followStatus', 'blocked', 'blocker sees blocked status on the card');
select public.unblock_user('bbbbbbbb-0000-4000-8000-000000000002');

-- source session deleted: post stays, detached; refresh refused
select public.sync_push('{"opId":"a0000000-0000-4000-8000-000000000002","aggregateType":"session",
  "aggregateId":"20000000-0000-4000-8000-000000000001","action":"delete","baseRevision":1,"doc":null}');
select is((select array[deleted::text, coalesce(source_session_id::text, 'null')] from public.posts), array['false', 'null'],
  'deleting the source session keeps the post, detached');
select throws_ok($$select public.update_post_snapshot('70000000-0000-4000-8000-000000000001')$$, 'P0002', null,
  'snapshot refresh needs the source session');

reset role;
select pg_temp.as_user('bbbbbbbb-0000-4000-8000-000000000002');
set local role authenticated;
select is(pg_temp.visible_posts(), 1, 'unblock restores access to a public author');
select throws_ok($$select public.delete_post('70000000-0000-4000-8000-000000000001')$$, 'P0002', null,
  'only the author can delete a post');

reset role;
select pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
set local role authenticated;
select public.delete_post('70000000-0000-4000-8000-000000000001');
select is(pg_temp.visible_posts(), 0, 'deleted post disappears');

reset role;
select is((select count(*)::int from public.reward_events where owner_id <> 'aaaaaaaa-0000-4000-8000-000000000001'), 0,
  'follow/like/comment award no XP');

select * from finish();
rollback;
