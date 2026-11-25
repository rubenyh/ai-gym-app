---
name: check-supabase-privacy
description: Check AI Gym App privacy enforcement in Supabase (RLS, RPCs, Storage) with multi-account tests, plus secret placement in the app. Use after adding or changing migrations, policies, RPCs, buckets, social/profile/coach queries, or env variables, and before closing milestones M1, M5, M6.
---

# Check Supabase privacy

Specs: `docs/PRODUCT.md` (Privacy), `docs/DATA_AND_SYNC.md` (Social permissions), `docs/REQUIREMENTS.md`
(NFR-04, NFR-05, SOCIAL-01..05). For a deeper read-only audit, the `supabase-privacy-reviewer` subagent applies the same checklist.

## 1. Static checks

- Every new `public` table has `enable row level security` and policies for each operation used.
- Policies and RPCs derive identity from `auth.uid()`; no user-ID parameters trusted.
- `security definer` functions set `search_path` and re-check access.
- Profile/post views, RPC return types, and post snapshots contain no age, height, body weight, limitations, training profile, or coach data.
- Storage buckets for photos are private; object paths are owner-scoped.
- Secrets: search `app/` for service-role keys, Gemini keys, OAuth secrets, and `EXPO_PUBLIC_` variables that are not in `app/.env.example`. Any hit is a blocker.

## 2. Executable checks

From the repo root: `supabase start` (Docker required), then `supabase test db` (pgTAP tests in `supabase/tests/`).
Use only commands confirmed in `AGENTS.md`. If Docker or tests are unavailable, report that; do not mark checks as passed.

## 3. Required access matrix (each row needs a test)

Accounts: A (owner), B (stranger), F (approved follower), P (pending requester), X (blocked by or blocking A).

| Resource | A | B | F | P | X |
| --- | --- | --- | --- | --- | --- |
| training_profiles, body weight, settings, coach requests/drafts | rw | none | none | none | none |
| sessions, routines, programs, reward events | owner only (reward events not client-writable) | none | none | none | none |
| public profile identity | r | r | r | r | none |
| post on public profile | rw | r | r | r | none |
| post on private profile | rw | none | r | none | none |
| post photo object | rw | as post | as post | as post | none |
| like/comment on accessible post | yes | if post readable | yes | if readable | no |

Also test transitions: follow accepted → access; follower removed → access lost; public→private → strangers lose access immediately; block → follows removed and access denied both ways.

## 4. Report

Findings as `path:line — problem — fix`, missing matrix tests, commands run with exit status.
