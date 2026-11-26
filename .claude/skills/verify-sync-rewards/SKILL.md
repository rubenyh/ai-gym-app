---
name: verify-sync-rewards
description: Verify offline recovery, sync idempotency, and reward/progress corrections in AI Gym App. Use after changing SQLite schema, outbox, sync worker, sync RPCs, reward_events, or progress calculations, or before closing milestones M2–M4.
---

# Verify offline sync and reward corrections

Specs: `docs/architecture/DATA_AND_SYNC.md` (sync protocol, recovery), `docs/product/PROGRESS_AND_GAMIFICATION.md`,
`docs/product/REQUIREMENTS.md` (SESSION-03/04, SYNC-01, GAME-01, NFR-02/03/11), release gates in `docs/planning/DELIVERY_PLAN.md`.

## 1. Run what exists

Check the commands table in `AGENTS.md` first; only run commands listed there as working.
- App tests (once jest-expo is configured in M0): run the project's test script from `app/`.
- Database tests: `supabase test db` from the repo root (needs `supabase start` and Docker).

If a runner is not configured yet, say so in the report. Do not claim a scenario passed without executing it.

## 2. Scenarios that must have a test

Mark each as: covered by `<test file>` / missing / not applicable yet.

Local durability
- [ ] Transaction failure after domain write leaves neither the change nor the outbox row.
- [ ] Force-close mid-workout, reopen: all committed sets and the active session return; rest timer derives from the persisted deadline.
- [ ] Starting a second workout offers resume/discard; never two active sessions.
- [ ] Old-schema database fixture upgrades with history and pending outbox rows intact.

Sync
- [ ] Same operation ID pushed twice returns the prior receipt; one server effect.
- [ ] Acknowledgement lost, client retries: one canonical session, one reward.
- [ ] Several offline edits to one aggregate push in order with rebased base revisions.
- [ ] Deletion propagates as a tombstone through pull.
- [ ] Pull never overwrites a pending local edit; conflicting completed workout produces a recoverable conflict, not last-write-wins.
- [ ] Restart between push and pull resumes from the saved cursor.
- [ ] Expired auth pauses sync with a visible state (no infinite spinner).
- [ ] Account A's outbox never syncs under account B.

Rewards and progress
- [ ] Complete → edit → edit: exactly one completion award.
- [ ] Remove all completed sets / delete session revokes; restoring re-grants the same award key, not a new one.
- [ ] Weekly bonus revoked/restored by corrections; missing weeks never subtract; total never below zero.
- [ ] Client cannot submit XP; server reward events are authoritative; offline values shown as pending.
- [ ] Unit switch creates no PR; ties create no PR notification; incomplete and assisted sets excluded from load PR/volume.
- [ ] Goal or timezone change applies from the next week; historical weeks unchanged.
- [ ] Unlocked pet stages persist when a correction lowers the level.
- [ ] Rule values come from the central versioned config, not UI code.

## 3. Report

List: commands run with exit status, scenarios covered/missing, and failures with the shortest decisive error line.
