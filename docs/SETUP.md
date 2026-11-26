# Local setup

How to run the app, the local backend and the coach service on a development machine. Commands and their
verification status: [AGENTS.md](../AGENTS.md#commands-verified-against-this-repository-on-2026-11-25).

## Prerequisites (versions observed 2026-11-25)

| Tool | Observed | Used for |
| --- | --- | --- |
| Node.js / npm | 24.13.0 / 11.12.1 | `app/` (Expo SDK 58), API tests |
| Docker Desktop | 28.0.4 | local Supabase stack |
| Supabase CLI | 2.75.0 | `supabase start`, migrations, pgTAP |
| Python | 3.12.7 | `services/coach-api` (venv) |
| Android Studio + JDK 17 | emulator `Medium_Phone_API_36.1` | development build (blocked on this Windows machine, O-13) |

iOS builds need macOS or EAS Build (O-06, not verified).

## Env files

Real `.env*` files are gitignored; copy the templates and fill values from `supabase status -o env`.

| Template | Copy to | Contains |
| --- | --- | --- |
| [app/.env.example](../app/.env.example) | `app/.env` | `EXPO_PUBLIC_*` only (bundled into the app): Supabase URL, anon key, coach URL. Android emulator: `http://10.0.2.2:54321`. |
| [.env.example](../.env.example) | shell env of the coach service | server-only: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `COACH_*` limits. Never prefix these `EXPO_PUBLIC_` or put them under `app/`. |

## 1. Local Supabase (repo root, Docker running)

```bash
supabase start                      # first run pulls images
bash scripts/supabase-ready.sh      # probes REST + Storage through Kong; restarts Kong once on 502
supabase status -o env              # API_URL, ANON_KEY, SERVICE_ROLE_KEY (local only)
```

Mailpit (sign-up confirmation emails): http://127.0.0.1:54324. Studio: http://127.0.0.1:54323.

After adding a migration: `supabase migration up --local` (keeps data). To rebuild from scratch:
`supabase db reset --local` (local only, deletes local data), then run `bash scripts/supabase-ready.sh` — the reset
recreates the storage/auth/realtime containers with new IPs and Kong can keep the old ones (502 until restarted).

Backend checks: `supabase test db`, `supabase db lint --local --level warning`, and
`set -a; eval "$(supabase status -o env)"; set +a; node --test supabase/tests/api/*.test.mjs`.

## 2. App (from `app/`)

```bash
npm install
npm run typecheck && npm run lint && npm test
npm run test:integration            # needs the local stack and its env exported (see above)
npm run android                     # development build; fails on this Windows machine (O-13)
npx expo start                      # serves JS to an installed development build
```

Add dependencies with `npx expo install <package>`. Device smoke flows: [app/maestro/README.md](../app/maestro/README.md).

## 2b. Web (browser)

The same app runs in a browser with the same screens, contracts and backend. Local training data and the outbox
live in a per-account SQLite database (expo-sqlite on wa-sqlite/OPFS in the browser), so browser storage of this
origin (`http://localhost:8081`) holds the training data; clearing site data discards unsynced changes.

Requirements: local Supabase running (section 1), Node as above, a Chromium-based browser or Firefox with
`SharedArrayBuffer` support. The browser must reach the backend at `127.0.0.1`, not the emulator alias `10.0.2.2`.
Shell variables override `app/.env.local`, so set the URLs for the web server only:

```bash
# Git Bash / macOS / Linux, from app/
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 EXPO_PUBLIC_COACH_API_URL=http://127.0.0.1:8010   npx expo start --web --port 8081
```

```powershell
# PowerShell, from app/
$env:EXPO_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321'; $env:EXPO_PUBLIC_COACH_API_URL='http://127.0.0.1:8010'
npx expo start --web --port 8081
```

Open http://localhost:8081 (use `localhost`: it is the origin allowed for auth redirects in
`supabase/config.toml` and for coach CORS). Sign-up confirmation and password-reset emails are in Mailpit
(http://127.0.0.1:54324); their links return to `http://localhost:8081/auth/callback`. Changing
`additional_redirect_urls` needs `supabase stop && supabase start`.

Coach service for the browser (section 3) needs the web origin allowed; any free port works if the app's
`EXPO_PUBLIC_COACH_API_URL` matches (8010 here because 8000/8001 were taken on the test machine):

```bash
COACH_CORS_ORIGINS=http://localhost:8081 SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<local anon key>   .venv/Scripts/python -m uvicorn coach_api.main:app_factory --factory --host 127.0.0.1 --port 8010
```

Web-specific notes:

- The dev server sends `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`
  (`app/metro.config.js`); expo-sqlite needs them for `SharedArrayBuffer`. A deployed web build must send the same
  headers from its host. Without them the app shows "This page cannot use offline storage … Reload the page."
- Orca's embedded browser does not always apply cross-origin isolation on navigation (it alternated between
  isolated and not isolated on consecutive reloads of the same URL, with the headers always present). Reload once
  if the message above appears there; regular Chrome applies the headers on the first load.
- Session tokens are kept in this origin's `localStorage` (no keychain in browsers); see D-35.

## 3. Coach service (`services/coach-api`)

```bash
cd services/coach-api
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"    # Windows; .venv/bin/python elsewhere
.venv/Scripts/python -m pytest -q
.venv/Scripts/python -m uvicorn coach_api.main:app_factory --factory --host 127.0.0.1 --port 8000
```

Without `GEMINI_API_KEY`/`GEMINI_MODEL` (open O-08) the service answers `503 coach_unavailable`; manual training
features do not depend on it. Details: [services/coach-api/README.md](../services/coach-api/README.md).

## Hosted configuration: not done

No hosted Supabase project exists (O-14) and the coach service has no hosting (O-09). Nothing in this repo has been
applied remotely; `supabase link` / `supabase db push` and deployments need explicit user approval.
