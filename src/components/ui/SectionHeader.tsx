import React from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useThemeColors } from '@/theme/useThemeColors';
import {
  FONT_CALLOUT,
  FONT_TITLE,
  SPACING_PAGE_H,
  SPACING_SECTION,
} from '@/theme/tokens';

interface Props {
  title: string;
  description?: string;
}

export function SectionHeader({ title, description }: Props) {
  const { colors } = useThemeColors();

  return (
    <View style={{ paddingTop: SPACING_SECTION, paddingHorizontal: SPACING_PAGE_H, paddingBottom: description ? 4 : 12 }}>
      <AppText
        style={{
          fontSize: FONT_TITLE,
          fontWeight: '700',
          letterSpacing: -0.4,
          color: colors.textPrimary,
        }}
      >
        {title}
      </AppText>
      {description ? (
        <AppText
          style={{
            fontSize: FONT_CALLOUT,
            color: colors.textSecondary,
            marginTop: 3,
            lineHeight: 18,
          }}
        >
          {description}
        </AppText>
      ) : null}
    </View>
  );
}
