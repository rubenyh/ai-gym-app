# Decision log

Three categories, matching [README.md](README.md#decision-status). Only the user can move an item into
**Confirmed**. Add entries with a date; never rewrite history — supersede instead.

## Confirmed by the user

Source: [PRODUCT.md](PRODUCT.md), [ARCHITECTURE.md](ARCHITECTURE.md), recorded 2026-11-25.

| ID | Decision |
| --- | --- |
| C-01 | Expo + React Native + TypeScript for Android and iOS; replaces Flutter. Web/desktop are not acceptance targets. |
| C-02 | Supabase for Auth (email/password + Google, mandatory sign-in, no guest), Postgres, Storage. Apple sign-in deferred. |
| C-03 | SQLite on device, offline-first logging; one active workout. |
| C-04 | Hybrid AI coach: structured forms + natural-language request, on demand only, explicit approval before activation. No chat, no automatic weekly coaching. |
| C-05 | Coach backend: FastAPI + Pydantic + LangGraph with Gemini via Google GenAI SDK, server-side only. |
| C-06 | Gamification: XP, levels, badges, user-defined weekly goal, one growing pet, separate coach character. No punishment for missed workouts. |
| C-07 | Animation roles: Rive for characters, Lottie only for authored flows, Reanimated for UI motion. |
| C-08 | Social: public/private profiles, approved follows, following feed, likes, comments, copy workouts, explicit post publication, block/remove follower. |
| C-09 | English first; selectable kg/lb and cm/ft-in. |
| C-10 | Free, unpublished prototype. No payments, ads, DMs, leaderboards, wearables, nutrition. |

## Implementation defaults (proposed, adjustable)

Engineering choices from the specs that are not independently user-confirmed. Change them by recording a superseding entry.

| ID | Default | Source |
| --- | --- | --- |
| D-01 | Library set: Expo Router, Drizzle, Zustand, TanStack Query, React Hook Form + Zod, NetInfo, expo-image(-picker), expo-haptics, gesture-handler. | [ARCHITECTURE.md](ARCHITECTURE.md#stack) |
| D-02 | Sync protocol: outbox + operation receipts + revisions + server change log + cursor pulls. | [DATA_AND_SYNC.md](DATA_AND_SYNC.md#sync-protocol--implementation-default) |
| D-03 | XP 100/session, 100/weekly goal; level curve `200 + 50*(L-1)`; pet stages at levels 1/5/10/20; badge thresholds. | [PROGRESS_AND_GAMIFICATION.md](PROGRESS_AND_GAMIFICATION.md) |
| D-04 | Coach limits: 90 s budget, max one repair, per-user rate limit. | [AI_COACH.md](AI_COACH.md#reliability) |
| D-05 | Testing: jest-expo + React Native Testing Library, pytest, pgTAP via `supabase test db`, small Maestro smoke suite. | [ARCHITECTURE.md](ARCHITECTURE.md#verification-stack) |
| D-06 | Keep the existing Expo project in `app/`, route files in `app/src/app/`; coach service at `services/coach-api/`. | Observed repo layout, 2026-11-25 |
| D-07 | Use the versions already installed by `create-expo-app` (Expo SDK 58, React Native 0.88.1, React 19.3.0, Reanimated 4.7.1, TypeScript 6.0) unless a native compatibility check fails. | `app/package.json`, 2026-11-25 |
| D-08 | npm is the package manager (existing `package-lock.json`). | Observed, 2026-11-25 |
| D-09 | Env split: `app/.env.example` (public `EXPO_PUBLIC_*`) and root `.env.example` (server-only secrets). | This setup, 2026-11-25 |
| D-10 | Local data isolation: one SQLite file per account (simpler than owner-scoping every query). Spec allows either. | [DATA_AND_SYNC.md](DATA_AND_SYNC.md#entities) |

## Open dependencies (unresolved — do not treat as decided)

| ID | Item | Blocks | Next step |
| --- | --- | --- | --- |
| O-01 | Exercise images/GIFs rights (Gym Visual media is not covered by the dataset MIT license). | Media in catalog (not metadata) | Use placeholders; seek rights or alternative assets. |
| O-02 | Dataset commit to pin and actual JSON schema. | M2 catalog import | Inspect repo, pin commit, record count. |
| O-03 | Pet and coach Rive assets, character personality, final branding and visuals. | M4 final visuals (placeholder allowed) | Create/choose authorized assets. |
| O-04 | `@rive-app/react-native` + `react-native-nitro-modules` compatibility with Expo SDK 58 / RN 0.88.1. | M0 exit | Install via `npx expo install`, test in development builds. |
| O-05 | App identity: `app.json` name/slug/scheme are still `app`; Android package / iOS bundle ID unset. Needed for OAuth redirects. | M0/M1 auth redirects | User chooses identifier and scheme. |
| O-06 | iOS development-build path: local macOS/Xcode vs. EAS Build (needs an Expo account; free-tier limits apply). | M0 iOS validation | User decides; no purchase implied. |
| O-07 | Google OAuth client IDs (Android/iOS/web) and consent-screen setup. | M1 Google sign-in | User creates credentials in Google Cloud; secrets stay server-side. |
| O-08 | Gemini model choice, API key, operator budget cap. | M5 live integration (mocked provider not blocked) | Evaluate availability/cost/quality. |
| O-09 | Coach API hosting and Python version. | M5 beyond local | Local FastAPI first. |
| O-10 | Reference devices for NFR-01 performance target. | M7 performance claims | Name one Android and one iOS device. |
| O-11 | Age eligibility, account deletion, reporting. | External release only | Decide before any public release. |
| O-12 | Supabase CLI upgrade (installed 2.75.0, latest 3.4.0). | Nothing yet | Upgrade before writing migrations if features require it. |
