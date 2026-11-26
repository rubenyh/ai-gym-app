# Product

## Purpose

Help gym users of any experience level plan and record training with very little friction, understand progress, stay consistent through a growing pet, and optionally generate personalized programs using an AI coach.

The three equally important product pillars are easy logging, useful personalized coaching, and motivating progression. Social sharing supports community around completed workouts. This is a free, unpublished prototype, not a subscription product.

## Confirmed scope

- Expo + React Native + TypeScript for Android and iOS. Web and desktop are not initial acceptance targets.
- Mandatory Supabase sign-in: email/password and Google. No guest mode; Apple deferred.
- Manual creation, reading, editing, and deletion of routines and weekly programs.
- Start from a routine or start an empty workout and add exercises while training.
- Record reps, optional external weight, completed sets, exercise notes, rest timer, and previous results.
- One active workout at a time; offline-first persistence using SQLite; resume interrupted sessions.
- Edit/delete completed sessions with recalculated statistics and rewards.
- History, personal records, exercise trends, consistency, training volume, and private body-weight history.
- Hybrid AI coach: structured profile forms plus natural-language preferences, editable weekly programs, and explicit approval before activation.
- Coaching only when requested, with manual features independent of AI availability.
- XP, levels, badges, user-defined weekly goals, one default pet with growth, and a separate coach character.
- Rive for the pet; Lottie only when useful for authored flow animations; Reanimated including keyframes for interface motion.
- Public/private profiles, approved follows for private profiles, following feed, likes, comments, and copying workouts.
- Optional publication of completed workout summaries with caption/photo. Completion alone never publishes.
- Delete own posts/comments, remove followers, and block users.
- English first; selectable kg/lb and cm/ft-in.

## Vocabulary

| Term | Meaning |
| --- | --- |
| Exercise | A catalog or custom movement definition. |
| Routine | Editable reusable plan of exercises and target sets. |
| Program | Weekly organization of routines against selected training days. |
| Session | What the user actually performed, captured independently of future routine changes. |
| Coach draft | Proposed program/change awaiting review; not an active plan. |
| Post | Explicitly published snapshot of a completed session. |

## Privacy

Age, body weight, height, limitations, coach requests, and coach history are private. Public posts can contain exercises, sets, reps, external weights, duration, caption, and a selected photo. Body weight is never included automatically.

Public means visible to other signed-in app users; the prototype has no unauthenticated profile website. Private posts are accessible to the owner and approved followers. Blocking overrides either visibility mode. Content already copied into another person's independent routine cannot be retroactively revoked; warn about this when copying private shared content.

## Exclusions

No payments, ads, automated weekly coaching, full conversational chat, direct messages, leaderboards, wearables, nutrition planning, or medical diagnosis. No supersets, effort ratings, timed exercise/distance logging, or concurrent multi-device editing optimization in this version. Exercise catalog breadth does not expand the supported logging modes.

## Success criteria

Users can complete a workout without internet or AI, recover it after restarting, and synchronize without duplicate sessions or rewards. Users can independently build a program, approve a coach-generated alternative, understand progress, and deliberately publish a privacy-respecting summary.
