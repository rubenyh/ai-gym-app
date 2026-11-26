# Requirement traceability

Requirement IDs come from [REQUIREMENTS.md](../product/REQUIREMENTS.md). Paths are relative to the repository root;
`app/src/` is abbreviated `src/`. Status as of 2026-11-25. This file says what is verified, not what is
believed to work.

Verification vocabulary:

- **Jest**: `cd app && npm test` (unit/RNTL, no network). **Jest-int**: `npm run test:integration`
  (gated, needs local Supabase). **pgTAP**: `supabase test db`. **API**: `node --test supabase/tests/api/*.test.mjs`
  against the local stack. **pytest**: `services/coach-api/tests`.
- **Maestro**: `app/maestro/*.yaml` device flows. They are written but **not run**: no Android dev build
  can be produced on the Windows machine (O-13) and iOS needs macOS/EAS (O-06).
- **Not automated**: only manual/device inspection can verify it.

## Functional requirements

| ID | Code paths | Automated verification | Device / live gate | Gaps |
| --- | --- | --- | --- | --- |
| AUTH-01 | `src/features/auth/auth-screens.tsx`, `auth-actions.ts`; routes `src/app/(auth)/*`, `src/app/auth/callback.tsx`, `src/app/reset-password.tsx`; guards in `src/app/_layout.tsx` | Jest `account/account-state.test.ts` (routing states), `account/validation.test.ts` (error mapping); pgTAP `06_onboarding_rpc` | Maestro `01-auth.yaml`; email/Google redirect to app scheme needs a device | No RNTL test of the sign-in/sign-up/reset screens; Google and email-link return **not automated** |
| AUTH-02 | `src/features/account/account-provider.tsx`, `account-state.ts`, `src/app/account-offline.tsx`; per-account DB `src/db/account-db.ts` | Jest `account-state.test.ts` "opens from the local cache offline instead of forcing a login loop"; `engine.test.ts` "pauses on auth failure" | Maestro `02-offline-workout-recovery.yaml` | Real token expiry offline **not automated** |
| PROFILE-01 | `src/features/coach/profile-screen.tsx`, `coach/profile.ts`; route `src/app/coach-draft/profile.tsx` | Jest `coach/coach.test.tsx`; pgTAP `03_private_data`, `09_coach` | — | Form-level invalid-input RNTL coverage is partial |
| PROFILE-02 | `src/features/account/onboarding-screen.tsx`, `settings-screen.tsx`, `avatar-picker.tsx` (content-validated upload) | Jest `services/image-validation.test.ts`; `validation.test.ts` (handle, timezone, goal 1–7), `services/sync/engine.test.ts` account-settings cases (pending until acked, rebase, no overwrite); pgTAP `02_profiles`, `03_private_data`, `05_avatar_storage`, `11_account_settings_sync`; API `account-isolation.test.mjs` | — | Settings screen has no RNTL test |
| CAT-01 | `src/features/catalog/catalog-screen.tsx` (debounced, bounded 100-row FlatList), `exercise-detail.tsx`; `src/db/repositories/catalog.ts` | Jest `db/repositories.test.ts` "seeds once, searches with filters"; `catalog/catalog.test.tsx` (debounce, bounded query, facets read once) | Scroll/typing smoothness on device **not automated** | Media is a placeholder until O-01 (by design) |
| CAT-02 | `src/features/catalog/custom-exercise-editor.tsx`, `exercise-detail.tsx` (archive) | Jest `repositories.test.ts` "archived custom exercise stays readable in routines and sessions" | — | No RNTL test of the editor form |
| PLAN-01 | `src/features/workouts/routine-editor.tsx`, `program-editor.tsx`, `workouts-home.tsx` | Jest `repositories.test.ts` "snapshots the routine: later routine edits never change the session"; pgTAP `07_sync_push_pull` | — | Editors have no RNTL test (`buildRoutine` validation untested) |
| SESSION-01 | `src/features/workouts/start-session.ts`, `workouts-home.tsx`, `src/features/progress/home-screen.tsx` | Jest `workouts.test.tsx` "offers resume or discard"; `repositories.test.ts` "allows one active session at a time"; `screens.test.tsx` Home starts empty workout | Maestro `02` | — |
| SESSION-02 | `src/features/workouts/logger-screen.tsx`, `set-row.tsx`, `common.tsx` | Jest `workouts.test.tsx` (reps required, lb input stored as grams, rest countdown, previous results not re-queried per tick/write); `repositories.test.ts` "completing requires reps > 0" | NFR-01 100 ms target needs a release build profile | Reorder/notes/add/remove set covered at repository level only |
| SESSION-03 | Persisted rest timer `src/db/repositories/sessions.ts`; `logger-screen.tsx` `RestTimerBanner`; `src/features/workouts/active-session-bar.tsx` (resume over all tabs) | Jest `repositories.test.ts` "survives force-close"; `workouts.test.tsx` "rest countdown from the persisted deadline after a remount", `ActiveSessionBar` test | Maestro `02` (force-close) | Floating bar position over native tabs needs a device check |
| SESSION-04 | `summary-screen.tsx`, `history-screen.tsx` (edit, confirmed delete), `src/features/progress/summary-rewards.tsx` | Jest `repositories.test.ts` "finish captures completion…; empty sessions cannot finish"; `workouts.test.tsx` delete keeps workout if post deletion fails; pgTAP `08_rewards` (no double credit) | — | Completed-session edit form has no RNTL test |
| PROGRESS-01 | `src/features/progress/*` (`calc/*`, `progress-screen.tsx`, `exercise-detail-screen.tsx`, `body-weight-screen.tsx`, `use-progress-data.ts` reads **all** history, only while focused) | Jest `calc/calc.test.ts` (records, PR ties, tolerance, units, assisted, volume, consistency, timezone, deletion recompute); `screens.test.tsx` (body-weight validation, full-history read, 20 logger writes cause 0 history reads and 0 recomputation in hidden Home/Progress) | — | History "calendar" is a dated list, not a calendar grid |
| GAME-01 | `src/features/gamification/rules.ts`, `src/domain/reward-rules.v1.json`, `summary-rewards.tsx`, `home-screen.tsx` | Jest `gamification/rules.test.ts` (levels, provisional XP, no double count); `screens.test.tsx` pending labels for XP and records; pgTAP `08_rewards`; Jest-int `sync.integration.test.ts` reward award | — | Weekly bonus only server-side (by design) |
| GAME-02 | `src/components/characters/characters.tsx`; `achievements-screen.tsx` | Jest `characters.test.tsx` (Rive drives stage, reduced motion/error → static) | Rive render on device (NFR-12) | Final art open (O-03) |
| COACH-01 | `src/features/coach/*`, `src/services/coach-client.ts`, `services/coach-api/` | Jest `coach.test.tsx` (retry, request ID reuse, clarification); pytest `test_evaluation.py`, `test_hardening.py`; pgTAP `09_coach`, `13_coach_hardening` | Live Gemini call **not automated** (`test_integration_local.py` gated) | — |
| COACH-02 | `src/features/coach/approval.ts`, `draft-review-screen.tsx`; `programs.applyCoachApproval` | Jest `coach.test.tsx` (approve once, stale blocked, cancel no-op); pgTAP `09_coach`, `13_coach_hardening`; API `training-social-coach.test.mjs` | Maestro `04-coach-approval.yaml` | — |
| SOCIAL-01 | `src/features/community/feed-screen.tsx`, `people-screens.tsx`, `api.ts` | pgTAP `10_social`; API `training-social-coach.test.mjs`, `feed-pagination.test.mjs` | — | Feed/search screens have no RNTL test |
| SOCIAL-02 | `src/features/community/publish-screen.tsx`, `snapshot.ts` | Jest `community.test.tsx` (preview allowlist, sync-first gate, retry reuses post id, non-image bytes never uploaded); pgTAP `10_social` | Maestro `05-publication.yaml` (photo upload) | Photo upload failure path **not automated** |
| SOCIAL-03 | `post-screen.tsx` (like, paginated comments, confirmed comment delete, copy) | Jest `community.test.tsx` (copy → independent routine); pgTAP `10_social` | — | Like/comment UI not RNTL-tested |
| SOCIAL-04 | `people-screens.tsx` (confirmed block/remove follower, accept/reject), `post-screen.tsx` (confirmed delete post) | Jest `community.test.tsx` "blocking asks for confirmation"; pgTAP `10_social`, `12_security_regressions`; API `security-regressions.test.mjs` | — | — |
| SOCIAL-05 | `post-screen.tsx` "Update post from workout"; `history-screen.tsx` `confirmDeleteSession` | Jest `workouts.test.tsx` delete-both failure keeps the workout; pgTAP `10_social` | — | Offline delete can only show a generic warning (posts cannot be checked) |
| SYNC-01 | `src/services/sync/engine.ts`, `app-engine.ts`, `src/features/sync/sync-status-screen.tsx`, `SyncBadge` in `workouts/common.tsx` | Jest `engine.test.ts` (lost ack, restart, deletes, backoff, conflicts); Jest-int `sync.integration.test.ts`; pgTAP `07_sync_push_pull` | Maestro `03-sync.yaml`; foreground/reconnect triggers on device | Background sync while suspended is explicitly not claimed |
| SETTINGS-01 | `src/domain/units.ts`, `useWeightUnit` in `workouts/common.tsx`, `settings-screen.tsx` | Jest `units.test.ts`; `workouts.test.tsx` lb display/grams storage; `calc.test.ts` "unit switching cannot create a PR" | — | Settings toggle UI not RNTL-tested |

## Selected nonfunctional requirements

| ID | Code paths | Automated verification | Device / live gate | Gaps |
| --- | --- | --- | --- | --- |
| NFR-06 | Shared primitives `src/components/form.tsx`, `ui/layout.tsx` (44–48 pt targets, labels, roles, states); `themed-text.tsx` `AccentColors` (link/error ≥ 4.5:1 in both schemes); `characters.tsx` reduced motion; `home-screen.tsx` static pet when unfocused | Jest `characters.test.tsx` (reduced motion → static); RNTL tests query by accessibility label throughout | Screen reader, font scaling at 200 %, contrast on device **not automated** | No automated contrast or large-text layout check |
| NFR-07 | Route files in `src/app/**` are 3–8 line wrappers; tabs in `src/navigation/tabs.ts`; training data only in SQLite via `useLocalQuery` | Jest `navigation/tabs.test.ts` | — | Route thinness is by review, not lint |
| NFR-09 | `community/ui.tsx` `QueryState` (offline/loading/error/unavailable), `PostPhoto` unavailable state; `SyncBadge`; progress `PENDING_LABEL` | Jest `community.test.tsx` unavailable post, photo-URL failure; `screens.test.tsx` pending labels; `sync-labels.test.ts` | Credential expiry spinner check on device | — |

## Security notes: image uploads (avatars, post photos)

What the local Supabase Storage actually enforces was probed on 2026-11-25 against the local stack, using a
throwaway user that was deleted afterwards. The probe uploaded to `avatars/<own uid>/`:

| Upload | Result |
| --- | --- |
| HTML bytes, `contentType: image/png` | **accepted**; served back as `image/png` |
| Header-only PNG declaring 30000×30000 (33 bytes) | **accepted** |
| HTML bytes, `contentType: text/html` | rejected 415 (`allowed_mime_types`) |
| 3 MiB body, `image/png` | rejected 413 (`file_size_limit` 2 MiB) |

So the server enforces the declared MIME label, the bucket size limit (2 MiB avatars, 5 MiB post photos),
and the owner-folder/visibility RLS policies. It does **not** inspect the content. Storage RLS policies see
only object metadata, not the bytes. The only in-stack options that could inspect content are an Edge
Function or the image-transformation service, and both would mean a new service. Neither is added.

What the app does: `expo-image-picker` (`quality: 0.7`) re-encodes in most cases but does not guarantee
JPEG. Android keeps PNG for `.png` sources, iOS can return the original data or PNG, and neither
platform resizes. Before every upload, `src/services/image-validation.ts` checks the actual bytes:

- the JPEG, PNG or WebP (VP8/VP8L/VP8X) signature;
- width and height parsed from the header, at most 4096×4096 (this blocks header-only decompression bombs);
- the bucket byte limit.

The upload then uses the **detected** type and extension instead of the picker's label. It is wired into
`account/avatar-picker.tsx` and `community/publish-screen.tsx`. Tests: Jest `services/image-validation.test.ts`
(real Pillow-encoded fixtures and forgeries) and `community.test.tsx` (HTML labelled `.png` is never
uploaded).

**Residual risk:** this check runs on the client, so a modified client can bypass it. Objects are private and
read only through short-lived signed URLs, displayed by `expo-image` with memory caching only. A non-image
object stored under an image label would still be served with that image label.

## Known gaps summary

Not automated anywhere: auth redirect return, real device performance (NFR-01), screen-reader and
font-scaling passes, floating resume bar placement, Rive on device. All Maestro flows are pending a
working development build.
