import { TabActions } from '@react-navigation/native';
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppStoreGlassActivePill } from '@/navigation/AppStoreGlassActivePill';
import { AppStoreGlassMaterial } from '@/navigation/AppStoreGlassMaterial';
import { AppStoreGlassTabButton } from '@/navigation/AppStoreGlassTabButton';
import type { AppStoreGlassTabBarProps } from '@/navigation/AppStoreGlassTabBar.types';
import { useActiveTabAnimation } from '@/navigation/useActiveTabAnimation';
import { useTabBarMetrics } from '@/navigation/useTabBarMetrics';
import { useAppTheme } from '@/theme/AppThemeProvider';

export function AppStoreGlassTabBar({
  state,
  descriptors,
  navigation,
  placement = 'bottom',
}: AppStoreGlassTabBarProps) {
  const { theme } = useAppTheme();
  const metrics = useTabBarMetrics({ tabCount: state.routes.length, placement });
  const animation = useActiveTabAnimation(state.index, metrics);

  useEffect(() => {
    if (!(typeof __DEV__ === 'boolean' && __DEV__)) return;
    const contentWidth = metrics.tabBarWidth - metrics.tabBarInsetX * 2;
    const pillX = metrics.activePillOffset(state.index);
    const pillCenterX = pillX + metrics.activePillWidth / 2;
    console.log(
      '[TabBarMetrics][JS]',
      {
        containerWidth: metrics.tabBarWidth,
        placement,
        horizontalInset: metrics.tabBarInsetX,
        contentWidth,
        tabCount: state.routes.length,
        slotWidth: metrics.slotWidth,
        activeIndex: state.index,
        pillWidth: metrics.activePillWidth,
        pillX,
        pillCenterX,
      }
    );
  }, [metrics, state.index, state.routes.length]);

  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <View
        pointerEvents="box-none"
        style={[
          styles.positioner,
          placement === 'top' ? { top: metrics.tabBarTop } : { bottom: metrics.tabBarBottom },
        ]}
      >
        <View
          style={[
            styles.shadowWrap,
            {
              width: metrics.tabBarWidth,
              height: metrics.tabBarHeight,
              borderRadius: metrics.tabBarRadius,
              shadowColor: theme.shadowColor,
              shadowOpacity: theme.colorScheme === 'dark' ? 0.18 : 0.07,
            },
          ]}
        >
          <View style={[styles.shell, { borderRadius: metrics.tabBarRadius }]}> 
            <AppStoreGlassMaterial metrics={metrics} />
            <AppStoreGlassActivePill
              metrics={metrics}
              translateStyle={animation.translateStyle}
              shapeStyle={animation.shapeStyle}
              highlightStyle={animation.highlightStyle}
              glowStyle={animation.glowStyle}
              shadowStyle={animation.shadowStyle}
            />

            <View
              style={[
                styles.row,
                {
                  paddingHorizontal: metrics.tabBarInsetX,
                  paddingVertical: metrics.tabBarInsetY,
                },
              ]}
            >
              {state.routes.map((route, index) => {
                const descriptor = descriptors[route.key];
                const focused = state.index === index;
                const color = focused ? theme.primaryBlue : theme.textSecondary;

                const onPress = () => {
                  const event = navigation.emit({
                    type: 'tabPress',
                    target: route.key,
                    canPreventDefault: true,
                  });

                  if (!focused && !event.defaultPrevented) {
                    navigation.dispatch({
                      ...TabActions.jumpTo(route.name, route.params),
                      target: state.key,
                    });
                  }
                };

                const onLongPress = () => {
                  navigation.emit({
                    type: 'tabLongPress',
                    target: route.key,
                  });
                };

                return (
                  <AppStoreGlassTabButton
                    key={route.key}
                    route={route}
                    descriptor={descriptor}
                    focused={focused}
                    color={color}
                    onPress={onPress}
                    onLongPress={onLongPress}
                  />
                );
              })}
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  positioner: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  shadowWrap: {
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 0,
  },
  shell: {
    flex: 1,
    overflow: 'hidden',
  },
  row: {
    flex: 1,
    flexDirection: 'row',
  },
});
