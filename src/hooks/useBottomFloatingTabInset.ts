import { useFloatingTabInsets } from '@/hooks/useFloatingTabInsets';

export function useBottomFloatingTabInset() {
  return useFloatingTabInsets().bottom;
}
