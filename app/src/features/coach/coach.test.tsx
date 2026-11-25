import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { coachApprovalDoc, type CoachDraftResponse } from '@/domain/contracts';
import { CoachApiError, coachClient } from '@/services/coach-client';

import { changeSummary } from './approval';
import { CoachScreen } from './coach-screen';
import { DraftReviewScreen } from './draft-review-screen';
import { coachQueryClient } from './ui';

jest.mock('@/services/supabase/client', () => ({ supabase: {} }));
jest.mock('@react-native-community/netinfo', () => ({ useNetInfo: () => ({ isConnected: true }) }));
let mockUuid = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuid).padStart(12, '0')}`,
}));
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: ReactNode }) => children,
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ draftId: 'aaaaaaaa-0000-4000-8000-000000000001' }),
}));
jest.mock('@/features/account/account-provider', () => ({
  useAccount: () => ({ state: { kind: 'ready', userId: 'u1', account: { settings: { lengthUnit: 'cm' } } } }),
}));
jest.mock('./profile', () => ({
  ...jest.requireActual('./profile'),
  fetchTrainingProfile: jest.fn(async () => ({
    goal: 'strength', age: 30, heightCm: 180, experience: 'beginner', equipment: [],
    limitations: null, availableWeekdays: [1, 3], sessionMinutes: 45,
  })),
}));
jest.mock('@/services/coach-client', () => ({
  ...jest.requireActual('@/services/coach-client'),
  coachApiUrl: () => 'http://coach.test',
  coachClient: { createDraft: jest.fn(), getDraft: jest.fn(), cancelDraft: jest.fn() },
}));

const mockRepos = {
  programs: { active: jest.fn((): unknown => null), list: jest.fn((): unknown[] => []), applyCoachApproval: jest.fn() },
  routines: { get: jest.fn(() => null) },
  catalog: { get: jest.fn(() => ({ loadMode: 'bodyweight' })) },
};
jest.mock('@/db/repositories-context', () => ({
  useRepositories: () => mockRepos,
  useLocalQuery: (read: (r: unknown) => unknown) => read(mockRepos),
}));

const client = coachClient as jest.Mocked<typeof coachClient>;
const DRAFT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

const readyDraft: CoachDraftResponse = {
  draftId: DRAFT_ID,
  requestId: 'bbbbbbbb-0000-4000-8000-000000000001',
  status: 'ready',
  baseProgramId: null,
  baseProgramRevision: null,
  draft: {
    title: 'Two day plan',
    explanation: 'Full body twice a week.',
    assumptions: ['Choose a starting weight you can control.'],
    days: [
      {
        weekday: 1,
        routineName: 'Full body A',
        exercises: [
          { exerciseKey: 'catalog:0001', exerciseName: 'Push-up', sets: 3, repsMin: 8, repsMax: 12, restSeconds: 90 },
          { exerciseKey: 'catalog:0003', exerciseName: 'Inverted Row', sets: 3, repsMin: 8, repsMax: 12, restSeconds: 90 },
        ],
      },
    ],
  },
  clarification: null,
  error: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  coachQueryClient.clear();
  mockRepos.programs.active.mockReturnValue(null);
  mockRepos.programs.list.mockReturnValue([]);
});

describe('draft review (COACH-02)', () => {
  it('applies the draft only on explicit approval, once, with the base revision', async () => {
    client.getDraft.mockResolvedValue(readyDraft);
    await render(<DraftReviewScreen />);
    await screen.findByText('Approve and activate');
    expect(mockRepos.programs.applyCoachApproval).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('Push-up sets'), '4');
    await fireEvent.press(screen.getByText('Remove Inverted Row'));
    expect(mockRepos.programs.applyCoachApproval).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText('Approve and activate'));
    expect(mockRepos.programs.applyCoachApproval).toHaveBeenCalledTimes(1);
    const doc = coachApprovalDoc.parse(mockRepos.programs.applyCoachApproval.mock.calls[0][0]);
    expect(doc.draftId).toBe(DRAFT_ID);
    expect(doc.baseProgramId).toBeNull();
    expect(doc.baseProgramRevision).toBeNull();
    expect(doc.program).toMatchObject({ active: true, origin: 'coach', coachDraftId: DRAFT_ID });
    expect(doc.routines[0].exercises).toHaveLength(1);
    expect(doc.routines[0].exercises[0].sets).toHaveLength(4);
    expect(doc.routines[0].exercises[0].sets.every((s) => s.targetLoadGrams === null && s.loadMode === 'bodyweight')).toBe(true);
    expect(await screen.findByText(/Pending sync/)).toBeTruthy();
    expect(screen.queryByText('Approve and activate')).toBeNull();
  });

  it('rejects invalid edits without applying anything', async () => {
    client.getDraft.mockResolvedValue(readyDraft);
    await render(<DraftReviewScreen />);
    await fireEvent.changeText(await screen.findByLabelText('Push-up min reps'), '20');
    await fireEvent.press(screen.getByText('Approve and activate'));
    expect(screen.getByText(/minimum reps must not exceed maximum reps/)).toBeTruthy();
    expect(mockRepos.programs.applyCoachApproval).not.toHaveBeenCalled();
  });

  it('cancel calls the server and changes nothing locally', async () => {
    client.getDraft.mockResolvedValue(readyDraft);
    client.cancelDraft.mockResolvedValue({ ...readyDraft, status: 'cancelled' });
    await render(<DraftReviewScreen />);
    await fireEvent.press(await screen.findByText('Cancel draft'));
    await waitFor(() => expect(client.cancelDraft).toHaveBeenCalledWith(DRAFT_ID));
    expect(mockRepos.programs.applyCoachApproval).not.toHaveBeenCalled();
  });

  it.each(['cancelled', 'failed', 'pending'] as const)('never offers approval for a %s draft', async (status) => {
    client.getDraft.mockResolvedValue({ ...readyDraft, status, error: null });
    if (status === 'pending') client.getDraft.mockResolvedValue({ ...readyDraft, status, draft: null });
    await render(<DraftReviewScreen />);
    const shown = { cancelled: 'This draft was cancelled. Nothing changed.', failed: 'This draft cannot be reviewed.', pending: null }[status];
    if (shown) expect(await screen.findByText(shown)).toBeTruthy();
    else expect(await screen.findByLabelText('Loading draft')).toBeTruthy();
    expect(screen.queryByText('Approve and activate')).toBeNull();
    expect(mockRepos.programs.applyCoachApproval).not.toHaveBeenCalled();
  });

  it('blocks approval of a stale draft', async () => {
    mockRepos.programs.active.mockReturnValue({ id: 'cccccccc-0000-4000-8000-000000000001', name: 'Mine', days: [], serverRevision: 4 });
    client.getDraft.mockResolvedValue({ ...readyDraft, baseProgramId: 'cccccccc-0000-4000-8000-000000000001', baseProgramRevision: 3 });
    await render(<DraftReviewScreen />);
    expect(await screen.findByText(/changed since this draft/)).toBeTruthy();
    expect(screen.queryByText('Approve and activate')).toBeNull();
    expect(mockRepos.programs.applyCoachApproval).not.toHaveBeenCalled();
  });
});

describe('coach request (COACH-01)', () => {
  it('keeps the request after a failure and retries with a new request ID', async () => {
    client.createDraft.mockResolvedValue({
      ...readyDraft, status: 'failed', draft: null,
      error: { code: 'invalid_model_output', message: 'The coach could not produce a valid program.', retryable: true },
    });
    await render(<CoachScreen />);
    await fireEvent.changeText(screen.getByLabelText('Your request'), 'More back please');
    await fireEvent.press(screen.getByText('Generate draft'));
    expect(await screen.findByText('The coach could not produce a valid program.')).toBeTruthy();
    expect(screen.getByLabelText('Your request').props.value).toBe('More back please');

    await fireEvent.press(screen.getByText('Try again'));
    await waitFor(() => expect(client.createDraft).toHaveBeenCalledTimes(2));
    const [a, b] = client.createDraft.mock.calls.map((c) => c[0]);
    expect(a.preferencesText).toBe('More back please');
    expect(b.preferencesText).toBe('More back please');
    expect(a.requestId).not.toBe(b.requestId);
    expect(mockRepos.programs.applyCoachApproval).not.toHaveBeenCalled();
  });

  it('reuses the request ID after a network error so the server deduplicates', async () => {
    client.createDraft.mockRejectedValueOnce(new CoachApiError('network', 'Could not reach the coach.', true));
    client.createDraft.mockResolvedValueOnce(readyDraft);
    await render(<CoachScreen />);
    await fireEvent.changeText(screen.getByLabelText('Your request'), 'Two days');
    await fireEvent.press(screen.getByText('Generate draft'));
    await fireEvent.press(await screen.findByText('Try again'));
    expect(await screen.findByText('Review draft')).toBeTruthy();
    const [a, b] = client.createDraft.mock.calls.map((c) => c[0]);
    expect(a.requestId).toBe(b.requestId);
    expect(mockRepos.programs.applyCoachApproval).not.toHaveBeenCalled();
  });

  it('reuses the request ID after a server timeout (504) and resets it after a 429 limit', async () => {
    client.createDraft.mockRejectedValueOnce(new CoachApiError('timeout', 'The coach took too long. Try again.', true, 504));
    client.createDraft.mockRejectedValueOnce(new CoachApiError('rate_limited', 'Too many coach requests.', true, 429));
    client.createDraft.mockResolvedValueOnce(readyDraft);
    await render(<CoachScreen />);
    await fireEvent.changeText(screen.getByLabelText('Your request'), 'Two days');
    await fireEvent.press(screen.getByText('Generate draft'));
    await fireEvent.press(await screen.findByText('Try again'));
    expect(await screen.findByText('Too many coach requests.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByText('Review draft')).toBeTruthy();
    const [a, b, c] = client.createDraft.mock.calls.map((x) => x[0]);
    expect(a.requestId).toBe(b.requestId);
    expect(c.requestId).not.toBe(b.requestId);
    expect(screen.getByLabelText('Your request').props.value).toBe('Two days');
  });

  it('shows a clarification as one focused question', async () => {
    client.createDraft.mockResolvedValue({
      ...readyDraft, status: 'needs_input', draft: null,
      clarification: { field: 'limitations', question: 'Which movements hurt your knee?' },
    });
    await render(<CoachScreen />);
    await fireEvent.changeText(screen.getByLabelText('Your request'), 'Legs');
    await fireEvent.press(screen.getByText('Generate draft'));
    expect(await screen.findByText('Which movements hurt your knee?')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Your answer'), 'Lunges');
    await fireEvent.press(screen.getByText('Send answer'));
    await waitFor(() => expect(client.createDraft).toHaveBeenCalledTimes(2));
    expect(client.createDraft.mock.calls[1][0].preferencesText).toBe('Legs\nWhich movements hurt your knee? Lunges');
  });
});

it('summarizes changes against the active program', () => {
  const lines = changeSummary(readyDraft.draft!, { id: 'p', name: 'Old', active: true, origin: 'manual', coachDraftId: null,
    days: [{ weekday: 1, routineId: 'r' }, { weekday: 4, routineId: 'r' }], serverRevision: 1, pendingOps: 0, conflict: false },
  () => ({ id: 'r', name: 'R', notes: '', archived: false, origin: 'manual',
    exercises: [{ id: 'e', position: 0, exerciseKey: 'catalog:0001', exerciseName: 'Push-up', notes: '', restSeconds: null, sets: [] }] }));
  expect(lines).toEqual(['Replaces "Old".', 'Mon: adds Inverted Row.', 'Thu: becomes a rest day.']);
});
