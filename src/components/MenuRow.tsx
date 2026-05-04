import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useThemeColors } from '@/theme/useThemeColors';
import { ACCENT, FONT_BODY, FONT_CAPTION } from '@/theme/tokens';

export function MenuRow({
  title,
  subtitle,
  hint,
  onPress,
  disabled = false,
}: {
  title: string;
  subtitle?: string;
  hint?: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const { colors } = useThemeColors();
  const disabledColor = colors.textMuted;

  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingVertical: 15,
      }}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <AppText style={{ fontSize: FONT_BODY, fontWeight: '600', color: disabled ? disabledColor : colors.textPrimary }}>{title}</AppText>
        {subtitle ? <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: colors.textSecondary }}>{subtitle}</AppText> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {hint ? <AppText style={{ fontSize: 14, fontWeight: '600', color: ACCENT }}>{hint}</AppText> : null}
        <Ionicons name="chevron-forward" size={14} color={disabledColor} />
      </View>
    </View>
  );

  if (!onPress) {
    return content;
  }

  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => ({ opacity: disabled ? 0.55 : pressed ? 0.72 : 1 })}>
      {content}
    </Pressable>
  );
}
