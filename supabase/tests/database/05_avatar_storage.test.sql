-- Avatar storage: owner writes only in its own folder; signed-in users read; anon reads nothing.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a@test.local'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'b@test.local');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('avatars', 'aaaaaaaa-0000-4000-8000-000000000001/avatar.png')$$,
  'A uploads into own avatar folder'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('avatars', 'bbbbbbbb-0000-4000-8000-000000000002/avatar.png')$$,
  '42501', null, 'A cannot upload into B folder'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

select is(
  (select count(*)::int from storage.objects where bucket_id = 'avatars'),
  1, 'signed-in user can read avatars'
);
-- Storage blocks raw SQL deletes unless this flag is set (the Storage API sets it); RLS still applies.
set local storage.allow_delete_query = 'true';
delete from storage.objects where bucket_id = 'avatars';
update storage.objects set name = 'bbbbbbbb-0000-4000-8000-000000000002/stolen.png' where bucket_id = 'avatars';

reset role;
select is(
  (select name from storage.objects where bucket_id = 'avatars'),
  'aaaaaaaa-0000-4000-8000-000000000001/avatar.png',
  'B cannot delete or move A avatar'
);

set local role anon;
select is_empty($$select * from storage.objects where bucket_id = 'avatars'$$, 'anon cannot list avatars');
reset role;

select is(
  (select count(*)::int from storage.buckets where id = 'avatars' and allowed_mime_types @> array['image/png']),
  1, 'avatar bucket restricts uploads to images'
);

select * from finish();
rollback;
