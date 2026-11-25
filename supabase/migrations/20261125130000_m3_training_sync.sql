-- M3: training aggregates and the sync protocol (SYNC-01, PLAN-01, SESSION-01..04, CAT-02, NFR-02/03/04).
-- Specs: docs/CONTRACTS.md, app/src/domain/contracts.ts (document shapes), docs/DATA_AND_SYNC.md (protocol),
-- docs/DECISIONS.md D-23. Dictionary: docs/DATA-DICTIONARY.md.
--
-- Model
-- * One row per aggregate: typed root columns for queries + `doc jsonb` (the whole validated document).
-- * Clients only SELECT their own rows (RLS). Every write goes through `sync_push`, one op per call:
--   receipt + domain write + change log (+ rewards, M4) commit in one transaction.
-- * `server_change_log` keeps one row per aggregate (its latest change); `seq` is per account and is
--   allocated under the `account_sync_state` row lock taken at the start of every push, so commit
--   order = seq order. `sync_pull` pages it by seq.
-- * Internal helpers live in schema `private` (not exposed by the API).

create schema private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------------------------
-- Document validation helpers. Invalid input raises SQLSTATE 22023 with a path-prefixed message;
-- sync_push maps it to a `rejected` result with code `invalid_doc`.
-- ---------------------------------------------------------------------------------------------

create function private.fail(p_path text, p_msg text) returns void
language plpgsql volatile set search_path = '' as $$
begin
  raise exception using errcode = '22023', message = p_path || ': ' || p_msg;
end $$;

-- Object with exactly these keys (all keys in the contracts are required; nullable ones may be null).
create function private.check_keys(j jsonb, p_path text, p_keys text[]) returns void
language plpgsql immutable set search_path = '' as $$
declare
  extra text;
  missing text;
begin
  if j is null or jsonb_typeof(j) <> 'object' then
    perform private.fail(p_path, 'must be an object');
  end if;
  select string_agg(k, ',') into extra from jsonb_object_keys(j) k where k <> all (p_keys);
  if extra is not null then
    perform private.fail(p_path, 'unknown keys ' || extra);
  end if;
  select string_agg(k, ',') into missing from unnest(p_keys) k where not j ? k;
  if missing is not null then
    perform private.fail(p_path, 'missing keys ' || missing);
  end if;
end $$;

create function private.get_text(
  j jsonb, p_key text, p_path text, p_min int, p_max int,
  p_nullable boolean default false, p_pattern text default null
) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v jsonb := j -> p_key;
  s text;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    if p_nullable then return null; end if;
    perform private.fail(p_path || '.' || p_key, 'is required');
  end if;
  if jsonb_typeof(v) <> 'string' then
    perform private.fail(p_path || '.' || p_key, 'must be a string');
  end if;
  s := v #>> '{}';
  if char_length(btrim(s)) < p_min or char_length(s) > p_max then
    perform private.fail(p_path || '.' || p_key, format('length must be %s-%s', p_min, p_max));
  end if;
  if p_pattern is not null and s !~ p_pattern then
    perform private.fail(p_path || '.' || p_key, 'has an invalid format');
  end if;
  return s;
end $$;

create function private.get_enum(j jsonb, p_key text, p_path text, p_values text[]) returns text
language plpgsql immutable set search_path = '' as $$
declare
  s text := private.get_text(j, p_key, p_path, 1, 64);
begin
  if s <> all (p_values) then
    perform private.fail(p_path || '.' || p_key, 'must be one of ' || array_to_string(p_values, ','));
  end if;
  return s;
end $$;

-- Lowercase UUID v4, as in contracts.ts.
create function private.get_uuid(j jsonb, p_key text, p_path text, p_nullable boolean default false) returns uuid
language sql immutable set search_path = '' as $$
  select private.get_text(j, p_key, p_path, 36, 36, p_nullable,
    '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')::uuid
$$;

create function private.get_int(
  j jsonb, p_key text, p_path text, p_min bigint, p_max bigint, p_nullable boolean default false
) returns bigint
language plpgsql immutable set search_path = '' as $$
declare
  v jsonb := j -> p_key;
  n numeric;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    if p_nullable then return null; end if;
    perform private.fail(p_path || '.' || p_key, 'is required');
  end if;
  if jsonb_typeof(v) <> 'number' then
    perform private.fail(p_path || '.' || p_key, 'must be a number');
  end if;
  n := v::numeric;
  if n <> trunc(n) then
    perform private.fail(p_path || '.' || p_key, 'must be an integer');
  end if;
  if n < coalesce(p_min, -2147483648) or n > coalesce(p_max, 2147483647) then
    perform private.fail(p_path || '.' || p_key, format('must be between %s and %s', p_min, p_max));
  end if;
  return n::bigint;
end $$;

create function private.get_bool(j jsonb, p_key text, p_path text) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(j -> p_key) is distinct from 'boolean' then
    perform private.fail(p_path || '.' || p_key, 'must be a boolean');
  end if;
  return (j ->> p_key)::boolean;
end $$;

-- ISO-8601 timestamp with offset (zod `datetime({ offset: true })`).
create function private.get_ts(j jsonb, p_key text, p_path text, p_nullable boolean default false) returns timestamptz
language plpgsql stable set search_path = '' as $$
declare
  s text := private.get_text(j, p_key, p_path, 1, 40, p_nullable,
    '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$');
begin
  return s::timestamptz;
exception when datetime_field_overflow or invalid_datetime_format then
  perform private.fail(p_path || '.' || p_key, 'is not a valid timestamp');
  return null;
end $$;

create function private.get_date(j jsonb, p_key text, p_path text, p_nullable boolean default false) returns date
language plpgsql immutable set search_path = '' as $$
declare
  s text := private.get_text(j, p_key, p_path, 10, 10, p_nullable, '^\d{4}-\d{2}-\d{2}$');
begin
  return s::date;
exception when datetime_field_overflow or invalid_datetime_format then
  perform private.fail(p_path || '.' || p_key, 'is not a valid date');
  return null;
end $$;

create function private.get_array(j jsonb, p_key text, p_path text, p_min int, p_max int) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v jsonb := j -> p_key;
begin
  if jsonb_typeof(v) is distinct from 'array' then
    perform private.fail(p_path || '.' || p_key, 'must be an array');
  end if;
  if jsonb_array_length(v) < p_min or jsonb_array_length(v) > p_max then
    perform private.fail(p_path || '.' || p_key, format('must have %s-%s items', p_min, p_max));
  end if;
  return v;
end $$;

create function private.check_text_array(j jsonb, p_key text, p_path text, p_max_items int, p_max_len int) returns void
language plpgsql immutable set search_path = '' as $$
declare
  arr jsonb := private.get_array(j, p_key, p_path, 0, p_max_items);
  e jsonb;
begin
  for e in select * from jsonb_array_elements(arr) loop
    if jsonb_typeof(e) <> 'string' or char_length(e #>> '{}') > p_max_len then
      perform private.fail(p_path || '.' || p_key, format('items must be strings of at most %s chars', p_max_len));
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Per-aggregate validators (mirror contracts.ts).
-- ---------------------------------------------------------------------------------------------

create function private.validate_custom_exercise(d jsonb, p_path text default 'doc') returns void
language plpgsql immutable set search_path = '' as $$
begin
  perform private.check_keys(d, p_path, array['id', 'name', 'primaryMuscles', 'secondaryMuscles', 'equipment',
    'instructions', 'loadMode', 'archived']);
  perform private.get_uuid(d, 'id', p_path);
  perform private.get_text(d, 'name', p_path, 1, 100);
  perform private.check_text_array(d, 'primaryMuscles', p_path, 10, 50);
  perform private.check_text_array(d, 'secondaryMuscles', p_path, 10, 50);
  perform private.check_text_array(d, 'equipment', p_path, 10, 50);
  perform private.check_text_array(d, 'instructions', p_path, 30, 500);
  perform private.get_enum(d, 'loadMode', p_path, array['external', 'bodyweight', 'assisted']);
  perform private.get_bool(d, 'archived', p_path);
end $$;

create function private.validate_routine(d jsonb, p_path text default 'doc') returns void
language plpgsql immutable set search_path = '' as $$
declare
  exs jsonb;
  sets jsonb;
  e jsonb;
  s jsonb;
  ep text;
  sp text;
begin
  perform private.check_keys(d, p_path, array['id', 'name', 'notes', 'archived', 'origin', 'exercises']);
  perform private.get_uuid(d, 'id', p_path);
  perform private.get_text(d, 'name', p_path, 1, 100);
  perform private.get_text(d, 'notes', p_path, 0, 2000);
  perform private.get_bool(d, 'archived', p_path);
  perform private.get_enum(d, 'origin', p_path, array['manual', 'session', 'copy', 'coach']);
  exs := private.get_array(d, 'exercises', p_path, 0, 50);
  for i in 0 .. jsonb_array_length(exs) - 1 loop
    e := exs -> i;
    ep := format('%s.exercises[%s]', p_path, i);
    perform private.check_keys(e, ep, array['id', 'position', 'exerciseKey', 'exerciseName', 'notes', 'restSeconds', 'sets']);
    perform private.get_uuid(e, 'id', ep);
    perform private.get_int(e, 'position', ep, 0, null);
    perform private.get_text(e, 'exerciseKey', ep, 1, 80, false,
      '^(catalog:[A-Za-z0-9_-]{1,64}|custom:[0-9a-f-]{36})$');
    perform private.get_text(e, 'exerciseName', ep, 1, 100);
    perform private.get_text(e, 'notes', ep, 0, 2000);
    perform private.get_int(e, 'restSeconds', ep, 0, 3600, true);
    sets := private.get_array(e, 'sets', ep, 0, 50);
    for k in 0 .. jsonb_array_length(sets) - 1 loop
      s := sets -> k;
      sp := format('%s.sets[%s]', ep, k);
      perform private.check_keys(s, sp, array['id', 'position', 'targetReps', 'targetLoadGrams', 'loadMode']);
      perform private.get_uuid(s, 'id', sp);
      perform private.get_int(s, 'position', sp, 0, null);
      perform private.get_int(s, 'targetReps', sp, 0, 1000, true);
      perform private.get_int(s, 'targetLoadGrams', sp, 0, 1000000, true);
      perform private.get_enum(s, 'loadMode', sp, array['external', 'bodyweight', 'assisted']);
    end loop;
  end loop;
end $$;

create function private.validate_program(d jsonb, p_path text default 'doc') returns void
language plpgsql immutable set search_path = '' as $$
declare
  days jsonb;
  e jsonb;
  dp text;
begin
  perform private.check_keys(d, p_path, array['id', 'name', 'active', 'origin', 'coachDraftId', 'days']);
  perform private.get_uuid(d, 'id', p_path);
  perform private.get_text(d, 'name', p_path, 1, 100);
  perform private.get_bool(d, 'active', p_path);
  perform private.get_enum(d, 'origin', p_path, array['manual', 'coach']);
  perform private.get_uuid(d, 'coachDraftId', p_path, true);
  days := private.get_array(d, 'days', p_path, 0, 7);
  for i in 0 .. jsonb_array_length(days) - 1 loop
    e := days -> i;
    dp := format('%s.days[%s]', p_path, i);
    perform private.check_keys(e, dp, array['weekday', 'routineId']);
    perform private.get_int(e, 'weekday', dp, 1, 7);
    perform private.get_uuid(e, 'routineId', dp);
  end loop;
  if (select count(distinct x ->> 'weekday') from jsonb_array_elements(days) x) <> jsonb_array_length(days) then
    perform private.fail(p_path || '.days', 'one routine per weekday at most');
  end if;
end $$;

create function private.validate_session(d jsonb, p_path text default 'doc') returns void
language plpgsql stable set search_path = '' as $$
declare
  exs jsonb;
  sets jsonb;
  e jsonb;
  s jsonb;
  ep text;
  sp text;
begin
  perform private.check_keys(d, p_path, array['id', 'routineId', 'name', 'status', 'startedAt', 'completedAt',
    'timezone', 'localDate', 'notes', 'exercises']);
  perform private.get_uuid(d, 'id', p_path);
  perform private.get_uuid(d, 'routineId', p_path, true);
  perform private.get_text(d, 'name', p_path, 1, 100);
  perform private.get_enum(d, 'status', p_path, array['active', 'completed']);
  perform private.get_ts(d, 'startedAt', p_path);
  perform private.get_ts(d, 'completedAt', p_path, true);
  perform private.get_text(d, 'timezone', p_path, 1, 64);
  perform private.get_date(d, 'localDate', p_path, true);
  perform private.get_text(d, 'notes', p_path, 0, 2000);
  exs := private.get_array(d, 'exercises', p_path, 0, 50);
  for i in 0 .. jsonb_array_length(exs) - 1 loop
    e := exs -> i;
    ep := format('%s.exercises[%s]', p_path, i);
    perform private.check_keys(e, ep, array['id', 'position', 'exerciseKey', 'exerciseName', 'notes', 'restSeconds', 'sets']);
    perform private.get_uuid(e, 'id', ep);
    perform private.get_int(e, 'position', ep, 0, null);
    perform private.get_text(e, 'exerciseKey', ep, 1, 80, false,
      '^(catalog:[A-Za-z0-9_-]{1,64}|custom:[0-9a-f-]{36})$');
    perform private.get_text(e, 'exerciseName', ep, 1, 100);
    perform private.get_text(e, 'notes', ep, 0, 2000);
    perform private.get_int(e, 'restSeconds', ep, 0, 3600, true);
    sets := private.get_array(e, 'sets', ep, 0, 100);
    for k in 0 .. jsonb_array_length(sets) - 1 loop
      s := sets -> k;
      sp := format('%s.sets[%s]', ep, k);
      perform private.check_keys(s, sp, array['id', 'position', 'targetReps', 'targetLoadGrams', 'reps', 'loadGrams',
        'loadMode', 'completed', 'completedAt']);
      perform private.get_uuid(s, 'id', sp);
      perform private.get_int(s, 'position', sp, 0, null);
      perform private.get_int(s, 'targetReps', sp, 0, 1000, true);
      perform private.get_int(s, 'targetLoadGrams', sp, 0, 1000000, true);
      perform private.get_int(s, 'reps', sp, 0, 1000, true);
      perform private.get_int(s, 'loadGrams', sp, 0, 1000000, true);
      perform private.get_enum(s, 'loadMode', sp, array['external', 'bodyweight', 'assisted']);
      perform private.get_bool(s, 'completed', sp);
      perform private.get_ts(s, 'completedAt', sp, true);
    end loop;
  end loop;
end $$;

create function private.validate_body_weight(d jsonb, p_path text default 'doc') returns void
language plpgsql stable set search_path = '' as $$
begin
  perform private.check_keys(d, p_path, array['id', 'measuredAt', 'weightGrams']);
  perform private.get_uuid(d, 'id', p_path);
  perform private.get_ts(d, 'measuredAt', p_path);
  perform private.get_int(d, 'weightGrams', p_path, 20000, 400000);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Aggregate tables. `id` is client-supplied (UUID v4) and globally unique, so an id owned by another
-- account is detected and rejected, never overwritten. `doc` is the full validated document.
-- ---------------------------------------------------------------------------------------------

create table public.custom_exercises (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  revision integer not null check (revision >= 1),
  deleted boolean not null default false,
  name text not null,
  archived boolean not null,
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index custom_exercises_owner_idx on public.custom_exercises (owner_id);

create table public.routines (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  revision integer not null check (revision >= 1),
  deleted boolean not null default false,
  name text not null,
  archived boolean not null,
  origin text not null check (origin in ('manual', 'session', 'copy', 'coach')),
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index routines_owner_idx on public.routines (owner_id);

create table public.programs (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  revision integer not null check (revision >= 1),
  deleted boolean not null default false,
  name text not null,
  active boolean not null,
  origin text not null check (origin in ('manual', 'coach')),
  coach_draft_id uuid,
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index programs_owner_idx on public.programs (owner_id);
-- At most one active program per account.
create unique index programs_one_active_per_owner on public.programs (owner_id) where active and not deleted;

create table public.sessions (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  revision integer not null check (revision >= 1),
  deleted boolean not null default false,
  routine_id uuid,
  name text not null,
  status text not null check (status in ('active', 'completed')),
  started_at timestamptz not null,
  completed_at timestamptz,
  timezone text not null,
  local_date date,
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sessions_owner_completed_idx on public.sessions (owner_id, completed_at desc);
-- One active workout at a time.
create unique index sessions_one_active_per_owner on public.sessions (owner_id) where status = 'active' and not deleted;

-- body_weight_entries (M1) becomes the body_weight aggregate; existing rows keep their data at revision 1.
alter table public.body_weight_entries
  add column revision integer not null default 1 check (revision >= 1),
  add column deleted boolean not null default false;

create trigger custom_exercises_set_updated_at before update on public.custom_exercises
  for each row execute function public.set_updated_at();
create trigger routines_set_updated_at before update on public.routines
  for each row execute function public.set_updated_at();
create trigger programs_set_updated_at before update on public.programs
  for each row execute function public.set_updated_at();
create trigger sessions_set_updated_at before update on public.sessions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Sync bookkeeping
-- ---------------------------------------------------------------------------------------------

-- Per-account sequence; its row lock serializes pushes of one account.
create table public.account_sync_state (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  last_seq bigint not null default 0
);

-- Applied operations. The stored result is returned (as `duplicate`) for a repeated opId.
-- Conflicts and rejections are not receipted: re-sending re-evaluates them.
create table public.operation_receipts (
  owner_id uuid not null references auth.users (id) on delete cascade,
  op_id uuid not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, op_id)
);

-- Latest change per aggregate (older entries for the same aggregate are replaced: pulls only need
-- the current state). `seq` is strictly increasing per owner.
create table public.server_change_log (
  owner_id uuid not null references auth.users (id) on delete cascade,
  seq bigint not null,
  aggregate_type text not null check (aggregate_type in ('custom_exercise', 'routine', 'program', 'session', 'body_weight')),
  aggregate_id uuid not null,
  revision integer not null,
  deleted boolean not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, seq),
  unique (owner_id, aggregate_type, aggregate_id)
);

-- Backfill M1 body weight rows so existing data reaches devices through sync_pull.
insert into public.account_sync_state (owner_id, last_seq)
select owner_id, count(*) from public.body_weight_entries group by owner_id;
insert into public.server_change_log (owner_id, seq, aggregate_type, aggregate_id, revision, deleted)
select owner_id, row_number() over (partition by owner_id order by created_at, id), 'body_weight', id, revision, deleted
  from public.body_weight_entries;

-- ---------------------------------------------------------------------------------------------
-- Grants and RLS: clients read their own rows; writes only through sync_push (security definer).
-- ---------------------------------------------------------------------------------------------

revoke all on public.custom_exercises, public.routines, public.programs, public.sessions,
  public.account_sync_state, public.operation_receipts, public.server_change_log from anon, authenticated;
revoke all on public.body_weight_entries from anon, authenticated;
grant select on public.custom_exercises, public.routines, public.programs, public.sessions,
  public.body_weight_entries, public.server_change_log to authenticated;

drop policy body_weight_entries_insert_own on public.body_weight_entries;
drop policy body_weight_entries_update_own on public.body_weight_entries;
drop policy body_weight_entries_delete_own on public.body_weight_entries;

alter table public.custom_exercises enable row level security;
alter table public.routines enable row level security;
alter table public.programs enable row level security;
alter table public.sessions enable row level security;
alter table public.account_sync_state enable row level security;
alter table public.operation_receipts enable row level security;
alter table public.server_change_log enable row level security;

create policy custom_exercises_select_own on public.custom_exercises
  for select to authenticated using (owner_id = (select auth.uid()));
create policy routines_select_own on public.routines
  for select to authenticated using (owner_id = (select auth.uid()));
create policy programs_select_own on public.programs
  for select to authenticated using (owner_id = (select auth.uid()));
create policy sessions_select_own on public.sessions
  for select to authenticated using (owner_id = (select auth.uid()));
create policy server_change_log_select_own on public.server_change_log
  for select to authenticated using (owner_id = (select auth.uid()));
-- account_sync_state / operation_receipts: no policies, no grants (server internal).

-- ---------------------------------------------------------------------------------------------
-- Sync internals
-- ---------------------------------------------------------------------------------------------

-- Business rejection: SQLSTATE GY001, message = code, detail = human message.
create function private.reject(p_code text, p_message text) returns void
language plpgsql volatile set search_path = '' as $$
begin
  raise exception using errcode = 'GY001', message = p_code, detail = p_message;
end $$;

create function private.log_change(p_owner uuid, p_type text, p_id uuid, p_revision int, p_deleted boolean) returns void
language plpgsql set search_path = '' as $$
declare
  s bigint;
begin
  insert into public.account_sync_state as a (owner_id, last_seq) values (p_owner, 1)
  on conflict (owner_id) do update set last_seq = a.last_seq + 1
  returning last_seq into s;
  insert into public.server_change_log as c (owner_id, seq, aggregate_type, aggregate_id, revision, deleted)
  values (p_owner, s, p_type, p_id, p_revision, p_deleted)
  on conflict (owner_id, aggregate_type, aggregate_id)
  do update set seq = excluded.seq, revision = excluded.revision, deleted = excluded.deleted, created_at = now();
end $$;

-- Current document of an aggregate (null for tombstones / unknown ids).
create function private.aggregate_doc(p_type text, p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select case p_type
    when 'custom_exercise' then (select doc from public.custom_exercises where id = p_id and not deleted)
    when 'routine' then (select doc from public.routines where id = p_id and not deleted)
    when 'program' then (select doc from public.programs where id = p_id and not deleted)
    when 'session' then (select doc from public.sessions where id = p_id and not deleted)
    when 'body_weight' then (
      select jsonb_build_object('id', id, 'measuredAt', measured_at, 'weightGrams', weight_grams)
        from public.body_weight_entries where id = p_id and not deleted)
  end
$$;

create function private.applied(p_op_id uuid, p_revision int, p_deleted boolean) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('status', 'applied', 'opId', p_op_id, 'revision', p_revision, 'deleted', p_deleted)
$$;

-- Routine write (shared with coach approval). Caller checked ownership and computed the revision.
create function private.write_routine(p_owner uuid, p_revision int, d jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  insert into public.routines as r (id, owner_id, revision, deleted, name, archived, origin, doc)
  values ((d ->> 'id')::uuid, p_owner, p_revision, false, d ->> 'name', (d ->> 'archived')::boolean, d ->> 'origin', d)
  on conflict (id) do update
    set revision = excluded.revision, deleted = false, name = excluded.name, archived = excluded.archived,
        origin = excluded.origin, doc = excluded.doc
    where r.owner_id = excluded.owner_id;
end $$;

-- Program write. Activating a program deactivates the previous active one (new revision + change log).
create function private.write_program(p_owner uuid, p_revision int, d jsonb) returns void
language plpgsql set search_path = '' as $$
declare
  pid uuid := (d ->> 'id')::uuid;
  other record;
begin
  if (d ->> 'active')::boolean then
    for other in
      update public.programs
         set active = false, doc = jsonb_set(doc, '{active}', 'false'), revision = revision + 1
       where owner_id = p_owner and active and not deleted and id <> pid
      returning id, revision
    loop
      perform private.log_change(p_owner, 'program', other.id, other.revision, false);
    end loop;
  end if;
  insert into public.programs as p (id, owner_id, revision, deleted, name, active, origin, coach_draft_id, doc)
  values (pid, p_owner, p_revision, false, d ->> 'name', (d ->> 'active')::boolean, d ->> 'origin',
          (d ->> 'coachDraftId')::uuid, d)
  on conflict (id) do update
    set revision = excluded.revision, deleted = false, name = excluded.name, active = excluded.active,
        origin = excluded.origin, coach_draft_id = excluded.coach_draft_id, doc = excluded.doc
    where p.owner_id = excluded.owner_id;
end $$;

-- M4 replaces this with the reward reconciliation (same transaction as the session write).
create function private.reconcile_session_rewards(p_owner uuid, p_session_id uuid, p_old_ts timestamptz) returns void
language plpgsql set search_path = '' as $$
begin
  perform p_owner, p_session_id, p_old_ts;
end $$;

-- M5 replaces this with the real coach approval command.
create function private.apply_coach_approval(p_owner uuid, p_op_id uuid, p_aggregate_id uuid, d jsonb) returns jsonb
language plpgsql set search_path = '' as $$
begin
  perform p_owner, p_op_id, p_aggregate_id, d;
  perform private.reject('unsupported', 'coach approval is not available yet');
  return null;
end $$;

-- Upsert/delete of one ordinary aggregate.
create function private.apply_aggregate(
  p_owner uuid, p_op_id uuid, p_type text, p_id uuid, p_action text, p_base int, d jsonb
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  tbl text := case p_type
    when 'custom_exercise' then 'custom_exercises' when 'routine' then 'routines' when 'program' then 'programs'
    when 'session' then 'sessions' when 'body_weight' then 'body_weight_entries' end;
  cur_owner uuid;
  cur_rev int;
  cur_deleted boolean;
  old_ts timestamptz;
  new_rev int;
begin
  execute format('select owner_id, revision, deleted from public.%I where id = $1 for update', tbl)
    into cur_owner, cur_rev, cur_deleted using p_id;

  if cur_owner is not null and cur_owner <> p_owner then
    perform private.reject('forbidden', 'aggregate id is not available');
  end if;

  if cur_owner is null then
    if p_base is not null then
      perform private.reject('unknown_aggregate', 'base revision given for an aggregate the server does not have');
    end if;
    if p_action = 'delete' then
      -- Created and deleted before it ever synced: nothing to store.
      return private.applied(p_op_id, 1, true);
    end if;
    new_rev := 1;
  elsif p_base is distinct from cur_rev then
    return jsonb_build_object('status', 'conflict', 'opId', p_op_id, 'serverRevision', cur_rev,
      'serverDeleted', cur_deleted, 'serverDoc', private.aggregate_doc(p_type, p_id));
  else
    new_rev := cur_rev + 1;
  end if;

  if p_type = 'session' then
    select coalesce(completed_at, started_at) into old_ts from public.sessions where id = p_id;
  end if;

  if p_action = 'delete' then
    execute format('update public.%I set deleted = true, revision = $2 where id = $1', tbl) using p_id, new_rev;
  else
    if (d ->> 'id') is distinct from p_id::text then
      perform private.fail('doc.id', 'must equal aggregateId');
    end if;
    case p_type
      when 'custom_exercise' then
        perform private.validate_custom_exercise(d);
        insert into public.custom_exercises as c (id, owner_id, revision, deleted, name, archived, doc)
        values (p_id, p_owner, new_rev, false, d ->> 'name', (d ->> 'archived')::boolean, d)
        on conflict (id) do update
          set revision = excluded.revision, deleted = false, name = excluded.name, archived = excluded.archived,
              doc = excluded.doc
          where c.owner_id = excluded.owner_id;
      when 'routine' then
        perform private.validate_routine(d);
        perform private.write_routine(p_owner, new_rev, d);
      when 'program' then
        perform private.validate_program(d);
        perform private.write_program(p_owner, new_rev, d);
      when 'session' then
        perform private.validate_session(d);
        if d ->> 'status' = 'active' and exists (
          select 1 from public.sessions
           where owner_id = p_owner and status = 'active' and not deleted and id <> p_id
        ) then
          perform private.reject('active_session_exists', 'another workout is already active');
        end if;
        insert into public.sessions as s (id, owner_id, revision, deleted, routine_id, name, status, started_at,
          completed_at, timezone, local_date, doc)
        values (p_id, p_owner, new_rev, false, (d ->> 'routineId')::uuid, d ->> 'name', d ->> 'status',
          (d ->> 'startedAt')::timestamptz, (d ->> 'completedAt')::timestamptz, d ->> 'timezone',
          (d ->> 'localDate')::date, d)
        on conflict (id) do update
          set revision = excluded.revision, deleted = false, routine_id = excluded.routine_id, name = excluded.name,
              status = excluded.status, started_at = excluded.started_at, completed_at = excluded.completed_at,
              timezone = excluded.timezone, local_date = excluded.local_date, doc = excluded.doc
          where s.owner_id = excluded.owner_id;
      when 'body_weight' then
        perform private.validate_body_weight(d);
        insert into public.body_weight_entries as b (id, owner_id, revision, deleted, measured_at, weight_grams)
        values (p_id, p_owner, new_rev, false, (d ->> 'measuredAt')::timestamptz, (d ->> 'weightGrams')::int)
        on conflict (id) do update
          set revision = excluded.revision, deleted = false, measured_at = excluded.measured_at,
              weight_grams = excluded.weight_grams
          where b.owner_id = excluded.owner_id;
    end case;
  end if;

  perform private.log_change(p_owner, p_type, p_id, new_rev, p_action = 'delete');
  if p_type = 'session' then
    perform private.reconcile_session_rewards(p_owner, p_id, old_ts);
  end if;
  return private.applied(p_op_id, new_rev, p_action = 'delete');
end $$;

-- ---------------------------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------------------------

-- PushOp -> PushResult (contracts.ts). Owner is auth.uid() only. One transaction per op.
create function public.sync_push(p_op jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v_op_id uuid;
  v_type text;
  v_id uuid;
  v_action text;
  v_base int;
  v_doc jsonb;
  v_result jsonb;
  v_code text;
  v_msg text;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- Without a valid opId there is nothing to answer to: plain error (HTTP 400).
  v_op_id := private.get_uuid(p_op, 'opId', 'op');

  -- Serialize this account's pushes (and seq allocation) until commit.
  insert into public.account_sync_state (owner_id) values (uid) on conflict (owner_id) do nothing;
  perform 1 from public.account_sync_state where owner_id = uid for update;

  select r.result into v_result from public.operation_receipts r where r.owner_id = uid and r.op_id = v_op_id;
  if found then
    return jsonb_set(v_result, '{status}', '"duplicate"');
  end if;

  begin
    perform private.check_keys(p_op, 'op', array['opId', 'aggregateType', 'aggregateId', 'action', 'baseRevision', 'doc']);
    v_type := private.get_enum(p_op, 'aggregateType', 'op',
      array['custom_exercise', 'routine', 'program', 'session', 'body_weight', 'coach_approval']);
    v_id := private.get_uuid(p_op, 'aggregateId', 'op');
    v_action := private.get_enum(p_op, 'action', 'op', array['upsert', 'delete']);
    v_base := private.get_int(p_op, 'baseRevision', 'op', 1, null, true);
    v_doc := nullif(p_op -> 'doc', 'null'::jsonb);
    if v_action = 'upsert' and v_doc is null then
      perform private.fail('op.doc', 'is required for upsert');
    end if;

    if v_type = 'coach_approval' then
      if v_action <> 'upsert' then
        perform private.fail('op.action', 'coach_approval only supports upsert');
      end if;
      v_result := private.apply_coach_approval(uid, v_op_id, v_id, v_doc);
    else
      v_result := private.apply_aggregate(uid, v_op_id, v_type, v_id, v_action, v_base, v_doc);
    end if;
  exception
    when sqlstate '22023' or check_violation or not_null_violation or invalid_text_representation then
      get stacked diagnostics v_msg = message_text;
      return jsonb_build_object('status', 'rejected', 'opId', v_op_id, 'code', 'invalid_doc', 'message', v_msg);
    when sqlstate 'GY001' then
      get stacked diagnostics v_code = message_text, v_msg = pg_exception_detail;
      return jsonb_build_object('status', 'rejected', 'opId', v_op_id, 'code', v_code, 'message', v_msg);
    when unique_violation then
      return jsonb_build_object('status', 'rejected', 'opId', v_op_id, 'code', 'constraint_violation',
        'message', 'the change violates a uniqueness rule');
  end;

  if v_result ->> 'status' = 'applied' then
    insert into public.operation_receipts (owner_id, op_id, aggregate_type, aggregate_id, result)
    values (uid, v_op_id, v_type, v_id, v_result);
  end if;
  return v_result;
end $$;

-- ChangePage for the caller: changes with seq > p_after, ascending, at most p_limit (1-500, default 100).
create function public.sync_pull(p_after bigint, p_limit int) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  lim int := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_after bigint := greatest(coalesce(p_after, 0), 0);
  v_changes jsonb;
  v_last bigint;
  v_more boolean;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  with page as (
    select c.*, row_number() over (order by c.seq) as rn
      from (select * from public.server_change_log
             where owner_id = uid and seq > v_after order by seq limit lim + 1) c
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'seq', seq, 'aggregateType', aggregate_type, 'aggregateId', aggregate_id, 'revision', revision,
           'deleted', deleted,
           'doc', case when deleted then null else private.aggregate_doc(aggregate_type, aggregate_id) end
         ) order by seq) filter (where rn <= lim), '[]'::jsonb),
         max(seq) filter (where rn <= lim),
         count(*) > lim
    into v_changes, v_last, v_more
    from page;
  return jsonb_build_object('changes', v_changes, 'nextCursor', coalesce(v_last, v_after), 'hasMore', v_more);
end $$;

revoke execute on all functions in schema private from public;
revoke execute on function public.sync_push(jsonb), public.sync_pull(bigint, int) from public, anon;
grant execute on function public.sync_push(jsonb), public.sync_pull(bigint, int) to authenticated;
