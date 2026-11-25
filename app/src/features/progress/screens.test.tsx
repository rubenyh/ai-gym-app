import { fireEvent, render, screen } from '@testing-library/react-native';

import type { RewardSummary, SessionDoc } from '@/domain/contracts';
import { sessionFixture } from '@/domain/fixtures';

import { BodyWeightScreen } from './body-weight-screen';
import { HomeScreen } from './home-screen';
import { ProgressScreen } from './progress-screen';
import { SummaryRewards } from './summary-rewards';

let mockSummary: RewardSummary | null = null;
let mockSessions: SessionDoc[] = [];
const mockStartEmpty = jest.fn();
const mockSaveWeight = jest.fn();
const mockRepos = {
  sessions: { history: () => mockSessions.map((s) => ({ ...s, serverRevision: null, pendingOps: 1, conflict: false })), active: () => null, startEmpty: mockStartEmpty },
  programs: { active: () => null },
  routines: { get: () => null },
  bodyWeight: { list: () => [], save: mockSaveWeight, delete: jest.fn() },
  rewardCache: { get: () => mockSummary },
  subscribe: () => () => {},
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
jest.mock('expo-router', () => ({ Link: ({ children }: { children: React.ReactNode }) => children }));

describe('progress screens', () => {
  beforeEach(() => {
    mockSummary = null;
    mockSessions = [sessionFixture];
    jest.clearAllMocks();
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
