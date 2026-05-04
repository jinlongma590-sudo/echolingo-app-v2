import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDeviceClass } from '@/hooks/useDeviceClass';
import {
  getDefaultFloatingTabMetrics,
  useFloatingTabMetricsStore,
} from '@/navigation/native/AppStoreLiquidTabBarMetricsStore';
import type { TabBarPlacement } from '@/navigation/AppStoreGlassTabBar.types';
import { useTabBarMetrics } from '@/navigation/useTabBarMetrics';

export function useFloatingTabInsets() {
  const { shouldUseTopTabBar } = useDeviceClass();
  const insets = useSafeAreaInsets();
  const placement: TabBarPlacement = shouldUseTopTabBar ? 'top' : 'bottom';
  const jsMetrics = useTabBarMetrics({ placement });
  const nativeMetrics = useFloatingTabMetricsStore();

  if (placement === 'top') {
    return {
      placement,
      top:
        Platform.OS === 'ios' && nativeMetrics.placement === 'top' && nativeMetrics.reservedTopInset > 0
          ? nativeMetrics.reservedTopInset
          : jsMetrics.reservedTopInset,
      bottom: 0,
    };
  }

  if (Platform.OS !== 'ios') {
    return {
      placement,
      top: 0,
      bottom: jsMetrics.reservedBottomInset,
    };
  }

  const defaultMetrics = getDefaultFloatingTabMetrics();
  const measuredBottomInset =
    nativeMetrics.placement === 'bottom'
      ? nativeMetrics.reservedBottomInset || nativeMetrics.height + nativeMetrics.bottomOffset
      : 0;

  return {
    placement,
    top: 0,
    bottom:
      measuredBottomInset > 0
        ? measuredBottomInset
        : Math.max(defaultMetrics.reservedBottomInset, insets.bottom + 8, 16),
  };
}
