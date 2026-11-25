import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { RewardSummary, SessionDoc } from '@/domain/contracts';
import { sessionFixture } from '@/domain/fixtures';

import { BodyWeightScreen } from './body-weight-screen';
import { HomeScreen } from './home-screen';
import { ProgressScreen } from './progress-screen';
import { SummaryRewards } from './summary-rewards';
import { ALL_HISTORY, useProgressData } from './use-progress-data';

let mockSummary: RewardSummary | null = null;
let mockSessions: SessionDoc[] = [];
const mockStartEmpty = jest.fn();
const mockSaveWeight = jest.fn();
let mockListeners: (() => void)[] = [];
let mockFocused = true;
const mockHistory = jest.fn((_opts?: { limit?: number }) => mockSessions.map((s) => ({ ...s, serverRevision: null, pendingOps: 1, conflict: false })));
const mockRepos = {
  sessions: { history: mockHistory, active: () => null, startEmpty: mockStartEmpty },
  programs: { active: () => null },
  routines: { get: () => null },
  bodyWeight: { list: () => [], save: mockSaveWeight, delete: jest.fn() },
  rewardCache: { get: () => mockSummary },
  subscribe: (l: () => void) => {
    mockListeners.push(l);
    return () => (mockListeners = mockListeners.filter((x) => x !== l));
  },
};
jest.mock('@/db/repositories-context', () => ({
  useRepositories: () => mockRepos,
  useLocalQuery: (read: (r: unknown) => unknown) => read(mockRepos),
}));
jest.mock('@/features/account/account-provider', () => ({
  useAccount: () => ({
    state: {
      kind: 'ready',
      userId: 'u',
      stale: false,
      account: {
        profile: { displayName: 'Ana' },
        settings: { weightUnit: 'kg', timezone: 'Europe/Madrid' },
        goals: [{ effectiveWeek: '2026-11-02', targetDays: 3, timezone: 'Europe/Madrid' }],
      },
    },
  }),
}));
const mockStart = jest.fn();
jest.mock('@/features/workouts/start-session', () => ({ useStartSession: () => mockStart, openLogger: jest.fn() }));
jest.mock('@/components/characters/characters', () => ({ PetCharacter: () => null, petStageName: () => 'Egg' }));
jest.mock('expo-router', () => ({ Link: ({ children }: { children: React.ReactNode }) => children, useIsFocused: () => mockFocused }));

describe('progress screens', () => {
  beforeEach(() => {
    mockSummary = null;
    mockSessions = [sessionFixture];
    mockListeners = [];
    mockFocused = true;
    jest.clearAllMocks();
  });

  it('reads all history once, skips re-reads while hidden and catches up on focus', async () => {
    function Probe() {
      useProgressData();
      return null;
    }
    const view = await render(<Probe />);
    expect(mockHistory).toHaveBeenCalledTimes(1);
    // All-time records/volume/PRs must not be computed from the 50-session default page.
    expect(mockHistory).toHaveBeenCalledWith({ limit: ALL_HISTORY });

    // Hidden tab under the logger: three set saves cause no history reads.
    mockFocused = false;
    await view.rerender(<Probe />);
    await act(async () => mockListeners.forEach((l) => (l(), l(), l())));
    expect(mockHistory).toHaveBeenCalledTimes(1);

    mockFocused = true;
    await view.rerender(<Probe />);
    expect(mockHistory).toHaveBeenCalledTimes(2);

    await act(async () => mockListeners.forEach((l) => l()));
    expect(mockHistory).toHaveBeenCalledTimes(3);
  });

  it('marks new records provisional while the workout is unsynced', async () => {
    const lighter = structuredClone(sessionFixture);
    lighter.id = '99999999-9999-4999-8999-999999999999';
    lighter.completedAt = '2026-11-01T10:00:00.000Z';
    lighter.localDate = '2026-11-01';
    for (const e of lighter.exercises) for (const set of e.sets) if (set.loadGrams) set.loadGrams -= 10_000;
    mockSessions = [sessionFixture, lighter];
    await render(<SummaryRewards sessionId={sessionFixture.id} />);
    const prs = screen.getAllByTestId('summary-pr');
    expect(prs.length).toBeGreaterThan(0);
    expect(prs.map((p) => [p.props.children].flat().join('')).join(' ')).toContain('Pending sync');
  });

  it('Home shows provisional XP labelled pending and starts an empty workout', async () => {
    await render(<HomeScreen />);
    expect(screen.getByText('Hi, Ana')).toBeTruthy();
    expect(screen.getByTestId('xp-pending').props.children.join('')).toContain('Pending sync');
    await fireEvent.press(screen.getByText('Start empty workout'));
    expect(mockStart).toHaveBeenCalledWith();
  });

  it('SummaryRewards clears the pending label once the server awarded the session', async () => {
    await render(<SummaryRewards sessionId={sessionFixture.id} />);
    expect(screen.getByTestId('summary-xp').props.children.join('')).toContain('Pending sync');
    mockSummary = {
      ruleVersion: 1,
      totalXp: 100,
      level: 1,
      xpIntoLevel: 100,
      xpForNextLevel: 200,
      qualifyingSessions: 1,
      badges: [],
      petStages: [],
      awardedSessionIds: [sessionFixture.id],
    };
    await render(<SummaryRewards sessionId={sessionFixture.id} />);
    expect(screen.getByTestId('summary-xp').props.children.join('')).not.toContain('Pending');
  });

  it('Progress renders history, records and volume with a unit label', async () => {
    await render(<ProgressScreen />);
    expect(screen.getByText('Progress')).toBeTruthy();
    expect(screen.getAllByText(/kg·reps/).length).toBeGreaterThan(0);
  });

  it('Body weight rejects out-of-range input and saves grams', async () => {
    await render(<BodyWeightScreen />);
    await fireEvent.changeText(screen.getByLabelText('Today (kg)'), '5');
    await fireEvent.press(screen.getByText('Add entry'));
    expect(mockSaveWeight).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter a body weight between/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Today (kg)'), '72,5');
    await fireEvent.press(screen.getByText('Add entry'));
    expect(mockSaveWeight).toHaveBeenCalledWith(expect.objectContaining({ weightGrams: 72500 }));
  });
});
