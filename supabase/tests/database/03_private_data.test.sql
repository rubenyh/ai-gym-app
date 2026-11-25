-- Private data (settings, training profile, body weight) is invisible and immutable to other users.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a@test.local'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'b@test.local');

-- A writes private data
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into public.user_settings (weight_unit, length_unit, timezone) values ('kg', 'cm', 'Europe/Madrid')$$,
  'A saves settings'
);
select throws_ok(
  $$update public.user_settings set timezone = 'Mars/Olympus'$$,
  '23514', null, 'invalid timezone rejected'
);
select lives_ok(
  $$insert into public.training_profiles (goal, age, height_cm, experience, available_weekdays, session_minutes)
    values ('strength', 30, 180.5, 'beginner', '{1,3,5}', 60)$$,
  'A saves training profile'
);
select throws_ok(
  $$update public.training_profiles set available_weekdays = '{0,8}'$$,
  '23514', null, 'weekdays must be ISO 1-7'
);
select lives_ok(
  $$insert into public.body_weight_entries (id, measured_at, weight_grams)
    values ('cccccccc-0000-4000-8000-000000000003', '2026-11-20T08:00:00Z', 80500)$$,
  'A records body weight with client-generated id'
);
select throws_ok(
  $$insert into public.body_weight_entries (measured_at, weight_grams) values (now(), 5)$$,
  '23514', null, 'implausible body weight rejected'
);
select throws_ok(
  $$update public.body_weight_entries set owner_id = 'bbbbbbbb-0000-4000-8000-000000000002'$$,
  '42501', null, 'body weight owner is not updatable'
);
select lives_ok(
  $$update public.body_weight_entries set weight_grams = 80000 where id = 'cccccccc-0000-4000-8000-000000000003'$$,
  'A edits own measurement value'
);

-- B attacks A's data
reset role;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

select is_empty('select * from public.user_settings', 'B cannot read A settings');
select is_empty('select * from public.training_profiles', 'B cannot read A training profile');
select is_empty('select * from public.body_weight_entries', 'B cannot read A body weight');
select throws_ok(
  $$insert into public.body_weight_entries (owner_id, measured_at, weight_grams)
    values ('aaaaaaaa-0000-4000-8000-000000000001', now(), 70000)$$,
  '42501', null, 'B cannot insert body weight for A'
);
select throws_ok(
  $$insert into public.training_profiles (owner_id, goal) values ('aaaaaaaa-0000-4000-8000-000000000001', 'x')$$,
  '42501', null, 'B cannot create a training profile for A'
);
update public.body_weight_entries set weight_grams = 1 where true;
delete from public.body_weight_entries where true;
update public.training_profiles set limitations = 'tampered' where true;
update public.user_settings set weight_unit = 'lb' where true;

reset role;
select is(
  (select weight_grams from public.body_weight_entries where id = 'cccccccc-0000-4000-8000-000000000003'),
  80000, 'B update/delete left A body weight intact'
);
select is((select limitations from public.training_profiles), null, 'B update left A training profile intact');
select is((select weight_unit::text from public.user_settings), 'kg', 'B update left A settings intact');

set local role anon;
select throws_ok('select * from public.training_profiles', '42501', null, 'anon cannot read training profiles');
reset role;

select * from finish();
rollback;
