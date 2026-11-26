# Hybrid AI coach

Implemented graph and request lifecycle as diagrams: [COACH_GRAPH.md](COACH_GRAPH.md).

## Product contract

The coach is optional. Users can create and use routines without it. Interaction combines forms for stats and availability with a natural-language request such as “prioritize back” or “include more biceps.” No full chat or automatic weekly adjustment in this release. Every generated change is a draft and requires approval.

## Inputs

Private profile: goal, age, height/weight, experience, available days, equipment, session duration, stated limitations. Optional context: current program, recent session results and prior preferences. Only send context relevant to the request. Do not include social data, photos, emails, or unrelated history.

Validate profile completeness; ask a focused structured clarification when the request is ambiguous or conflicts with constraints. Limitations guide exclusions but this system is not a medical suitability assessment.

## LangGraph workflow

1. **authenticate/load_context**: verify Supabase token and ownership; load a consistent profile/program revision.
2. **validate_inputs**: validate forms, size/rate limits, supported training mode, and available information.
3. **interpret_request**: Gemini returns typed intent, priorities and constraints; natural-language text cannot override system constraints or invoke arbitrary tools.
4. **select_candidates**: code filters catalog by supported tracking mode, equipment and explicit exclusions. No embedding/vector database required initially.
5. **generate_draft**: model proposes days/routines/sets/reps/optional rest using only allowed candidate IDs.
6. **validate_draft**: Pydantic and deterministic checks validate references, day count, set/rep bounds, duplicates, duration estimates, equipment, and exclusions. Bounds must be versioned configuration, not portrayed as medical guarantees.
7. **repair_or_fail**: at most one model repair with specific validation errors; otherwise return a recoverable failure.
8. **persist_draft**: save the validated draft, explanation, input/base revision, schema and model metadata privately.

Human approval is outside automatic generation. Activation checks the reviewed draft revision and uses the transactional application contract. User edits are validated again; changing preferences/program after generation may make the draft stale.

## Illustrative API

```text
POST /v1/coach/drafts
  Authorization: Bearer <Supabase access token>
  {request_id, mode: create|adjust, program_id?, base_revision?, preferences_text}
  -> {draft_id, status: ready|needs_input|failed, draft?, clarification?, error?}

GET /v1/coach/drafts/:draft_id
  -> owned draft and status only
```

Profile/plan context is loaded server-side or accepted as an explicitly versioned, validated snapshot; never trust a client-supplied owner. A repeated request ID must not create duplicate drafts or unbounded duplicate model calls. Concurrent duplicate requests return existing state. If work outlives the HTTP request, persist job state; a timeout does not imply cancellation of already running provider work.

A draft includes a title, weekly day assignments, routines, catalog exercise IDs, ordered target sets, reps, optional rest seconds, optional supported load targets, explanation and unresolved assumptions. Do not invent exact starting loads when history is absent. Age/height/weight alone do not establish lifting capacity; ask the user to select an appropriate load or use relevant recorded history.

Approval may use a Supabase RPC and outbox operation, not an arbitrary unauthenticated write endpoint. Exactly-once application is established by an approval receipt and database transaction.

## Reliability

Initial request budget: 90 seconds total, maximum one repair, configurable input/output limits and user request rate limits. Enforce an operator budget cap even though the app is free. Failed budget/provider/network calls preserve existing plans and allow retry. Never log raw sensitive profile payloads or model credentials. Keep the exact Gemini model configurable and provider access behind an adapter.

Gemini structured output improves schema conformance but does not prove exercise validity. Validation must occur outside the model. Only trusted catalog lookup and draft persistence are available to the graph; it cannot modify active plans, run shell code, or access arbitrary URLs.

## Evaluation cases

Cover beginner/experienced profiles, limited equipment, two versus five available days, back/biceps requests, unavailable exercise IDs, malformed output, conflicting preferences, prompt injection, missing history, limitations requiring clarification, timeout, duplicate request, stale approval, and duplicate approval. Assert that no failed or unapproved draft changes active plans. Use mocked provider responses for deterministic checks and a small optional live evaluation set.

References: https://ai.google.dev/gemini-api/docs/structured-output and https://github.com/hasaneyldrm/exercises-dataset.
