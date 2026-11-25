-- M5: coach requests/drafts and the explicit approval command (COACH-01, COACH-02, NFR-05, NFR-10).
-- Specs: docs/AI_COACH.md, docs/CONTRACTS.md, contracts.ts (CoachDraftResponse, CoachDraftContent, CoachApprovalDoc).
--
-- * The coach service calls these RPCs with the USER's access token (no service-role key), so every row
--   is owned by auth.uid(). Clients only read their own rows; writes go through the RPCs.
-- * coach_begin_request is idempotent on (owner, request_id) and rate limited per user.
-- * Approval is a `coach_approval` op of sync_push (replaces the M3 stub): draft must be `ready`,
--   approved once, and the active program must still match the reviewed base revision.

create table public.coach_requests (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  request_id uuid not null,
  mode text not null check (mode in ('create', 'adjust')),
  program_id uuid,
  base_revision integer check (base_revision >= 1),
  -- Minimized input (e.g. preferences text); never the full profile.
  input jsonb not null check (jsonb_typeof(input) = 'object' and pg_column_size(input) <= 8192),
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'needs_input', 'failed', 'approved', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, request_id)
);
create index coach_requests_owner_created_idx on public.coach_requests (owner_id, created_at desc);

create table public.coach_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  request_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'needs_input', 'failed', 'approved', 'cancelled')),
  base_program_id uuid,
  base_program_revision integer check (base_program_revision >= 1),
  content jsonb,
  clarification jsonb,
  error jsonb,
  schema_version integer not null default 1,
  model text check (char_length(model) <= 100),
  approval_id uuid unique,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, request_id),
  foreign key (owner_id, request_id) references public.coach_requests (owner_id, request_id) on delete cascade
);

create trigger coach_requests_set_updated_at before update on public.coach_requests
  for each row execute function public.set_updated_at();
create trigger coach_drafts_set_updated_at before update on public.coach_drafts
  for each row execute function public.set_updated_at();

-- The request mirrors its draft's status.
create function private.sync_coach_request_status() returns trigger
language plpgsql set search_path = '' as $$
begin
  update public.coach_requests set status = new.status
   where owner_id = new.owner_id and request_id = new.request_id;
  return new;
end $$;
create trigger coach_drafts_sync_request_status after update of status on public.coach_drafts
  for each row execute function private.sync_coach_request_status();

revoke all on public.coach_requests, public.coach_drafts from anon, authenticated;
grant select on public.coach_requests, public.coach_drafts to authenticated;
alter table public.coach_requests enable row level security;
alter table public.coach_drafts enable row level security;
create policy coach_requests_select_own on public.coach_requests
  for select to authenticated using (owner_id = (select auth.uid()));
create policy coach_drafts_select_own on public.coach_drafts
  for select to authenticated using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- CoachDraftResponse (contracts.ts).
create function private.coach_draft_json(d public.coach_drafts) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('draftId', d.id, 'requestId', d.request_id, 'status', d.status,
    'baseProgramId', d.base_program_id, 'baseProgramRevision', d.base_program_revision,
    'draft', d.content, 'clarification', d.clarification, 'error', d.error)
$$;

-- CoachDraftContent (contracts.ts).
create function private.validate_coach_content(c jsonb, p_path text default 'content') returns void
language plpgsql immutable set search_path = '' as $$
declare
  days jsonb;
  exs jsonb;
  e jsonb;
  x jsonb;
  dp text;
  xp text;
begin
  perform private.check_keys(c, p_path, array['title', 'explanation', 'assumptions', 'days']);
  perform private.get_text(c, 'title', p_path, 1, 100);
  perform private.get_text(c, 'explanation', p_path, 0, 4000);
  perform private.check_text_array(c, 'assumptions', p_path, 20, 500);
  days := private.get_array(c, 'days', p_path, 1, 7);
  for i in 0 .. jsonb_array_length(days) - 1 loop
    e := days -> i;
    dp := format('%s.days[%s]', p_path, i);
    perform private.check_keys(e, dp, array['weekday', 'routineName', 'exercises']);
    perform private.get_int(e, 'weekday', dp, 1, 7);
    perform private.get_text(e, 'routineName', dp, 1, 100);
    exs := private.get_array(e, 'exercises', dp, 1, 12);
    for k in 0 .. jsonb_array_length(exs) - 1 loop
      x := exs -> k;
      xp := format('%s.exercises[%s]', dp, k);
      perform private.check_keys(x, xp, array['exerciseKey', 'exerciseName', 'sets', 'repsMin', 'repsMax', 'restSeconds']);
      perform private.get_text(x, 'exerciseKey', xp, 1, 80, false, '^catalog:[A-Za-z0-9_-]{1,64}$');
      perform private.get_text(x, 'exerciseName', xp, 1, 100);
      perform private.get_int(x, 'sets', xp, 1, 10);
      if private.get_int(x, 'repsMin', xp, 1, 50) > private.get_int(x, 'repsMax', xp, 1, 50) then
        perform private.fail(xp, 'repsMin must not exceed repsMax');
      end if;
      perform private.get_int(x, 'restSeconds', xp, 0, 3600, true);
    end loop;
  end loop;
  if (select count(distinct y ->> 'weekday') from jsonb_array_elements(days) y) <> jsonb_array_length(days) then
    perform private.fail(p_path || '.days', 'one day per weekday at most');
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Coach service RPCs (user token)
-- ---------------------------------------------------------------------------------------------

-- Returns {"created": boolean, "draft": CoachDraftResponse}. A repeated request id returns the existing
-- draft (created = false) without counting against the rate limit. Rate limit: 10 new requests/hour
-- (raises SQLSTATE PT429 -> HTTP 429).
create function public.coach_begin_request(
  p_request_id uuid, p_mode text, p_program_id uuid, p_base_revision int, p_input jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  d public.coach_drafts;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- Serializes concurrent requests of one user (idempotency + rate limit).
  perform pg_advisory_xact_lock(hashtextextended('coach:' || uid::text, 0));

  select * into d from public.coach_drafts where owner_id = uid and request_id = p_request_id;
  if found then
    return jsonb_build_object('created', false, 'draft', private.coach_draft_json(d));
  end if;

  if p_request_id is null or p_mode is null or p_mode not in ('create', 'adjust') then
    raise exception 'invalid request' using errcode = '22023';
  end if;
  if p_mode = 'adjust' and p_program_id is null then
    raise exception 'adjust requires a program' using errcode = '22023';
  end if;
  if p_program_id is not null and not exists (
    select 1 from public.programs where id = p_program_id and owner_id = uid and not deleted
  ) then
    raise exception 'program not found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.coach_requests
       where owner_id = uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'rate_limited' using errcode = 'PT429';
  end if;

  insert into public.coach_requests (owner_id, request_id, mode, program_id, base_revision, input)
  values (uid, p_request_id, p_mode, p_program_id, p_base_revision, coalesce(p_input, '{}'::jsonb));
  insert into public.coach_drafts (owner_id, request_id, base_program_id, base_program_revision)
  values (uid, p_request_id, p_program_id, p_base_revision)
  returning * into d;
  return jsonb_build_object('created', true, 'draft', private.coach_draft_json(d));
end $$;

-- Persist the graph result. Only open drafts (pending/needs_input/failed) can change.
create function public.coach_save_draft(
  p_draft_id uuid, p_status text, p_content jsonb, p_clarification jsonb, p_error jsonb, p_model text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  d public.coach_drafts;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into d from public.coach_drafts where id = p_draft_id and owner_id = uid for update;
  if not found then
    raise exception 'draft not found' using errcode = 'P0002';
  end if;
  if d.status not in ('pending', 'needs_input', 'failed') then
    raise exception 'draft is %', d.status using errcode = '55000';
  end if;
  p_content := nullif(p_content, 'null'::jsonb);
  p_clarification := nullif(p_clarification, 'null'::jsonb);
  p_error := nullif(p_error, 'null'::jsonb);
  case p_status
    when 'pending' then
      null;
    when 'ready' then
      perform private.validate_coach_content(p_content);
      p_clarification := null;
      p_error := null;
    when 'needs_input' then
      perform private.check_keys(p_clarification, 'clarification', array['field', 'question']);
      perform private.get_text(p_clarification, 'field', 'clarification', 1, 100);
      perform private.get_text(p_clarification, 'question', 'clarification', 1, 1000);
      p_content := null;
      p_error := null;
    when 'failed' then
      perform private.check_keys(p_error, 'error', array['code', 'message', 'retryable']);
      perform private.get_text(p_error, 'code', 'error', 1, 100);
      perform private.get_text(p_error, 'message', 'error', 0, 1000);
      perform private.get_bool(p_error, 'retryable', 'error');
      p_content := null;
      p_clarification := null;
    else
      raise exception 'invalid status' using errcode = '22023';
  end case;
  update public.coach_drafts
     set status = p_status, content = p_content, clarification = p_clarification, error = p_error,
         model = coalesce(p_model, model)
   where id = d.id
  returning * into d;
  return private.coach_draft_json(d);
end $$;

create function public.coach_cancel_draft(p_draft_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  d public.coach_drafts;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into d from public.coach_drafts where id = p_draft_id and owner_id = uid for update;
  if not found then
    raise exception 'draft not found' using errcode = 'P0002';
  end if;
  if d.status = 'approved' then
    raise exception 'draft is approved' using errcode = '55000';
  end if;
  update public.coach_drafts set status = 'cancelled' where id = d.id returning * into d;
  return private.coach_draft_json(d);
end $$;

-- Minimal context for generation (caller's own rows only; RLS applies). Weights in grams.
create function public.coach_get_context() returns jsonb
language sql stable security invoker set search_path = '' as $$
  with active as (
    select id, revision, doc from public.programs
     where owner_id = (select auth.uid()) and active and not deleted
  )
  select jsonb_build_object(
    'trainingProfile', (
      select jsonb_build_object('goal', goal, 'age', age, 'heightCm', height_cm, 'experience', experience,
        'equipment', equipment, 'limitations', limitations, 'availableWeekdays', available_weekdays,
        'sessionMinutes', session_minutes)
        from public.training_profiles where owner_id = (select auth.uid())),
    'latestBodyWeightGrams', (
      select weight_grams from public.body_weight_entries
       where owner_id = (select auth.uid()) and not deleted order by measured_at desc limit 1),
    'activeProgram', (select jsonb_build_object('id', id, 'revision', revision, 'doc', doc) from active),
    'routines', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'revision', r.revision, 'doc', r.doc) order by r.name)
        from public.routines r
       where r.owner_id = (select auth.uid()) and not r.deleted
         and r.id in (select (dd ->> 'routineId')::uuid from active, jsonb_array_elements(active.doc -> 'days') dd)
    ), '[]'::jsonb),
    'recentSessions', coalesce((
      select jsonb_agg(x.j order by x.completed_at desc) from (
        select s.completed_at, jsonb_build_object('id', s.id, 'name', s.name, 'completedAt', s.completed_at,
          'localDate', s.local_date,
          'exercises', coalesce((
            select jsonb_agg(jsonb_build_object('exerciseKey', e ->> 'exerciseKey', 'exerciseName', e ->> 'exerciseName',
              'sets', (select coalesce(jsonb_agg(jsonb_build_object('reps', st -> 'reps', 'loadGrams', st -> 'loadGrams',
                         'loadMode', st -> 'loadMode')), '[]'::jsonb)
                         from jsonb_array_elements(e -> 'sets') st where (st ->> 'completed')::boolean)))
              from jsonb_array_elements(s.doc -> 'exercises') e), '[]'::jsonb)) as j
          from public.sessions s
         where s.owner_id = (select auth.uid()) and not s.deleted and s.status = 'completed'
         order by s.completed_at desc nulls last
         limit 10
      ) x
    ), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------------------------
-- Approval command (sync_push aggregate `coach_approval`, aggregateId = approvalId)
-- ---------------------------------------------------------------------------------------------

create or replace function private.apply_coach_approval(p_owner uuid, p_op_id uuid, p_aggregate_id uuid, d jsonb)
returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_approval uuid;
  v_draft_id uuid;
  v_base_id uuid;
  v_base_rev int;
  dr public.coach_drafts;
  act_id uuid;
  act_rev int;
  prog jsonb;
  prog_id uuid;
  routines jsonb;
  rt jsonb;
  cur_owner uuid;
  cur_rev int;
  new_rev int;
begin
  -- Validate the whole command first.
  perform private.check_keys(d, 'doc', array['approvalId', 'draftId', 'baseProgramId', 'baseProgramRevision',
    'program', 'routines']);
  v_approval := private.get_uuid(d, 'approvalId', 'doc');
  v_draft_id := private.get_uuid(d, 'draftId', 'doc');
  v_base_id := private.get_uuid(d, 'baseProgramId', 'doc', true);
  v_base_rev := private.get_int(d, 'baseProgramRevision', 'doc', 1, null, true);
  prog := d -> 'program';
  perform private.validate_program(prog, 'doc.program');
  routines := private.get_array(d, 'routines', 'doc', 1, 7);
  for i in 0 .. jsonb_array_length(routines) - 1 loop
    perform private.validate_routine(routines -> i, format('doc.routines[%s]', i));
  end loop;
  if v_approval <> p_aggregate_id then
    perform private.fail('doc.approvalId', 'must equal aggregateId');
  end if;
  if not (prog ->> 'active')::boolean or (prog ->> 'coachDraftId') is distinct from v_draft_id::text then
    perform private.fail('doc.program', 'must be active and reference the approved draft');
  end if;
  prog_id := (prog ->> 'id')::uuid;

  select * into dr from public.coach_drafts where id = v_draft_id and owner_id = p_owner for update;
  if not found then
    perform private.reject('draft_not_found', 'coach draft not found');
  end if;
  if dr.status = 'approved' then
    if dr.approval_id = v_approval then
      return jsonb_build_object('status', 'duplicate', 'opId', p_op_id,
        'revision', (select revision from public.programs where id = prog_id and owner_id = p_owner), 'deleted', false);
    end if;
    perform private.reject('already_approved', 'this draft was already approved');
  end if;
  if dr.status <> 'ready' then
    perform private.reject('draft_not_ready', 'only a ready draft can be approved');
  end if;

  -- Stale check against the active program the user reviewed.
  select id, revision into act_id, act_rev from public.programs
   where owner_id = p_owner and active and not deleted for update;
  if act_id is distinct from v_base_id or act_rev is distinct from v_base_rev then
    select id, revision into cur_owner, cur_rev from public.programs
     where id = coalesce(act_id, v_base_id) and owner_id = p_owner;
    if cur_rev is null then
      perform private.reject('stale_approval', 'the reviewed program no longer exists');
    end if;
    return jsonb_build_object('status', 'conflict', 'opId', p_op_id, 'serverRevision', cur_rev,
      'serverDeleted', (select deleted from public.programs where id = cur_owner),
      'serverDoc', private.aggregate_doc('program', cur_owner));
  end if;

  -- Apply routines, then the program (which deactivates the previous active one).
  for i in 0 .. jsonb_array_length(routines) - 1 loop
    rt := routines -> i;
    select owner_id, revision into cur_owner, cur_rev from public.routines where id = (rt ->> 'id')::uuid for update;
    if cur_owner is not null and cur_owner <> p_owner then
      perform private.reject('forbidden', 'aggregate id is not available');
    end if;
    new_rev := coalesce(cur_rev, 0) + 1;
    perform private.write_routine(p_owner, new_rev, rt);
    perform private.log_change(p_owner, 'routine', (rt ->> 'id')::uuid, new_rev, false);
  end loop;

  select owner_id, revision into cur_owner, cur_rev from public.programs where id = prog_id for update;
  if cur_owner is not null and cur_owner <> p_owner then
    perform private.reject('forbidden', 'aggregate id is not available');
  end if;
  new_rev := coalesce(cur_rev, 0) + 1;
  perform private.write_program(p_owner, new_rev, prog);
  perform private.log_change(p_owner, 'program', prog_id, new_rev, false);

  update public.coach_drafts set status = 'approved', approval_id = v_approval, approved_at = now() where id = dr.id;
  return private.applied(p_op_id, new_rev, false);
end $$;

revoke execute on all functions in schema private from public;
revoke execute on function public.coach_begin_request(uuid, text, uuid, int, jsonb),
  public.coach_save_draft(uuid, text, jsonb, jsonb, jsonb, text), public.coach_cancel_draft(uuid),
  public.coach_get_context() from public, anon;
grant execute on function public.coach_begin_request(uuid, text, uuid, int, jsonb),
  public.coach_save_draft(uuid, text, jsonb, jsonb, jsonb, text), public.coach_cancel_draft(uuid),
  public.coach_get_context() to authenticated;
