import 'react-native-gesture-handler';
import 'react-native-reanimated';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AndroidUpdateModal } from '@/components/AndroidUpdateModal';
import { useAndroidAppUpdateCheck } from '@/hooks/useAndroidAppUpdateCheck';
import { AppSessionProvider } from '@/services/auth/AppSessionProvider';
import { AiDataConsentProvider } from '@/services/privacy/AiDataConsentProvider';
import { AppThemeProvider, useAppTheme } from '@/theme/AppThemeProvider';

// Pre-import the heavy EpisodeScreen module at app start so Metro's
// lazy-bundling doesn't re-fetch its chunk the first time the user
// navigates into an episode. The reference is intentionally unused — its
// only purpose is to force the module into the dependency graph at boot.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { EpisodeScreen as _PrewarmEpisodeScreen } from '@/screens/EpisodeScreen';

function RootLayoutContent() {
  const { theme, resolvedColorScheme } = useAppTheme();
  const { updateInfo, dismissUpdate } = useAndroidAppUpdateCheck();

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.pageBackground }}>
      <AppSessionProvider>
        <AiDataConsentProvider>
          <StatusBar style={resolvedColorScheme === 'dark' ? 'light' : 'dark'} />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.pageBackground } }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="auth/sign-in" options={{ presentation: 'card' }} />
            {/* simple_push = native iOS push, faster + cheaper than 'card'
                modal style. animationDuration shortens the slide so the
                page lands earlier; the route component is pre-imported above
                to avoid Metro lazy-load latency on first navigation. */}
            <Stack.Screen
              name="episode/[id]"
              options={{
                presentation: 'card',
                animation: 'simple_push',
                animationDuration: 180,
                animationTypeForReplace: 'push',
              }}
            />
          </Stack>
          <AndroidUpdateModal updateInfo={updateInfo} onDismiss={dismissUpdate} />
        </AiDataConsentProvider>
      </AppSessionProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  return (
    <AppThemeProvider>
      <RootLayoutContent />
    </AppThemeProvider>
  );
}
