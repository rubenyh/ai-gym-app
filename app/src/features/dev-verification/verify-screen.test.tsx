import { fireEvent, render, screen } from '@testing-library/react-native';

import { VerifyScreen } from './verify-screen';

const mockUseRiveFile = jest.fn();
jest.mock('@rive-app/react-native', () => {
  // jest.mock factories cannot reference imports; require is the documented pattern here.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    Fit: { Contain: 'contain' },
    useRiveFile: (...args: unknown[]) => mockUseRiveFile(...args),
    RiveView: (props: { testID?: string; autoPlay?: boolean }) => (
      <View testID={props.testID} accessibilityHint={`autoPlay=${props.autoPlay}`} />
    ),
  };
});

let mockStored = { count: 3, updatedAt: '2026-11-25T00:00:00.000Z' };
jest.mock('./sqlite-probe', () => ({
  readProbe: jest.fn(async () => mockStored),
  incrementProbe: jest.fn(async () => {
    mockStored = { ...mockStored, count: mockStored.count + 1 };
    return mockStored;
  }),
}));

describe('VerifyScreen', () => {
  beforeEach(() => {
    mockUseRiveFile.mockReset();
    mockStored = { count: 3, updatedAt: '2026-11-25T00:00:00.000Z' };
  });

  it('shows the static character when the Rive file fails to load', async () => {
    mockUseRiveFile.mockReturnValue({ riveFile: undefined, isLoading: false, error: new Error('decode failed') });
    await render(<VerifyScreen />);
    expect(await screen.findByTestId('rive-fallback')).toBeTruthy();
    expect(screen.getByText(/decode failed/)).toBeTruthy();
    expect(screen.queryByTestId('rive-view')).toBeNull();
  });

  it('renders Rive when loaded and can force the static fallback', async () => {
    mockUseRiveFile.mockReturnValue({ riveFile: {}, isLoading: false, error: undefined });
    await render(<VerifyScreen />);
    expect(await screen.findByTestId('rive-view')).toBeTruthy();
    await fireEvent.press(screen.getByText('Force static fallback'));
    expect(screen.getByTestId('rive-fallback')).toBeTruthy();
  });

  it('shows the persisted count and the value read back after increment', async () => {
    mockUseRiveFile.mockReturnValue({ riveFile: undefined, isLoading: true, error: undefined });
    await render(<VerifyScreen />);
    expect(await screen.findByText('Stored count: 3')).toBeTruthy();
    await fireEvent.press(screen.getByText('Increment and save'));
    expect(await screen.findByText('Stored count: 4')).toBeTruthy();
  });

  it('reports the deep link source param', async () => {
    mockUseRiveFile.mockReturnValue({ riveFile: undefined, isLoading: true, error: undefined });
    await render(<VerifyScreen deepLinkSource="adb" />);
    expect(await screen.findByText('Opened via deep link (source=adb)')).toBeTruthy();
  });
});
