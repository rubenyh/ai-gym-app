# Architecture and technical stack

## Baseline

Expo + React Native + strict TypeScript replaces Flutter. Use an Expo development build for native dependencies, especially Rive. Android/iOS are targets; do not require Expo Go compatibility. Inspect the initialized repository before changing anything; do not delete Flutter source without an explicit migration plan.

## Stack

| Concern | Selection | Boundary |
| --- | --- | --- |
| App/runtime | Expo, React Native, TypeScript | Pin mutually compatible stable versions against selected Expo SDK. |
| Routes | Expo Router | Central tab layout; Home, Workouts, Coach, Community, Progress; no feature logic tied to tab order. |
| Styling | StyleSheet + design tokens | Reusable accessible components; visual branding remains open. |
| SQLite | expo-sqlite | Durable account-scoped local data and transactional outbox. |
| Typed database | drizzle-orm + drizzle-kit | SQLite queries, migrations and live query integration; not a sync engine. |
| UI state | Zustand | Transient state only; persisted sessions come from SQLite. |
| Remote requests | TanStack Query | Social queries/mutations and coach status; avoid a second canonical training cache. |
| Forms/contracts | React Hook Form + Zod | User input and client runtime validation; server validates independently. |
| Backend client | @supabase/supabase-js | Auth, RLS-protected data operations and Storage. |
| Network status | @react-native-community/netinfo | A connectivity hint; actual request results determine reachability. |
| Media | expo-image-picker, expo-image | Photo selection, rendering, caching. |
| Feedback | expo-haptics | Optional, never necessary to understand state. |
| Characters | @rive-app/react-native + react-native-nitro-modules | Current recommended runtime, conditional on selected SDK compatibility. |
| Flow animations | lottie-react-native, only where needed | Authored onboarding/success illustrations. |
| UI motion | react-native-reanimated + SDK-compatible worklets dependencies | Keyframes, timing/spring animations, XP bars, transitions. |
| Gestures | react-native-gesture-handler | Reordering and native gestures. |
| Coach service | FastAPI, Pydantic, LangGraph | Python server authenticates Supabase access tokens, runs bounded graph. |
| Model | Google GenAI SDK, Gemini | Backend-only provider adapter; model chosen/configured later. |
| Cloud | Supabase Postgres, Auth, Storage | RLS and server-authoritative rewards; Realtime optional, not required for correctness. |

Use Expo-compatible installation commands for native packages. Do not copy preview/RC versions from documentation into the project automatically. Commit the chosen package-manager lockfile. Enable only necessary native permissions.

## Suggested repository

```text
repo/
  app/
    src/
      app/                    # Expo Router route wrappers and layouts
      features/               # auth, workouts, coach, social, progress, gamification
      components/             # shared UI and character wrappers
      db/                     # SQLite schema, migrations, repositories
      services/               # sync, Supabase, coach client
      theme/                  # design tokens and motion settings
    assets/                   # authorized .riv, Lottie, fonts and images
  services/coach-api/          # FastAPI application and graph
  supabase/                   # migrations, RLS, functions, seed scripts
  docs/
```

## Responsibilities

A completed set commits to SQLite immediately. Live local queries render training screens. The sync worker sends durable operations to transactional Supabase RPCs and pulls changes back into SQLite. Social actions use online requests through TanStack Query and Supabase. The coach service reads only authorized context and returns private drafts; approval applies a program transactionally through the application sync contract.

Supabase owns account identity. RLS checks user ownership/follows/blocks. The coach service verifies token signature, issuer, audience, and expiry using supported Supabase verification. Never trust a client-provided user ID. Prefer user-scoped data access; any privileged client requires explicit server-side ownership enforcement.

Persist authentication using the supported Supabase session adapter appropriate to the selected SDK. Prefer platform-secure storage where feasible; validate session size/chunking and refresh behavior. Tokens must not be mixed into workout tables or logs. Offline cached identity allows local use only; server operations still require a valid token.

## Animation design

Pet and coach are separate components with a static fallback. Feed Rive explicit state such as growth stage, idle, workout-complete, and celebration; animation is a projection of game state, not its owner. The AI model cannot directly execute animation code. Pause hidden loops and respect reduced motion. Save before triggering effects. Lottie is optional; do not duplicate the same interaction across three animation engines.

## Verification stack

Use jest-expo and React Native Testing Library for behavior; Python pytest for graph/contracts; Supabase CLI/database integration checks for RLS/RPC; a small Maestro device smoke suite for sign-in, offline workout recovery, and publication. Confirm package compatibility at setup. Tests focus on recovery, permissions, sync idempotency, reward correction, and AI approval rather than trivial wrappers.

## Primary references

- https://docs.expo.dev/router/introduction/
- https://docs.expo.dev/versions/latest/sdk/sqlite/
- https://orm.drizzle.team/docs/connect-expo-sqlite
- https://supabase.com/docs/guides/auth/quickstarts/react-native
- https://rive.app/docs/runtimes/react-native/react-native
- https://docs.swmansion.com/react-native-reanimated/docs/layout-animations/keyframe-animations/
- https://github.com/lottie-react-native/lottie-react-native
- https://tanstack.com/query/latest/docs/framework/react/react-native

References were consulted during planning; verify current compatibility during implementation rather than treating URLs as version pins.
