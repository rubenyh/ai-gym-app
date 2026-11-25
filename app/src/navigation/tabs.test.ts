import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { TABS } from './tabs';

describe('tab shell config', () => {
  it('matches the tab order in docs/SCREENS_AND_FLOWS.md', () => {
    expect(TABS.map((t) => t.label)).toEqual(['Home', 'Workouts', 'Coach', 'Community', 'Progress']);
  });

  it('has unique route names', () => {
    const names = TABS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(TABS.map((t) => t.name))('has a route file for "%s"', (name) => {
    expect(existsSync(join(__dirname, '..', 'app', '(tabs)', `${name}.tsx`))).toBe(true);
  });
});
