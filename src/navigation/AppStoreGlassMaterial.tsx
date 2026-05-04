import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';

import type { AppStoreGlassTabBarMetrics } from '@/navigation/AppStoreGlassTabBar.types';
import { useAppTheme } from '@/theme/AppThemeProvider';

export function AppStoreGlassMaterial({ metrics }: { metrics: AppStoreGlassTabBarMetrics }) {
  const { theme } = useAppTheme();
  const hideAndroidDarkHighlight = Platform.OS === 'android' && theme.colorScheme === 'dark';

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <BlurView intensity={theme.colorScheme === 'dark' ? 72 : 84} tint={theme.colorScheme === 'dark' ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
      <View style={[styles.fill, { backgroundColor: theme.tabBarBackground }]} />
      <View style={[styles.topLine, { backgroundColor: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.22)' }]} />
      {!hideAndroidDarkHighlight && (
        <View style={[styles.topHighlight, { backgroundColor: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.08)' }]} />
      )}
      {/* bottomShade 仅在 iOS 上渲染，Android 上该元素会显示为明显的细长小胶囊 */}
      {Platform.OS !== 'android' && (
        <View style={[styles.bottomShade, { backgroundColor: theme.colorScheme === 'dark' ? 'rgba(0,0,0,0.16)' : 'rgba(112,124,146,0.045)' }]} />
      )}
      <View style={[styles.outerStroke, { borderRadius: metrics.tabBarRadius, borderColor: theme.tabBarBorder }]} />
      <View style={[styles.innerStroke, { borderRadius: metrics.tabBarRadius - 1.5, borderColor: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.07)' }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
  topLine: {
    position: 'absolute',
    left: 14,
    right: 14,
    top: 1,
    height: 1,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  topHighlight: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: 3,
    height: '34%',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  bottomShade: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 2,
    height: '28%',
    borderRadius: 999,
    backgroundColor: 'rgba(112,124,146,0.045)',
  },
  outerStroke: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
  },
  innerStroke: {
    ...StyleSheet.absoluteFillObject,
    margin: 1.5,
    borderWidth: 1,
  },
});
