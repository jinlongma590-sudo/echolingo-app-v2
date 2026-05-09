import 'react-native-gesture-handler';
import 'react-native-reanimated';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AndroidUpdateModal } from '@/components/AndroidUpdateModal';
import { RootErrorBoundary } from '@/components/RootErrorBoundary';
import { useAndroidAppUpdateCheck } from '@/hooks/useAndroidAppUpdateCheck';
import { hideSplashSafe, preventSplashAutoHideSafe } from '@/lib/splashControl';
import { AppSessionProvider } from '@/services/auth/AppSessionProvider';
import { AiDataConsentProvider } from '@/services/privacy/AiDataConsentProvider';
import { AppThemeProvider, useAppTheme } from '@/theme/AppThemeProvider';

// Hold the native splash screen until the React tree mounts. Hard timeout in
// splashControl.ts guarantees the splash will hide even if mounting fails so
// the app can never sit forever on the splash screen during App Store review.
preventSplashAutoHideSafe();

function RootLayoutContent() {
  const { theme, resolvedColorScheme } = useAppTheme();
  const { updateInfo, dismissUpdate } = useAndroidAppUpdateCheck();

  useEffect(() => {
    // Hide splash on the next tick so the first frame paints before the
    // native splash transitions away.
    const handle = setTimeout(() => {
      void hideSplashSafe('root_layout_mounted');
    }, 0);
    return () => clearTimeout(handle);
  }, []);

  useEffect(() => {
    // Defer heavy module pre-warm to after first paint, wrapped in try/catch
    // so a transitive import failure cannot block app boot. Previously we
    // imported '@/screens/EpisodeScreen' at module top-level, which made any
    // side-effect throw deep in its dependency tree fatal to the entire app.
    const handle = setTimeout(() => {
      void (async () => {
        try {
          await import('@/screens/EpisodeScreen');
        } catch (error) {
          console.warn('[boot] episode_screen_prewarm_failed', JSON.stringify({
            message: error instanceof Error ? error.message : String(error ?? 'unknown'),
          }));
        }
      })();
    }, 250);
    return () => clearTimeout(handle);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.pageBackground }}>
      <AppSessionProvider>
        <AiDataConsentProvider>
          <StatusBar style={resolvedColorScheme === 'dark' ? 'light' : 'dark'} />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.pageBackground } }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="auth/sign-in" options={{ presentation: 'card' }} />
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
    <RootErrorBoundary>
      <AppThemeProvider>
        <RootLayoutContent />
      </AppThemeProvider>
    </RootErrorBoundary>
  );
}
