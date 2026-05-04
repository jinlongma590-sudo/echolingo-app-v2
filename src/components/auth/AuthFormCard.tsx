import React from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useAppTheme } from '@/theme/AppThemeProvider';

type AuthFormCardProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  brandLabel?: string;
};

const CARD_RADIUS = 30;
const CARD_PADDING_HORIZONTAL = 36;
const CARD_PADDING_VERTICAL = 34;

export function AuthFormCard({
  title,
  subtitle,
  children,
  brandLabel = 'ECHOLINGO',
}: AuthFormCardProps) {
  const { theme } = useAppTheme();

  return (
    <View
      style={{
        width: '100%',
        maxWidth: 560,
        alignSelf: 'center',
        borderRadius: CARD_RADIUS,
        paddingHorizontal: CARD_PADDING_HORIZONTAL,
        paddingVertical: CARD_PADDING_VERTICAL,
        backgroundColor: theme.cardBackground,
        borderWidth: 1,
        borderColor: theme.border,
        shadowColor: theme.shadowColor,
        shadowOpacity: theme.colorScheme === 'dark' ? 0 : 0.05,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
      }}
    >
      <View style={{ gap: 22 }}>
        <View style={{ gap: 8 }}>
          <AppText
            style={{
              fontSize: 11,
              lineHeight: 14,
              fontWeight: '800',
              letterSpacing: 1.2,
              color: theme.textSecondary,
            }}
          >
            {brandLabel}
          </AppText>
          <View style={{ gap: 6 }}>
            <AppText
              style={{
                fontSize: 30,
                lineHeight: 36,
                fontWeight: '800',
                color: theme.textPrimary,
                letterSpacing: -0.6,
              }}
            >
              {title}
            </AppText>
            {subtitle ? (
              <AppText
                style={{
                  fontSize: 15,
                  lineHeight: 22,
                  color: theme.textSecondary,
                }}
              >
                {subtitle}
              </AppText>
            ) : null}
          </View>
        </View>
        {children}
      </View>
    </View>
  );
}
