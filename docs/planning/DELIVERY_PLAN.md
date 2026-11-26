# Delivery plan and open decisions

## Implementation order

1. Inspect repository and establish Expo TypeScript development builds. Preserve existing code. Confirm Android/iOS, Rive static/interactive sample, Reanimated, SQLite persistence, and auth redirects before feature expansion.
2. Set up Supabase migrations/RLS, email/Google auth, account-scoped SQLite and migrations, thin routes, tokens, and basic onboarding.
3. Import pinned catalog metadata; manual routine/program CRUD, empty/routine sessions, immediate local saves, timer and restart recovery.
4. Implement transactional sync, conflict recovery, tombstones, idempotent operations, auth pause/resume, and status UI. Add meaningful integration fixtures before layering social features.
5. Progress calculations, corrected-session handling, server reward reconciliation, weekly goals, pet states and badges.
6. Coach graph/API with mocked model, deterministic validation and explicit approval; then integrate selected Gemini model and bounded usage.
7. Social profiles/follows/blocks, snapshots, post upload/visibility, feed, comments/likes and independent copies.
8. Polish media/motion, accessibility, recovery states, privacy checks, device tests and documentation. No automatic public deployment.

## Release gates for the prototype

- Force-close and reopen an offline session; all committed sets recover.
- Synchronize after multiple edits and lost acknowledgements; one canonical session and correct rewards result.
- Repeated saves/deletes/undo-like corrections do not multiply XP.
- Account B cannot read Account A's private stats, coach requests, posts or Storage objects through direct requests.
- Follow approval, unfollow/removal, public→private changes, and blocks change server access correctly.
- A stale or repeated coach approval cannot overwrite a newer program or duplicate application.
- Invalid model output/provider failure does not modify the current plan.
- Unit/timezone changes preserve historical meaning.
- Database upgrade fixture retains history and pending sync operations.
- Reduced motion/static character fallback leaves every essential action usable.
- Type checking, lint, focused app tests, backend tests, database permission tests and device smoke checks pass or have explicit documented environment blockers.

## Remaining decisions that do not block specification delivery

| Item | Default / next step |
| --- | --- |
| Final brand and visual design | Working name AI Gym App; use neutral accessible placeholders. |
| Character assets | One pet and separate coach; create/choose authorized Rive assets later. |
| Exercise media | Dataset metadata/instructions under its applicable MIT terms; images/GIFs require separate Gym Visual rights. Use placeholders until resolved. |
| Dependency versions | Inspect actual project; choose mutually compatible stable Expo/native versions and lock them. |
| AI model | Gemini adapter; choose model after availability/cost/quality evaluation, configure server-side. |
| Hosting | Local FastAPI first; choose deployment later. App users being free does not make API/hosting free. |
| Device performance baseline | Name representative Android/iOS devices before asserting performance targets. |
| XP balance | Proposed values are configurable defaults; assess through prototype use. |
| User age/public launch | Intended gym audience is broad; do not silently invent a minimum age. Decide age eligibility, account deletion/reporting and publication obligations before external release. |
| Screenshots/visual assets | High-fidelity designs and final character personality are not included. |

## Dataset integration

Source: https://github.com/hasaneyldrm/exercises-dataset
License: https://github.com/hasaneyldrm/exercises-dataset/blob/main/LICENSE

README describes 1,324 entries with IDs, instructions, equipment, muscles, thumbnails and GIFs. Pin a commit and inspect actual JSON/schema when importing. Keep IDs as strings; count/validate imported data rather than trusting the README forever. Only supported rep-based movements enter initial coach candidates.

The repository license separates code/data/instructions from Gym Visual images/GIFs and says cloning does not grant media rights. Preserve applicable attribution/license notices. Do not assume noncommercial/unpublished use resolves the media dependency. Metadata-first import and replaceable media keep implementation moving.
