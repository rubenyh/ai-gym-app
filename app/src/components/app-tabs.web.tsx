import type { Href } from 'expo-router';
import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ActiveSessionBar } from '@/features/workouts/active-session-bar';
import { TABS } from '@/navigation/tabs';

/*
 * Web tab shell: same TABS config as native, as a bottom bar in the page flow. The native-tabs web fallback
 * is a floating top bar that covered each screen's title on narrow (phone-width) windows.
 */
// `ref` is typed for a View component, not an instance; the trigger works without it.
function TabButton({ label, isFocused, ref: _ref, ...props }: TabTriggerSlotProps & { label: string }) {
  return (
    <Pressable {...props} accessibilityRole="tab" aria-selected={isFocused} style={styles.tab}>
      <ThemedView type={isFocused ? 'backgroundSelected' : 'background'} style={styles.pill}>
        <ThemedText type="smallBold" themeColor={isFocused ? 'text' : 'textSecondary'} numberOfLines={1}>
          {label}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

export default function AppTabs() {
  return (
    <Tabs style={styles.flex}>
      <View style={styles.flex}>
        <TabSlot style={styles.flex} />
        <ActiveSessionBar />
      </View>
      <TabList asChild>
        <ThemedView accessibilityRole="tablist" aria-label="Main" style={styles.bar}>
          {TABS.map((tab) => (
            <TabTrigger key={tab.name} name={tab.name} href={(tab.name === 'index' ? '/' : `/${tab.name}`) as Href} asChild>
              <TabButton label={tab.label} />
            </TabTrigger>
          ))}
        </ThemedView>
      </TabList>
    </Tabs>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#8884',
  },
  tab: { flexShrink: 1, minWidth: 44 },
  pill: { minHeight: 44, paddingHorizontal: Spacing.two, borderRadius: Spacing.three, justifyContent: 'center', alignItems: 'center' },
});
