import { useMemo } from 'react';

import { useAppTheme } from '@/theme/AppThemeProvider';

export function useThemeColors() {
  const { theme, themeMode, setThemeMode, resolvedColorScheme, hydrated } = useAppTheme();

  const colors = useMemo(() => {
    const isDark = theme.colorScheme === 'dark';

    return {
      ...theme,
      isDark,
      pageBackground: theme.pageBackground,
      cardBackground: theme.cardBackground,
      secondaryCardBackground: theme.secondaryCardBackground,
      elevatedCardBackground: theme.elevatedCardBackground,
      heroCardBackground: isDark ? theme.elevatedCardBackground : theme.cardBackground,
      textPrimary: theme.textPrimary,
      textSecondary: theme.textSecondary,
      textMuted: theme.textTertiary,
      textTertiary: theme.textTertiary,
      border: theme.border,
      divider: theme.separator,
      separator: theme.separator,
      pressableBackground: theme.fillSecondary,
      inputBackground: theme.secondaryCardBackground,
      chipBackground: theme.fillSecondary,
      softCardBackground: theme.secondaryCardBackground,
      iconBackground: theme.fillTertiary,
      shadowColor: theme.shadowColor,
    };
  }, [theme]);

  return {
    theme,
    colors,
    themeMode,
    setThemeMode,
    resolvedColorScheme,
    hydrated,
  };
}
