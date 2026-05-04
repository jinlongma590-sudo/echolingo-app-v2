import React from 'react';
import { Text, type TextProps } from 'react-native';

import { useAppTheme } from '@/theme/AppThemeProvider';
import { resolveAndroidDarkTextOverride } from '@/theme/androidLegacyColorOverrides';
import { FONT_FAMILY } from '@/theme/tokens';

type AppTextTone = 'primary' | 'secondary' | 'tertiary' | 'quaternary';

export function AppText({
  style,
  tone = 'primary',
  disableAndroidDarkTextOverride = false,
  ...props
}: TextProps & { tone?: AppTextTone; disableAndroidDarkTextOverride?: boolean }) {
  const { theme } = useAppTheme();
  const androidDarkTextOverride = disableAndroidDarkTextOverride ? null : resolveAndroidDarkTextOverride(style, theme);
  const color =
    tone === 'secondary'
      ? theme.textSecondary
      : tone === 'tertiary'
        ? theme.textTertiary
        : tone === 'quaternary'
          ? theme.textQuaternary
          : theme.textPrimary;

  return (
    <Text
      allowFontScaling={false}
      style={[
        {
          color,
          fontFamily: FONT_FAMILY,
        },
        style,
        androidDarkTextOverride,
      ]}
      {...props}
    />
  );
}
