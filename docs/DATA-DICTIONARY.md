# Data dictionary

Implemented server schema as of M6 (2026-11-25; migrations M1, M3 sync, M4 rewards, M5 coach, M6 social). Logical model and future entities: [DATA_AND_SYNC.md](DATA_AND_SYNC.md).
Diagram: [DB-DIAGRAM.md](DB-DIAGRAM.md). Source of truth: `supabase/migrations/` (server) and `app/src/db/schema.ts`
(device). Update this file in the same change as any migration.

Conventions:

- Owner columns reference `auth.users(id)` with `on delete cascade` and default to `auth.uid()`. RLS re-checks
  ownership, so a client cannot write rows for another user.
- Clients (`authenticated`) get explicit grants; `anon` has none. Identity columns (`id`, `owner_id`, primary keys)
  are not client-updatable.
- Canonical units: body weight in integer grams, height in centimetres. kg/lb and cm/ft-in are display/input only.
- Timestamps are `timestamptz` (UTC). `updated_at` is maintained by the `set_updated_at` trigger.
- Time zones are IANA names validated by `is_valid_timezone`.

## Server (Supabase Postgres, schema `public`)

### profiles — public identity

| Column | Type | Null | Default | Rules |
| --- | --- | --- | --- | --- |
| id | uuid | no | `auth.uid()` | PK, FK `auth.users`. Not updatable. |
| handle | text | no | | Stored normalized: `^[a-z0-9_]{3,30}$`. Unique (`profiles_handle_key`). |
| display_name | text | no | | Trimmed length 1–50. |
| avatar_path | text | yes | | Object path in bucket `avatars`; must start with `<id>/`. |
| visibility | `profile_visibility` (`public`, `private`) | no | `private` | Controls access to training content (M6). |
| created_at / updated_at | timestamptz | no | `now()` | |

Never contains private metrics (age, height, weight, limitations, coach data) — asserted by pgTAP.
**Access:** select by any signed-in user unless a block exists in either direction (M6; identity of private profiles is still visible); insert/update own row only;
no delete (account deletion is deferred, cascades from `auth.users`).

### user_settings — private preferences (1 row per user)

| Column | Type | Null | Default | Rules |
| --- | --- | --- | --- | --- |
| owner_id | uuid | no | `auth.uid()` | PK, FK `auth.users`. |
| weight_unit | `weight_unit` (`kg`, `lb`) | no | | Display/input only. |
| length_unit | `length_unit` (`cm`, `ft_in`) | no | | Display/input only. |
| timezone | text | no | | Valid IANA zone. Current preference; history lives in `weekly_goals`. |
| created_at / updated_at | timestamptz | no | `now()` | |

**Access:** owner select/insert/update. **Trigger** `user_settings_carry_goal_timezone`: a timezone change upserts
the goal in force next week with the new zone, so current and past weeks keep their original boundaries.

### weekly_goals — append-forward goal history

| Column | Type | Null | Default | Rules |
| --- | --- | --- | --- | --- |
| owner_id | uuid | no | `auth.uid()` | PK part, FK `auth.users`. |
| effective_week | date | no | | PK part. Monday (ISO) of the first local week the row applies to. |
| target_days | smallint | no | | 1–7 distinct training days. |
| timezone | text | no | | Valid IANA zone that defines this row's week boundaries (frozen). |
| created_at / updated_at | timestamptz | no | `now()` | |

A row applies from `effective_week` until the next row. **Access (RLS):** owner select; insert only for a future week,
or the current week when the user has no goal yet; update/delete only future rows. Current and past weeks are frozen.

### training_profiles — private coach inputs (PROFILE-01)

| Column | Type | Null | Default | Rules |
| --- | --- | --- | --- | --- |
| owner_id | uuid | no | `auth.uid()` | PK, FK `auth.users`. |
| goal | text | yes | | ≤ 200 chars. Allowed values not yet decided (free text). |
| age | smallint | yes | | 1–120 (data sanity, not an eligibility rule). |
| height_cm | numeric(4,1) | yes | | 50–272 cm. |
| experience | `experience_level` (`beginner`, `intermediate`, `advanced`) | yes | | |
| equipment | text[] | no | `{}` | ≤ 50 items. Vocabulary to align with the exercise catalog (M2). |
| limitations | text | yes | | ≤ 1000 chars. Private; never sent to social features. |
| available_weekdays | smallint[] | no | `{}` | ISO weekdays 1 (Mon)–7 (Sun). |
| session_minutes | smallint | yes | | 10–300. |
| created_at / updated_at | timestamptz | no | `now()` | |

All coach fields are nullable because coaching questions can be deferred. **Access:** owner only (CRUD).

### body_weight_entries — private time series

| Column | Type | Null | Default | Rules |
| --- | --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` | PK; client-generated UUID (sync aggregate id). |
| owner_id | uuid | no | `auth.uid()` | FK `auth.users`. |
| measured_at | timestamptz | no | | Measurement time. |
| weight_grams | integer | no | | 20 000–400 000 g. |
| revision | integer | no | `1` | Server revision (M3). Existing M1 rows start at 1. |
| deleted | boolean | no | `false` | Tombstone (M3). |
| created_at / updated_at | timestamptz | no | `now()` | |

Index `body_weight_entries_owner_measured_idx (owner_id, measured_at desc)`. Since M3 this is the `body_weight`
sync aggregate. **Access:** owner select only; writes only through `sync_push`. M1 rows were backfilled into
`server_change_log`.

### Training aggregates (M3): `custom_exercises`, `routines`, `programs`, `sessions`

One row per aggregate document (contracts in `app/src/domain/contracts.ts`, D-23). Common columns:

| Column | Type | Null | Default | Rules |
| --- | --- | --- | --- | --- |
| id | uuid | no | | PK, client-generated, globally unique (an id owned by another account is rejected). |
| owner_id | uuid | no | `auth.uid()` | FK `auth.users`. |
| revision | integer | no | | >= 1, assigned by the server on every write. |
| deleted | boolean | no | `false` | Tombstone; the last `doc` is kept, pulls return `doc = null`. |
| doc | jsonb | no | | Whole validated document (exact keys at every level, types, bounds per contracts.ts). |
| created_at / updated_at | timestamptz | no | `now()` | |

Typed root columns: `custom_exercises(name, archived)`; `routines(name, archived, origin)`;
`programs(name, active, origin, coach_draft_id)` with unique partial index `programs_one_active_per_owner`
(activating a program deactivates the previous one with a new revision); `sessions(routine_id, name, status
active|completed, started_at, completed_at, timezone, local_date)` with unique partial index
`sessions_one_active_per_owner`. **Access:** owner select only; writes only via `sync_push`.

### Sync bookkeeping (M3)

| Table | Columns | Notes |
| --- | --- | --- |
| account_sync_state | owner_id PK, last_seq bigint | Row lock taken at the start of each push serializes the account; seq allocated under it. No client access. |
| operation_receipts | (owner_id, op_id) PK, aggregate_type, aggregate_id, result jsonb, created_at | Only `applied` results are stored; a repeated opId returns it as `duplicate`. No client access. |
| server_change_log | (owner_id, seq) PK, aggregate_type, aggregate_id, revision, deleted, created_at; unique (owner_id, aggregate_type, aggregate_id) | Latest change per aggregate (re-written with a new seq). Owner select. |

### Rewards (M4)

| Table | Columns | Notes |
| --- | --- | --- |
| reward_events | id PK, owner_id, source_type session/week, source_id (session id or week Monday), reason session_completed/weekly_goal, rule_version, xp >= 0, active, created/updated | Unique `(owner_id, source_type, source_id, reason, rule_version)`; revoke/restore flips `active`. |
| reward_event_log | id PK, owner_id, reward_event_id, action award/revoke/restore, xp, created_at | Correction audit trail. |
| achievement_unlocks | (owner_id, badge_id) PK, unlocked_at | Permanent. Badge ids from reward-rules.v1.json. |
| pet_unlocks | (owner_id, stage) PK, unlocked_at | Permanent. stage = 1-based index into `petStageLevels`. |

All owner select only; written only inside `sync_push` / `get_reward_summary`. A session qualifies when
`completed`, not deleted and has >= 1 completed set with reps > 0. The weekly bonus uses the frozen `weekly_goals`
row in force for the completion instant (its timezone defines week and local day); weeks before the first goal never count.

### Coach (M5)

| Table | Columns | Notes |
| --- | --- | --- |
| coach_requests | (owner_id, request_id) PK, mode create/adjust, program_id, base_revision, input jsonb (object <= 8 KB, minimized), status, created/updated | Rate limit 10 new requests/hour/user. Status mirrors its draft. |
| coach_drafts | id PK, owner_id, request_id (unique per owner, FK coach_requests), status pending/ready/needs_input/failed/approved/cancelled, base_program_id, base_program_revision, content (CoachDraftContent), clarification, error, schema_version, model, approval_id unique, approved_at, created/updated | Approved once through the `coach_approval` push op. |

Owner select only; written only by the coach RPCs (user token) and `sync_push`.

### Social (M6)

| Table | Columns | Notes |
| --- | --- | --- |
| follows | (requester_id, followee_id) PK, status pending/accepted, created/updated | Select if party. Written by RPCs. |
| blocks | (blocker_id, blocked_id) PK, created_at | Select own. Effective both ways; blocking deletes follows both ways. |
| posts | id PK (client publication id), author_id, source_session_id FK sessions (set null; also detached when the session is tombstoned), snapshot (PostSnapshot, server-built), caption <= 500, photo_path `<author>/<id>.<jpg/jpeg/png/webp>`, revision, deleted, published_at, updated_at | Select when accessible and not deleted. Written by RPCs. |
| likes | (post_id, user_id) PK, created_at | Select/insert only on accessible posts; delete own. |
| comments | id PK, post_id, author_id, body 1-1000 chars, created_at | Select/insert only on accessible posts; delete own. |

Access rule: viewer is the author, or no block either way and (author public or viewer is an accepted follower),
evaluated live by `private.can_view_author` / `private.can_view_post`.

### Storage bucket `avatars`

Private bucket, 2 MiB limit, `image/jpeg`, `image/png`, `image/webp`. Objects at `<user id>/<file>`.
Signed-in users read (via signed URLs); owners insert/update/delete only inside their own folder.

### Storage bucket `post-photos` (M6)

Private, 5 MiB, `image/jpeg`, `image/png`, `image/webp`. Objects at `<user id>/<post id>.<ext>`. Owners write only
in their own folder; others read only while the referencing post is accessible to them.

### Functions

| Function | Kind | Purpose |
| --- | --- | --- |
| `complete_onboarding(handle, display_name, weight_unit, length_unit, timezone, target_days)` | RPC, security invoker | Creates profile, settings and current-week goal in one transaction (all or nothing). |
| `schedule_weekly_goal(target_days) → date` | RPC, security invoker | Upserts the goal for next local week; returns that week's Monday. |
| `week_start(ts, tz) → date` | helper | Monday of the local week containing `ts` in `tz`. |
| `is_valid_timezone(tz) → boolean` | helper | IANA zone check used by constraints. |
| `has_weekly_goal(uid) → boolean` | security definer, not executable by anon | Lets the insert policy check existing goals without RLS recursion. |
| `set_updated_at()`, `carry_goal_timezone()` | triggers | See tables above. |
| `sync_push(p_op jsonb) -> jsonb` | RPC, security definer | PushOp -> PushResult. Owner from `auth.uid()`; receipt + write + change log + rewards in one transaction. Rejection codes: `invalid_doc`, `forbidden`, `unknown_aggregate`, `active_session_exists`, `constraint_violation`, `draft_not_found`, `already_approved`, `draft_not_ready`, `stale_approval`. |
| `sync_pull(p_after bigint, p_limit int) -> jsonb` | RPC, security definer | ChangePage for the caller, limit 1-500 (default 100). |
| `get_reward_rules() -> jsonb` | RPC | Mirrors `reward-rules.v1.json` (API test compares). |
| `get_reward_summary() -> jsonb` | RPC, security definer | RewardSummary; unlocks pet stage 1 on first call. |
| `coach_begin_request(request_id, mode, program_id, base_revision, input) -> jsonb` | RPC, security definer | `{created, draft: CoachDraftResponse}`; idempotent per request id; rate limit raises `PT429` (HTTP 429). |
| `coach_save_draft(draft_id, status, content, clarification, error, model) -> jsonb` | RPC, security definer | Validates content/clarification/error; only open drafts change. |
| `coach_cancel_draft(draft_id) -> jsonb` | RPC, security definer | Approved drafts cannot be cancelled (55000). |
| `coach_get_context() -> jsonb` | RPC, security invoker | trainingProfile, latestBodyWeightGrams, activeProgram, its routines, 10 recent completed-session summaries. |
| `publish_post`, `update_post_snapshot`, `delete_post`, `follow_user`, `unfollow_user`, `respond_follow_request`, `remove_follower`, `block_user`, `unblock_user`, `get_profile_card`, `list_blocked` | RPC, security definer | Signatures per docs/CONTRACTS.md; actor = `auth.uid()`. |
| `get_feed(before, limit)`, `search_profiles(query, limit)`, `list_follow_requests()` | RPC, security invoker | RLS applies. |
| `private.*` | internal (schema not exposed by the API) | Validators and sync/reward/coach internals; only the `is_blocked`/`can_view_*` RLS helpers are executable by `authenticated`. |

RPCs run as the caller, so RLS applies. `anon` cannot execute them.

## Device (SQLite, one file per account: `account-<user id>.db`)

Read-through cache of server rows so a previously signed-in user can open the app offline (AUTH-02).
Server data is authoritative; the cache is replaced in one transaction after each successful fetch.
Migrations: `app/src/db/migrations/` (Drizzle), run before any query.

| Table | Columns | Notes |
| --- | --- | --- |
| account_profile | id (PK), handle, display_name, visibility, avatar_path, updated_at | Mirror of own `profiles` row. |
| user_settings | id (PK, always 1), weight_unit, length_unit, timezone, updated_at | Mirror of own settings. |
| weekly_goals | effective_week (PK), target_days, timezone | Mirror of own goal history. |

Device training tables, `outbox` and `sync_state` are owned by the app data layer (`app/src/db/schema.ts`).
