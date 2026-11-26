# Progress and gamification

The feature categories are confirmed. The numerical rules below are configurable implementation defaults proposed during planning, not finalized balance testing.

## Rewards

| Event | XP |
| --- | --- |
| Complete a session with at least one valid completed exercise set | 100 |
| Reach the weekly target of distinct training days | 100 once per qualifying week |
| Publish, like, comment, copy, or unlock a badge | 0 |

A session can qualify for completion XP once. Removing all completed sets or deleting the session revokes its award; correcting it to qualify can restore the same award, never duplicate it. Saving/editing repeatedly earns nothing extra. Multiple sessions per day can each qualify for session XP; they count as one consistency day. This generous prototype rule is not a public anti-abuse system and must not be described as one.

Weekly bonus is derived from that week's saved goal. Corrections can revoke/restore the bonus through idempotent adjustments. Missing workouts never subtract XP. XP totals cannot go below zero. Server-calculated reward events are authoritative; offline values are provisional. Use a unique source/reason/rule-version key and keep a correction audit trail.

## Levels and pet

Start at level 1. Advancing from level L to L+1 requires `200 + 50*(L-1)` additional XP. Cumulative XP to reach level n is `200*(n-1) + 25*(n-1)*(n-2)`.

One default pet; growth unlocks at levels 1, 5, 10, 20. No neglect mechanic, death, or inactivity regression. Correcting source data may lower current XP/level, but unlocked pet appearances remain available. Keep current level and permanent cosmetic unlocks separate. Pet artwork/personality and coach character appearance are unresolved.

Initial badges: first workout; 10/25/50/100 qualifying workouts; first achieved weekly goal; four consecutive achieved weeks. Cosmetic badge unlocks remain earned after legitimate historical achievement; current counters and XP still recalculate. This is a deliberate prototype default.

## Weekly consistency

User chooses 1–7 training days weekly. Week runs Monday–Sunday in saved user timezone. A session counts on its completion date, not upload date; one distinct local date contributes one day. Store UTC timestamps plus effective local date/timezone information so travel or preference changes do not rewrite history unexpectedly.

Weekly goal changes take effect next week. Timezone changes take effect at the next week boundary; freeze historical week boundaries and goals. Four consecutive weeks means four adjacent calendar weeks, not four arbitrary successful weeks. No goal existed before signup, so earlier weeks do not count as failed.

## Metrics

| Metric | Formula / behavior |
| --- | --- |
| History | Completed sessions ordered by performed timestamp, not sync time. |
| Weight PR | Highest comparable completed external load for that exercise/load mode. |
| Rep PR | Highest reps at the same canonical load, within a defined precision tolerance. |
| Progress chart | Actual weight/reps per session with set-level drilldown. No invented trend with insufficient data. |
| Volume | Sum of completed external load in kg × reps, labeled kg·reps or converted lb·reps. |
| Consistency | Distinct completed training dates / frozen weekly target. |
| Body weight | Private time series in kg internally, unit preference on display. |

Incomplete sets do not contribute. Ties do not create new PR notifications. Deletion/edit recomputes records and volume for affected exercise/time windows. Bodyweight-only reps do not assume full body mass as load. Assistance mode is tracked separately and excluded from ordinary external-load PR/volume; never reward more assistance as stronger performance. Initial UI may leave assisted load unrecorded and show reps only.

For dumbbells, label the entered value explicitly as the logged load; do not silently double it for unilateral/per-hand movements. Volume is logged external-load volume, not a biomechanical work estimate. Body weight and exercise load have separate fields.

Use canonical precision (for example integer grams for weight), preserve submitted units if useful for exact redisplay, and compare canonical values with a documented tolerance. Unit switching must not create PRs. Numbers, rule versions, badge thresholds, and pet thresholds belong in centralized configuration rather than UI code.
