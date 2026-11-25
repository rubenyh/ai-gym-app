import { render, screen } from '@testing-library/react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { CoachCharacter, PetCharacter } from './characters';

const mockUseRiveFile = jest.fn();
const mockSetValue = jest.fn();
jest.mock('@rive-app/react-native', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    Fit: { Contain: 'contain' },
    useRiveFile: (...args: unknown[]) => mockUseRiveFile(...args),
    useViewModelInstance: () => ({ instance: {}, isLoading: false, error: null }),
    useRiveNumber: () => ({ value: undefined, setValue: mockSetValue, error: null }),
    RiveView: (props: { testID?: string }) => <View testID={props.testID} />,
  };
});
jest.mock('react-native-reanimated', () => ({ useReducedMotion: jest.fn(() => false) }));

describe('PetCharacter', () => {
  beforeEach(() => {
    mockUseRiveFile.mockReset();
    mockSetValue.mockReset();
    jest.mocked(useReducedMotion).mockReturnValue(false);
  });

  it('renders Rive and drives the stage input', async () => {
    mockUseRiveFile.mockReturnValue({ riveFile: {}, isLoading: false, error: undefined });
    await render(<PetCharacter stage={2} />);
    expect(screen.getByTestId('pet-rive')).toBeTruthy();
    expect(mockSetValue).toHaveBeenCalledWith(2);
  });

  it('falls back to a labelled static pet on load error', async () => {
    mockUseRiveFile.mockReturnValue({ riveFile: undefined, isLoading: false, error: new Error('bad file') });
    await render(<PetCharacter stage={3} />);
    expect(screen.getByTestId('pet-static')).toBeTruthy();
    expect(screen.getByLabelText(/stage 3: Sprout/)).toBeTruthy();
  });

  it('is static under reduced motion', async () => {
    jest.mocked(useReducedMotion).mockReturnValue(true);
    mockUseRiveFile.mockReturnValue({ riveFile: {}, isLoading: false, error: undefined });
    await render(<PetCharacter stage={1} />);
    expect(screen.getByTestId('pet-static')).toBeTruthy();
    expect(screen.queryByTestId('pet-rive')).toBeNull();
  });
});

it('CoachCharacter has its own accessible identity', async () => {
  await render(<CoachCharacter />);
  expect(screen.getByLabelText('Coach (placeholder character)')).toBeTruthy();
});
