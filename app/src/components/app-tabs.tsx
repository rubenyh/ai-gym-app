import { NativeTabs } from 'expo-router/native-tabs';
import { StyleSheet, useColorScheme, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { ActiveSessionBar } from '@/features/workouts/active-session-bar';
import { TABS } from '@/navigation/tabs';

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <View style={styles.flex}>
      <NativeTabs
        backgroundColor={colors.background}
        indicatorColor={colors.backgroundElement}
        labelStyle={{ selected: { color: colors.text } }}>
        {TABS.map((tab) => (
          <NativeTabs.Trigger key={tab.name} name={tab.name}>
            <NativeTabs.Trigger.Label>{tab.label}</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon sf={tab.icon.ios} md={tab.icon.android} />
          </NativeTabs.Trigger>
        ))}
      </NativeTabs>
      <ActiveSessionBar />
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
