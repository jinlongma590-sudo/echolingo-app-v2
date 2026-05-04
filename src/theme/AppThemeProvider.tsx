import * as SecureStore from 'expo-secure-store';
import * as SystemUI from 'expo-system-ui';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, useColorScheme } from 'react-native';

import { resolveAppTheme, type AppResolvedColorScheme, type AppThemePalette } from '@/theme/tokens';

export type AppThemeMode = 'system' | 'light' | 'dark';

type AppThemeContextValue = {
  theme: AppThemePalette;
  themeMode: AppThemeMode;
  resolvedColorScheme: AppResolvedColorScheme;
  setThemeMode: (mode: AppThemeMode) => Promise<void>;
  hydrated: boolean;
};

const APP_THEME_MODE_KEY = 'echolingo_theme_mode';

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

function isValidThemeMode(value: string | null): value is AppThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const systemColorScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<AppThemeMode>('system');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const stored = await SecureStore.getItemAsync(APP_THEME_MODE_KEY);
        if (!cancelled && isValidThemeMode(stored)) {
          setThemeModeState(stored);
        }
      } catch {
        // Ignore storage read failures and keep the default system mode.
      } finally {
        if (!cancelled) {
          setHydrated(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const resolvedColorScheme: AppResolvedColorScheme =
    themeMode === 'system' ? (systemColorScheme === 'dark' ? 'dark' : 'light') : themeMode;
  const theme = useMemo(() => resolveAppTheme(resolvedColorScheme), [resolvedColorScheme]);

  useEffect(() => {
    Appearance.setColorScheme(themeMode === 'system' ? 'unspecified' : themeMode);
  }, [themeMode]);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.pageBackground).catch(() => {
      // Ignore background sync failures on unsupported platforms.
    });
  }, [theme.pageBackground]);

  const setThemeMode = useCallback(async (mode: AppThemeMode) => {
    setThemeModeState(mode);
    try {
      await SecureStore.setItemAsync(APP_THEME_MODE_KEY, mode);
    } catch {
      // Ignore storage write failures; the in-memory theme still updates immediately.
    }
  }, []);

  const value = useMemo<AppThemeContextValue>(
    () => ({
      theme,
      themeMode,
      resolvedColorScheme,
      setThemeMode,
      hydrated,
    }),
    [hydrated, resolvedColorScheme, setThemeMode, theme, themeMode],
  );

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}

export function useAppTheme() {
  const context = useContext(AppThemeContext);
  if (!context) {
    throw new Error('useAppTheme must be used within AppThemeProvider');
  }

  return context;
}
