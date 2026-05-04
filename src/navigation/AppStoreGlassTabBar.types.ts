import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

export type TabBarPlacement = 'bottom' | 'top';

export type AppStoreGlassTabBarProps = BottomTabBarProps & {
  placement?: TabBarPlacement;
};

export type AppStoreGlassTabBarMetrics = {
  placement: TabBarPlacement;
  tabBarWidth: number;
  tabBarHeight: number;
  tabBarRadius: number;
  tabBarBottom: number;
  tabBarTop: number;
  tabBarInsetX: number;
  tabBarInsetY: number;
  slotWidth: number;
  activePillWidth: number;
  activePillHeight: number;
  activePillRadius: number;
  reservedTopInset: number;
  reservedBottomInset: number;
  pageBottomInset: number;
  activePillOffset: (index: number) => number;
};

export type AppStoreGlassTabButtonProps = {
  route: BottomTabBarProps['state']['routes'][number];
  descriptor: BottomTabBarProps['descriptors'][string];
  focused: boolean;
  color: string;
  onPress: () => void;
  onLongPress: () => void;
};
