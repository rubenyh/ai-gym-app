# Data dictionary

Implemented schema as of M1 (2026-11-25). Logical model and future entities: [DATA_AND_SYNC.md](DATA_AND_SYNC.md).
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
**Access:** select by any signed-in user (identity of private profiles is still visible); insert/update own row only;
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
| id | uuid | no | `gen_random_uuid()` | PK; client may supply its own UUID. Not updatable. |
| owner_id | uuid | no | `auth.uid()` | FK `auth.users`. Not updatable. |
| measured_at | timestamptz | no | | Measurement time. Editable. |
| weight_grams | integer | no | | 20 000–400 000 g. Editable. |
| created_at / updated_at | timestamptz | no | `now()` | |

Index `body_weight_entries_owner_measured_idx (owner_id, measured_at desc)`. **Access:** owner only (CRUD).

### Storage bucket `avatars`

Private bucket, 2 MiB limit, `image/jpeg`, `image/png`, `image/webp`. Objects at `<user id>/<file>`.
Signed-in users read (via signed URLs); owners insert/update/delete only inside their own folder.

### Functions

| Function | Kind | Purpose |
| --- | --- | --- |
| `complete_onboarding(handle, display_name, weight_unit, length_unit, timezone, target_days)` | RPC, security invoker | Creates profile, settings and current-week goal in one transaction (all or nothing). |
| `schedule_weekly_goal(target_days) → date` | RPC, security invoker | Upserts the goal for next local week; returns that week's Monday. |
| `week_start(ts, tz) → date` | helper | Monday of the local week containing `ts` in `tz`. |
| `is_valid_timezone(tz) → boolean` | helper | IANA zone check used by constraints. |
| `has_weekly_goal(uid) → boolean` | security definer, not executable by anon | Lets the insert policy check existing goals without RLS recursion. |
| `set_updated_at()`, `carry_goal_timezone()` | triggers | See tables above. |

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

Training tables, `outbox` and `sync_state` arrive in M2/M3.
