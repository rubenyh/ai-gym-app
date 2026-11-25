import { z } from 'zod';

/** Client-side validation mirrors the database constraints; the server validates independently. */

export const emailSchema = z.email('Enter a valid email address.');
// Matches supabase/config.toml minimum_password_length.
export const passwordSchema = z.string().min(6, 'Password must have at least 6 characters.');

export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,30}$/, 'Use 3–30 letters, numbers or underscores.');

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a display name.')
  .max(50, 'Use at most 50 characters.');

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz.length > 0;
  } catch {
    return false;
  }
}

export const timezoneSchema = z.string().trim().refine(isValidTimeZone, 'Enter a valid time zone, e.g. Europe/Madrid.');

export const targetDaysSchema = z.number().int().min(1).max(7);

export const onboardingSchema = z.object({
  handle: handleSchema,
  displayName: displayNameSchema,
  weightUnit: z.enum(['kg', 'lb']),
  lengthUnit: z.enum(['cm', 'ft_in']),
  timezone: timezoneSchema,
  targetDays: targetDaysSchema,
});

export type OnboardingInput = z.input<typeof onboardingSchema>;

/** First issue message per field, for inline form errors. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    out[key] ??= issue.message;
  }
  return out;
}

export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
}
