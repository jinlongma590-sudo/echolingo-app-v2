import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useAppTheme } from '@/theme/AppThemeProvider';
import {
  ACCENT,
  COLOR_AMBER_BG,
  COLOR_BLUE,
  COLOR_BLUE_BG,
  COLOR_GREEN,
  COLOR_GREEN_BG,
  COLOR_RED,
  COLOR_RED_BG,
  COLOR_TEAL,
  COLOR_TEAL_BG,
  FONT_BODY,
  FONT_CAPTION,
  RADIUS_CARD,
  RADIUS_ICON,
  SPACING_CARD_MB,
  SPACING_PAGE_H,
} from '@/theme/tokens';

type IconColor = 'amber' | 'blue' | 'green' | 'red' | 'teal';

const iconColors: Record<IconColor, { bg: string; fg: string }> = {
  amber: { bg: COLOR_AMBER_BG, fg: ACCENT },
  blue: { bg: COLOR_BLUE_BG, fg: COLOR_BLUE },
  green: { bg: COLOR_GREEN_BG, fg: COLOR_GREEN },
  red: { bg: COLOR_RED_BG, fg: COLOR_RED },
  teal: { bg: COLOR_TEAL_BG, fg: COLOR_TEAL },
};

export interface ListCardItem {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconColor: IconColor;
  title: string;
  description?: string;
  badge?: string;
  badgeColor?: IconColor;
  onPress: () => void;
}

interface Props {
  items: ListCardItem[];
}

export function ListCard({ items }: Props) {
  const { theme } = useAppTheme();

  return (
    <View
      style={{
        marginHorizontal: SPACING_PAGE_H,
        marginBottom: SPACING_CARD_MB,
        backgroundColor: theme.cardBackground,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.border,
        borderRadius: RADIUS_CARD,
        overflow: 'hidden',
      }}
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const ic = iconColors[item.iconColor];
        const bc = item.badgeColor ? iconColors[item.badgeColor] : ic;

        return (
          <Pressable
            key={`${item.title}-${index}`}
            onPress={item.onPress}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 16,
              paddingVertical: 13,
              gap: 12,
              borderBottomWidth: isLast ? 0 : 0.5,
              borderBottomColor: theme.separator,
              backgroundColor: pressed ? theme.secondaryCardBackground : theme.cardBackground,
            })}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: RADIUS_ICON,
                backgroundColor: ic.bg,
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Ionicons name={item.icon} size={16} color={ic.fg} />
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <AppText
                style={{
                  fontSize: FONT_BODY,
                  fontWeight: '600',
                  letterSpacing: -0.2,
                  color: theme.textPrimary,
                  lineHeight: 20,
                }}
                numberOfLines={1}
              >
                {item.title}
              </AppText>
              {item.description ? (
                <AppText style={{ fontSize: FONT_CAPTION, color: theme.textSecondary, marginTop: 1 }} numberOfLines={1}>
                  {item.description}
                </AppText>
              ) : null}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              {item.badge ? (
                <AppText style={{ fontSize: 14, fontWeight: '600', letterSpacing: -0.2, color: bc.fg }}>
                  {item.badge}
                </AppText>
              ) : null}
              <Ionicons name="chevron-forward" size={14} color={theme.textTertiary} />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
