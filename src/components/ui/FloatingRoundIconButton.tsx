import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';

import { useAppTheme } from '@/theme/AppThemeProvider';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export function FloatingRoundIconButton({
  icon,
  onPress,
  accessibilityLabel,
}: {
  icon: IoniconName;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const { theme } = useAppTheme();
  const dark = theme.colorScheme === 'dark';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: dark ? theme.groupedBackground : theme.cardBackground,
          borderColor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(17,24,39,0.06)',
          shadowColor: theme.shadowColor,
          shadowOpacity: dark ? 0 : 0.06,
          elevation: dark ? 0 : 3,
        },
        pressed && styles.buttonPressed,
      ]}
    >
      <Ionicons name={icon} size={20} color={theme.textPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  buttonPressed: {
    opacity: 0.78,
    ...(Platform.OS === 'ios' ? { transform: [{ scale: 0.98 }] } : null),
  },
});
