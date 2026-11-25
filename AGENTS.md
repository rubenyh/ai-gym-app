# AGENTS.md — AI Gym App engineering instructions

Tool-neutral instructions for any coding agent or human contributor. Product and technical
requirements live only in [`docs/`](docs/README.md); this file does not restate them. When this file and
`docs/` disagree, `docs/` wins — fix this file.

## Authoritative documents

| Need | Read |
| --- | --- |
| Index and decision-status vocabulary | [docs/README.md](docs/README.md) |
| Product scope, privacy, exclusions (authoritative) | [docs/PRODUCT.md](docs/PRODUCT.md) |
| Requirement IDs and acceptance criteria | [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) |
| Screens, navigation, flows | [docs/SCREENS_AND_FLOWS.md](docs/SCREENS_AND_FLOWS.md) |
| Stack and module boundaries | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Entities, RLS, sync protocol | [docs/DATA_AND_SYNC.md](docs/DATA_AND_SYNC.md) |
| Coach graph, API, approval | [docs/AI_COACH.md](docs/AI_COACH.md) |
| XP, levels, PRs, weekly consistency | [docs/PROGRESS_AND_GAMIFICATION.md](docs/PROGRESS_AND_GAMIFICATION.md) |
| Ordered milestones and current blockers | [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) |
| Confirmed vs. default vs. open decisions | [docs/DECISIONS.md](docs/DECISIONS.md) |
| Expo SDK-specific rules (versioned docs, CNG, `expo install`) | [app/AGENTS.md](app/AGENTS.md) |

Do not re-run product discovery or swap selected technologies without a concrete compatibility
reason recorded in `docs/DECISIONS.md`. Never present an open dependency as resolved.

## Repository layout

```text
app/                 Expo SDK 58 app (the only mobile app — never create a second one)
  src/app/           Expo Router routes: thin wrappers only
  src/features/      auth, account, catalog, workouts, sync, progress, gamification, coach, community
  src/db/            per-account SQLite (Drizzle schema + migrations)
  src/services/      Supabase client, sync worker, coach client, query provider
  src/domain/        frozen shared contracts (docs/CONTRACTS.md)
  maestro/           device smoke flows (prepared, not executed)
  src/components/    shared UI and character wrappers
supabase/            Supabase CLI project: config.toml, migrations/, tests/database (pgTAP), tests/api
services/coach-api/  FastAPI + LangGraph coach service (Python 3.12, venv in .venv)
docs/                specifications
```

`app/` implements M0–M7 code paths (see [IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md#m2m7-status-2026-11-25)) plus a dev-only native verification route
(`/dev/verify`). Schema reference: [docs/DATA-DICTIONARY.md](docs/DATA-DICTIONARY.md),
[docs/DB-DIAGRAM.md](docs/DB-DIAGRAM.md). The earlier Flutter project was already removed from `app/`
in commit `fbc5047`; no Flutter migration remains.

## Commands (verified against this repository on 2026-11-25)

Package manager is **npm** (`app/package-lock.json`). Observed: Node 24.13.0, npm 11.12.1,
Supabase CLI 2.75.0 (3.4.0 available). Run app commands from `app/`.

| Purpose | Command | Status |
| --- | --- | --- |
| Install | `npm install` | lockfile present |
| Add dependency | `npx expo install <package>` | required instead of `npm install <pkg>` for SDK-compatible versions |
| Typecheck | `npm run typecheck` | passes. Runs `expo customize tsconfig.json` first to generate gitignored `expo-env.d.ts` and typed-route types, then `tsc --noEmit`. |
| Lint | `npm run lint` | passes (ESLint 9 flat config, `eslint-config-expo`) |
| Unit tests | `npm test` | passes (jest-expo, React Native Testing Library 14) |
| App integration tests | `npm run test:integration` (local stack env exported, see API isolation row) | passes per [IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) final checks; refuses non-local URLs |
| Diagnose deps | `npx expo-doctor` | 20/20 checks passed (downloads expo-doctor on demand) |
| Android dev build | `npm run android` (`expo run:android`) | **fails on this Windows machine** (path length, O-13); see [M0 status](docs/IMPLEMENTATION_PLAN.md#m0-status-2026-11-25) |
| Dev server | `npx expo start` | serves the installed development build |
| iOS dev build | `npm run ios` | **not verified**: needs macOS or EAS Build (open O-06) |
| Local backend | `supabase start` (repo root) | works with Docker Desktop running (local stack only) |
| Backend readiness | `bash scripts/supabase-ready.sh` (repo root) | probes REST + Storage via Kong; on 502 restarts Kong once (stale container IPs after `db reset`), bounded 10 × 1 s |
| Apply new migrations | `supabase migration up --local` | applies pending files without wiping data |
| Rebuild local DB | `supabase db reset --local` | applies `supabase/migrations/` from scratch; **local only** |
| DB permission tests | `supabase test db` | passes (pgTAP, `supabase/tests/database/`) |
| API isolation tests | `set -a; eval "$(supabase status -o env)"; set +a; node --test supabase/tests/api/*.test.mjs` | passes; refuses non-local URLs |
| DB lint | `supabase db lint --local --level warning` | no errors |
| DB types | `supabase gen types typescript --local --schema public > app/src/services/supabase/database.types.ts` | regenerate after each migration |
| Local SQLite migrations | `npm run db:generate` (in `app/`) | Drizzle; regenerate after editing `app/src/db/schema.ts` |
| Coach tests | `.venv/Scripts/python -m pytest -q` (in `services/coach-api`, Python 3.12 venv) | 32 tests collected; setup in [services/coach-api/README.md](services/coach-api/README.md) |
| Catalog import | `node scripts/import-exercises.mjs <clone-of-exercises-dataset>` (in `app/`) | writes `assets/catalog/exercises.v1.json` (metadata only, pinned SHA in ATTRIBUTION.md) |
| Sync end-to-end | `set -a; eval "$(supabase status -o env)"; set +a; npm run test:integration` (in `app/`) | passes, 7 tests; real engine + repositories vs local stack; refuses non-local URLs |
| Coach tests | `.venv/Scripts/python -m pytest -q` (in `services/coach-api/`, venv per its README) | passes; integration test runs only when local Supabase env vars are exported |
| Kong after reset | `docker restart supabase_kong_ai-gym-app` | needed when Storage/REST return 502 after `supabase db reset` (CLI 2.75) |

Full local setup (prerequisites, env files, stack, app, coach): [docs/SETUP.md](docs/SETUP.md).
Update this table when a command is added or its status changes. Never document a command you have
not run or confirmed exists.

## Architecture rules (non-negotiable)

- **Data ownership.** SQLite (expo-sqlite + Drizzle) is the durable source of training data. Zustand
  holds transient UI state only. TanStack Query handles remote social/coach requests and is never a
  second canonical training cache.
- **Atomic writes.** Every committed local training change and its outbox operation commit in one
  SQLite transaction, or neither does.
- **Sync is a protocol**, not a cache: stable UUID operation IDs, transactional server receipts,
  aggregate revisions, tombstones, ordered cursor pulls, recoverable conflicts (no silent
  last-write-wins on completed workouts). Supabase Realtime or query caches alone are not sync.
  See [DATA_AND_SYNC.md](docs/DATA_AND_SYNC.md#sync-protocol--implementation-default).
- **Offline first.** One active workout at a time. Manual routines and logging never depend on AI or
  the network. Saving a set never waits on a remote call or an animation.
- **Separate snapshots.** Plans (routines/programs), performed sessions, coach drafts, and published
  posts are distinct entities; editing one never silently rewrites another.
- **Coach approval.** A draft becomes active only through explicit user approval, applied once,
  checked against the base program revision (stale/repeated approvals rejected).
- **Rewards.** XP, levels, badges, PRs are deterministic, idempotent, and server-reconciled
  (`reward_events` unique key). Clients never submit XP totals. Missing workouts never punish the pet.
  All numeric rules live in one versioned config module, never in UI code.
- **Privacy is enforced by the backend.** RLS and private Storage buckets enforce ownership,
  approved follows, and blocks. Private stats/body weight/coach data never appear in profiles or
  posts. UI hiding is not security.
- **Navigation stays changeable.** Thin Expo Router routes; tab labels/order defined in one place;
  feature modules never depend on tab order.
- **Motion.** Rive for pet/coach characters (static fallback required), Lottie only for authored
  sequences, Reanimated for UI motion. Respect reduced motion. Animation projects game state; it never
  owns it.
- **Units and time.** Store canonical metric values (e.g. integer grams); units are display/input only.
  Freeze historical week boundaries and goals across timezone/goal changes.
- **Exercise media.** Dataset images/GIFs are an unresolved rights dependency. Import metadata only; do
  not commit or hotlink restricted media and never label it MIT.
- **No false guarantees.** Timers use persisted deadlines; background sync is opportunistic. Do not
  claim either runs while the OS suspends the app.

## Secrets

- Public mobile config: [`app/.env.example`](app/.env.example) (`EXPO_PUBLIC_*` only — bundled into the app).
- Server-only secrets: [`.env.example`](.env.example) (service-role key, Gemini key, OAuth secrets).
- A Gemini key, Supabase service-role/secret key, or OAuth secret must **never** be prefixed
  `EXPO_PUBLIC_`, placed under `app/`, logged, or committed. Real `.env*` files are gitignored.
- Do not log access tokens or raw profile/coach payloads.

## Testing priorities

Write meaningful tests for: offline recovery after force-close, duplicate/retried operations, lost
acknowledgements, account isolation, SQLite migration upgrades with pending outbox rows, reward
corrections (edit/delete/restore), follow/block/visibility permissions across two accounts, stale or
duplicate coach approval, and invalid model output. Coverage percentages are not a goal.

## Definition of done

1. Change traces to requirement IDs in [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) and a milestone in
   [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).
2. Typecheck and lint pass (or the failure is pre-existing and documented above).
3. Relevant tests added and passing; for backend permission changes, two-account tests via `supabase test db`.
4. No secrets or restricted media added; new env vars added to the right `.env.example`.
5. Docs updated when behavior, commands, or decisions change (`docs/DECISIONS.md` for decisions).
6. Report states exactly what was run and what was not. Never claim untested behavior works.

## Out of bounds without explicit user approval

Applying migrations to a remote Supabase project (`supabase db push`, `supabase link`), purchasing services, deploying, `eas submit`/`eas update`, publishing, deleting user data or source
directories, installing third-party plugins/MCP servers, or destructive database resets of non-local
environments.
