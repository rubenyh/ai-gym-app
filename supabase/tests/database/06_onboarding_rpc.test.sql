-- complete_onboarding is atomic; schedule_weekly_goal only touches next week.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a@test.local'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'b@test.local');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$select public.schedule_weekly_goal(3::smallint)$$,
  'P0002', null, 'goal scheduling requires completed onboarding'
);
select throws_ok(
  $$select public.complete_onboarding('alice', 'Alice', 'kg', 'cm', 'Not/AZone', 3::smallint)$$,
  '23514', null, 'invalid onboarding input fails'
);
select is_empty('select * from public.profiles', 'failed onboarding leaves no partial profile');
select lives_ok(
  $$select public.complete_onboarding('alice', '  Alice  ', 'kg', 'cm', 'Europe/Madrid', 3::smallint)$$,
  'onboarding succeeds'
);
select is(
  (select array[p.display_name, s.timezone, g.target_days::text]
     from public.profiles p, public.user_settings s, public.weekly_goals g),
  array['Alice', 'Europe/Madrid', '3'],
  'profile, settings and current-week goal created together'
);
select is(
  public.schedule_weekly_goal(5::smallint),
  public.week_start(now(), 'Europe/Madrid') + 7,
  'goal change is scheduled for next local week'
);
select is(
  (select target_days::int from public.weekly_goals where effective_week = public.week_start(now(), 'Europe/Madrid')),
  3, 'current week goal unchanged by scheduling'
);

reset role;
set local role anon;
select throws_ok(
  $$select public.complete_onboarding('mallory', 'M', 'kg', 'cm', 'UTC', 3::smallint)$$,
  '42501', null, 'anon cannot call onboarding'
);
reset role;

select * from finish();
rollback;
