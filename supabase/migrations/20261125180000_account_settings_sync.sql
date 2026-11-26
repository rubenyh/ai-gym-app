-- Offline identity/preference edits (PROFILE-02, SETTINGS-01, AUTH-02, NFR-09). Supersedes D-28.
-- Display name, visibility, units, timezone and weekly goal sync through the existing outbox protocol as
-- the `account_settings` aggregate (aggregateId = the account's user id). Handle (server uniqueness) and
-- avatar (upload) stay online-only.
-- Contract: app/src/domain/contracts.ts `accountSettingsDoc`, docs/CONTRACTS.md.
-- Tests: supabase/tests/database/11_account_settings_sync.test.sql.
--
-- Model
-- * Root rows stay where they are (profiles, user_settings, weekly_goals). `user_settings.revision` is the
--   aggregate revision. sync_push bumps it once per applied op that changes the document; any other write
--   to a doc field (onboarding, schedule_weekly_goal, direct table writes, the timezone carry trigger)
--   bumps it per statement (onboarding ends at revision 2: settings insert, then the first goal). Every bump writes the change log, so pulls and base-revision checks see it.
-- * Weekly goals stay append-forward and frozen: past and current weeks are never touched. A queued
--   goal change asks for "from week W" (chosen at edit time); the server applies it from
--   greatest(W, next local week at arrival) and the pulled document reports the week actually used.

-- ---------------------------------------------------------------------------------------------
-- Revision bookkeeping
-- ---------------------------------------------------------------------------------------------

alter table public.user_settings add column revision integer not null default 1;

alter table public.server_change_log drop constraint server_change_log_aggregate_type_check;
alter table public.server_change_log add constraint server_change_log_aggregate_type_check
  check (aggregate_type in ('custom_exercise', 'routine', 'program', 'session', 'body_weight', 'account_settings'));

-- ponytail: a direct table write locks user_settings before account_sync_state (sync_push does the
-- reverse); a concurrent pair can deadlock and one side gets a retryable error. The app only writes
-- these fields through sync_push, so this needs no ordering lock unless direct writes return.
create function private.touch_account_settings(p_owner uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_rev int;
begin
  -- apply_account_settings bumps once itself after all its writes.
  if coalesce(current_setting('app.account_settings_batch', true), '') = 'on' then
    return;
  end if;
  update public.user_settings set revision = revision + 1 where owner_id = p_owner
  returning revision into v_rev;
  if found then
    perform private.log_change(p_owner, 'account_settings', p_owner, v_rev, false);
  end if;
end $$;

-- TG_ARGV[0] = column holding the owner id.
create function private.account_settings_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.touch_account_settings(
    ((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> tg_argv[0])::uuid);
  return null;
end $$;

create trigger profiles_account_settings_changed after update of display_name, visibility on public.profiles
  for each row when (old.display_name is distinct from new.display_name or old.visibility is distinct from new.visibility)
  execute function private.account_settings_changed('id');
create trigger user_settings_account_settings_changed after update of weight_unit, length_unit, timezone on public.user_settings
  for each row when ((old.weight_unit, old.length_unit, old.timezone) is distinct from (new.weight_unit, new.length_unit, new.timezone))
  execute function private.account_settings_changed('owner_id');
create trigger weekly_goals_account_settings_changed after insert or update or delete on public.weekly_goals
  for each row execute function private.account_settings_changed('owner_id');

-- Existing accounts reach devices through sync_pull.
select private.log_change(s.owner_id, 'account_settings', s.owner_id, s.revision, false)
  from public.user_settings s join public.profiles p on p.id = s.owner_id;

-- ---------------------------------------------------------------------------------------------
-- Document
-- ---------------------------------------------------------------------------------------------

-- Same as 20261125130000 plus account_settings.
create or replace function private.aggregate_doc(p_type text, p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select case p_type
    when 'custom_exercise' then (select doc from public.custom_exercises where id = p_id and not deleted)
    when 'routine' then (select doc from public.routines where id = p_id and not deleted)
    when 'program' then (select doc from public.programs where id = p_id and not deleted)
    when 'session' then (select doc from public.sessions where id = p_id and not deleted)
    when 'body_weight' then (
      select jsonb_build_object('id', id, 'measuredAt', measured_at, 'weightGrams', weight_grams)
        from public.body_weight_entries where id = p_id and not deleted)
    when 'account_settings' then (
      select jsonb_build_object('id', p.id, 'displayName', p.display_name, 'visibility', p.visibility,
          'weightUnit', s.weight_unit, 'lengthUnit', s.length_unit, 'timezone', s.timezone,
          'weeklyGoals', coalesce((
            select jsonb_agg(jsonb_build_object('effectiveWeek', g.effective_week, 'targetDays', g.target_days,
                     'timezone', g.timezone) order by g.effective_week)
              from public.weekly_goals g where g.owner_id = p.id), '[]'::jsonb))
        from public.profiles p join public.user_settings s on s.owner_id = p.id
       where p.id = p_id)
  end
$$;

-- Upsert of the caller's account settings. Only the LAST weeklyGoals entry is read (the requested
-- goal); earlier entries are server history and are ignored.
create function private.apply_account_settings(
  p_owner uuid, p_op_id uuid, p_id uuid, p_action text, p_base int, d jsonb
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  cur_rev int;
  v_name text;
  v_visibility public.profile_visibility;
  v_weight public.weight_unit;
  v_length public.length_unit;
  v_tz text;
  v_goals jsonb;
  v_goal jsonb;
  v_from date;
  v_target int;
  v_latest int;
  v_week date;
  v_before jsonb;
begin
  if p_id <> p_owner then
    perform private.reject('forbidden', 'account settings belong to the signed-in account');
  end if;
  if p_action <> 'upsert' then
    perform private.fail('op.action', 'account_settings only supports upsert');
  end if;
  select revision into cur_rev from public.user_settings where owner_id = p_owner for update;
  if cur_rev is null or not exists (select 1 from public.profiles where id = p_owner) then
    perform private.reject('not_onboarded', 'complete onboarding first');
  end if;
  if p_base is distinct from cur_rev then
    return jsonb_build_object('status', 'conflict', 'opId', p_op_id, 'serverRevision', cur_rev,
      'serverDeleted', false, 'serverDoc', private.aggregate_doc('account_settings', p_owner));
  end if;

  perform private.check_keys(d, 'doc',
    array['id', 'displayName', 'visibility', 'weightUnit', 'lengthUnit', 'timezone', 'weeklyGoals']);
  if (d ->> 'id') is distinct from p_id::text then
    perform private.fail('doc.id', 'must equal aggregateId');
  end if;
  v_name := btrim(private.get_text(d, 'displayName', 'doc', 1, 50));
  v_visibility := private.get_enum(d, 'visibility', 'doc', array['public', 'private'])::public.profile_visibility;
  v_weight := private.get_enum(d, 'weightUnit', 'doc', array['kg', 'lb'])::public.weight_unit;
  v_length := private.get_enum(d, 'lengthUnit', 'doc', array['cm', 'ft_in'])::public.length_unit;
  v_tz := private.get_text(d, 'timezone', 'doc', 1, 64);
  if not public.is_valid_timezone(v_tz) then
    perform private.fail('doc.timezone', 'is not a known time zone');
  end if;
  v_goals := private.get_array(d, 'weeklyGoals', 'doc', 0, 1000);
  if jsonb_array_length(v_goals) > 0 then
    v_goal := v_goals -> -1;
    perform private.check_keys(v_goal, 'doc.weeklyGoals[-1]', array['effectiveWeek', 'targetDays', 'timezone']);
    v_from := private.get_date(v_goal, 'effectiveWeek', 'doc.weeklyGoals[-1]');
    v_target := private.get_int(v_goal, 'targetDays', 'doc.weeklyGoals[-1]', 1, 7);
    perform private.get_text(v_goal, 'timezone', 'doc.weeklyGoals[-1]', 1, 64);
  end if;

  v_before := private.aggregate_doc('account_settings', p_owner);
  perform set_config('app.account_settings_batch', 'on', true);
  update public.profiles set display_name = v_name, visibility = v_visibility
   where id = p_owner and (display_name, visibility) is distinct from (v_name, v_visibility);
  -- A timezone change fires carry_goal_timezone (applies from the next week boundary).
  update public.user_settings set weight_unit = v_weight, length_unit = v_length, timezone = v_tz
   where owner_id = p_owner and (weight_unit, length_unit, timezone) is distinct from (v_weight, v_length, v_tz);

  if v_target is not null then
    select g.target_days into v_latest from public.weekly_goals g
     where g.owner_id = p_owner order by g.effective_week desc limit 1;
    if v_latest is distinct from v_target then
      -- Never the current or a past week, even when the edit was queued offline weeks ago.
      v_week := greatest(date_trunc('week', v_from)::date, public.week_start(now(), v_tz) + 7);
      insert into public.weekly_goals (owner_id, effective_week, target_days, timezone)
      values (p_owner, v_week, v_target, v_tz)
      on conflict (owner_id, effective_week) do update set target_days = excluded.target_days;
      -- Later scheduled rows (e.g. a timezone carry) follow the newest wish.
      update public.weekly_goals set target_days = v_target
       where owner_id = p_owner and effective_week > v_week and target_days <> v_target;
    end if;
  end if;

  perform set_config('app.account_settings_batch', '', true);
  if private.aggregate_doc('account_settings', p_owner) is distinct from v_before then
    cur_rev := cur_rev + 1;
    update public.user_settings set revision = cur_rev where owner_id = p_owner;
    perform private.log_change(p_owner, 'account_settings', p_owner, cur_rev, false);
  end if;
  return private.applied(p_op_id, cur_rev, false);
end $$;

-- ---------------------------------------------------------------------------------------------
-- sync_push: same as 20261125130000 plus the account_settings branch.
-- ---------------------------------------------------------------------------------------------

create or replace function public.sync_push(p_op jsonb) returns jsonb
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

  -- A repeated opId returns its receipt even if the payload differs: op ids are client-generated UUIDs
  -- frozen with their payload, so a different payload under a known id is never produced by the app.
  select r.result into v_result from public.operation_receipts r where r.owner_id = uid and r.op_id = v_op_id;
  if found then
    return jsonb_set(v_result, '{status}', '"duplicate"');
  end if;

  begin
    perform private.check_keys(p_op, 'op', array['opId', 'aggregateType', 'aggregateId', 'action', 'baseRevision', 'doc']);
    v_type := private.get_enum(p_op, 'aggregateType', 'op',
      array['custom_exercise', 'routine', 'program', 'session', 'body_weight', 'coach_approval', 'account_settings']);
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
    elsif v_type = 'account_settings' then
      v_result := private.apply_account_settings(uid, v_op_id, v_id, v_action, v_base, v_doc);
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

revoke execute on function private.touch_account_settings(uuid), private.account_settings_changed(),
  private.apply_account_settings(uuid, uuid, uuid, text, int, jsonb)
  from public;
