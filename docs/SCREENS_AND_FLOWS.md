# Screens and user flows

## Navigation

Main tabs: Home, Workouts, Coach, Community, Progress. Avatar opens own profile/settings. Keep tab labels/order centralized and route files thin. Active session appears as a persistent resume affordance; its full logger opens above the tab shell.

## Screens

| Group | Screens and essential content |
| --- | --- |
| Auth | Sign-in, sign-up, password recovery, email verification/Google return. |
| Onboarding | Display name/handle, units/timezone, weekly goal; offer optional training profile. |
| Home | Pet, level/XP, weekly goal, next planned routine, start empty workout, resume active workout. |
| Workouts | Program/routine list, weekly program editor, routine detail/editor, history and session detail. |
| Catalog | Search, muscle/equipment filters, exercise detail, custom exercise editor. |
| Logger | Duration, exercise list/reorder, target versus actual sets, previous session results, complete toggles, notes, rest timer, add exercise, finish/discard. |
| Summary | Completed exercises/sets, duration, provisional rewards/records, edit, save routine, optional publish. |
| Coach | Profile completeness, structured preferences, natural-language request, program context, generation status, draft editor, change summary and approval. |
| Community | Paginated following feed, user search, post detail/comments, public/private profile, follow requests, blocked users. |
| Publication | Exact summary preview, optional caption/photo, publish/update and retry status. |
| Progress | History/calendar, exercise selector/charts, records, consistency, volume, private body-weight entries. |
| Settings | Profile privacy, units, weekly goal/timezone, training profile, sync status/retry, sign-out. |
| Achievements | Badge list and pet growth details, reachable from Home/Progress. |

## First use

Sign in online → basic onboarding → Home. Email confirmation/reset/Google redirects must return correctly to the development/production application scheme. Coaching questions are required only when relevant to coach generation. Existing sessions can be used offline after prior authentication.

## Workout

1. Start a routine snapshot or an empty session. If active session exists, resume or explicitly discard it first.
2. Add/reorder exercises and log sets. Weight optional; reps positive for a completed set. Save each committed change locally with an outbox operation.
3. Completing a set can start its configured rest timer. Backgrounding uses the saved deadline, not a continuously running JS timer guarantee.
4. Finish → review summary → save completion. Empty sessions offer discard, not reward.
5. Show progress/rewards and optional save-as-routine/publication actions. Publishing is never the default completion side effect.
6. Restart at any point restores committed state. Discard requires confirmation; pending network changes never block local logging.

## Coach

Complete necessary profile → choose create program or adjust existing → natural-language preferences → generate → inspect draft/reason → edit → approve. Cancel retains the existing program. Errors preserve the request and allow retry. A clarification returns a focused form question rather than opening full chat.

## Social

Follow/search → profile → accessible post → like/comment/copy. Private profile with no approval shows limited identity and request status, not workout details. Owner can accept/reject requests, remove followers, block, and delete own content. Copy produces an independent routine, not a historical completed session.

Publication preview lists the allowed fields explicitly. A failed photo upload leaves the completed session intact; publish retry must not create duplicates. Source workout edits require explicit post update. Source deletion does not silently delete an independent post; warn and offer both actions.

## Common states

Every network screen distinguishes loading, empty, error/retry, and offline. Every local mutation can expose pending/sync-failed status without treating the workout as unsaved. The app must not show infinite spinners when credentials expire. Charts explain insufficient data instead of inventing trends. Unauthorized/private/deleted posts show an unavailable state and purge inaccessible cached details on permission refresh.

No specific colors, character art, or high-fidelity screen designs are selected yet. Essential controls remain usable with a placeholder character and reduced motion.
