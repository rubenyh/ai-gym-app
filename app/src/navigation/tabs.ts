import type { AndroidSymbol } from 'expo-symbols';
import type { SFSymbol } from 'sf-symbols-typescript';

/**
 * Single source of truth for the main tab shell (docs/product/SCREENS_AND_FLOWS.md#navigation).
 * Reorder, rename, or replace tabs here only; feature modules must not depend on tab order.
 * `name` must match a route file in src/app/(tabs)/ (`index` is the Home route).
 */
export type TabDefinition = {
  name: string;
  label: string;
  icon: { ios: SFSymbol; android: AndroidSymbol };
};

export const TABS: readonly TabDefinition[] = [
  { name: 'index', label: 'Home', icon: { ios: 'house', android: 'home' } },
  { name: 'workouts', label: 'Workouts', icon: { ios: 'dumbbell', android: 'fitness_center' } },
  { name: 'coach', label: 'Coach', icon: { ios: 'sparkles', android: 'psychology' } },
  { name: 'community', label: 'Community', icon: { ios: 'person.2', android: 'groups' } },
  { name: 'progress', label: 'Progress', icon: { ios: 'chart.bar', android: 'bar_chart' } },
];
