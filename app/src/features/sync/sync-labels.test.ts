import { describeChange, phaseLabel } from './sync-labels';

it('describes changes by name only and labels every worker phase distinctly', () => {
  expect(describeChange('routine', { name: 'Push A', notes: 'private' })).toBe('Routine: Push A');
  expect(describeChange('body_weight', { weightGrams: 80000 })).toBe('Body weight entry');
  const labels = (['idle', 'syncing', 'retry-scheduled', 'paused-auth', 'stopped'] as const).map((phase) => phaseLabel({ phase, nextRetryAt: null }));
  expect(new Set(labels).size).toBe(labels.length);
});
