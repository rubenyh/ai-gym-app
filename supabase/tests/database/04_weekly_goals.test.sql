-- Weekly goals: first goal may start this week, later changes take effect next week, history is
-- frozen, and timezone changes apply from the next week boundary.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a@test.local'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'b@test.local');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$insert into public.weekly_goals (effective_week, target_days, timezone)
    values (public.week_start(now(), 'UTC') - 7, 3, 'UTC')$$,
  '42501', null, 'goal cannot start in a past week'
);
select lives_ok(
  $$insert into public.weekly_goals (effective_week, target_days, timezone)
    values (public.week_start(now(), 'UTC'), 3, 'UTC')$$,
  'first goal can start in the current week'
);
select throws_ok(
  $$insert into public.weekly_goals (effective_week, target_days, timezone)
    values (public.week_start(now(), 'UTC') + 1, 3, 'UTC')$$,
  '23514', null, 'effective_week must be a Monday'
);
select throws_ok(
  $$insert into public.weekly_goals (effective_week, target_days, timezone)
    values (public.week_start(now(), 'UTC') + 7, 8, 'UTC')$$,
  '23514', null, 'target days must be 1-7'
);
select lives_ok(
  $$insert into public.weekly_goals (effective_week, target_days, timezone)
    values (public.week_start(now(), 'UTC') + 7, 5, 'UTC')$$,
  'goal change is scheduled for next week'
);

update public.weekly_goals set target_days = 7 where effective_week = public.week_start(now(), 'UTC');
delete from public.weekly_goals where effective_week = public.week_start(now(), 'UTC');
select is(
  (select target_days::int from public.weekly_goals where effective_week = public.week_start(now(), 'UTC')),
  3, 'current week goal is frozen (update and delete have no effect)'
);
select lives_ok(
  $$update public.weekly_goals set target_days = 4 where effective_week = public.week_start(now(), 'UTC') + 7$$,
  'future goal can still be edited'
);
select is(
  (select target_days::int from public.weekly_goals where effective_week = public.week_start(now(), 'UTC') + 7),
  4, 'future goal edit applied'
);

-- Timezone change on settings carries forward from next week only.
insert into public.user_settings (weight_unit, length_unit, timezone) values ('kg', 'cm', 'UTC');
update public.user_settings set timezone = 'Asia/Tokyo';
select is(
  (select timezone from public.weekly_goals where effective_week = public.week_start(now(), 'UTC')),
  'UTC', 'current week keeps its original timezone after a timezone change'
);
select ok(
  exists (select 1 from public.weekly_goals
           where effective_week > public.week_start(now(), 'UTC') and timezone = 'Asia/Tokyo' and target_days = 4),
  'next week goal uses the new timezone with the scheduled target'
);

-- B: only a current-week goal; timezone change creates a next-week row with the same target.
reset role;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

select is_empty('select * from public.weekly_goals', 'B cannot see A goals');
insert into public.weekly_goals (effective_week, target_days, timezone) values (public.week_start(now(), 'UTC'), 2, 'UTC');
insert into public.user_settings (weight_unit, length_unit, timezone) values ('lb', 'ft_in', 'UTC');
update public.user_settings set timezone = 'America/New_York';
select is(
  (select count(*)::int from public.weekly_goals where timezone = 'America/New_York' and target_days = 2
     and effective_week > public.week_start(now(), 'UTC')),
  1, 'timezone change schedules a next-week row for a user with only a current goal'
);
select throws_ok(
  $$insert into public.weekly_goals (owner_id, effective_week, target_days, timezone)
    values ('aaaaaaaa-0000-4000-8000-000000000001', public.week_start(now(), 'UTC') + 14, 1, 'UTC')$$,
  '42501', null, 'B cannot write A goals'
);
reset role;

select * from finish();
rollback;
