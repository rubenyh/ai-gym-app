# Shared contracts (frozen 2026-11-25)

Concrete types live in code; this page lists them and the server signatures that mirror them. Change a
contract only by editing the code **and** this page in the same commit.

| Contract | Source of truth |
| --- | --- |
| Aggregate documents, exercise keys, units, push/pull/receipt shapes, reward summary, coach draft, post snapshot | [`app/src/domain/contracts.ts`](../app/src/domain/contracts.ts) (Zod) |
| Representative fixtures | [`app/src/domain/fixtures.ts`](../app/src/domain/fixtures.ts) |
| Local repository interface + transaction boundaries | [`app/src/domain/repositories.ts`](../app/src/domain/repositories.ts) (incl. `rewardCache`, 2026-11-25). Implementation `app/src/db/repositories/`; the sync worker additionally uses `LocalRepositories.sync` (internal, not for feature UI). UI imports `RepositoriesProvider`, `useRepositories`, `useLocalQuery`, `useSyncEngine` from `@/db/repositories-context`. |
| Reward numbers (D-03), rule version 1 | [`app/src/domain/reward-rules.v1.json`](../app/src/domain/reward-rules.v1.json); SQL mirrors it, an API test compares them |

## Fixed semantics

- **IDs.** App-owned entities use client-generated UUID v4. Catalog exercises use `catalog:<sourceId>` (string,
  leading zeros kept); personal exercises `custom:<uuid>`.
- **Units.** Weight in integer grams everywhere (local, server, snapshots). Units are display/input only.
- **Aggregates.** `custom_exercise`, `routine`, `program`, `session`, `body_weight` sync as whole documents
  (root + children). `coach_approval` is a command-only aggregate (never pulled). Server keeps one row per
  aggregate with typed root columns and a validated `doc jsonb` holding children (D-23).
- **Revisions.** Server assigns `revision` (1, 2, …) per aggregate. Local rows keep `server_revision`
  (null = never acknowledged). Deletes are tombstones (`deleted = true`, revision bumped).
- **Outbox.** Every local mutation inserts an outbox row (`op_id`, `aggregate_type`, `aggregate_id`, `action`,
  `status = pending`) in the same SQLite transaction. At send time the worker coalesces all `pending` rows of one
  aggregate into the newest one (others → `superseded`), freezes the current document into it (`inflight`,
  with `base_revision` = local `server_revision`) and sends exactly that frozen op until it gets a definitive
  answer. A lost acknowledgement is retried with the same op ID and payload; the server returns the receipt.
- **Ordering.** Server change log uses a per-account `seq` incremented under a per-account row lock in the same
  transaction as the domain write, so commit order = `seq` order. Client clocks never order sync.
- **Conflicts.** Stale `base_revision` → `conflict` with the server copy. Client keeps its local draft, stores
  the server copy in `sync_conflicts`, and the user picks *keep mine* (re-queue on the server revision) or
  *use server copy*. No silent last-write-wins.
- **Rewards.** Only the server writes `reward_events`; it reconciles session/week awards inside `sync_push`.
  Clients compute provisional values from local data and label them pending until `awardedSessionIds` contains
  the session.

## Supabase RPCs (owner: backend agent)

| RPC | Contract |
| --- | --- |
| `sync_push(p_op jsonb) returns jsonb` | `PushOp` → `PushResult`. Owner from `auth.uid()` only. Receipt + domain write + change log + reward reconciliation in one transaction. |
| `sync_pull(p_after bigint, p_limit int) returns jsonb` | `ChangePage` for the caller only, `seq > p_after`, ascending, `limit` ≤ 500. |
| `get_reward_summary() returns jsonb` | `RewardSummary` for the caller. |
| `get_reward_rules() returns jsonb` | Mirrors `reward-rules.v1.json`. |
| `publish_post(p_post_id uuid, p_session_id uuid, p_caption text, p_photo_path text) returns jsonb` | Idempotent on `p_post_id`; builds `PostSnapshot` server-side from the synced, completed session. |
| `update_post_snapshot(p_post_id uuid) returns jsonb` | Explicit refresh from the source session. |
| `follow_user(p_target uuid) returns text` | `accepted` for public, `pending` for private; refused when blocked. |
| `respond_follow_request(p_requester uuid, p_accept boolean)`, `remove_follower(p_follower uuid)`, `unfollow_user(p_target uuid)`, `block_user(p_target uuid)`, `unblock_user(p_target uuid)` | Actor = `auth.uid()`. Blocking deletes follows both ways. |
| `search_profiles(p_query text, p_limit int)`, `get_profile_card(p_handle text)` | Public identity only + caller's `FollowStatus`. |
| `get_feed(p_before timestamptz, p_limit int)` | Accessible posts from followed authors (and own), newest first. |
| Coach tables `coach_requests`, `coach_drafts` | Owner-read via RLS; written only by the coach service with the **user's** token through `coach_begin_request` (returns `{created, draft}`, rate limit raises `PT429`), `coach_save_draft`, `coach_cancel_draft`, `coach_get_context` (no service-role key). Approval arrives as a `coach_approval` push op. |

## Coach HTTP API (owner: coach agent)

`POST /v1/coach/drafts` (`CoachDraftRequest` → `CoachDraftResponse`), `GET /v1/coach/drafts/{id}`,
`POST /v1/coach/drafts/{id}/cancel`. `Authorization: Bearer <Supabase access token>`; server verifies via
Supabase Auth and reads context with the same user token (RLS), never a client-supplied owner.

## Server rules added during implementation (2026-11-25)

- Documents must contain exactly the contract keys at every level (unknown keys are rejected).
- `coach_approval`: `aggregateId` must equal `approvalId`; the program must be `active` with `coachDraftId = draftId`.
- Only `applied` results are stored as receipts; `conflict`/`rejected` are re-evaluated when resent.
- Pushing an active program deactivates the previous one (new revision + change-log entry).
- A delete for an aggregate the server never stored returns `applied` (revision 1) and stores nothing.
- Server weekly bonus places a session by `completedAt` in that week's frozen goal timezone; the client's
  provisional view uses the stored `localDate`. They differ only for sessions completed near midnight after a
  timezone change, and the server value wins once synced.
