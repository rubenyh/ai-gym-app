# AI Gym App — specification index

Status: implementation-ready product baseline, not an implemented application.
Prepared: 2026-11-25. Working name: AI Gym App; final branding is undecided.

Copy this entire `docs/` directory into the existing repository. These documents supersede the earlier Flutter direction: the mobile app is now Expo + React Native + TypeScript. Do not assume the actual repository has already been migrated.

## Reading order

1. [Product](PRODUCT.md): purpose, scope, decisions, and exclusions.
2. [Requirements](REQUIREMENTS.md): functional/nonfunctional requirements and acceptance criteria.
3. [Screens and flows](SCREENS_AND_FLOWS.md): navigation, interactions, and state handling.
4. [Architecture](ARCHITECTURE.md): stack, boundaries, layout, and validation.
5. [Data and synchronization](DATA_AND_SYNC.md): entities, permissions, offline writes, and recovery.
6. [AI coach](AI_COACH.md): generation workflow, contracts, and approval.
7. [Progress and gamification](PROGRESS_AND_GAMIFICATION.md): proposed numerical rules and calculations.
8. [Delivery plan](DELIVERY_PLAN.md): implementation sequence, checks, and remaining decisions.
9. [Claude setup prompt](CLAUDE_SETUP_PROMPT.md): paste into Claude in the repository to establish development instructions and supporting documentation.

## Decision status

- **Confirmed**: explicitly selected by the user, including Expo, Supabase, SQLite, hybrid coaching, social features, and animation responsibilities.
- **Implementation default**: proposed engineering behavior that can be implemented without further product discovery, but is not an independently confirmed user preference. Examples: exact XP formula, pet thresholds, component libraries, and synchronization protocol.
- **Open dependency**: illustration reuse rights, actual character assets, compatible package versions, exact Gemini model, and hosting configuration.

Do not represent an open dependency as resolved. Specific numerical rewards and performance targets are configurable prototype defaults. Requirements use “must” to define the intended implementation baseline; defaults remain adjustable.

These documents contain no credentials and do not authorize deployment, public release, purchases, or destructive replacement of existing source files.
