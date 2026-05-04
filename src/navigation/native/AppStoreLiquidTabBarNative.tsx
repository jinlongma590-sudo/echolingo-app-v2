import type { ViewProps } from 'react-native';
import { requireNativeComponent } from 'react-native';

import type { TabBarPlacement } from '@/navigation/AppStoreGlassTabBar.types';

export type NativeTabBarItem = {
  key: string;
  title: string;
  iconName: string;
  badgeText?: string;
  showsDot?: boolean;
};

type NativeMetricsEvent = {
  nativeEvent: {
    placement: TabBarPlacement;
    height: number;
    bottomOffset: number;
    topOffset: number;
    pageInset: number;
    reservedTopInset: number;
    reservedBottomInset: number;
    width: number;
  };
};

type NativePressEvent = {
  nativeEvent: {
    index: number;
  };
};

export type AppStoreLiquidTabBarNativeProps = ViewProps & {
  items: NativeTabBarItem[];
  selectedIndex: number;
  accentColor: string;
  placement?: TabBarPlacement;
  onTabPress?: (event: NativePressEvent) => void;
  onMetricsChange?: (event: NativeMetricsEvent) => void;
};

export const AppStoreLiquidTabBarNative = requireNativeComponent<AppStoreLiquidTabBarNativeProps>('AppStoreLiquidTabBar');
