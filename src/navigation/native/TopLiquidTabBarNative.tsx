import { requireNativeComponent } from 'react-native';

import type { AppStoreLiquidTabBarNativeProps } from '@/navigation/native/AppStoreLiquidTabBarNative';

export const TopLiquidTabBarNative = requireNativeComponent<AppStoreLiquidTabBarNativeProps>('TopLiquidTabBar');
