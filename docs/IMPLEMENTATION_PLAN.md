# Implementation plan

Derived from [DELIVERY_PLAN.md](DELIVERY_PLAN.md). Requirement IDs refer to [REQUIREMENTS.md](REQUIREMENTS.md);
decision/blocker IDs (`O-xx`, `D-xx`) refer to [DECISIONS.md](DECISIONS.md). Status as of 2026-11-25:
**M0**: code and automated checks done; Android build/device verification **pending** (O-13, see
[M0 status](#m0-status-2026-11-25)). **M1**: implemented and verified against the local Supabase stack; device
verification pending with M0 (see [M1 status](#m1-status-2026-11-25)).

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

### M0 status (2026-11-25)

**Done (code):** starter demo removed (D-12); central tab shell `app/src/navigation/tabs.ts` + thin routes in
`app/src/app/(tabs)/`; dev-only route `app/src/app/dev/verify.tsx` →
`app/src/features/dev-verification/` (SQLite probe, Rive sample with static fallback, Reanimated keyframe with
`ReduceMotion.System`, deep-link param); provisional identifiers `com.rubenyh.aigym` / scheme `aigym` (O-05);
Rive sample `app/assets/rive/rating.riv` with [attribution](../app/assets/rive/ATTRIBUTION.md); ESLint, jest-expo.

Installed native packages: `expo-sqlite ~58.0.18`, `expo-dev-client ~58.0.21`, `@rive-app/react-native 0.5.18`,
`react-native-nitro-modules 0.36.5` (D-11); Reanimated 4.7.1 / worklets 0.13.0 and Expo Router were already present.

| Check | Command (from `app/`) | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | pass |
| Lint | `npm run lint` | pass, 0 problems |
| Unit tests | `npm test` | pass, 2 suites / 11 tests (tab config ↔ route files; Rive fallback; SQLite count read-back; deep-link param) |
| Dependency health | `npx expo-doctor` | 20/20 checks passed |
| Android JS bundle | `npx expo export --platform android --output-dir <tmp>` | pass; Hermes bundle built, `rating.riv` included as asset |
| Android native build | `npm run android` (emulator `Medium_Phone_API_36.1`, JDK 17) | **FAIL — environment blocker O-13** |
| Android device verification | manual steps below | **not performed** (no installed build) |
| iOS build / device | — | **pending O-06** (config prepared, not verified) |

Unit tests mock the Rive runtime and SQLite; they do not prove native behavior.

**Android build failure (O-13).** Prebuild succeeds; Gradle fails in native CMake/ninja steps with
`ninja: error: mkdir(CMakeFiles/reanimated.dir/C_/repos/clases/heterogenas/ai-gym-app/app/node_modules/react-native-reanimated/Common/cpp/reanimated/CSS/common/filters): No such file or directory`.
Windows `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled` is `0`, so object paths over 260
characters fail. Attempts: CMake 3.31.6 (ninja 1.12.1) via `cmake.dir` in gitignored `app/android/local.properties`
— same error; `subst` short drive — Gradle resolves back to the long path; temporary worktree at `C:\ag` —
Reanimated compiled but `react-native-gesture-handler` codegen still exceeded 260 characters. Not a package
incompatibility: no package was downgraded or swapped.

Resolution options (user decision): enable Windows long paths (admin, then reboot/new shell) and keep CMake
3.31.6; or build in WSL/Linux; or EAS Build (account, see O-06).

**Reproduce / finish verification after O-13 is resolved:**

```bash
cd app
npm ci
# Windows only: Android SDK CMake 3.31.6 and long paths enabled
#   sdkmanager "cmake;3.31.6"
#   echo cmake.dir=C:/Users/<you>/AppData/Local/Android/Sdk/cmake/3.31.6 >> android/local.properties  (after prebuild)
npm run android                 # prebuild + Gradle build + install com.rubenyh.aigym on emulator/device
npx expo start                  # Metro for the development build
adb shell am start -W -a android.intent.action.VIEW -d "aigym://dev/verify?source=adb" com.rubenyh.aigym
```

Device checklist (record device, OS version, result):
1. Deep link opens **M0 verification** showing `Opened via deep link (source=adb)`.
2. Press **Increment and save** twice; note count; `adb shell am force-stop com.rubenyh.aigym`; reopen via deep link; count unchanged.
3. Rive sample animates; **Force static fallback** shows the static character; screen stays usable.
4. **Replay keyframe** pops the badge; enable Settings → Accessibility → Remove animations, relaunch: badge appears
   without animating, status text says reduced motion on, Rive autoplay off.
5. All five tabs render; Home shows the dev link only in development builds.

M0 exit remains open until steps 1–5 pass on Android. iOS repeats them after O-06.

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

### M1 status (2026-11-25)

**Implemented**
- Server: migration `supabase/migrations/20261125120000_m1_identity_settings.sql` — `profiles`, `user_settings`,
  `weekly_goals`, `training_profiles`, `body_weight_entries`, private `avatars` bucket; constraints, index, explicit
  grants (none for `anon`), RLS on every table, frozen weekly-goal history, timezone change from next week, atomic
  `complete_onboarding` and `schedule_weekly_goal` RPCs. Documented in [DATA-DICTIONARY.md](DATA-DICTIONARY.md)
  and [DB-DIAGRAM.md](DB-DIAGRAM.md).
- `supabase/config.toml`: `site_url = "aigym://"`, redirect allowlist `aigym://**`, email confirmations on, Google
  provider block present but disabled (env references, O-07).
- App: Supabase client (`app/src/services/supabase/`) with PKCE and chunked `expo-secure-store` session storage;
  generated DB types; per-account SQLite file with Drizzle schema/migrations (`app/src/db/`); account provider and
  route guards (signed-out → auth, no profile → onboarding, otherwise tabs; cached account opens offline);
  sign-in, sign-up with email confirmation, password reset, `auth/callback` return route, Google OAuth action;
  onboarding; Profile & settings (display name, visibility, units, timezone, weekly goal from next week, sign-out).

**Checks run**

| Check | Command | Result |
| --- | --- | --- |
| Migration from scratch | `supabase db reset --local` (repo root) | pass |
| Schema lint | `supabase db lint --local --level warning` | no errors |
| Database permission tests | `supabase test db` | pass, 6 files / 60 assertions (two accounts, anon, frozen goals, RPC atomicity, storage folders) |
| API isolation (PostgREST, RPC, Storage) | `set -a; eval "$(supabase status -o env)"; set +a; node --test supabase/tests/api/*.test.mjs` | pass, 6 tests |
| Auth redirect allowlist | ad-hoc sign-up/reset against local stack, links read from Mailpit | `aigym://auth/callback` and `…?next=reset-password` accepted |
| App typecheck / lint / unit tests | `npm run typecheck`, `npm run lint`, `npm test` (in `app/`) | pass; 6 suites / 32 tests (secure-storage chunking, account-state offline resolution, per-account DB isolation, validation) |

Native config changed (`expo-secure-store` config plugin in `app.json`; new JS deps `@supabase/supabase-js`, `drizzle-orm`, `zod`): the next development build must include them. No native build was run this milestone.

**Not verified (needs a device build, O-13):** screens and route guards on a device, secure-store persistence,
email-link deep links into the app, offline relaunch, account switch on one device. Google sign-in is untestable
until O-07. The device checklist for M1 is added to the M0 checklist run.

**Deferred inside M1 scope (recorded, not dropped)**
- Avatar picking/upload UI: storage and policies exist; picker needs `expo-image-picker` (native dependency) — add
  with the next native build.
- Training-profile form (PROFILE-01): table and RLS exist; form lands with the coach flow (M5), where it is first
  required.
- Settings and profile edits are online-only until the M3 outbox; offline they show the cached values and an error.
- Sign-out pending-changes warning (NFR-08): nothing is pending before the M2 outbox; add the warning with it.

M1 device checklist (with M0 checklist, after O-13): sign up → confirm link opens app → onboarding → Home; force-stop
offline relaunch reaches Home; sign out, sign in as a second account → no first-account data; password reset link
opens New password screen.

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

Next milestone: **M2** (catalog and manual offline training). Start with O-02 (pin the exercise dataset commit)
and the local training schema + outbox in `app/src/db/`. Device verification of M0/M1 still waits on O-13.
