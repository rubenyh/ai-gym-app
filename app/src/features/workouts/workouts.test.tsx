import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { SessionDoc } from '@/domain/contracts';
import type { Repositories, RestTimer } from '@/domain/repositories';
import { GRAMS_PER_LB } from '@/domain/units';

import { deletePost, findPostsForSession } from '@/features/community/api';
import { router } from 'expo-router';

import { ActiveSessionBar } from './active-session-bar';
import { REPS_REQUIRED } from './common';
import { readHistoryPages, SessionDetailScreen } from './history-screen';
import { LoggerScreen } from './logger-screen';
import { WorkoutsHome } from './workouts-home';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const T0 = Date.parse('2026-11-25T10:00:00.000Z');

function makeSession(set: Partial<SessionDoc['exercises'][number]['sets'][number]> = {}): SessionDoc {
  return {
    id: SESSION_ID,
    routineId: null,
    name: 'Push day',
    status: 'active',
    startedAt: new Date(T0).toISOString(),
    completedAt: null,
    timezone: 'UTC',
    localDate: null,
    notes: '',
    exercises: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        position: 0,
        exerciseKey: 'catalog:0025',
        exerciseName: 'Bench press',
        notes: '',
        restSeconds: 90,
        sets: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            position: 0,
            targetReps: 8,
            targetLoadGrams: null,
            reps: null,
            loadGrams: null,
            loadMode: 'external',
            completed: false,
            completedAt: null,
            ...set,
          },
        ],
      },
    ],
  };
}

// In-memory fake of the parts of Repositories these screens use.
const mockState: { session: SessionDoc | null; active: SessionDoc | null; timer: RestTimer; unit: 'kg' | 'lb' } = {
  session: null,
  active: null,
  timer: null,
  unit: 'kg',
};
const mockRepos = {
  sessions: {
    get: jest.fn(() => (mockState.session ? { ...mockState.session, serverRevision: null, pendingOps: 0, conflict: false } : null)),
    active: jest.fn(() => mockState.active),
    restTimer: jest.fn(() => mockState.timer),
    previousResults: jest.fn(() => null),
    setCompleted: jest.fn(),
    updateSet: jest.fn(),
    startEmpty: jest.fn(),
    startFromRoutine: jest.fn(),
    startRestTimer: jest.fn(),
    clearRestTimer: jest.fn(),
    delete: jest.fn(),
  },
  programs: { active: jest.fn(() => null), list: jest.fn(() => []) },
  routines: { list: jest.fn(() => []) },
  catalog: { search: jest.fn(() => []), muscles: jest.fn(() => []), equipment: jest.fn(() => []) },
};

jest.mock('@/db/repositories-context', () => ({
  useRepositories: () => mockRepos,
  useLocalQuery: (read: (r: unknown) => unknown) => read(mockRepos),
}));
jest.mock('@/features/account/account-provider', () => ({
  useAccount: () => ({ state: { kind: 'ready', account: { settings: { weightUnit: mockState.unit } } } }),
}));
jest.mock('@/features/community/api', () => ({ deletePost: jest.fn(), findPostsForSession: jest.fn() }));
jest.mock('@/features/progress/summary-rewards', () => ({ SummaryRewards: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() } }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockState, { session: makeSession(), active: null, timer: null, unit: 'kg' });
});

afterEach(() => jest.useRealTimers());
// First render loads the screen's lazy RN modules, which can be slow on a cold Jest cache.
jest.setTimeout(30_000);

describe('LoggerScreen', () => {
  it('refuses to complete a set without reps and explains why', async () => {
    await render(<LoggerScreen sessionId={SESSION_ID} />);
    await fireEvent.press(screen.getByLabelText('Complete set 1'));
    expect(screen.getByText(REPS_REQUIRED)).toBeTruthy();
    expect(mockRepos.sessions.setCompleted).not.toHaveBeenCalled();
  });

  it('shows the rest countdown from the persisted deadline after a remount', async () => {
    jest.useFakeTimers({ now: T0 });
    mockState.timer = { sessionId: SESSION_ID, endsAt: new Date(T0 + 75_000).toISOString(), durationSeconds: 90 };
    const first = await render(<LoggerScreen sessionId={SESSION_ID} />);
    expect(screen.getByText('Rest 1:15')).toBeTruthy();
    await first.unmount();

    // App was closed for 30 s: the countdown is recomputed from the wall clock, not resumed.
    jest.setSystemTime(T0 + 30_000);
    await render(<LoggerScreen sessionId={SESSION_ID} />);
    expect(screen.getByText('Rest 0:45')).toBeTruthy();

    await act(async () => {
      jest.setSystemTime(T0 + 80_000);
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByText('Rest complete')).toBeTruthy();
  });

  it('displays weight in lb and saves canonical grams', async () => {
    mockState.unit = 'lb';
    mockState.session = makeSession({ loadGrams: Math.round(100 * GRAMS_PER_LB) });
    await render(<LoggerScreen sessionId={SESSION_ID} />);
    const input = screen.getByLabelText('Set 1 Weight (lb)');
    expect(input.props.value).toBe('100');

    await fireEvent.changeText(input, '110');
    await fireEvent(input, 'blur');
    expect(mockRepos.sessions.updateSet).toHaveBeenCalledWith(SESSION_ID, '33333333-3333-4333-8333-333333333333', {
      loadGrams: Math.round(110 * GRAMS_PER_LB),
    });
  });
});

describe('LoggerScreen performance', () => {
  it('does not re-query previous results on clock ticks or set writes', async () => {
    jest.useFakeTimers({ now: T0 });
    mockState.timer = { sessionId: SESSION_ID, endsAt: new Date(T0 + 60_000).toISOString(), durationSeconds: 60 };
    const view = await render(<LoggerScreen sessionId={SESSION_ID} />);
    expect(mockRepos.sessions.previousResults).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.getByText('Rest 0:57')).toBeTruthy();
    // A committed set edit re-renders the logger with a new session snapshot.
    mockState.session = makeSession({ reps: 8 });
    await view.rerender(<LoggerScreen sessionId={SESSION_ID} />);
    expect(mockRepos.sessions.previousResults).toHaveBeenCalledTimes(1);
  });
});

describe('ActiveSessionBar', () => {
  it('is hidden without an active workout and resumes it from any tab', async () => {
    const empty = await render(<ActiveSessionBar />);
    expect(screen.queryByLabelText(/Resume active workout/)).toBeNull();
    await empty.unmount();

    mockState.active = makeSession();
    await render(<ActiveSessionBar />);
    await fireEvent.press(screen.getByLabelText('Resume active workout Push day'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/training/session/[id]', params: { id: SESSION_ID } });
  });
});

describe('SessionDetailScreen delete', () => {
  it('keeps the workout when deleting its published post fails (no false "both deleted")', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockState.session = { ...makeSession({ reps: 5, completed: true }), status: 'completed', completedAt: new Date(T0 + 60_000).toISOString() };
    jest.mocked(findPostsForSession).mockResolvedValue([{ id: 'p1', publishedAt: '2026-11-25', photoPath: null }]);
    jest.mocked(deletePost).mockRejectedValue(new Error('offline'));
    await render(<SessionDetailScreen sessionId={SESSION_ID} />);
    await fireEvent.press(screen.getByText('Delete workout'));

    const deleteBoth = alert.mock.calls.at(-1)![2]!.find((b) => b.text === 'Delete both')!;
    await act(async () => {
      await deleteBoth.onPress!();
    });
    expect(mockRepos.sessions.delete).not.toHaveBeenCalled();
    expect(alert).toHaveBeenLastCalledWith('Post not deleted', expect.any(String));
  });
});

describe('WorkoutsHome', () => {
  it('offers resume or discard when a workout is already active', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockState.active = makeSession();
    await render(<WorkoutsHome />);
    await fireEvent.press(screen.getByText('Start empty workout'));

    expect(mockRepos.sessions.startEmpty).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('Workout in progress', expect.any(String), expect.any(Array));
    const buttons = alert.mock.calls[0][2]!.map((b) => b.text);
    expect(buttons).toEqual(expect.arrayContaining(['Resume', 'Discard']));
  });
});

describe('readHistoryPages', () => {
  it('follows the (completedAt, id) cursor across pages', () => {
    const all = Array.from({ length: 45 }, (_, i) => ({ id: String(i), completedAt: new Date(T0 - i * 60_000).toISOString() }));
    const history = jest.fn(({ limit, before }: { limit: number; before?: { completedAt: string; id: string } }) =>
      all.filter((s) => !before || s.completedAt < before.completedAt).slice(0, limit),
    );
    const repos = { sessions: { history } } as unknown as Repositories;
    expect(readHistoryPages(repos, 1)).toMatchObject({ hasMore: true });
    const two = readHistoryPages(repos, 2);
    expect(two.hasMore).toBe(false);
    expect(two.sessions.map((s) => s.id)).toEqual(all.map((s) => s.id));
    expect(history).toHaveBeenLastCalledWith({ limit: 30, before: { completedAt: all[29].completedAt, id: all[29].id } });
  });
});
