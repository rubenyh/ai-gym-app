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

## Run locally

Set the server-only variables from the repo-root [.env.example](../../.env.example) in your shell
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, optional `COACH_*` limits), then:

```sh
.venv/Scripts/python -m uvicorn coach_api.main:app_factory --factory --host 127.0.0.1 --port 8000
```

`GET /health` reports whether a provider and the catalog (`app/assets/catalog/exercises.v1.json`) are loaded.
Logs carry draft IDs, statuses and error codes only, never tokens or profile/request text.
