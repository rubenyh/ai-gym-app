/** Canonical weight is integer grams; kg/lb are display/input only (SETTINGS-01, NFR-11). */
export type WeightUnit = 'kg' | 'lb';

export const GRAMS_PER_LB = 453.59237;

/** Parses user input in the given unit to canonical grams. Returns null for empty, NaN on invalid. */
export function parseWeight(input: string, unit: WeightUnit): number | null {
  const text = input.trim().replace(',', '.');
  if (text === '') return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return Number.NaN;
  return Math.round(unit === 'kg' ? value * 1000 : value * GRAMS_PER_LB);
}

/** Display value rounded to 0.1 (kg) or 0.1 (lb); never used for comparisons. */
export function formatWeight(grams: number | null, unit: WeightUnit, withUnit = true): string {
  if (grams === null) return '';
  const value = unit === 'kg' ? grams / 1000 : grams / GRAMS_PER_LB;
  const rounded = Math.round(value * 10) / 10;
  return withUnit ? `${rounded} ${unit}` : String(rounded);
}

/** Volume label for kg·reps or lb·reps from gram·reps. */
export function formatVolume(gramReps: number, unit: WeightUnit): string {
  const value = unit === 'kg' ? gramReps / 1000 : gramReps / GRAMS_PER_LB;
  return `${Math.round(value).toLocaleString('en-US')} ${unit}·reps`;
}
