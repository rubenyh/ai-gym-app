-- M4: server-authoritative rewards (GAME-01, SESSION-04, PROGRESS-01). Spec: docs/PROGRESS_AND_GAMIFICATION.md,
-- rule numbers: app/src/domain/reward-rules.v1.json (mirrored by get_reward_rules(); an API test compares them).
--
-- * reward_events: one row per (owner, source_type, source_id, reason, rule_version); `active` flips on
--   revoke/restore, so an award is never duplicated. Every flip is audited in reward_event_log.
-- * Reconciliation runs inside sync_push for every session upsert/delete (same transaction).
-- * achievement_unlocks / pet_unlocks are permanent: nothing revokes them.
-- * Clients only read their own rows; there are no client write grants.

create function public.get_reward_rules() returns jsonb
language sql immutable set search_path = '' as $$
  select '{
    "ruleVersion": 1,
    "sessionCompletionXp": 100,
    "weeklyGoalXp": 100,
    "levelBaseXp": 200,
    "levelStepXp": 50,
    "petStageLevels": [1, 5, 10, 20],
    "badges": [
      { "id": "first_workout", "kind": "qualifying_sessions", "threshold": 1 },
      { "id": "workouts_10", "kind": "qualifying_sessions", "threshold": 10 },
      { "id": "workouts_25", "kind": "qualifying_sessions", "threshold": 25 },
      { "id": "workouts_50", "kind": "qualifying_sessions", "threshold": 50 },
      { "id": "workouts_100", "kind": "qualifying_sessions", "threshold": 100 },
      { "id": "first_weekly_goal", "kind": "achieved_weeks", "threshold": 1 },
      { "id": "four_week_streak", "kind": "consecutive_achieved_weeks", "threshold": 4 }
    ],
    "repPrToleranceGrams": 50
  }'::jsonb
$$;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.reward_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  source_type text not null check (source_type in ('session', 'week')),
  -- session id, or the Monday (YYYY-MM-DD) of the goal week
  source_id text not null,
  reason text not null check (reason in ('session_completed', 'weekly_goal')),
  rule_version integer not null,
  xp integer not null check (xp >= 0),
  active boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reward_events_idempotency_key unique (owner_id, source_type, source_id, reason, rule_version)
);

create table public.reward_event_log (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  reward_event_id bigint not null references public.reward_events (id) on delete cascade,
  action text not null check (action in ('award', 'revoke', 'restore')),
  xp integer not null,
  created_at timestamptz not null default now()
);
create index reward_event_log_owner_idx on public.reward_event_log (owner_id, created_at);
create index reward_event_log_event_idx on public.reward_event_log (reward_event_id);

create table public.achievement_unlocks (
  owner_id uuid not null references auth.users (id) on delete cascade,
  badge_id text not null,
  unlocked_at timestamptz not null default now(),
  primary key (owner_id, badge_id)
);

-- stage = 1-based index into petStageLevels (stage 1 = level 1, 2 = level 5, 3 = level 10, 4 = level 20).
create table public.pet_unlocks (
  owner_id uuid not null references auth.users (id) on delete cascade,
  stage smallint not null check (stage >= 1),
  unlocked_at timestamptz not null default now(),
  primary key (owner_id, stage)
);

create trigger reward_events_set_updated_at before update on public.reward_events
  for each row execute function public.set_updated_at();

revoke all on public.reward_events, public.reward_event_log, public.achievement_unlocks, public.pet_unlocks
  from anon, authenticated;
grant select on public.reward_events, public.reward_event_log, public.achievement_unlocks, public.pet_unlocks
  to authenticated;

alter table public.reward_events enable row level security;
alter table public.reward_event_log enable row level security;
alter table public.achievement_unlocks enable row level security;
alter table public.pet_unlocks enable row level security;

create policy reward_events_select_own on public.reward_events
  for select to authenticated using (owner_id = (select auth.uid()));
create policy reward_event_log_select_own on public.reward_event_log
  for select to authenticated using (owner_id = (select auth.uid()));
create policy achievement_unlocks_select_own on public.achievement_unlocks
  for select to authenticated using (owner_id = (select auth.uid()));
create policy pet_unlocks_select_own on public.pet_unlocks
  for select to authenticated using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------------------------

-- Cumulative XP needed to reach level n: base*(n-1) + step*(n-1)*(n-2)/2.
create function private.level_xp(p_level int, p_rules jsonb) returns int
language sql immutable set search_path = '' as $$
  select (p_rules ->> 'levelBaseXp')::int * (p_level - 1)
       + (p_rules ->> 'levelStepXp')::int * (p_level - 1) * (p_level - 2) / 2
$$;

create function private.level_for_xp(p_xp int, p_rules jsonb) returns int
language plpgsql immutable set search_path = '' as $$
declare
  n int := 1;
begin
  while private.level_xp(n + 1, p_rules) <= p_xp loop
    n := n + 1;
  end loop;
  return n;
end $$;

-- A session qualifies iff completed, not deleted, and it has >= 1 completed set with reps > 0.
create function private.session_qualifies(p_status text, p_deleted boolean, p_doc jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select p_status = 'completed' and not p_deleted
     and jsonb_path_exists(p_doc, '$.exercises[*].sets[*] ? (@.completed == true && @.reps > 0)')
$$;

-- Week (Monday), local day and target for a completion instant, using the frozen weekly goal row in
-- force for that week (its own timezone). No row => the week predates any goal and does not count.
create function private.goal_week(p_owner uuid, p_ts timestamptz)
returns table (week date, day date, target int)
language sql stable set search_path = '' as $$
  select public.week_start(p_ts, g.timezone), (p_ts at time zone g.timezone)::date, g.target_days::int
    from public.weekly_goals g
   where g.owner_id = p_owner and p_ts is not null
     and g.effective_week <= public.week_start(p_ts, g.timezone)
   order by g.effective_week desc
   limit 1
$$;

-- ---------------------------------------------------------------------------------------------
-- Reconciliation
-- ---------------------------------------------------------------------------------------------

-- Idempotent award state change: create (award), deactivate (revoke) or reactivate (restore).
create function private.set_award(
  p_owner uuid, p_source_type text, p_source_id text, p_reason text, p_xp int, p_version int, p_should boolean
) returns void
language plpgsql set search_path = '' as $$
declare
  v_id bigint;
  v_active boolean;
  v_xp int;
begin
  select id, active, xp into v_id, v_active, v_xp from public.reward_events
   where owner_id = p_owner and source_type = p_source_type and source_id = p_source_id
     and reason = p_reason and rule_version = p_version
   for update;
  if v_id is null then
    if p_should then
      insert into public.reward_events (owner_id, source_type, source_id, reason, rule_version, xp, active)
      values (p_owner, p_source_type, p_source_id, p_reason, p_version, p_xp, true)
      returning id into v_id;
      insert into public.reward_event_log (owner_id, reward_event_id, action, xp) values (p_owner, v_id, 'award', p_xp);
    end if;
  elsif v_active and not p_should then
    update public.reward_events set active = false where id = v_id;
    insert into public.reward_event_log (owner_id, reward_event_id, action, xp) values (p_owner, v_id, 'revoke', v_xp);
  elsif not v_active and p_should then
    update public.reward_events set active = true where id = v_id;
    insert into public.reward_event_log (owner_id, reward_event_id, action, xp) values (p_owner, v_id, 'restore', v_xp);
  end if;
end $$;

create function private.reconcile_week(p_owner uuid, p_week date, p_rules jsonb) returns void
language plpgsql set search_path = '' as $$
declare
  v_target int;
  v_days int;
begin
  select g.target_days into v_target from public.weekly_goals g
   where g.owner_id = p_owner and g.effective_week <= p_week
   order by g.effective_week desc limit 1;
  -- Sessions within +-2 days of the week cover any timezone offset; goal_week() decides membership.
  select count(distinct gw.day) into v_days
    from public.sessions s
    cross join lateral private.goal_week(p_owner, coalesce(s.completed_at, s.started_at)) gw
   where s.owner_id = p_owner
     and coalesce(s.completed_at, s.started_at) between p_week - 2 and p_week + 9
     and private.session_qualifies(s.status, s.deleted, s.doc)
     and gw.week = p_week;
  perform private.set_award(p_owner, 'week', p_week::text, 'weekly_goal', (p_rules ->> 'weeklyGoalXp')::int,
    (p_rules ->> 'ruleVersion')::int, v_target is not null and v_days >= v_target);
end $$;

-- Permanent unlocks reached by the current totals (never removed).
create function private.refresh_unlocks(p_owner uuid, p_rules jsonb) returns void
language plpgsql set search_path = '' as $$
declare
  v_xp int;
  v_sessions int;
  v_weeks int;
  v_streak int;
  v_level int;
  b jsonb;
  v_value int;
begin
  select coalesce(sum(xp) filter (where active), 0),
         count(*) filter (where active and reason = 'session_completed'),
         count(*) filter (where active and reason = 'weekly_goal')
    into v_xp, v_sessions, v_weeks
    from public.reward_events where owner_id = p_owner;
  -- Longest run of adjacent achieved calendar weeks.
  select coalesce(max(n), 0) into v_streak from (
    select count(*) as n from (
      select w, w - (row_number() over (order by w))::int * 7 as grp
        from (select distinct source_id::date as w from public.reward_events
               where owner_id = p_owner and reason = 'weekly_goal' and active) a
    ) b group by grp
  ) c;
  v_level := private.level_for_xp(v_xp, p_rules);

  for b in select * from jsonb_array_elements(p_rules -> 'badges') loop
    v_value := case b ->> 'kind'
      when 'qualifying_sessions' then v_sessions
      when 'achieved_weeks' then v_weeks
      when 'consecutive_achieved_weeks' then v_streak
      else 0 end;
    if v_value >= (b ->> 'threshold')::int then
      insert into public.achievement_unlocks (owner_id, badge_id) values (p_owner, b ->> 'id')
      on conflict do nothing;
    end if;
  end loop;

  for i in 1 .. jsonb_array_length(p_rules -> 'petStageLevels') loop
    if v_level >= (p_rules -> 'petStageLevels' ->> (i - 1))::int then
      insert into public.pet_unlocks (owner_id, stage) values (p_owner, i) on conflict do nothing;
    end if;
  end loop;
end $$;

-- Called by sync_push (M3) after every session upsert/delete. p_old_ts is the session's previous
-- completion instant, so a session moved to another week reconciles both weeks.
create or replace function private.reconcile_session_rewards(p_owner uuid, p_session_id uuid, p_old_ts timestamptz)
returns void
language plpgsql set search_path = '' as $$
declare
  rules jsonb := public.get_reward_rules();
  s record;
  w date;
begin
  select status, deleted, doc, coalesce(completed_at, started_at) as ts into s
    from public.sessions where id = p_session_id and owner_id = p_owner;
  perform private.set_award(p_owner, 'session', p_session_id::text, 'session_completed',
    (rules ->> 'sessionCompletionXp')::int, (rules ->> 'ruleVersion')::int,
    coalesce(private.session_qualifies(s.status, s.deleted, s.doc), false));
  for w in
    select gw.week from private.goal_week(p_owner, s.ts) gw
    union
    select gw.week from private.goal_week(p_owner, p_old_ts) gw
  loop
    perform private.reconcile_week(p_owner, w, rules);
  end loop;
  perform private.refresh_unlocks(p_owner, rules);
end $$;

-- ---------------------------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------------------------

-- RewardSummary (contracts.ts) for the caller. Unlocks pet stage 1 on first call (level 1).
create function public.get_reward_summary() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  rules jsonb := public.get_reward_rules();
  v_xp int;
  v_sessions int;
  v_awarded jsonb;
  v_level int;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform private.refresh_unlocks(uid, rules);
  select coalesce(sum(xp) filter (where active), 0),
         count(*) filter (where active and reason = 'session_completed'),
         coalesce(jsonb_agg(source_id order by source_id) filter (where active and reason = 'session_completed'), '[]')
    into v_xp, v_sessions, v_awarded
    from public.reward_events where owner_id = uid;
  v_level := private.level_for_xp(v_xp, rules);
  return jsonb_build_object(
    'ruleVersion', (rules ->> 'ruleVersion')::int,
    'totalXp', v_xp,
    'level', v_level,
    'xpIntoLevel', v_xp - private.level_xp(v_level, rules),
    'xpForNextLevel', private.level_xp(v_level + 1, rules) - private.level_xp(v_level, rules),
    'qualifyingSessions', v_sessions,
    'badges', coalesce((select jsonb_agg(jsonb_build_object('badgeId', badge_id, 'unlockedAt', unlocked_at)
                          order by unlocked_at, badge_id)
                          from public.achievement_unlocks where owner_id = uid), '[]'),
    'petStages', coalesce((select jsonb_agg(jsonb_build_object('stage', stage, 'unlockedAt', unlocked_at) order by stage)
                             from public.pet_unlocks where owner_id = uid), '[]'),
    'awardedSessionIds', v_awarded);
end $$;

revoke execute on all functions in schema private from public;
revoke execute on function public.get_reward_rules(), public.get_reward_summary() from public, anon;
grant execute on function public.get_reward_rules(), public.get_reward_summary() to authenticated;
