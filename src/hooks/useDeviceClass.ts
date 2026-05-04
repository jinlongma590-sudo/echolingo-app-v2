import { useMemo } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

export const TABLET_BREAKPOINT = 768;
export const TABLET_LAYOUT_BREAKPOINT = 900;
export const WIDE_LAYOUT_BREAKPOINT = 1024;

export function useDeviceClass() {
  const { width, height } = useWindowDimensions();

  return useMemo(() => {
    const minDimension = Math.min(width, height);
    const isTablet = width >= TABLET_BREAKPOINT;
    const isPadLikeDevice =
      Platform.OS === 'ios'
        ? Platform.isPad === true || minDimension >= TABLET_BREAKPOINT
        : minDimension >= TABLET_BREAKPOINT;
    const isPhone = !isPadLikeDevice;
    const shouldUseTopTabBar = isPadLikeDevice;
    const shouldUseTabletLayout = isPadLikeDevice && width >= TABLET_LAYOUT_BREAKPOINT;
    const isWideTablet = shouldUseTabletLayout;
    const isWideLayout = width >= WIDE_LAYOUT_BREAKPOINT;

    return {
      width,
      height,
      isTablet,
      isPadLikeDevice,
      isPhone,
      shouldUseTopTabBar,
      isWideTablet,
      shouldUseTabletLayout,
      isWideLayout,
    };
  }, [height, width]);
}
