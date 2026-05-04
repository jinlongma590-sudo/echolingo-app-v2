import React from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/AppText';
import {
  BG_CARD,
  BG_HERO,
  BG_HERO_BTN_SEC,
  BG_HERO_PILL,
  FONT_MICRO,
  RADIUS_BTN,
  RADIUS_HERO,
  RADIUS_PILL,
  SEPARATOR_DARK,
  SPACING_PAGE_H,
  TEXT_ON_DARK,
  TEXT_ON_DARK_DIM,
  TEXT_PRIMARY,
} from '@/theme/tokens';

export interface HeroStat {
  label: string;
  value: string;
}

interface Props {
  eyebrow: string;
  headline: string;
  description?: string;
  stats: HeroStat[];
  primaryLabel: string;
  secondaryLabel: string;
  onPrimary: () => void;
  onSecondary: () => void;
}

export function HeroCard({
  eyebrow,
  headline,
  description,
  stats,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
}: Props) {
  return (
    <View
      style={{
        marginHorizontal: SPACING_PAGE_H,
        marginTop: 16,
        borderRadius: RADIUS_HERO,
        overflow: 'hidden',
      }}
    >
      <View style={{ backgroundColor: BG_HERO, paddingHorizontal: 20, paddingTop: 20 }}>
        <AppText
          style={{
            fontSize: FONT_MICRO,
            fontWeight: '600',
            letterSpacing: 0.8,
            textTransform: 'uppercase',
            color: TEXT_ON_DARK_DIM,
            marginBottom: 10,
          }}
        >
          {eyebrow}
        </AppText>

        <AppText
          style={{
            fontSize: 24,
            fontWeight: '700',
            letterSpacing: -0.6,
            lineHeight: 29,
            color: TEXT_ON_DARK,
            marginBottom: 4,
          }}
        >
          {headline}
        </AppText>

        {description ? (
          <AppText style={{ fontSize: 12, color: TEXT_ON_DARK_DIM, lineHeight: 18, marginBottom: 20 }}>
            {description}
          </AppText>
        ) : (
          <View style={{ height: 20 }} />
        )}

        <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 20 }}>
          {stats.map((stat) => (
            <View
              key={stat.label}
              style={{
                flex: 1,
                backgroundColor: BG_HERO_PILL,
                borderWidth: 0.5,
                borderColor: SEPARATOR_DARK,
                borderRadius: RADIUS_PILL,
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
            >
              <AppText style={{ fontSize: FONT_MICRO, color: TEXT_ON_DARK_DIM, marginBottom: 3 }}>{stat.label}</AppText>
              <AppText style={{ fontSize: 22, fontWeight: '700', letterSpacing: -0.5, color: TEXT_ON_DARK }}>{stat.value}</AppText>
            </View>
          ))}
        </View>
      </View>

      <View
        style={{
          backgroundColor: BG_HERO,
          paddingHorizontal: 16,
          paddingBottom: 20,
          flexDirection: 'row',
          gap: 10,
        }}
      >
        <Pressable
          onPress={onSecondary}
          style={({ pressed }) => ({
            flex: 1,
            borderRadius: RADIUS_BTN,
            backgroundColor: BG_HERO_BTN_SEC,
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 15,
            opacity: pressed ? 0.75 : 1,
          })}
        >
          <AppText style={{ fontSize: 16, fontWeight: '600', letterSpacing: -0.2, color: TEXT_ON_DARK }}>
            {secondaryLabel}
          </AppText>
        </Pressable>

        <Pressable
          onPress={onPrimary}
          style={({ pressed }) => ({
            flex: 1,
            borderRadius: RADIUS_BTN,
            backgroundColor: BG_CARD,
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 15,
            opacity: pressed ? 0.75 : 1,
          })}
        >
          <AppText style={{ fontSize: 16, fontWeight: '600', letterSpacing: -0.2, color: TEXT_PRIMARY }}>
            {primaryLabel}
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}
