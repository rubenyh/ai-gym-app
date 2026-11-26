import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText, useAccentColors } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Shared accessible form primitives (labels, 44pt targets, visible errors). */

export function FormScreen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['bottom', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ThemedText type="subtitle" accessibilityRole="header">
            {title}
          </ThemedText>
          {children}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

export function TextField({
  label,
  error,
  ...props
}: TextInputProps & { label: string; error?: string }) {
  const theme = useTheme();
  const accent = useAccentColors();
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        {...props}
      />
      {error ? (
        <ThemedText type="small" style={{ color: accent.error }} accessibilityLiveRegion="polite">
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

export function Choice<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.field} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <View style={styles.row}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={String(o.value)}
              accessibilityRole="radio"
              aria-checked={selected}
              onPress={() => onChange(o.value)}>
              <ThemedView type={selected ? 'backgroundSelected' : 'backgroundElement'} style={styles.chip}>
                <ThemedText type={selected ? 'smallBold' : 'small'}>{o.label}</ThemedText>
              </ThemedView>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Button({
  label,
  onPress,
  busy = false,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onPress}>
      <ThemedView type={variant === 'primary' ? 'backgroundSelected' : 'background'} style={styles.button}>
        {busy ? <ActivityIndicator /> : <ThemedText type="smallBold">{label}</ThemedText>}
      </ThemedView>
    </Pressable>
  );
}

export function FormMessage({ text, tone = 'error' }: { text?: string | null; tone?: 'error' | 'info' }) {
  const accent = useAccentColors();
  if (!text) return null;
  return (
    <ThemedText
      type="small"
      style={tone === 'error' ? { color: accent.error } : undefined}
      accessibilityLiveRegion="polite"
      accessibilityRole={tone === 'error' ? 'alert' : undefined}>
      {text}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.three },
  field: { gap: Spacing.one },
  input: { minHeight: 44, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 16 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { minHeight: 44, minWidth: 44, paddingHorizontal: Spacing.three, borderRadius: Spacing.three, justifyContent: 'center', alignItems: 'center' },
  button: { minHeight: 48, borderRadius: Spacing.three, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
});

/** Padding that gives inline text links a 44pt touch target (NFR-06). */
export const linkTarget = { paddingVertical: 12 } as const;
