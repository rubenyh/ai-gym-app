import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AccountProvider, useAccount } from '@/features/account/account-provider';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AccountProvider>
        <RootStack />
      </AccountProvider>
    </ThemeProvider>
  );
}

/** Route guards: signed out → auth, signed in without profile → onboarding, otherwise the app. */
function RootStack() {
  const { state } = useAccount();
  const kind = state.kind;

  useEffect(() => {
    if (kind !== 'loading') SplashScreen.hideAsync();
  }, [kind]);

  return (
    <Stack>
      <Stack.Protected guard={kind === 'ready'}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        {/* Feature stacks; each directory owns its _layout.tsx (docs/IMPLEMENTATION_PLAN.md execution DAG). */}
        <Stack.Screen name="training" options={{ headerShown: false }} />
        <Stack.Screen name="insights" options={{ headerShown: false }} />
        <Stack.Screen name="coach-draft" options={{ headerShown: false }} />
        <Stack.Screen name="social" options={{ headerShown: false }} />
        <Stack.Screen name="sync-status" options={{ title: 'Sync status' }} />
      </Stack.Protected>
      {/* While loading, the splash screen covers this group. */}
      <Stack.Protected guard={kind === 'signed-out' || kind === 'loading'}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={kind === 'needs-onboarding'}>
        <Stack.Screen name="onboarding" options={{ title: 'Set up your profile' }} />
      </Stack.Protected>
      <Stack.Protected guard={kind === 'offline'}>
        <Stack.Screen name="account-offline" options={{ title: 'Offline' }} />
      </Stack.Protected>
      <Stack.Protected guard={kind !== 'signed-out' && kind !== 'loading'}>
        <Stack.Screen name="reset-password" options={{ title: 'New password' }} />
      </Stack.Protected>
      <Stack.Screen name="auth/callback" options={{ title: 'Signing in' }} />
      <Stack.Screen name="dev/verify" options={{ title: 'M0 verification' }} />
    </Stack>
  );
}
