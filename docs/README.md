# AI Gym App — specification index

Prepared: 2026-11-25, reorganized 2026-11-26. Working name: AI Gym App; final branding is undecided.
Status: M0–M7 implemented as a local prototype (Expo app in `app/`, Supabase in `supabase/`, coach service in
`services/coach-api/`); see [planning/IMPLEMENTATION_PLAN.md](planning/IMPLEMENTATION_PLAN.md). Engineering
instructions: [`AGENTS.md`](../AGENTS.md).

## Layout

| Folder | Responsibility | Documents |
| --- | --- | --- |
| [`product/`](product/) | What to build and why (authoritative for scope) | [Product](product/PRODUCT.md) (authoritative), [Requirements](product/REQUIREMENTS.md), [Screens and flows](product/SCREENS_AND_FLOWS.md), [Progress and gamification rules](product/PROGRESS_AND_GAMIFICATION.md) |
| [`architecture/`](architecture/) | How the system is built: stack, boundaries, protocols, contracts | [Architecture](architecture/ARCHITECTURE.md), [Data and sync](architecture/DATA_AND_SYNC.md), [Contracts](architecture/CONTRACTS.md), [AI coach](architecture/AI_COACH.md), [Coach graph diagram](architecture/COACH_GRAPH.md) |
| [`database/`](database/) | Implemented schema reference | [Data dictionary](database/DATA-DICTIONARY.md), [DB diagram](database/DB-DIAGRAM.md) |
| [`planning/`](planning/) | Sequence, status, evidence, decisions | [Delivery plan](planning/DELIVERY_PLAN.md), [Implementation plan and status](planning/IMPLEMENTATION_PLAN.md), [Decisions](planning/DECISIONS.md), [Traceability](planning/TRACEABILITY.md) |
| [`guides/`](guides/) | How to run and work on it | [Local setup (native + web)](guides/SETUP.md), [Claude setup prompt](guides/CLAUDE_SETUP_PROMPT.md) |

Reading order for a new contributor: Product → Requirements → Architecture → Data and sync → Implementation
plan → Setup.

Older references (SQL comments in applied migrations, commit messages) use the previous flat paths
`docs/<NAME>.md`; the file names are unchanged, only the folder above was added.

## Decision status

- **Confirmed**: explicitly selected by the user, including Expo, Supabase, SQLite, hybrid coaching, social features, and animation responsibilities.
- **Implementation default**: proposed engineering behavior that can be implemented without further product discovery, but is not an independently confirmed user preference. Examples: exact XP formula, pet thresholds, component libraries, and synchronization protocol.
- **Open dependency**: illustration reuse rights, actual character assets, compatible package versions, exact Gemini model, and hosting configuration.

Do not represent an open dependency as resolved. Specific numerical rewards and performance targets are configurable prototype defaults. Requirements use “must” to define the intended implementation baseline; defaults remain adjustable.

These documents contain no credentials and do not authorize deployment, public release, purchases, or destructive replacement of existing source files.
