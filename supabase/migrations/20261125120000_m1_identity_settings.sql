-- M1: identity, preferences, weekly goals, private training profile, body weight, avatars.
-- Specs: docs/DATA_AND_SYNC.md (entities, social permissions), docs/REQUIREMENTS.md (AUTH-*, PROFILE-*,
-- SETTINGS-01, NFR-04, NFR-11), docs/PROGRESS_AND_GAMIFICATION.md (weekly consistency).
-- Dictionary: docs/DATA-DICTIONARY.md. Diagram: docs/DB-DIAGRAM.md.
--
-- Conventions
-- * Every table is owner-scoped through auth.uid(); owner columns default to auth.uid() and RLS
--   re-checks them, so a client cannot write rows for another user.
-- * Clients get explicit table/column grants only. Identity columns (id, owner_id, keys) are not
--   updatable by clients.
-- * Canonical units: body weight in integer grams, height in centimetres.

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- True when tz is an IANA zone name PostgreSQL understands.
create function public.is_valid_timezone(tz text) returns boolean
language plpgsql stable set search_path = '' as $$
begin
  if tz is null or tz = '' then
    return false;
  end if;
  perform now() at time zone tz;
  return true;
exception when others then
  return false;
end $$;

-- Monday (ISO week start) of the local week containing ts in time zone tz.
create function public.week_start(ts timestamptz, tz text) returns date
language sql stable set search_path = '' as $$
  select date_trunc('week', ts at time zone tz)::date
$$;

-- ---------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------

create type public.profile_visibility as enum ('public', 'private');
create type public.weight_unit as enum ('kg', 'lb');
create type public.length_unit as enum ('cm', 'ft_in');
create type public.experience_level as enum ('beginner', 'intermediate', 'advanced');

-- ---------------------------------------------------------------------------------------------
-- profiles: public identity only. No private metrics ever live here.
-- ---------------------------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  handle text not null,
  display_name text not null,
  avatar_path text,
  visibility public.profile_visibility not null default 'private',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Stored already normalized (lowercase), so uniqueness is case-insensitive.
  constraint profiles_handle_format check (handle ~ '^[a-z0-9_]{3,30}$'),
  constraint profiles_display_name_length check (char_length(btrim(display_name)) between 1 and 50),
  -- Avatar objects live in the avatars bucket under the owner's folder: '<id>/<file>'.
  constraint profiles_avatar_path_owner check (avatar_path is null or avatar_path like id::text || '/%')
);

create unique index profiles_handle_key on public.profiles (handle);

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- user_settings: display/input units and current timezone (private).
-- ---------------------------------------------------------------------------------------------

create table public.user_settings (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  weight_unit public.weight_unit not null,
  length_unit public.length_unit not null,
  timezone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_settings_timezone_valid check (public.is_valid_timezone(timezone))
);

create trigger user_settings_set_updated_at before update on public.user_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- weekly_goals: append-forward history. A row applies from effective_week until the next row.
-- Past and current weeks are frozen; changes take effect next week (enforced by RLS below).
-- ---------------------------------------------------------------------------------------------

create table public.weekly_goals (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  effective_week date not null,
  target_days smallint not null,
  timezone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, effective_week),
  constraint weekly_goals_monday check (extract(isodow from effective_week) = 1),
  constraint weekly_goals_target_days check (target_days between 1 and 7),
  constraint weekly_goals_timezone_valid check (public.is_valid_timezone(timezone))
);

create trigger weekly_goals_set_updated_at before update on public.weekly_goals
  for each row execute function public.set_updated_at();

-- Used by the insert policy (a policy cannot query its own table without recursion).
create function public.has_weekly_goal(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.weekly_goals where owner_id = uid)
$$;
revoke all on function public.has_weekly_goal(uuid) from public, anon;

-- A timezone change applies from the next week boundary: carry the goal in force next week
-- forward with the new timezone, leaving current and past weeks untouched.
create function public.carry_goal_timezone() returns trigger
language plpgsql set search_path = '' as $$
declare
  next_week date;
  target smallint;
begin
  if new.timezone is not distinct from old.timezone then
    return new;
  end if;
  -- Later of the two zones' next Monday, so the row is in the future in both.
  next_week := greatest(public.week_start(now(), old.timezone), public.week_start(now(), new.timezone)) + 7;
  select g.target_days into target
    from public.weekly_goals g
   where g.owner_id = new.owner_id and g.effective_week <= next_week
   order by g.effective_week desc
   limit 1;
  if target is null then
    return new; -- no goal yet: nothing to freeze
  end if;
  insert into public.weekly_goals (owner_id, effective_week, target_days, timezone)
  values (new.owner_id, next_week, target, new.timezone)
  on conflict (owner_id, effective_week) do update set timezone = excluded.timezone;
  return new;
end $$;

create trigger user_settings_carry_goal_timezone after update of timezone on public.user_settings
  for each row execute function public.carry_goal_timezone();

-- ---------------------------------------------------------------------------------------------
-- training_profiles: private coach/profile inputs (PROFILE-01). Fields are nullable because
-- coaching questions may be deferred until coaching is requested.
-- ---------------------------------------------------------------------------------------------

create table public.training_profiles (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  goal text,
  age smallint,
  height_cm numeric(4, 1),
  experience public.experience_level,
  equipment text[] not null default '{}',
  limitations text,
  available_weekdays smallint[] not null default '{}',
  session_minutes smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_profiles_goal_length check (char_length(goal) <= 200),
  -- Sanity bounds for data validity only; not an age-eligibility rule (open decision O-11).
  constraint training_profiles_age_range check (age between 1 and 120),
  constraint training_profiles_height_range check (height_cm between 50 and 272),
  constraint training_profiles_equipment_size check (cardinality(equipment) <= 50),
  constraint training_profiles_limitations_length check (char_length(limitations) <= 1000),
  constraint training_profiles_weekdays_iso check (available_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  constraint training_profiles_session_minutes_range check (session_minutes between 10 and 300)
);

create trigger training_profiles_set_updated_at before update on public.training_profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- body_weight_entries: private time series. Identity immutable, value editable.
-- ---------------------------------------------------------------------------------------------

create table public.body_weight_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  measured_at timestamptz not null,
  weight_grams integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint body_weight_entries_weight_range check (weight_grams between 20000 and 400000)
);

create index body_weight_entries_owner_measured_idx on public.body_weight_entries (owner_id, measured_at desc);

create trigger body_weight_entries_set_updated_at before update on public.body_weight_entries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Grants: nothing for anon; explicit operations and updatable columns for authenticated.
-- ---------------------------------------------------------------------------------------------

revoke all on public.profiles, public.user_settings, public.weekly_goals, public.training_profiles,
  public.body_weight_entries from anon, authenticated;

grant select, insert on public.profiles to authenticated;
grant update (handle, display_name, avatar_path, visibility) on public.profiles to authenticated;

grant select, insert on public.user_settings to authenticated;
grant update (weight_unit, length_unit, timezone) on public.user_settings to authenticated;

grant select, insert, delete on public.weekly_goals to authenticated;
grant update (target_days, timezone) on public.weekly_goals to authenticated;

grant select, insert, delete on public.training_profiles to authenticated;
grant update (goal, age, height_cm, experience, equipment, limitations, available_weekdays, session_minutes)
  on public.training_profiles to authenticated;

grant select, insert, delete on public.body_weight_entries to authenticated;
grant update (measured_at, weight_grams) on public.body_weight_entries to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.weekly_goals enable row level security;
alter table public.training_profiles enable row level security;
alter table public.body_weight_entries enable row level security;

-- Profiles are identity visible to every signed-in user (private profiles still show limited
-- identity, docs/SCREENS_AND_FLOWS.md#social). Blocking will narrow this in M6.
create policy profiles_select_signed_in on public.profiles
  for select to authenticated using (true);
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy user_settings_select_own on public.user_settings
  for select to authenticated using (owner_id = (select auth.uid()));
create policy user_settings_insert_own on public.user_settings
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy user_settings_update_own on public.user_settings
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy weekly_goals_select_own on public.weekly_goals
  for select to authenticated using (owner_id = (select auth.uid()));
-- First goal may start this week (no earlier week counts as failed); later changes start next week.
create policy weekly_goals_insert_own_forward on public.weekly_goals
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and (
      effective_week > public.week_start(now(), timezone)
      or (effective_week = public.week_start(now(), timezone) and not public.has_weekly_goal((select auth.uid())))
    )
  );
create policy weekly_goals_update_own_future on public.weekly_goals
  for update to authenticated
  using (owner_id = (select auth.uid()) and effective_week > public.week_start(now(), timezone))
  with check (owner_id = (select auth.uid()) and effective_week > public.week_start(now(), timezone));
create policy weekly_goals_delete_own_future on public.weekly_goals
  for delete to authenticated
  using (owner_id = (select auth.uid()) and effective_week > public.week_start(now(), timezone));

create policy training_profiles_select_own on public.training_profiles
  for select to authenticated using (owner_id = (select auth.uid()));
create policy training_profiles_insert_own on public.training_profiles
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy training_profiles_update_own on public.training_profiles
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy training_profiles_delete_own on public.training_profiles
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy body_weight_entries_select_own on public.body_weight_entries
  for select to authenticated using (owner_id = (select auth.uid()));
create policy body_weight_entries_insert_own on public.body_weight_entries
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy body_weight_entries_update_own on public.body_weight_entries
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy body_weight_entries_delete_own on public.body_weight_entries
  for delete to authenticated using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- Storage: private avatars bucket. Signed-in users read (identity is visible to them); owners
-- write only inside their own '<uid>/' folder. Clients use short-lived signed URLs.
-- ---------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp']);

create policy avatars_select_signed_in on storage.objects
  for select to authenticated using (bucket_id = 'avatars');
create policy avatars_insert_own_folder on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_update_own_folder on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_delete_own_folder on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------------------------
-- RPCs (security invoker: RLS above still applies)
-- ---------------------------------------------------------------------------------------------

-- Onboarding writes identity, settings and the first weekly goal in one transaction, so a
-- partially onboarded account cannot exist. The first goal starts in the current local week.
create function public.complete_onboarding(
  p_handle text,
  p_display_name text,
  p_weight_unit public.weight_unit,
  p_length_unit public.length_unit,
  p_timezone text,
  p_target_days smallint
) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.profiles (handle, display_name) values (p_handle, btrim(p_display_name));
  insert into public.user_settings (weight_unit, length_unit, timezone)
  values (p_weight_unit, p_length_unit, p_timezone);
  insert into public.weekly_goals (effective_week, target_days, timezone)
  values (public.week_start(now(), p_timezone), p_target_days, p_timezone);
end $$;

-- Weekly goal changes take effect from the next local week (docs/PROGRESS_AND_GAMIFICATION.md).
-- Returns the week the new target starts.
create function public.schedule_weekly_goal(p_target_days smallint) returns date
language plpgsql security invoker set search_path = '' as $$
declare
  tz text;
  next_week date;
begin
  select timezone into tz from public.user_settings where owner_id = (select auth.uid());
  if tz is null then
    raise exception 'onboarding not completed' using errcode = 'P0002';
  end if;
  next_week := public.week_start(now(), tz) + 7;
  insert into public.weekly_goals (effective_week, target_days, timezone)
  values (next_week, p_target_days, tz)
  on conflict (owner_id, effective_week) do update set target_days = excluded.target_days;
  return next_week;
end $$;

revoke execute on function public.complete_onboarding(text, text, public.weight_unit, public.length_unit, text, smallint)
  from public, anon;
revoke execute on function public.schedule_weekly_goal(smallint) from public, anon;
grant execute on function public.complete_onboarding(text, text, public.weight_unit, public.length_unit, text, smallint)
  to authenticated;
grant execute on function public.schedule_weekly_goal(smallint) to authenticated;
