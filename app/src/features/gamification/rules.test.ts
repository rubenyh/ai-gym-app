import type { RewardSummary } from '@/domain/contracts';
import { sessionFixture } from '@/domain/fixtures';

import { levelForXp, petStageForLevel, progressionView, xpToReachLevel } from './rules';

const summary = (over: Partial<RewardSummary> = {}): RewardSummary => ({
  ruleVersion: 1,
  totalXp: 0,
  level: 1,
  xpIntoLevel: 0,
  xpForNextLevel: 200,
  qualifyingSessions: 0,
  badges: [],
  petStages: [],
  awardedSessionIds: [],
  ...over,
});

describe('level math', () => {
  it('matches 200*(n-1) + 25*(n-1)*(n-2)', () => {
    for (const lv of [1, 2, 3, 5, 10, 20]) expect(xpToReachLevel(lv)).toBe(200 * (lv - 1) + 25 * (lv - 1) * (lv - 2));
    expect(xpToReachLevel(2)).toBe(200);
    expect(xpToReachLevel(3)).toBe(450);
  });
  it('maps XP to level and progress', () => {
    expect(levelForXp(0)).toEqual({ level: 1, xpIntoLevel: 0, xpForNextLevel: 200 });
    expect(levelForXp(199).level).toBe(1);
    expect(levelForXp(200)).toEqual({ level: 2, xpIntoLevel: 0, xpForNextLevel: 250 });
    expect(levelForXp(500)).toEqual({ level: 3, xpIntoLevel: 50, xpForNextLevel: 300 });
    expect(levelForXp(-50).level).toBe(1);
  });
  it('pet stages unlock at configured levels', () => {
    expect([1, 4, 5, 9, 10, 20, 30].map(petStageForLevel)).toEqual([1, 1, 2, 2, 3, 4, 4]);
  });
});

describe('progressionView', () => {
  it('adds provisional XP for local qualifying sessions not yet awarded', () => {
    const v = progressionView(summary({ totalXp: 150 }), [sessionFixture]);
    expect(v).toMatchObject({ totalXp: 250, pendingXp: 100, pendingSessionIds: [sessionFixture.id], level: 2, confirmed: true });
  });
  it('does not double count awarded sessions', () => {
    const v = progressionView(summary({ totalXp: 100, awardedSessionIds: [sessionFixture.id] }), [sessionFixture]);
    expect(v).toMatchObject({ totalXp: 100, pendingXp: 0 });
  });
  it('works with no summary and ignores non-qualifying sessions', () => {
    const empty = { ...sessionFixture, exercises: [] };
    const v = progressionView(null, [empty]);
    expect(v).toMatchObject({ totalXp: 0, pendingXp: 0, confirmed: false, level: 1, petStage: 1 });
  });
  it('keeps permanently unlocked pet stages after XP is corrected down', () => {
    const v = progressionView(summary({ totalXp: 0, petStages: [{ stage: 2, unlockedAt: '2026-11-01T00:00:00Z' }] }), []);
    expect(v.level).toBe(1);
    expect(v.petStage).toBe(2);
  });
});
