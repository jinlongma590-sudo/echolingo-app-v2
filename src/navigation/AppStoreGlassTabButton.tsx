import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { AppStoreGlassTabButtonProps } from '@/navigation/AppStoreGlassTabBar.types';
import { useAppTheme } from '@/theme/AppThemeProvider';

export function AppStoreGlassTabButton({ route, descriptor, focused, color, onPress, onLongPress }: AppStoreGlassTabButtonProps) {
  const { theme } = useAppTheme();
  const options = descriptor.options;
  const badge = options.tabBarBadge;
  const icon = options.tabBarIcon?.({ focused, color, size: 25 }) ?? null;
  const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : typeof options.title === 'string' ? options.title : route.name;

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={focused ? { selected: true } : {}}
      accessibilityLabel={options.tabBarAccessibilityLabel}
      testID={options.tabBarButtonTestID}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <View style={styles.inner}>
        <View style={styles.iconWrap}>
          {icon}
          {badge != null ? (
            typeof badge === 'string' || typeof badge === 'number' ? (
              <View style={[styles.badgePill, { borderColor: theme.activeTabBackground }]}>
                <Text numberOfLines={1} style={styles.badgeText}>{badge}</Text>
              </View>
            ) : (
              <View style={[styles.badgeDot, { borderColor: theme.activeTabBackground }]} />
            )
          ) : null}
        </View>
        <Text numberOfLines={1} style={[styles.label, { color }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flex: 1,
  },
  pressed: {
    opacity: 0.78,
  },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    minWidth: 26,
    minHeight: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    marginTop: 2,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '600',
  },
  badgePill: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: '#FF3B30',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  badgeDot: {
    position: 'absolute',
    top: 0,
    right: -4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF3B30',
    borderWidth: 1,
  },
});
