import { useEffect } from 'react';

import {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { AppStoreGlassTabBarMetrics } from '@/navigation/AppStoreGlassTabBar.types';

const PHASE_STRETCH = 130;
const PHASE_GLIDE = 470;
const PHASE_OVERSHOOT = 120;
const PHASE_SETTLE = 210;
const PHASE_HIGHLIGHT_RECOVER = 140;

export function useActiveTabAnimation(index: number, metrics: AppStoreGlassTabBarMetrics) {
  const translateX = useSharedValue(metrics.activePillOffset(index));
  const scaleX = useSharedValue(1);
  const scaleY = useSharedValue(1);
  const highlight = useSharedValue(0.7);
  const glow = useSharedValue(0.62);
  const shadow = useSharedValue(0.56);

  useEffect(() => {
    const target = metrics.activePillOffset(index);
    const direction = target >= translateX.value ? 1 : -1;
    const overshoot = direction * 5;

    translateX.value = withSequence(
      withTiming(target + overshoot, {
        duration: PHASE_GLIDE,
        easing: Easing.bezier(0.18, 1, 0.3, 1),
      }),
      withTiming(target, {
        duration: PHASE_SETTLE,
        easing: Easing.bezier(0.2, 0.9, 0.2, 1),
      })
    );

    scaleX.value = withSequence(
      withTiming(1.14, {
        duration: PHASE_STRETCH,
        easing: Easing.out(Easing.cubic),
      }),
      withTiming(1.06, {
        duration: PHASE_GLIDE,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
      }),
      withTiming(1.02, {
        duration: PHASE_OVERSHOOT,
        easing: Easing.bezier(0.2, 0.9, 0.2, 1),
      }),
      withTiming(1, {
        duration: PHASE_SETTLE,
        easing: Easing.bezier(0.2, 0.9, 0.2, 1),
      })
    );

    scaleY.value = withSequence(
      withTiming(0.97, {
        duration: PHASE_STRETCH,
        easing: Easing.out(Easing.cubic),
      }),
      withTiming(0.985, {
        duration: PHASE_GLIDE,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
      }),
      withTiming(1.01, {
        duration: PHASE_OVERSHOOT,
        easing: Easing.bezier(0.2, 0.9, 0.2, 1),
      }),
      withTiming(1, {
        duration: PHASE_SETTLE,
        easing: Easing.bezier(0.2, 0.9, 0.2, 1),
      })
    );

    glow.value = withSequence(
      withTiming(1, {
        duration: PHASE_STRETCH,
        easing: Easing.out(Easing.quad),
      }),
      withTiming(0.82, {
        duration: PHASE_GLIDE,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
      }),
      withTiming(0.76, {
        duration: PHASE_OVERSHOOT,
        easing: Easing.bezier(0.2, 0.9, 0.2, 1),
      }),
      withTiming(0.68, {
        duration: PHASE_SETTLE,
        easing: Easing.bezier(0.2, 0.9, 0.2, 1),
      })
    );

    shadow.value = withSequence(
      withTiming(1, {
        duration: PHASE_STRETCH,
        easing: Easing.out(Easing.quad),
      }),
      withTiming(0.86, {
        duration: PHASE_GLIDE,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
      }),
      withTiming(0.7, {
        duration: PHASE_OVERSHOOT,
        easing: Easing.bezier(0.2, 0.9, 0.2, 1),
      }),
      withTiming(0.62, {
        duration: PHASE_SETTLE,
        easing: Easing.bezier(0.2, 0.9, 0.2, 1),
      })
    );

    highlight.value = withSequence(
      withTiming(1, {
        duration: PHASE_STRETCH,
        easing: Easing.out(Easing.quad),
      }),
      withTiming(0.88, {
        duration: PHASE_GLIDE,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
      }),
      withTiming(0.84, {
        duration: PHASE_OVERSHOOT,
        easing: Easing.bezier(0.2, 0.9, 0.2, 1),
      }),
      withTiming(0.76, {
        duration: PHASE_SETTLE,
        easing: Easing.bezier(0.2, 0.9, 0.2, 1),
      }),
      withTiming(0.7, {
        duration: PHASE_HIGHLIGHT_RECOVER,
        easing: Easing.bezier(0.2, 0.9, 0.2, 1),
      })
    );
  }, [glow, highlight, index, metrics, scaleX, scaleY, shadow, translateX]);

  const translateStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const shapeStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: scaleX.value }, { scaleY: scaleY.value }],
  }));

  const highlightStyle = useAnimatedStyle(() => ({
    opacity: interpolate(highlight.value, [0.7, 1], [0.16, 0.3]),
    transform: [{ translateX: interpolate(highlight.value, [0.7, 1], [0, 5]) }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(glow.value, [0.62, 1], [0.1, 0.2]),
  }));

  const shadowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(shadow.value, [0.56, 1], [0.08, 0.16]),
  }));

  return {
    translateStyle,
    shapeStyle,
    highlightStyle,
    glowStyle,
    shadowStyle,
    durations: {
      stretch: PHASE_STRETCH,
      glide: PHASE_GLIDE,
      overshoot: PHASE_OVERSHOOT,
      settle: PHASE_SETTLE,
      highlightRecover: PHASE_HIGHLIGHT_RECOVER,
    },
  };
}
