import { Redirect, type Href } from 'expo-router';
import type { ReactNode } from 'react';

const DEFAULT_FALLBACK_HREF: Href = '/(tabs)/speaking';

export const isDevOnlyRouteEnabled =
  typeof __DEV__ === 'boolean' ? __DEV__ : false;

export function DevOnlyRoute({
  children,
  fallbackHref = DEFAULT_FALLBACK_HREF,
}: {
  children: ReactNode;
  fallbackHref?: Href;
}) {
  if (!isDevOnlyRouteEnabled) {
    return <Redirect href={fallbackHref} />;
  }

  return <>{children}</>;
}
