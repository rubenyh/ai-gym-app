# AI coach graph

Diagram of the implemented coach agent. Source of truth is the code:
[`services/coach-api/coach_api/graph.py`](../../services/coach-api/coach_api/graph.py) (LangGraph state graph) and
[`services/coach-api/coach_api/main.py`](../../services/coach-api/coach_api/main.py) (HTTP API around it).
Behaviour and rules: [AI_COACH.md](AI_COACH.md). Update this page when a node or edge changes.

## Request lifecycle

The model never writes plans. The service only saves a **draft**; a plan changes only when the user approves it,
which travels through the normal sync protocol.

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant App as Expo app
    participant API as Coach API (FastAPI)
    participant G as LangGraph run
    participant LLM as Gemini (O-08)
    participant DB as Supabase (user token, RLS)

    U->>App: Profile form + request text
    App->>API: POST /v1/coach/drafts (Bearer user token, requestId, mode, programId, baseRevision)
    API->>DB: verify token (Supabase Auth)
    alt provider or catalog missing
        API-->>App: 503 coach_unavailable
    end
    API->>DB: coach_begin_request (idempotent on requestId, hourly max 10 per user, daily operator cap)
    alt rate limit
        DB-->>API: PT429
        API-->>App: 429, no draft created
    else requestId already used
        DB-->>API: existing draft (created = false)
        API-->>App: existing draft, no model call
    end
    API->>G: run(draftId) inside one time budget
    G->>DB: coach_get_context (profile, active program, recent sessions)
    G->>LLM: interpret (structured output)
    G->>LLM: generate (structured output, at most one repair)
    G->>DB: coach_save_draft (ready | needs_input | failed)
    API-->>App: draft
    Note over API,DB: Timeout, provider or network error: draft saved as failed (retryable). Plans untouched.
    U->>App: Review draft, Approve
    App->>DB: sync_push coach_approval op (base revision must match, applied once)
    DB-->>App: applied: program + routines created, program active
```

`POST /v1/coach/drafts/{id}/cancel` marks a pending draft cancelled; a late model result never overwrites a draft
that is no longer pending.

## LangGraph state graph

Every node may set `outcome`. The router `done_or(next)` sends the run to `persist_draft` as soon as an outcome
exists, otherwise to the next node. `generate_draft → validate_draft` and `persist_draft → END` are unconditional.

```mermaid
flowchart TD
    START([START]) --> load_context

    load_context["load_context<br/>coach_get_context, minimized summary"]
    validate_inputs["validate_inputs<br/>goal, experience, weekdays, minutes present?"]
    interpret_request["interpret_request<br/>LLM: Intent (priorities, exclusions, days)"]
    select_candidates["select_candidates<br/>catalog filter: equipment, exclusions, priority muscles"]
    generate_draft["generate_draft<br/>LLM: DraftContent from candidates only"]
    validate_draft["validate_draft<br/>schema + bounds + candidate keys + exclusions"]
    repair_or_fail["repair_or_fail<br/>repairs below max_repairs (1)?"]
    persist_draft["persist_draft<br/>coach_save_draft"]

    load_context -- "stale programId/baseRevision → failed stale_base<br/>adjust without program → needs_input" --> persist_draft
    load_context -- ok --> validate_inputs
    validate_inputs -- "missing field → needs_input" --> persist_draft
    validate_inputs -- ok --> interpret_request
    interpret_request -- "clarification or too many days → needs_input" --> persist_draft
    interpret_request -- ok --> select_candidates
    select_candidates -- "no candidates → needs_input (equipment)" --> persist_draft
    select_candidates -- ok --> generate_draft
    generate_draft --> validate_draft
    validate_draft -- "valid → ready" --> persist_draft
    validate_draft -- "errors" --> repair_or_fail
    repair_or_fail -- "retry with errors + previous output" --> generate_draft
    repair_or_fail -- "limit reached → failed invalid_model_output" --> persist_draft
    persist_draft --> END([END])

    classDef llm fill:#e8f0fe,stroke:#4a6ee0;
    classDef db fill:#e9f7ef,stroke:#2e8b57;
    class interpret_request,generate_draft llm;
    class load_context,persist_draft db;
```

Blue nodes call the model; green nodes call Supabase with the user's token (RLS, no service-role key).

## Nodes

| Node | Reads | Writes to state | Can end the run with |
| --- | --- | --- | --- |
| `load_context` | `coach_get_context` | `profile`, `context_summary` (no social data, notes or loads; trimmed to `COACH_MAX_CONTEXT_CHARS`), `has_history` | `failed stale_base` (program changed or unsynced), `needs_input mode` (adjust without active program) |
| `validate_inputs` | profile | — | `needs_input` for goal, experience, availableWeekdays, sessionMinutes |
| `interpret_request` | summary, request text (wrapped in `<user_request>`) | `intent` (invalid model JSON → empty intent; code constraints still apply) | `needs_input` (model clarification, or more days requested than available) |
| `select_candidates` | bundled catalog | `candidates` (≤ `COACH_MAX_CANDIDATES`), `excluded_keys`, `repairs = 0` | `needs_input equipment` |
| `generate_draft` | summary, intent, candidates, `DRAFT_RULES`, previous errors | `raw` model output | — |
| `validate_draft` | `raw` | `errors`, or `outcome ready` with catalog names (not model names) and a no-history assumption when needed | `ready` |
| `repair_or_fail` | `repairs`, `errors` | `repairs + 1` | `failed invalid_model_output` |
| `persist_draft` | `outcome` | `saved` (stored draft returned to the API) | always ends |

## Outcomes

| Status | Meaning | Changes plans? |
| --- | --- | --- |
| `ready` | Valid draft for review | No — only an approved `coach_approval` push does |
| `needs_input` | One focused question (`clarification.field`, `question`) | No |
| `failed` | `stale_base`, `invalid_model_output`, `timeout`, `provider_error`, `data_unavailable` (retryable flags per error) | No |
| `cancelled` | User cancelled while pending | No |
