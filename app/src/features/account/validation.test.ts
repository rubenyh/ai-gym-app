import { friendlyError } from './errors';
import { handleSchema, isValidTimeZone, onboardingSchema } from './validation';

describe('account validation mirrors database constraints', () => {
  it('normalizes handles to the stored lowercase form', () => {
    expect(handleSchema.parse('  Lifter_Ana ')).toBe('lifter_ana');
  });

  it.each(['ab', 'has space', 'émile', 'a'.repeat(31)])('rejects handle %p', (h) => {
    expect(handleSchema.safeParse(h).success).toBe(false);
  });

  it('validates IANA time zones', () => {
    expect(isValidTimeZone('Europe/Madrid')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });

  it('rejects weekly goals outside 1–7 days', () => {
    const base = { handle: 'ana', displayName: 'Ana', weightUnit: 'kg', lengthUnit: 'cm', timezone: 'UTC' } as const;
    expect(onboardingSchema.safeParse({ ...base, targetDays: 0 }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...base, targetDays: 8 }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...base, targetDays: 7 }).success).toBe(true);
  });

  it('maps database errors to actionable messages', () => {
    expect(friendlyError({ code: '23505', message: 'duplicate key' })).toBe('That handle is already taken.');
    expect(friendlyError({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(
      'Email or password is incorrect.',
    );
  });
});
