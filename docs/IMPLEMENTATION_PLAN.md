# Implementation plan

Derived from [DELIVERY_PLAN.md](DELIVERY_PLAN.md). Requirement IDs refer to [REQUIREMENTS.md](REQUIREMENTS.md);
decision/blocker IDs (`O-xx`, `D-xx`) refer to [DECISIONS.md](DECISIONS.md). Status as of 2026-11-25:
**nothing implemented**; `app/` is the unmodified Expo SDK 58 starter, `supabase/` has only `config.toml`.

## Dependency graph

```text
M0 Toolchain & native spike
 └─ M1 Backend foundation, auth, local DB
     └─ M2 Catalog & manual training (offline)
         └─ M3 Sync engine
             ├─ M4 Progress & gamification
             ├─ M5 AI coach            (graph/API with mocked model may start after M1+M2)
             └─ M6 Social              (needs M4 summary data for post snapshots)
                 └─ M7 Polish & release gates  (needs M4, M5, M6)
```

M5 and M6 can proceed in parallel once M3 is done. Do not start social features before sync fixtures exist (M3).

---

## M0 — Toolchain and native compatibility spike

**Requirements:** NFR-07, NFR-12. **Depends on:** nothing.

Work:
- Run `npm run reset-project` in `app/` (moves starter to `app/example/`, which is gitignored), or delete
  starter screens deliberately; keep `src/app/` thin.
- Fix the 3 current `npx tsc --noEmit` errors; configure ESLint (`npm run lint`) and jest-expo + RNTL with
  one real test; add `typecheck`/`test` npm scripts and record them in [AGENTS.md](../AGENTS.md#commands-verified-against-this-repository-on-2026-11-25).
- Set app name/scheme/bundle IDs (blocked on **O-05**).
- `npx expo install expo-sqlite expo-dev-client`, Rive + Nitro, and confirm Reanimated/worklets already present.
- Central tab shell (Home, Workouts, Coach, Community, Progress) with placeholder screens.
- Spike screen: write a row to SQLite, force-close, reopen, read it; play a sample Rive file with a static
  fallback; run a Reanimated keyframe respecting reduced motion; open a deep link via the scheme.

Likely files: `app/package.json`, `app/app.json`, `app/eas.json` (if EAS chosen), `app/src/app/_layout.tsx`,
`app/src/app/(tabs)/*`, `app/src/components/app-tabs.tsx`, `app/src/navigation/tabs.ts`, `app/jest.config.js`.

Acceptance: typecheck, lint, and tests pass; Android and iOS development builds run the spike; `npx expo-doctor`
clean or findings documented.
Blockers: **O-04** Rive compatibility, **O-05** identifiers, **O-06** iOS build path.

## M1 — Backend foundation, auth, account-scoped local DB

**Requirements:** AUTH-01, AUTH-02, PROFILE-02, NFR-04, NFR-05, NFR-08, SETTINGS-01 (preferences storage).
**Depends on:** M0.

Work:
- Supabase migrations: `profiles`, `user_settings`, `weekly_goals`, `training_profiles`, `body_weight_entries`
  with RLS; pgTAP tests in `supabase/tests/` for owner-only access across two accounts.
- Supabase client with supported session persistence (secure storage where feasible); email/password, reset,
  verification, Google sign-in with return to the app scheme.
- Per-account SQLite file (D-10), Drizzle schema + migrations run before any query; sign-out warns about
  pending changes.
- Onboarding: handle, display name, units, timezone, weekly goal.

Likely files: `supabase/migrations/*`, `supabase/tests/*`, `supabase/config.toml` (redirect URLs, Google),
`app/src/services/supabase/*`, `app/src/db/{schema,migrations,client}.ts`, `app/src/features/auth/*`,
`app/src/features/onboarding/*`.

Acceptance: `supabase test db` proves account B cannot read A's private rows; sign-in → onboarding → Home;
offline relaunch of a signed-in user reaches local data without a login loop; switching accounts shows no
previous-account data.
Blockers: **O-05**, **O-07** Google credentials (email/password not blocked).

## M2 — Catalog and manual training (offline)

**Requirements:** CAT-01, CAT-02, PLAN-01, SESSION-01..04, SETTINGS-01, NFR-01, NFR-02, NFR-03 (migrations).
**Depends on:** M1.

Work:
- Import pinned dataset metadata (IDs as strings, counted/validated); no restricted media (**O-01**).
- Custom exercises (archive, never delete referenced definitions).
- Routine/program CRUD; session snapshots from routines; empty sessions; one active session.
- Logger: set complete/edit/add/remove, notes, previous results, rest timer with persisted deadline.
- Every mutation = SQLite change + outbox row in one transaction (outbox table exists now; sending is M3).
- Canonical units (integer grams), unit conversion at display/input only.

Likely files: `app/src/db/schema/*`, `app/src/db/repositories/*`, `app/src/features/workouts/*`,
`app/src/features/catalog/*`, `app/src/stores/active-workout-ui.ts` (transient only), `app/src/lib/units.ts`,
`scripts/import-exercises.*`.

Acceptance: force-close mid-workout recovers all committed sets; failed transaction leaves neither session
change nor outbox row; editing a routine leaves old sessions unchanged; unit switch changes display only;
migration upgrade fixture test.
Blockers: **O-02** dataset pin.

## M3 — Synchronization engine

**Requirements:** SYNC-01, AUTH-02, NFR-02, NFR-03, NFR-09. **Depends on:** M1, M2.

Work:
- Server: `operation_receipts`, `server_change_log`, revisions/tombstones on training tables; transactional
  RPCs per aggregate validating ownership and base revision; repeated operation ID returns prior result.
- Client: per-account serialized worker; ordered push per aggregate with rebasing of dependent commands;
  ordered paged pull applied with cursor in one transaction; pending local edits never overwritten.
- Conflict records with user recovery; backoff + jitter; auth pause/resume; sync status/retry screen.
- Triggers: foreground, reconnection, manual. No claims about background execution.

Likely files: `supabase/migrations/*sync*`, `supabase/tests/*sync*`, `app/src/services/sync/*`,
`app/src/db/schema/outbox.ts`, `app/src/features/settings/sync-status.tsx`.

Acceptance (see skill `verify-sync-rewards`): duplicate push and lost acknowledgement yield one session;
deletion propagates as tombstone; restart mid-sync resumes; conflict preserves both versions; expired
token pauses instead of spinning.

## M4 — Progress and gamification

**Requirements:** PROGRESS-01, GAME-01, GAME-02, NFR-11, NFR-06 (fallbacks). **Depends on:** M3.

Work:
- Central versioned rules config (XP, level curve, badge and pet thresholds) — D-03.
- Server-authoritative `reward_events` (unique source/reason/rule-version key), achievement/pet unlocks,
  derived in the session-sync transaction or an idempotent follow-up; local provisional values marked pending.
- PRs, volume, consistency with frozen weekly goals/timezones; body-weight history.
- Pet (Rive, placeholder asset) + coach character components with static fallback and reduced motion.

Likely files: `app/src/features/gamification/rules.ts`, `app/src/features/progress/*`,
`app/src/components/characters/*`, `supabase/migrations/*rewards*`, `supabase/tests/*rewards*`.

Acceptance: save/edit/delete/restore of a session never multiplies XP; missing weeks never subtract;
unit switch creates no PR; timezone/goal change keeps historical weeks; fixture tests for week boundaries.
Blockers: **O-03** final assets (placeholder allowed).

## M5 — AI coach

**Requirements:** COACH-01, COACH-02, PROFILE-01, NFR-05, NFR-10. **Depends on:** M1, M2 (catalog);
approval application needs M3.

Work:
- `services/coach-api/`: FastAPI, Supabase token verification, LangGraph nodes per [AI_COACH.md](AI_COACH.md),
  Pydantic contracts, deterministic validation, one repair, request-ID idempotency, rate limit.
- Provider adapter with mocked responses first; Gemini integration after **O-08**.
- `coach_requests`/`coach_drafts` tables with RLS; approval RPC with approval receipt + base-revision check.
- App: profile completeness, request form, status, draft editor, change summary, approve/cancel.

Likely files: `services/coach-api/**`, `supabase/migrations/*coach*`, `app/src/features/coach/*`,
`app/src/services/coach-client.ts`.

Acceptance: pytest evaluation cases from AI_COACH.md pass with mocked provider; invalid output/timeout never
modifies the active program; duplicate and stale approvals are rejected.
Blockers: **O-08** model/key (live only), **O-09** hosting/Python version.

## M6 — Social

**Requirements:** SOCIAL-01..05, PROFILE-02, NFR-04. **Depends on:** M3, M4.

Work:
- `follows`, `blocks`, `posts`, `likes`, `comments` with RLS honoring visibility, approved follows, and
  two-way blocks; private Storage bucket with short-lived URLs.
- Publication with stable publication ID, exact-field preview, recoverable photo upload, orphan cleanup.
- Feed, profile, comments, likes (TanStack Query, online-only); copy to independent routine (no XP).
- Permission refresh purges inaccessible cached rows.

Likely files: `supabase/migrations/*social*`, `supabase/tests/*social*`, `app/src/features/social/*`.

Acceptance (see skill `check-supabase-privacy`): two/three-account tests for public/private/follow/
remove/block/public→private; posts contain no private fields; failed upload keeps the session saved;
publish retry creates no duplicate.

## M7 — Polish and release gates

**Requirements:** NFR-01, NFR-06, NFR-09 and all [release gates](DELIVERY_PLAN.md#release-gates-for-the-prototype).
**Depends on:** M4, M5, M6.

Work: accessibility pass, reduced-motion and static-fallback audit, Lottie only where useful, Maestro smoke
suite (sign-in, offline workout recovery, publication), profiling on reference devices.
Blockers: **O-10** reference devices; **O-11** only if external release is planned.

---

## First concrete step

Start **M0**: reset the starter, fix the three typecheck errors, add lint/test tooling, then the native spike
(SQLite persistence + Rive + Reanimated + deep link) in Android and iOS development builds. Get **O-05**
(app identifier/scheme) and **O-06** (iOS build path) from the user before the native build step.
