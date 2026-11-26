# Prompt for Claude — repository setup and implementation guidance

Paste the following into Claude while working inside the actual repository.

---

You are helping develop AI Gym App. Read every specification in `docs/`, starting with `docs/README.md`. These documents are the product/technical baseline. The mobile stack is Expo + React Native + TypeScript, replacing an earlier Flutter direction. Do not re-run product discovery or replace selected technologies without a concrete compatibility reason.

## Immediate task

Inspect the repository, existing instructions, source layout, package manager/lockfiles and installed versions. Then set up a concise, consistent development-documentation system and an actionable implementation plan. This task authorizes documentation/configuration for agent guidance; do not start full app implementation, buy services, deploy, publish, or delete/replace an existing Flutter project as part of this setup.

If the repo is still Flutter, document a migration plan preserving existing source. If it is already Expo, adapt to the existing structure. Do not create a second app inside the current app accidentally.

## Required outputs

1. Root `CLAUDE.md`: short entry point linking authoritative specs, architecture boundaries, working commands verified from the repository, checks, secret handling and definition of done. Use exact filename casing.
2. Root `AGENTS.md`: equivalent tool-neutral engineering instructions. Avoid divergent copies of product requirements; link `docs/`.
3. Keep `docs/product/PRODUCT.md` as the authoritative product document. Do not create a conflicting root `product.md`; add a pointer only if repository conventions require it.
4. `docs/planning/IMPLEMENTATION_PLAN.md`: ordered milestones with dependency relationships, requirement IDs, files/components likely affected, acceptance checks, and unresolved blockers. Use `docs/planning/DELIVERY_PLAN.md` as the starting point.
5. `docs/planning/DECISIONS.md`: concise decision log distinguishing user-confirmed choices, proposed defaults, and open dependencies. No fabricated resolved decisions.
6. `.claude/agents/`: a small number of focused subagent definitions only where they provide distinct useful work, such as Expo/offline data, Supabase permissions/sync, and coach workflow. Use current valid Claude Code format, bounded responsibilities, minimal necessary tools, and shared authoritative docs. Do not create a large agent hierarchy or make delegation mandatory for simple work.
7. `.claude/skills/`: only project-specific reusable workflows, such as verifying offline sync/reward corrections and checking Supabase privacy. Follow current valid Claude Code format. Link project specs and executable checks where available; do not invent commands or copy generic advice into dozens of skills.
8. An environment-variable template if missing, with placeholders only. Document public Expo configuration versus server-only secrets. A Gemini key or Supabase service-role key must never be prefixed `EXPO_PUBLIC_` or bundled into the app.

Inspect existing files first. Merge compatible guidance, preserve relevant content and do not duplicate already installed skills/agents. Do not install arbitrary third-party plugins or MCP servers. Verify current Claude Code documentation if syntax is uncertain; clearly state if you cannot verify rather than fabricating support. Use least-privilege tool settings; do not enable bypass permissions or unreviewed shell hooks.

## Engineering requirements to encode

- Local durable training source is SQLite via expo-sqlite/Drizzle; Zustand holds transient UI state; TanStack Query handles remote social/coach requests.
- Every committed local training change and outbox operation is atomic.
- Sync uses stable operation IDs, transactional server receipts, revisions, tombstones, ordered pulls and recoverable conflicts. Supabase Realtime or query cache alone is not synchronization.
- One active workout; manual routines and logging never depend on AI/network.
- Separate plans, performed-session snapshots, coach drafts and published-post snapshots.
- Explicit approval before a coach proposal becomes active; repeated/stale approvals are checked.
- Reward and progress corrections are deterministic/idempotent and server-reconciled. Missing workouts do not punish the pet. Proposed numerical rules remain centralized/configurable.
- Private stats/coach data do not appear in profiles/posts. RLS and private Storage enforce approved-follow and blocking rules, not only UI.
- Expo development builds validate native Rive/Nitro, Reanimated and SQLite compatibility early. Use Rive for characters, optional Lottie for authored sequences, Reanimated for UI motion. Respect reduced motion and static fallbacks.
- Navigation stays changeable: thin Expo Router routes, centrally defined tab shell, feature modules independent of tab order.
- English first with canonical metric storage and selectable units; historical weeks/goals remain stable across changes.
- Exercise illustrations are an unresolved rights dependency; do not import/use restricted assets or claim they are MIT. Metadata-first implementation is allowed.
- Test critical behavior: offline recovery, duplicate retries, account isolation, migrations, reward corrections, follow/block permissions, and invalid model output. Prefer meaningful tests over superficial coverage targets.
- App motion never delays saving workout data; no false guarantees about background timers/sync under OS suspension.

## Finish

Check links and consistency of the files you created, summarize actual changes, list remaining open dependencies, and identify the first concrete implementation milestone. Do not claim tests ran or features exist unless verified. Do not ask for approval of routine reversible documentation work already authorized here; stop only for a material unresolved decision, destructive migration, external purchase or deployment.
