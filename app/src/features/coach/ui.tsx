import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

/**
 * Coach requests are online-only (TanStack Query, never a training cache). One client shared by the coach
 * tab and the coach-draft stack so a draft fetched on one screen is reused on the other.
 * ponytail: feature-local client because the root has no QueryClientProvider; drop this once the root mounts one.
 */
export const coachQueryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } });

export function CoachQueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={coachQueryClient}>{children}</QueryClientProvider>;
}

export const draftKey = (draftId: string) => ['coach', 'draft', draftId] as const;
export const profileKey = ['coach', 'profile'] as const;

/** Multi-select chips (44pt targets) for weekdays and equipment. */
export function MultiChoice<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: readonly T[];
  onChange: (value: T[]) => void;
}) {
  return (
    <View style={styles.field} accessibilityLabel={label}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <View style={styles.row}>
        {options.map((o) => {
          const checked = value.includes(o.value);
          return (
            <Pressable
              key={String(o.value)}
              accessibilityRole="checkbox"
              accessibilityLabel={`${label}: ${o.label}`}
              accessibilityState={{ checked }}
              onPress={() => onChange(checked ? value.filter((v) => v !== o.value) : [...value, o.value])}>
              <ThemedView type={checked ? 'backgroundSelected' : 'backgroundElement'} style={styles.chip}>
                <ThemedText type={checked ? 'smallBold' : 'small'}>{o.label}</ThemedText>
              </ThemedView>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      {children}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.one },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { minHeight: 44, minWidth: 44, paddingHorizontal: Spacing.three, borderRadius: Spacing.three, justifyContent: 'center', alignItems: 'center' },
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
});
