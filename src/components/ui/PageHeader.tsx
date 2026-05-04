import React from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useThemeColors } from '@/theme/useThemeColors';
import {
  ACCENT,
  FONT_CALLOUT,
  FONT_LARGE_TITLE,
  FONT_MICRO,
  SPACING_PAGE_H,
} from '@/theme/tokens';

interface Props {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  topPadding?: number;
  bottomPadding?: number;
}

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  topPadding = 8,
  bottomPadding = 8,
}: Props) {
  const { colors } = useThemeColors();

  return (
    <View style={{ paddingTop: topPadding, paddingHorizontal: SPACING_PAGE_H, paddingBottom: bottomPadding }}>
      {eyebrow ? (
        <AppText
          style={{
            fontSize: FONT_MICRO,
            fontWeight: '700',
            letterSpacing: 0.8,
            textTransform: 'uppercase',
            color: ACCENT,
            marginBottom: 8,
          }}
        >
          {eyebrow}
        </AppText>
      ) : null}
      <AppText
        style={{
          fontSize: FONT_LARGE_TITLE,
          fontWeight: '700',
          letterSpacing: -0.5,
          color: colors.textPrimary,
          lineHeight: 38,
        }}
      >
        {title}
      </AppText>
      {subtitle ? (
        <AppText style={{ fontSize: FONT_CALLOUT, color: colors.textSecondary, marginTop: 4, lineHeight: 18 }}>
          {subtitle}
        </AppText>
      ) : null}
    </View>
  );
}
