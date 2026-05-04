import { useSyncExternalStore } from 'react';

import type { TabBarPlacement } from '@/navigation/AppStoreGlassTabBar.types';

export type FloatingTabMetrics = {
  placement: TabBarPlacement;
  height: number;
  bottomOffset: number;
  topOffset: number;
  reservedTopInset: number;
  reservedBottomInset: number;
  width: number;
};

const DEFAULT_METRICS: FloatingTabMetrics = {
  placement: 'bottom',
  height: 76,
  bottomOffset: 6,
  topOffset: 0,
  reservedTopInset: 0,
  reservedBottomInset: 94,
  width: 380,
};

let metricsState: FloatingTabMetrics = DEFAULT_METRICS;
const listeners = new Set<() => void>();

export function setFloatingTabMetrics(next: Partial<FloatingTabMetrics>) {
  const merged = { ...metricsState, ...next };
  if (
    merged.placement === metricsState.placement &&
    merged.height === metricsState.height &&
    merged.bottomOffset === metricsState.bottomOffset &&
    merged.topOffset === metricsState.topOffset &&
    merged.reservedTopInset === metricsState.reservedTopInset &&
    merged.reservedBottomInset === metricsState.reservedBottomInset &&
    merged.width === metricsState.width
  ) {
    return;
  }

  metricsState = merged;
  listeners.forEach((listener) => listener());
}

export function useFloatingTabMetricsStore() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => metricsState,
    () => metricsState,
  );
}

export function getDefaultFloatingTabMetrics() {
  return DEFAULT_METRICS;
}

export type BottomFloatingTabMetrics = FloatingTabMetrics;
export const setBottomFloatingTabMetrics = setFloatingTabMetrics;
export const useBottomFloatingTabMetricsStore = useFloatingTabMetricsStore;
export const getDefaultBottomFloatingTabMetrics = getDefaultFloatingTabMetrics;
