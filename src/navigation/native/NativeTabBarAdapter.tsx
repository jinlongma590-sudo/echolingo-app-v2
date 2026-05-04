import { TabActions } from '@react-navigation/native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import React, { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { useDeviceClass } from '@/hooks/useDeviceClass';
import { AppStoreGlassTabBar } from '@/navigation/AppStoreGlassTabBar';
import { useTabBarMetrics } from '@/navigation/useTabBarMetrics';
import { TAB_SELECTED_TINT } from '@/theme/tokens';
import { AppStoreLiquidTabBarNative, type NativeTabBarItem } from '@/navigation/native/AppStoreLiquidTabBarNative';
import {
  setFloatingTabMetrics,
} from '@/navigation/native/AppStoreLiquidTabBarMetricsStore';
import { SystemLiquidTabBarNative } from '@/navigation/native/SystemLiquidTabBarNative';
import { TopLiquidTabBarNative } from '@/navigation/native/TopLiquidTabBarNative';

const USE_SYSTEM_IOS26_TAB_BAR = true;

const IOS_ICON_MAP: Record<string, string> = {
  home: 'house.fill',
  library: 'headphones',
  words: 'square.grid.2x2.fill',
  speaking: 'mic.fill',
  my: 'person.fill',
};

function toBadgePayload(value: unknown): Pick<NativeTabBarItem, 'badgeText' | 'showsDot'> {
  if (typeof value === 'string' || typeof value === 'number') {
    return { badgeText: String(value) };
  }

  if (value != null) {
    return { showsDot: true };
  }

  return {};
}

export function NativeTabBarAdapter({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const { shouldUseTopTabBar } = useDeviceClass();
  const placement = shouldUseTopTabBar ? 'top' : 'bottom';
  const jsMetrics = useTabBarMetrics({ tabCount: state.routes.length, placement });
  const isTopPlacement = placement === 'top';
  const shouldUseSystemIos26TabBar =
    Platform.OS === 'ios' && !isTopPlacement && USE_SYSTEM_IOS26_TAB_BAR && Number(Platform.Version) >= 26;
  const items = useMemo<NativeTabBarItem[]>(() => {
    return state.routes.map((route) => {
      const options = descriptors[route.key].options;
      const title =
        typeof options.tabBarLabel === 'string'
          ? options.tabBarLabel
          : typeof options.title === 'string'
            ? options.title
            : route.name;

      return {
        key: route.key,
        title,
        iconName: IOS_ICON_MAP[route.name] ?? 'circle.fill',
        ...toBadgePayload(options.tabBarBadge),
      };
    });
  }, [descriptors, state.routes]);

  if (Platform.OS !== 'ios') {
    return <AppStoreGlassTabBar state={state} descriptors={descriptors} navigation={navigation} insets={insets} placement={placement} />;
  }

  const NativeTabBarComponent = isTopPlacement
    ? TopLiquidTabBarNative
    : shouldUseSystemIos26TabBar
      ? SystemLiquidTabBarNative
      : AppStoreLiquidTabBarNative;
  const topOverlayHeight = Math.max(jsMetrics.reservedTopInset || 0, 82);
  const bottomOverlayHeight = Math.min(
    Math.max(
      jsMetrics.tabBarHeight + jsMetrics.tabBarBottom + 8,
      112,
    ),
    124,
  );

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.overlay,
        isTopPlacement
          ? {
              top: 0,
              height: topOverlayHeight,
            }
          : {
              bottom: 0,
              height: bottomOverlayHeight,
            },
      ]}
    >
      <NativeTabBarComponent
        style={StyleSheet.absoluteFill}
        items={items}
        selectedIndex={state.index}
        accentColor={TAB_SELECTED_TINT}
        placement={placement}
        onMetricsChange={(event) => {
          setFloatingTabMetrics({
            placement: event.nativeEvent.placement,
            height: event.nativeEvent.height,
            bottomOffset: event.nativeEvent.bottomOffset,
            topOffset: event.nativeEvent.topOffset,
            reservedTopInset: event.nativeEvent.reservedTopInset,
            reservedBottomInset: event.nativeEvent.reservedBottomInset || event.nativeEvent.pageInset,
            width: event.nativeEvent.width,
          });
        }}
        onTabPress={(event) => {
          const index = event.nativeEvent.index;
          const route = state.routes[index];
          if (!route) return;
          const focused = state.index === index;
          const tabPress = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });

          if (!focused && !tabPress.defaultPrevented) {
            navigation.dispatch({
              ...TabActions.jumpTo(route.name, route.params),
              target: state.key,
            });
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  topNativeBar: {
    alignSelf: 'center',
  },
});
