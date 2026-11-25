# Data model, permissions, and synchronization

This defines logical entities and transaction contracts, not final SQL. Use UUIDs for app-owned entities; preserve source exercise identifiers as strings (including leading zeros). All remote tables require appropriate RLS and indexes.

## Entities

| Entity | Important fields and relationships |
| --- | --- |
| profiles | auth user FK, unique normalized handle, display name, avatar reference, visibility. No private metrics. |
| training_profiles | owner, goal, age, height_cm, experience, equipment, limitations, available weekdays, session minutes. |
| user_settings | owner, unit preferences, timezone; reward goal history stored separately. |
| weekly_goals | owner, effective week, target days, timezone/week-boundary information. |
| body_weight_entries | owner, timestamp, weight_kg; immutable measurement identity, editable value. |
| exercises | app ID, source/source ID/version, name, muscles, equipment, English instructions, tracking mode, media attribution/reference, archived flag. |
| custom_exercises | owner and exercise fields; personal until included as a snapshot in shared content. |
| programs / program_days | owner, revision, active flag, weekdays/order, routine references. |
| routines / routine_exercises / planned_sets | owner, ordering, exercise references/snapshots, target reps/weight/rest. |
| sessions / session_exercises / performed_sets | owner, source routine, status, timestamps, snapshots, notes, set order, completed flag, reps, optional load and load mode. |
| coach_requests / coach_drafts | owner, request ID, minimized input/context, status, schema/model version, structured draft, base program revision, approval status. |
| posts | author, optional source session, allowed summary snapshot, caption, private-storage photo reference, revision, publication time. |
| follows | requester/followee, pending/accepted, unique relationship. |
| blocks | blocker/blocked, unique pair; effective in both directions for access. |
| likes / comments | post and actor, unique like per user/post; comment text with owner/time. |
| reward_events | owner, source session/week, rule version, reason, XP amount, unique idempotency key; server-controlled. |
| achievement_unlocks / pet_unlocks | owner, badge/stage, unlock source/time; server-calculated and mirrored locally. |
| outbox (local only) | operation ID, account, entity aggregate, base revision, action/payload, attempts, status, last error. |
| sync_state (local only) | account and stream cursor, last successful sync, schema version. |
| server_change_log / operation_receipts | monotonic server sequence, owner, entity/version/deletion; applied operation IDs and results. |

Store user data by account, using separate local database files or rigorously enforced owner scoping. Use canonical units and consistent numeric precision. Load modes distinguish external load, bodyweight-only, and assistance; do not treat assistance as ordinary lifted weight.

Session exercise snapshots survive routine/catalog edits. Post snapshots contain only public fields; no private-profile rows or arbitrary raw session JSON. Copy snapshots into private routine definitions without granting access to the author's custom-exercise table.

## Sync protocol — implementation default

1. A local domain mutation atomically updates SQLite and inserts an outbox command. Commands use UUID operation IDs and target aggregate revisions.
2. Foreground sync pushes commands in order per aggregate to a transactional authenticated RPC. Serialize concurrent workers per account.
3. Server checks ownership, constraints, base revision, and operation receipt. A repeated ID returns its prior result. Receipt creation and domain write commit together.
4. Server assigns a new revision and writes a durable monotonic change sequence. Deletion emits a tombstone; no reliance on client timestamps for ordering.
5. Client saves the acknowledgement/new revision and removes or marks the command applied transactionally. A lost acknowledgement is safe to retry.
6. Pull an ordered bounded page of changes after the account cursor; apply a page and advance its cursor in one local transaction.
7. Do not overwrite pending local edits during pull. Conflict response preserves the local draft and latest remote version; offer a recovery resolution. Do not silently last-write-win completed workouts.
8. Retry transient failures with exponential backoff/jitter. Auth failures refresh or pause; validation/conflict failures require user action. Expose a manual retry/status screen.

For consecutive offline edits, maintain an aggregate queue with server base revision, and advance/rebase dependent local commands after acknowledged predecessors. Do not send every queued edit with the same stale base revision. Consider coalescing pending unsent routine edits, but do not lose user changes or reuse an already acknowledged operation ID.

Handle an aggregate such as a session plus children transactionally. Server derives rewards from the accepted canonical session in the same transaction, or a guaranteed idempotent follow-up with explicit pending status. A client cannot submit arbitrary XP totals.

Coach draft approval uses an immutable draft/approval ID and base program revision. It atomically applies a whole program or fails. A locally saved approved draft can remain pending offline; remote activation requires successful synchronization and must not be falsely reported as synced.

Initial sync downloads catalog metadata and owned training data with pagination. Keep full history locally for this prototype; media is separately cached. Authorized media for selected routines should be downloadable; uncached assets have a clear offline placeholder. Do not hotlink GitHub as the production asset backend.

## Social permissions

- profiles expose only intended public identity. Private profile training contents require approved follow status.
- posts are read by author, or by unblocked signed-in viewers if public, or approved followers if private.
- follow/like/comment writes validate actor identity and current access on the server.
- removing followers revokes future private access; changing public→private applies immediately server-side.
- blocking removes/suppresses follow relationships and denies access/interaction in either direction.
- private media uses private buckets and short-lived authorized URLs. Cached/downloaded copies cannot be guaranteed revocable; avoid storing private feed photos offline in the prototype.
- social queries re-check permissions on refresh/resume. Inaccessible cached rows are removed; never rely on hiding UI controls for security.

Direct follows/likes/comments can stay online-only. Post publication must use stable publication IDs and a recoverable upload step; clean up orphaned failed uploads. Do not auto-publish an offline summary without a prior explicit publication action.

## Recovery and lifecycle

Migrations run before local queries. Keep fixtures for upgrade tests. On sign-out, warn about unsynced data and offer sync/cancel or explicit discard; do not silently purge pending workouts. Clear account tokens and sensitive visible caches after sign-out. Foreground sync is guaranteed to be attempted; OS background execution is opportunistic only.
