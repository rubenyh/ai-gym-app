-- Every public table has RLS; anon has no table privileges; private tables expose nothing to anon.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0,
  'every table in public has row level security enabled'
);

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon'),
  0,
  'anon has no privileges on public tables'
);

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name in ('age', 'height_cm', 'weight_grams', 'limitations', 'goal', 'timezone', 'equipment')),
  0,
  'profiles has no private training or settings columns'
);

select is(
  (select public from storage.buckets where id = 'avatars'),
  false,
  'avatars bucket is private'
);

set local role anon;
select throws_ok(
  'select * from public.body_weight_entries',
  '42501',
  null,
  'anon cannot read body weight entries'
);
reset role;

select * from finish();
rollback;
