import * as SplashScreen from 'expo-splash-screen';

let preventCalled = false;
let hideCalled = false;
let hardTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

const HARD_TIMEOUT_MS = 4000;

export function preventSplashAutoHideSafe() {
  if (preventCalled) return;
  preventCalled = true;
  try {
    void SplashScreen.preventAutoHideAsync().catch((error) => {
      console.warn('[splash] preventAutoHideAsync_failed', JSON.stringify({
        message: error instanceof Error ? error.message : String(error ?? 'unknown'),
      }));
    });
  } catch (error) {
    console.warn('[splash] preventAutoHideAsync_threw', JSON.stringify({
      message: error instanceof Error ? error.message : String(error ?? 'unknown'),
    }));
  }
  // Hard fallback: even if React tree never renders or hideSplashSafe never
  // gets called, force-hide the splash after HARD_TIMEOUT_MS so the app cannot
  // sit forever on the splash screen during App Store review.
  if (!hardTimeoutHandle) {
    hardTimeoutHandle = setTimeout(() => {
      hardTimeoutHandle = null;
      void hideSplashSafe('hard_timeout');
    }, HARD_TIMEOUT_MS);
  }
}

export async function hideSplashSafe(reason: string) {
  if (hideCalled) return;
  hideCalled = true;
  if (hardTimeoutHandle) {
    clearTimeout(hardTimeoutHandle);
    hardTimeoutHandle = null;
  }
  try {
    await SplashScreen.hideAsync();
    console.log('[splash] hidden', JSON.stringify({ reason }));
  } catch (error) {
    console.warn('[splash] hideAsync_failed', JSON.stringify({
      reason,
      message: error instanceof Error ? error.message : String(error ?? 'unknown'),
    }));
  }
}
