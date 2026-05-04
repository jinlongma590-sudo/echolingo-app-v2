import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated from 'react-native-reanimated';

import type { AppStoreGlassTabBarMetrics } from '@/navigation/AppStoreGlassTabBar.types';
import { useAppTheme } from '@/theme/AppThemeProvider';

export function AppStoreGlassActivePill({
  metrics,
  translateStyle,
  shapeStyle,
  highlightStyle,
  glowStyle,
  shadowStyle,
}: {
  metrics: AppStoreGlassTabBarMetrics;
  translateStyle: any;
  shapeStyle: any;
  highlightStyle: any;
  glowStyle: any;
  shadowStyle: any;
}) {
  const { theme } = useAppTheme();
  const hideAndroidDarkHighlight = Platform.OS === 'android' && theme.colorScheme === 'dark';

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.outer,
        {
          top: metrics.tabBarInsetY,
          width: metrics.activePillWidth,
          height: metrics.activePillHeight,
          borderRadius: metrics.activePillRadius,
        },
        translateStyle,
      ]}
    >
      <Animated.View
        style={[
          styles.separation,
          {
            borderRadius: metrics.activePillRadius,
            backgroundColor: theme.colorScheme === 'dark' ? 'rgba(0,0,0,0.18)' : 'rgba(106,118,138,0.10)',
          },
          shadowStyle,
        ]}
      />
      <Animated.View style={[styles.inner, { borderRadius: metrics.activePillRadius }, shapeStyle]}>
        <BlurView intensity={theme.colorScheme === 'dark' ? 44 : 62} tint={theme.colorScheme === 'dark' ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
        <View style={[styles.fill, { backgroundColor: theme.activeTabBackground }]} />
        <Animated.View
          style={[
            styles.refraction,
            {
              backgroundColor: theme.colorScheme === 'dark' ? 'rgba(10,132,255,0.10)' : 'rgba(22,119,255,0.05)',
            },
            glowStyle,
          ]}
        />
        {!hideAndroidDarkHighlight && (
          <Animated.View
            style={[
              styles.highlight,
              {
                backgroundColor: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.18)',
              },
              highlightStyle,
            ]}
          />
        )}
        <View style={[styles.outline, { borderColor: theme.activeTabBorder }]} />
        <View style={[styles.innerOutline, { borderColor: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.06)' }]} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  outer: {
    position: 'absolute',
    left: 0,
    overflow: 'visible',
  },
  separation: {
    ...StyleSheet.absoluteFillObject,
    left: 4,
    right: 4,
    top: 3,
    bottom: 3,
  },
  inner: {
    flex: 1,
    overflow: 'hidden',
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
  refraction: {
    position: 'absolute',
    left: 7,
    right: 7,
    top: 7,
    bottom: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(22,119,255,0.05)',
  },
  highlight: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: 2,
    height: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  outline: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderRadius: 999,
  },
  innerOutline: {
    ...StyleSheet.absoluteFillObject,
    margin: 1.5,
    borderWidth: 1,
    borderRadius: 999,
  },
});
