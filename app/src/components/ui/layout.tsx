import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

/** Scrollable screen body for screens whose title lives in the navigator header. */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['bottom', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <ThemedView type="backgroundElement" style={[styles.card, style]}>
      {children}
    </ThemedView>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <ThemedText type="smallBold" accessibilityRole="header">
      {children}
    </ThemedText>
  );
}

/** Compact 44pt button for inline actions (Button in form.tsx is the full-width primary action). */
export function SmallButton({
  label,
  onPress,
  accessibilityLabel,
  disabled = false,
  selected = false,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
  selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}>
      <ThemedView type={selected ? 'backgroundSelected' : 'background'} style={[styles.small, disabled && styles.disabled]}>
        <ThemedText type="smallBold">{label}</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

/** Single-select horizontal chip row; `null` is the "All" option. */
export function ChipRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const all: (string | null)[] = [null, ...options];
  return (
    <View style={styles.chipBlock}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <ScrollView horizontal contentContainerStyle={styles.row} accessibilityLabel={label}>
        {all.map((o) => (
          <SmallButton
            key={o ?? '__all'}
            label={o ?? 'All'}
            accessibilityLabel={`${label}: ${o ?? 'All'}`}
            selected={o === value}
            onPress={() => onChange(o)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.three },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  chipBlock: { gap: Spacing.one },
  small: { minHeight: 44, minWidth: 44, paddingHorizontal: Spacing.three, borderRadius: Spacing.three, justifyContent: 'center', alignItems: 'center' },
  disabled: { opacity: 0.5 },
});
