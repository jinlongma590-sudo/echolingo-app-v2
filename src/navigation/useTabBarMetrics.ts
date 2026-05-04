import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AppStoreGlassTabBarMetrics, TabBarPlacement } from '@/navigation/AppStoreGlassTabBar.types';

const TAB_BAR_TARGET_WIDTH = 404;
const TAB_BAR_TOP_MIN_WIDTH = 640;
const TAB_BAR_TOP_MAX_WIDTH = 700;
const TAB_BAR_HEIGHT = 76;
const TAB_BAR_RADIUS = 38;
const TAB_BAR_BOTTOM_GAP = 4;
const TAB_BAR_TOP_GAP = 6;
const TAB_BAR_SIDE_MARGIN = 24;
const TAB_BAR_TOP_SIDE_MARGIN = 16;
const TAB_BAR_INSET_X = 12;
const TAB_BAR_INSET_Y = 9;
const ACTIVE_PILL_HEIGHT = 58;
const PAGE_BREATHING_SPACE = 12;
const TOP_CONTENT_GAP = 12;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

type UseTabBarMetricsOptions = {
  tabCount?: number;
  placement?: TabBarPlacement;
};

export function useTabBarMetrics(
  tabCountOrOptions: number | UseTabBarMetricsOptions = 5,
): AppStoreGlassTabBarMetrics {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const options =
    typeof tabCountOrOptions === 'number'
      ? { tabCount: tabCountOrOptions, placement: 'bottom' as TabBarPlacement }
      : {
          tabCount: tabCountOrOptions.tabCount ?? 5,
          placement: tabCountOrOptions.placement ?? 'bottom',
        };
  const tabCount = options.tabCount;
  const placement = options.placement;

  return useMemo(() => {
    const resolvedTabCount = Math.max(1, tabCount);
    const tabBarWidth =
      placement === 'top'
        ? Math.min(
            Math.max(TAB_BAR_TOP_MIN_WIDTH, width * 0.5),
            Math.min(TAB_BAR_TOP_MAX_WIDTH, width - TAB_BAR_TOP_SIDE_MARGIN * 2),
          )
        : Math.min(TAB_BAR_TARGET_WIDTH, Math.max(320, width - TAB_BAR_SIDE_MARGIN * 2));
    const contentWidth = tabBarWidth - TAB_BAR_INSET_X * 2;
    const slotWidth = contentWidth / resolvedTabCount;
    const activePillWidth = Math.min(clamp(slotWidth * 0.92, 76, 88), slotWidth + 4);
    const resolvedTabBarHeight = placement === 'top' ? 52 : TAB_BAR_HEIGHT;
    const resolvedTabBarRadius = placement === 'top' ? 26 : TAB_BAR_RADIUS;
    const resolvedActivePillHeight = placement === 'top' ? 42 : ACTIVE_PILL_HEIGHT;
    const resolvedTabBarInsetY = placement === 'top' ? 5 : TAB_BAR_INSET_Y;
    const activePillRadius = Math.min(resolvedActivePillHeight, activePillWidth) / 2;
    const tabBarBottom = Math.max(insets.bottom + TAB_BAR_BOTTOM_GAP, 6);
    const tabBarTop = insets.top + TAB_BAR_TOP_GAP;
    const reservedTopInset =
      placement === 'top'
        ? Math.min(Math.max(insets.top + resolvedTabBarHeight + TOP_CONTENT_GAP, 84), 92)
        : 0;
    const reservedBottomInset = placement === 'bottom' ? tabBarBottom + TAB_BAR_HEIGHT + PAGE_BREATHING_SPACE : 0;

    return {
      placement,
      tabBarWidth,
      tabBarHeight: resolvedTabBarHeight,
      tabBarRadius: resolvedTabBarRadius,
      tabBarBottom,
      tabBarTop,
      tabBarInsetX: TAB_BAR_INSET_X,
      tabBarInsetY: resolvedTabBarInsetY,
      slotWidth,
      activePillWidth,
      activePillHeight: resolvedActivePillHeight,
      activePillRadius,
      reservedTopInset,
      reservedBottomInset,
      pageBottomInset: reservedBottomInset,
      activePillOffset: (index: number) => TAB_BAR_INSET_X + slotWidth * index + (slotWidth - activePillWidth) / 2,
    };
  }, [insets.bottom, insets.top, placement, tabCount, width]);
}
