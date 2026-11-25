-- Profiles: public identity readable by signed-in users, writable only by the owner.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a@test.local'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'b@test.local');

-- Sign in as A
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into public.profiles (handle, display_name) values ('alice', 'Alice')$$,
  'owner creates own profile (id defaults to auth.uid())'
);
select is((select visibility::text from public.profiles where handle = 'alice'), 'private', 'visibility defaults to private');
select throws_ok(
  $$insert into public.profiles (id, handle, display_name) values ('bbbbbbbb-0000-4000-8000-000000000002', 'mallory', 'M')$$,
  '42501', null, 'cannot create a profile for another user'
);
select throws_ok(
  $$update public.profiles set id = 'bbbbbbbb-0000-4000-8000-000000000002' where handle = 'alice'$$,
  '42501', null, 'profile id is not updatable'
);
select throws_ok(
  $$update public.profiles set avatar_path = 'bbbbbbbb-0000-4000-8000-000000000002/x.png' where handle = 'alice'$$,
  '23514', null, 'avatar path must be inside the owner folder'
);

-- Sign in as B
reset role;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$insert into public.profiles (handle, display_name) values ('alice', 'Bob')$$,
  '23505', null, 'handles are unique'
);
select throws_ok(
  $$insert into public.profiles (handle, display_name) values ('Bob!', 'Bob')$$,
  '23514', null, 'handle must be normalized lowercase [a-z0-9_]{3,30}'
);
select lives_ok($$insert into public.profiles (handle, display_name) values ('bob', 'Bob')$$, 'B creates own profile');
select is((select count(*)::int from public.profiles), 2, 'signed-in user can read other identities');

update public.profiles set display_name = 'Hacked' where handle = 'alice';
reset role;
select is((select display_name from public.profiles where handle = 'alice'), 'Alice', 'B cannot modify A profile');

set local role anon;
select throws_ok('select * from public.profiles', '42501', null, 'anon cannot read profiles');
reset role;

select * from finish();
rollback;
