# Requirements and acceptance criteria

## Functional requirements

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| AUTH-01 | Mandatory email/password or Google sign-in through Supabase. | Successful sign-in opens onboarding/home; invalid credentials produce actionable errors; password reset and email verification flows have return routes. |
| AUTH-02 | Continue established local use offline. | A previously authenticated user can access their account-scoped local training data offline without being sent into an impossible network login loop. Online sync waits for valid authentication. |
| PROFILE-01 | Manage private training profile. | Forms accept goal, age, height, weight, days/availability, experience, equipment, session duration, and limitations; invalid input cannot submit. Coach fields can be deferred until coaching. |
| PROFILE-02 | Manage identity and preferences. | Unique handle, display name, avatar, public/private visibility, timezone, weekly goal, and units can be edited; private information is excluded from public profile responses. |
| CAT-01 | Browse/search/filter catalog offline. | Search by name and filter muscles/equipment on locally available metadata; exercise detail shows English instructions and available authorized media. |
| CAT-02 | Create/edit/archive personal exercises. | Personal records do not enter the global catalog; archived definitions remain readable in existing routines and sessions. |
| PLAN-01 | CRUD routines and weekly programs. | Users can order exercises, configure target sets/reps/optional weight/rest, and assign routines to days; changes do not rewrite old sessions. |
| SESSION-01 | Start a routine or empty workout. | A routine is snapshotted into a session; an empty session supports adding exercises; starting another offers resume/discard of the active session. |
| SESSION-02 | Log and edit training data. | Complete/uncomplete/add/remove sets, edit reps/optional weight, enter exercise notes, inspect previous results, and use a rest timer without network dependency. |
| SESSION-03 | Persist and recover. | After each committed edit, force-closing and reopening preserves saved sets and active session. A timer uses a persisted end timestamp. |
| SESSION-04 | Finish/edit/delete sessions. | Summary reflects completed sets; completed sessions remain editable; deletion is confirmed; derived progress and reward adjustments occur without double credit. |
| PROGRESS-01 | Display all selected metrics. | History, exercise records/trends, weekly consistency, external-load volume, and body-weight measurements match the defined calculations and respond to corrections. |
| GAME-01 | Award XP and progression. | Stable session identity produces one completion award; edits/deletes reconcile awards; missing workouts never deduct XP. Offline awards are marked pending until reconciled. |
| GAME-02 | Display pet/coach characters. | Distinct identities; Rive pet responds to state; failure to load animation leaves a usable static fallback. Growth persists according to configured rules. |
| COACH-01 | Generate/edit program on request. | Valid profile plus natural-language request produces a validated editable draft, or an actionable failure; no automatic program replacement. |
| COACH-02 | Explicit approval. | Approve applies the reviewed draft once; cancel changes nothing; stale drafts require reconciliation before activation. |
| SOCIAL-01 | Follow and discover users. | Public-profile follows are immediate; private-profile follows require acceptance; following feed contains accessible published posts only. |
| SOCIAL-02 | Publish completed sessions. | Preview shows exactly the public fields; photo/caption optional; user explicitly publishes; completed workout remains saved if upload fails. |
| SOCIAL-03 | Interact/copy. | Like/unlike, paginated comments, delete own comment, and copy accessible workout into an independent routine; copying grants no completion XP. |
| SOCIAL-04 | Enforce controls. | Owner can delete own post, remove followers, accept/reject requests, and block; blocked relationships cannot view or interact with protected content. |
| SOCIAL-05 | Maintain snapshots. | Editing a completed session leaves its post unchanged until explicit update; deleting a source session leaves its post independent with a warning and optional delete-post action. |
| SYNC-01 | Synchronize local training changes. | Durable queued operations survive restart, retry automatically on foreground/reconnection and on request, with no duplicate effects. Deletions propagate. |
| SETTINGS-01 | Support English and units. | Switching units changes display/input interpretation, not historical meaning; input units are labeled. |

## Nonfunctional requirements

| ID | Requirement / prototype target | Verification |
| --- | --- | --- |
| NFR-01 | Immediate local logging; target visible response within 100 ms under normal load on the agreed reference device. | Profile a release-like Android/iOS build; never block a set save on a remote call or animation. Device baseline must be recorded. |
| NFR-02 | Atomic local persistence. | Session mutation and outbox insertion either both commit or neither does. Test interrupted writes and recovery. |
| NFR-03 | Reliable retry and migrations. | Retry is bounded/backed off; migrations preserve history; test duplicate requests, partial sync, restart, and an old database upgrade. |
| NFR-04 | Backend-enforced privacy. | Test separate accounts against database, API, and Storage paths; unauthorized access fails even with a modified client. |
| NFR-05 | Secret separation. | Gemini and privileged Supabase credentials exist only on trusted backend; logs exclude tokens and sensitive coach/profile payloads. |
| NFR-06 | Accessible usable UI. | Screen-reader labels, scalable text, adequate contrast, large touch targets, reduced-motion handling; essential actions work without animation. |
| NFR-07 | Maintainable modules. | Routes stay thin; shared tokens; database and API boundaries testable; no persistent workout source of truth duplicated in Zustand. |
| NFR-08 | Account isolation. | Switching users never reveals previous user's local data. Sign-out warns about pending changes and offers sync/cancel or explicit discard. |
| NFR-09 | Explicit network states. | Loading/empty/error/offline/pending/retry states are distinguishable. No claim that background sync runs while the OS suspends the app. |
| NFR-10 | Bounded AI operations. | Configurable timeout (initial total request budget 90 seconds), token/input limits, at most one repair attempt, per-user rate limit, cancel-safe results. |
| NFR-11 | Stable statistics. | Metric storage canonical; display rounding does not generate false records; timezone/week boundaries and edits have fixture coverage. |
| NFR-12 | Native compatibility. | Android and iOS development builds validate Rive, SQLite, authentication redirects, and Reanimated before feature expansion. |

Account deletion and reporting are deferred public-release prerequisites; sign-out is in scope now. This is an engineering scope boundary, not permission to expose data during prototyping.
