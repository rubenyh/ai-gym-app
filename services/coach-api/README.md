# coach-api

FastAPI + LangGraph coach service (M5, COACH-01/02, NFR-05/10). Spec: [docs/AI_COACH.md](../../docs/AI_COACH.md),
HTTP contract: `coachDraftRequest`/`coachDraftResponse` in [app/src/domain/contracts.ts](../../app/src/domain/contracts.ts).

- Auth: `Authorization: Bearer <Supabase access token>`, verified with Supabase Auth `GET /auth/v1/user`
  (signature/issuer/expiry checked by Supabase; `aud` must be `authenticated`).
- Data: only the user's token against RPCs `coach_get_context`, `coach_begin_request`, `coach_save_draft`,
  `coach_cancel_draft` and an RLS owner-read of `coach_drafts`
  (`supabase/migrations/20261125150000_m5_coach.sql`). No service-role key. The service cannot modify plans:
  approval is a `coach_approval` sync op from the app.
- Graph: `load_context → validate_inputs → interpret_request → select_candidates → generate_draft →
  validate_draft → repair_or_fail (max 1) → persist_draft` ([coach_api/graph.py](coach_api/graph.py)).
- Limits and budget (enforced in the database, `20261125200000_coach_hardening.sql`, so they hold across any number
  of service processes): per-user hourly limit (`COACH_USER_REQUESTS_PER_HOUR`, can only lower the DB ceiling of 10)
  and global daily cap (`COACH_DAILY_REQUEST_CAP`, atomic per-UTC-day counter); both return HTTP 429 without
  creating a draft. `COACH_REQUEST_TIMEOUT_SECONDS` (90) covers begin + context + both model calls + persist; token
  verification (10 s HTTP timeout) runs before it. A draft left `pending` by a crashed process expires to a retryable
  `failed` when its request ID is repeated after 5 minutes.
- Late results: `coach_save_draft` only changes a `pending` draft, so a cancelled or timed-out draft is never flipped
  to `ready`; responses report the stored state.
- Training bounds: `DRAFT_RULES` (versioned) in [coach_api/config.py](coach_api/config.py). Not medical guarantees.
- Model: Gemini via `google-genai`, model name from `GEMINI_MODEL` (open decision O-08). Missing key or model →
  `503 coach_unavailable`. No fake provider exists outside tests.

## Setup (Python 3.12)

```sh
cd services/coach-api
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"     # Windows; use .venv/bin/python elsewhere
```

## Test (deterministic, scripted provider, no network)

```sh
.venv/Scripts/python -m pytest -q
```

## Integration test (local Supabase stack only)

Real auth, RPCs and RLS with the scripted model: draft persistence, request-ID idempotency (sequential and two
concurrent POSTs), cancel while generating, approval via `sync_push` (applied once, duplicate, second approval
rejected, stale base conflict), failed draft leaves the active program unchanged, cross-account read denied,
PT429 → HTTP 429. Skipped unless the env is set; refuses non-local URLs; creates fresh users with the service-role
key (test-only), deletes them at teardown and never resets the database.

```sh
# repo root, bash, `supabase start` running and migrations applied
set -a; eval "$(supabase status -o env)"; set +a
cd services/coach-api && .venv/Scripts/python -m pytest -q tests/test_integration_local.py
```

## Run locally

Set the server-only variables from the repo-root [.env.example](../../.env.example) in your shell
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, optional `COACH_*` limits), then:

```sh
.venv/Scripts/python -m uvicorn coach_api.main:app_factory --factory --host 127.0.0.1 --port 8000
```

`GET /health` reports whether a provider and the catalog (`app/assets/catalog/exercises.v1.json`) are loaded.
Logs carry draft IDs, statuses and error codes only, never tokens or profile/request text.
