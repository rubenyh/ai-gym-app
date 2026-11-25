import { z } from 'zod';

import { supabase } from '@/services/supabase/client';

/** Private training profile (PROFILE-01), table public.training_profiles. Bounds mirror the M1 SQL checks. */

export const experienceLevels = ['beginner', 'intermediate', 'advanced'] as const;

export const trainingProfileSchema = z.object({
  goal: z.string().trim().min(1, 'Enter a goal.').max(200),
  age: z.number().int().min(1).max(120).nullable(),
  heightCm: z.number().min(50).max(272).nullable(),
  experience: z.enum(experienceLevels, { message: 'Choose your experience.' }),
  equipment: z.array(z.string().max(50)).max(50),
  limitations: z.string().max(1000),
  availableWeekdays: z.array(z.number().int().min(1).max(7)).min(1, 'Choose at least one weekday.'),
  sessionMinutes: z.number().int().min(10, 'Sessions must be 10–300 minutes.').max(300, 'Sessions must be 10–300 minutes.'),
});
export type TrainingProfile = z.infer<typeof trainingProfileSchema>;

/** What the server-side coach requires before generating (services/coach-api REQUIRED_PROFILE). */
export type StoredProfile = {
  goal: string | null;
  age: number | null;
  heightCm: number | null;
  experience: TrainingProfile['experience'] | null;
  equipment: string[];
  limitations: string | null;
  availableWeekdays: number[];
  sessionMinutes: number | null;
};

export const REQUIRED_FIELDS = [
  ['goal', 'Goal'],
  ['experience', 'Experience'],
  ['availableWeekdays', 'Available weekdays'],
  ['sessionMinutes', 'Session length'],
] as const;

export function missingProfileFields(p: StoredProfile | null): string[] {
  return REQUIRED_FIELDS.filter(([key]) => {
    const v = p?.[key];
    return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
  }).map(([, label]) => label);
}

// ------------------------------------------------------------------ height units (display/input only)

const CM_PER_INCH = 2.54;

export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const total = Math.round(cm / CM_PER_INCH);
  return { feet: Math.floor(total / 12), inches: total % 12 };
}

export function feetInchesToCm(feet: number, inches: number): number {
  return Math.round((feet * 12 + inches) * CM_PER_INCH * 10) / 10;
}

// ------------------------------------------------------------------ persistence (RLS: owner only)

export async function fetchTrainingProfile(userId: string): Promise<StoredProfile | null> {
  const { data, error } = await supabase.from('training_profiles').select('*').eq('owner_id', userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    goal: data.goal,
    age: data.age,
    heightCm: data.height_cm,
    experience: data.experience,
    equipment: data.equipment,
    limitations: data.limitations,
    availableWeekdays: data.available_weekdays,
    sessionMinutes: data.session_minutes,
  };
}

export async function saveTrainingProfile(userId: string, exists: boolean, p: TrainingProfile): Promise<void> {
  const row = {
    goal: p.goal,
    age: p.age,
    height_cm: p.heightCm,
    experience: p.experience,
    equipment: p.equipment,
    limitations: p.limitations.trim() || null,
    available_weekdays: [...p.availableWeekdays].sort(),
    session_minutes: p.sessionMinutes,
  };
  // Insert-or-update instead of upsert: authenticated may not update owner_id (column grants).
  const { error } = exists
    ? await supabase.from('training_profiles').update(row).eq('owner_id', userId)
    : await supabase.from('training_profiles').insert(row);
  if (error) throw error;
}
