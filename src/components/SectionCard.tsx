import React, { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useAppTheme } from '@/theme/AppThemeProvider';
import {
  FONT_CALLOUT,
  FONT_TITLE,
  RADIUS_CARD,
} from '@/theme/tokens';

export function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const { theme } = useAppTheme();

  return (
    <View
      style={{
        borderRadius: RADIUS_CARD,
        backgroundColor: theme.cardBackground,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.border,
        paddingHorizontal: 16,
        paddingVertical: 16,
        gap: 12,
      }}
    >
      <View style={{ gap: 4 }}>
        <AppText style={{ fontSize: FONT_TITLE, fontWeight: '700', letterSpacing: -0.4, color: theme.textPrimary }}>{title}</AppText>
        {subtitle ? (
          <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 19, color: theme.textSecondary }}>{subtitle}</AppText>
        ) : null}
      </View>
      {children}
    </View>
  );
}
