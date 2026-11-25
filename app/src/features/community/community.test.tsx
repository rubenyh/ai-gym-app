import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Alert } from 'react-native';

import type { PostSnapshot } from '@/domain/contracts';
import { ids, sessionFixture } from '@/domain/fixtures';

import * as api from './api';
import { ProfileScreen } from './people-screens';
import { PostScreen } from './post-screen';
import { PublishScreen } from './publish-screen';
import { previewSnapshot, routineFromSnapshot } from './snapshot';
import { PostPhoto } from './ui';

jest.mock('@/services/supabase/client', () => ({ supabase: {} }));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: () => () => {} },
  useNetInfo: () => ({ isConnected: true }),
}));
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: ReactNode }) => children,
  router: { replace: jest.fn(), back: jest.fn() },
}));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
let mockUuid = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuid).padStart(12, '0')}`,
}));
jest.mock('@/features/account/account-provider', () => ({
  useAccount: () => ({
    state: { kind: 'ready', userId: '11111111-1111-4111-8111-111111111111', account: { settings: { weightUnit: 'kg' } } },
  }),
}));
const mockRepos = {
  sessions: { get: jest.fn() },
  routines: { save: jest.fn((d) => d) },
  catalog: { saveCustom: jest.fn((d) => ({ ...d, id: 'eeeeeeee-0000-4000-8000-000000000001' })) },
};
jest.mock('@/db/repositories-context', () => ({
  useRepositories: () => mockRepos,
  useLocalQuery: (read: (r: unknown) => unknown) => read(mockRepos),
}));
jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  publishPost: jest.fn(),
  getPost: jest.fn(),
  getComments: jest.fn(async () => []),
  getProfileCard: jest.fn(),
  getAuthorPosts: jest.fn(async () => []),
  blockUser: jest.fn(async () => undefined),
  signedPhotoUrl: jest.fn(),
}));

const mocked = api as jest.Mocked<typeof api>;

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const snapshot: PostSnapshot = {
  version: 1,
  title: 'Push A',
  completedOn: '2026-11-23',
  durationMinutes: 60,
  exercises: [
    { exerciseKey: 'catalog:0025', exerciseName: 'Barbell Bench Press', loadMode: 'external', sets: [{ reps: 8, loadGrams: 60000 }] },
    { exerciseKey: null, exerciseName: 'My Cable Thing', loadMode: 'external', sets: [{ reps: 12, loadGrams: 20000 }] },
  ],
};

beforeEach(() => jest.clearAllMocks());

describe('publication', () => {
  const synced = { ...sessionFixture, serverRevision: 3, pendingOps: 0, conflict: false };

  it('preview shows only allowlisted fields and never session notes', async () => {
    mockRepos.sessions.get.mockReturnValue(synced);
    await wrap(<PublishScreen sessionId={ids.session} />);
    expect(screen.getByText('Push A')).toBeTruthy();
    expect(screen.getByText(/2026-11-23 · 60 min/)).toBeTruthy();
    expect(screen.getByText(/Set 1: 8 reps · 60 kg/)).toBeTruthy();
    expect(screen.queryByText(/private note/)).toBeNull();
    expect(screen.getByText(/Workout and exercise notes/)).toBeTruthy(); // listed as excluded
    expect(Object.keys(previewSnapshot(sessionFixture)).sort()).toEqual(['completedOn', 'durationMinutes', 'exercises', 'title', 'version']);
  });

  it('asks to sync first when the session has not reached the server', async () => {
    mockRepos.sessions.get.mockReturnValue({ ...synced, serverRevision: null });
    await wrap(<PublishScreen sessionId={ids.session} />);
    expect(screen.getByText(/Sync this workout first/)).toBeTruthy();
  });

  it('publish retry reuses the same post id', async () => {
    mockRepos.sessions.get.mockReturnValue(synced);
    mocked.publishPost.mockRejectedValueOnce(new Error('Network request failed')).mockResolvedValueOnce({});
    await wrap(<PublishScreen sessionId={ids.session} />);
    await fireEvent.press(screen.getByText('Publish'));
    await fireEvent.press(await screen.findByText('Retry publish'));
    await waitFor(() => expect(mocked.publishPost).toHaveBeenCalledTimes(2));
    const [first, second] = mocked.publishPost.mock.calls.map((c) => c[0].postId);
    expect(second).toBe(first);
  });
});

describe('copy', () => {
  it('creates an independent routine with new ids and origin copy', () => {
    const routine = routineFromSnapshot(snapshot, mockRepos.catalog.saveCustom);
    expect(routine.origin).toBe('copy');
    expect(routine.exercises[0].exerciseKey).toBe('catalog:0025');
    expect(routine.exercises[1].exerciseKey).toBe('custom:eeeeeeee-0000-4000-8000-000000000001');
    expect(mockRepos.catalog.saveCustom).toHaveBeenCalledWith(expect.objectContaining({ name: 'My Cable Thing' }));
    const allIds = [routine.id, ...routine.exercises.flatMap((e) => [e.id, ...e.sets.map((s) => s.id)])];
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(routine.exercises[1].sets[0]).toMatchObject({ targetReps: 12, targetLoadGrams: 20000 });
  });

  it('post screen saves the copy through the routine repository', async () => {
    mocked.getPost.mockResolvedValue({
      id: ids.draft, authorId: ids.userB, handle: 'bob', displayName: 'Bob', sessionId: null, snapshot,
      caption: null, photoPath: null, publishedAt: '2026-11-24T00:00:00Z', likeCount: 0, commentCount: 0, likedByMe: false,
    });
    await wrap(<PostScreen postId={ids.draft} />);
    await fireEvent.press(await screen.findByText('Copy to my routines'));
    expect(mockRepos.routines.save).toHaveBeenCalledWith(expect.objectContaining({ origin: 'copy', name: 'Push A' }));
    expect(await screen.findByText('Copied to your routines.')).toBeTruthy();
  });
});

describe('permissions', () => {
  it('inaccessible post shows the unavailable state', async () => {
    mocked.getPost.mockRejectedValue(new api.UnavailableError());
    await wrap(<PostScreen postId={ids.draft} />);
    expect(await screen.findByText(/This content is unavailable/)).toBeTruthy();
    expect(screen.queryByText('Copy to my routines')).toBeNull();
  });
});

describe('controls and failure states', () => {
  it('blocking asks for confirmation before calling the server', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mocked.getProfileCard.mockResolvedValue({ id: ids.userB, handle: 'bob', displayName: 'Bob', visibility: 'public', followStatus: 'none' } as never);
    await wrap(<ProfileScreen handle="bob" />);
    await fireEvent.press(await screen.findByText('Block'));
    expect(mocked.blockUser).not.toHaveBeenCalled();
    const block = alert.mock.calls[0][2]!.find((b) => b.text === 'Block')!;
    await block.onPress!();
    await waitFor(() => expect(mocked.blockUser).toHaveBeenCalledWith(ids.userB));
  });

  it('a photo whose signed URL cannot be created shows unavailable, not an endless placeholder', async () => {
    mocked.signedPhotoUrl.mockRejectedValue(new Error('Network request failed'));
    await render(<PostPhoto path="u/p.jpg" />);
    expect(await screen.findByText('Photo unavailable')).toBeTruthy();
  });
});
