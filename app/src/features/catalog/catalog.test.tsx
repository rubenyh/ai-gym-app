import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { CatalogBrowser } from './catalog-screen';

const mockRepos = {
  catalog: { search: jest.fn(() => []), muscles: jest.fn(() => ['chest']), equipment: jest.fn(() => ['barbell']) },
};
// Minimal useLocalQuery: re-reads only when deps change, like the real hook between writes.
jest.mock('@/db/repositories-context', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useMemo } = require('react');
  return {
    useLocalQuery: (read: (r: unknown) => unknown, deps: unknown[]) =>
      // eslint-disable-next-line react-hooks/exhaustive-deps
      useMemo(() => read(mockRepos), deps),
  };
});

afterEach(() => jest.useRealTimers());
jest.setTimeout(30_000);

describe('CatalogBrowser', () => {
  it('debounces typing into one bounded search and reads facets once', async () => {
    jest.useFakeTimers();
    await render(<CatalogBrowser onSelect={jest.fn()} />);
    expect(mockRepos.catalog.search).toHaveBeenCalledTimes(1);

    const input = screen.getByLabelText('Search exercises');
    for (const text of ['b', 'be', 'ben', 'benc', 'bench']) await fireEvent.changeText(input, text);
    expect(mockRepos.catalog.search).toHaveBeenCalledTimes(1);

    await act(async () => jest.advanceTimersByTime(250));
    expect(mockRepos.catalog.search).toHaveBeenCalledTimes(2);
    expect(mockRepos.catalog.search).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'bench' }), 100);
    expect(mockRepos.catalog.muscles).toHaveBeenCalledTimes(1);
    expect(mockRepos.catalog.equipment).toHaveBeenCalledTimes(1);
  });
});
