-- Coach hardening (COACH-01, COACH-02, NFR-05, NFR-10). Replaces three M5 functions; no table changes to M5 tables.
--
-- 1. coach_begin_request: the operator's daily request cap is enforced here with an atomic counter (one row per
--    UTC day, upsert row lock), so it holds across coach-api processes and concurrent requests. The per-user hourly
--    limit stays under the per-user advisory lock; the caller may only LOWER it (max 10/hour). A repeated request
--    id whose draft is still `pending` after 5 minutes (service crashed mid-run) is expired to a retryable `failed`.
-- 2. coach_save_draft: only a `pending` draft changes. Any later save (late provider result after cancel/timeout)
--    returns the stored draft unchanged, so a cancelled draft never flips to `ready`. Approved still raises 55000.
-- 3. apply_coach_approval (sync_push `coach_approval`): additionally requires the approval base to equal the base
--    the draft was generated against, and revalidates the edited command against the server-stored draft:
--    program origin coach, one distinct routine per program day (all included in the command), weekdays and
--    exercise keys taken from the draft (the catalog lives in the app bundle, not in the database, so the
--    validated draft content is the server's catalog reference), sets 1-10, targetReps 1-50, no load targets,
--    and fresh program/routine ids (a coach approval never overwrites an existing snapshot).
--    Concurrency: sync_push holds the per-account account_sync_state row lock and this function locks the draft
--    row, so two approvals (same or different drafts) of one account are serialized; the second sees the new
--    active program and gets a conflict.

create table private.coach_daily_usage (
  day date primary key,
  requests integer not null check (requests >= 0)
);
revoke all on private.coach_daily_usage from public, anon, authenticated;

drop function public.coach_begin_request(uuid, text, uuid, int, jsonb);

-- Returns {"created": boolean, "draft": CoachDraftResponse}. p_hourly_limit (<= 10) and p_daily_cap come from the
-- coach service configuration (COACH_USER_REQUESTS_PER_HOUR / COACH_DAILY_REQUEST_CAP). A user calling the RPC
-- directly can only create pending drafts (no model call) and still counts against both limits.
create function public.coach_begin_request(
  p_request_id uuid, p_mode text, p_program_id uuid, p_base_revision int, p_input jsonb,
  p_hourly_limit int default null, p_daily_cap int default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  d public.coach_drafts;
  used int;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- Serializes concurrent requests of one user (idempotency + hourly limit).
  perform pg_advisory_xact_lock(hashtextextended('coach:' || uid::text, 0));

  select * into d from public.coach_drafts where owner_id = uid and request_id = p_request_id;
  if found then
    if d.status = 'pending' and d.created_at < now() - interval '5 minutes' then
      update public.coach_drafts
         set status = 'failed', error = jsonb_build_object('code', 'timeout', 'retryable', true,
           'message', 'The coach took too long. Try again.')
       where id = d.id
      returning * into d;
    end if;
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
       where owner_id = uid and created_at > now() - interval '1 hour')
     >= greatest(1, least(coalesce(p_hourly_limit, 10), 10)) then
    raise exception 'rate_limited' using errcode = 'PT429';
  end if;

  -- Atomic across processes: the upsert takes the day row lock; the exception rolls the increment back.
  insert into private.coach_daily_usage as u (day, requests) values ((now() at time zone 'utc')::date, 1)
  on conflict (day) do update set requests = u.requests + 1
  returning requests into used;
  if p_daily_cap is not null and used > p_daily_cap then
    raise exception 'budget_exhausted' using errcode = 'PT429';
  end if;

  insert into public.coach_requests (owner_id, request_id, mode, program_id, base_revision, input)
  values (uid, p_request_id, p_mode, p_program_id, p_base_revision, coalesce(p_input, '{}'::jsonb));
  insert into public.coach_drafts (owner_id, request_id, base_program_id, base_program_revision)
  values (uid, p_request_id, p_program_id, p_base_revision)
  returning * into d;
  return jsonb_build_object('created', true, 'draft', private.coach_draft_json(d));
end $$;

-- Persist the graph result. Only a pending draft changes; the first terminal write wins.
create or replace function public.coach_save_draft(
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
  if d.status = 'approved' then
    raise exception 'draft is approved' using errcode = '55000';
  end if;
  if d.status <> 'pending' then
    return private.coach_draft_json(d);  -- cancelled/expired/already saved: late result discarded
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
  days jsonb;
  routines jsonb;
  rt jsonb;
  x jsonb;
  draft_keys text[];
  draft_weekdays int[];
  cur_id uuid;
  cur_rev int;
begin
  -- Validate the whole command first (generic routine/program contracts).
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
  if not (prog ->> 'active')::boolean or (prog ->> 'coachDraftId') is distinct from v_draft_id::text
     or prog ->> 'origin' <> 'coach' then
    perform private.fail('doc.program', 'must be active, origin coach and reference the approved draft');
  end if;
  prog_id := (prog ->> 'id')::uuid;
  days := prog -> 'days';

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
  if dr.status <> 'ready' or dr.content is null then
    perform private.reject('draft_not_ready', 'only a ready draft can be approved');
  end if;
  -- The reviewed base is the one the draft was generated against; a client cannot re-base a stale draft.
  if v_base_id is distinct from dr.base_program_id or v_base_rev is distinct from dr.base_program_revision then
    perform private.reject('stale_approval', 'the approval base does not match the draft base');
  end if;

  -- The edited command may only narrow/tune the server-validated draft.
  select array_agg(distinct e ->> 'exerciseKey'), array_agg(distinct (x0 ->> 'weekday')::int)
    into draft_keys, draft_weekdays
    from jsonb_array_elements(dr.content -> 'days') x0, jsonb_array_elements(x0 -> 'exercises') e;
  if jsonb_array_length(days) <> jsonb_array_length(routines)
     or (select count(distinct dd ->> 'routineId') from jsonb_array_elements(days) dd) <> jsonb_array_length(days)
     or exists (select 1 from jsonb_array_elements(days) dd
                 where not exists (select 1 from jsonb_array_elements(routines) r where r ->> 'id' = dd ->> 'routineId'))
  then
    perform private.fail('doc.program.days', 'each day must reference a distinct routine of this approval');
  end if;
  if exists (select 1 from jsonb_array_elements(days) dd where not ((dd ->> 'weekday')::int = any (draft_weekdays))) then
    perform private.fail('doc.program.days', 'weekdays must come from the draft');
  end if;
  for i in 0 .. jsonb_array_length(routines) - 1 loop
    rt := routines -> i;
    if rt ->> 'origin' <> 'coach' or jsonb_array_length(rt -> 'exercises') > 12 then
      perform private.fail(format('doc.routines[%s]', i), 'must be origin coach with at most 12 exercises');
    end if;
    for k in 0 .. jsonb_array_length(rt -> 'exercises') - 1 loop
      x := rt -> 'exercises' -> k;
      if not ((x ->> 'exerciseKey') = any (draft_keys)) then
        perform private.fail(format('doc.routines[%s].exercises[%s].exerciseKey', i, k), 'must be an exercise of the draft');
      end if;
      if jsonb_array_length(x -> 'sets') not between 1 and 10
         or exists (select 1 from jsonb_array_elements(x -> 'sets') st
                     where coalesce((st ->> 'targetReps')::int, 0) not between 1 and 50
                        or st -> 'targetLoadGrams' <> 'null'::jsonb) then
        perform private.fail(format('doc.routines[%s].exercises[%s].sets', i, k),
          '1-10 sets with 1-50 target reps and no load target');
      end if;
    end loop;
  end loop;

  -- Stale check against the active program the user reviewed (row locked until commit).
  select id, revision into act_id, act_rev from public.programs
   where owner_id = p_owner and active and not deleted for update;
  if act_id is distinct from v_base_id or act_rev is distinct from v_base_rev then
    select id, revision into cur_id, cur_rev from public.programs
     where id = coalesce(act_id, v_base_id) and owner_id = p_owner;
    if cur_rev is null then
      perform private.reject('stale_approval', 'the reviewed program no longer exists');
    end if;
    return jsonb_build_object('status', 'conflict', 'opId', p_op_id, 'serverRevision', cur_rev,
      'serverDeleted', (select deleted from public.programs where id = cur_id),
      'serverDoc', private.aggregate_doc('program', cur_id));
  end if;

  -- Separate snapshots: approval creates a new program and new routines, never overwrites existing ones.
  if exists (select 1 from public.programs where id = prog_id and owner_id <> p_owner)
     or exists (select 1 from public.routines r, jsonb_array_elements(routines) j
                 where r.id = (j ->> 'id')::uuid and r.owner_id <> p_owner) then
    perform private.reject('forbidden', 'aggregate id is not available');
  end if;
  if exists (select 1 from public.programs where id = prog_id)
     or exists (select 1 from public.routines r, jsonb_array_elements(routines) j where r.id = (j ->> 'id')::uuid)
     or (select count(distinct j ->> 'id') from jsonb_array_elements(routines) j) <> jsonb_array_length(routines) then
    perform private.reject('id_conflict', 'approval ids must be new');
  end if;

  for i in 0 .. jsonb_array_length(routines) - 1 loop
    rt := routines -> i;
    perform private.write_routine(p_owner, 1, rt);
    perform private.log_change(p_owner, 'routine', (rt ->> 'id')::uuid, 1, false);
  end loop;
  perform private.write_program(p_owner, 1, prog);  -- deactivates the previous active program
  perform private.log_change(p_owner, 'program', prog_id, 1, false);

  update public.coach_drafts set status = 'approved', approval_id = v_approval, approved_at = now() where id = dr.id;
  return private.applied(p_op_id, 1, false);
end $$;

revoke execute on all functions in schema private from public;
revoke execute on function public.coach_begin_request(uuid, text, uuid, int, jsonb, int, int) from public, anon;
grant execute on function public.coach_begin_request(uuid, text, uuid, int, jsonb, int, int) to authenticated;
