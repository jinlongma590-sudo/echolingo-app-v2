import React from 'react';

import { FloatingRoundIconButton } from '@/components/ui/FloatingRoundIconButton';
import { Ionicons } from '@expo/vector-icons';
import { Pressable } from 'react-native';

import { AppText } from '@/components/AppText';
import { ACCENT, FONT_BODY } from '@/theme/tokens';

interface Props {
  label?: string;
  onPress: () => void;
  variant?: 'floating' | 'text';
}

export function BackLink({ label = '单词中心', onPress, variant = 'floating' }: Props) {
  if (variant === 'floating') {
    return <FloatingRoundIconButton icon="chevron-back" onPress={onPress} accessibilityLabel={label} />;
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        alignSelf: 'flex-start',
        paddingVertical: 6,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name="chevron-back" size={20} color={ACCENT} />
      <AppText style={{ fontSize: FONT_BODY, color: ACCENT }}>{label}</AppText>
    </Pressable>
  );
}
