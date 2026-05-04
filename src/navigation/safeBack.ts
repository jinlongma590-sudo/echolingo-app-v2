import { router, type Href } from 'expo-router';

const WORDS_HOME_ROUTE = '/(tabs)/words' as Href;

export function safeBack(fallbackRoute: Href = WORDS_HOME_ROUTE) {
  if (router.canGoBack()) {
    router.back();
    return;
  }

  router.replace(fallbackRoute);
}

