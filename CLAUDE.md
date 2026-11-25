# CLAUDE.md

Entry point for Claude Code. Shared engineering instructions (specs, layout, verified commands, architecture
rules, secrets, definition of done) live in AGENTS.md so every tool reads the same rules:

@AGENTS.md

## Claude-specific notes

- Start each task from [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md); cite requirement IDs.
- Inside `app/`, [app/CLAUDE.md](app/CLAUDE.md) also loads the Expo SDK rules from `app/AGENTS.md`.
- Optional subagents in `.claude/agents/` (use only when the task is large enough to benefit;
  simple work stays in the main session):
  - `offline-data-engineer`: SQLite/Drizzle schema, migrations, outbox, client sync.
  - `supabase-privacy-reviewer`: read-only audit of RLS, RPCs, Storage policies.
  - `coach-workflow-engineer`: FastAPI/LangGraph coach service and approval contract.
- Project skills in `.claude/skills/`:
  - `verify-sync-rewards`: offline/sync/reward-correction verification checklist.
  - `check-supabase-privacy`: two-account RLS/Storage privacy check.
- Reading real `.env` files is denied in `.claude/settings.json`; use the `.env.example` templates.
