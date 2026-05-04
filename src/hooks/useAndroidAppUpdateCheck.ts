import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { env } from '@/lib/env';

export type AndroidUpdateInfo = {
  latestVersionCode: number;
  latestVersionName: string;
  apkUrl: string;
  forceUpdate: boolean;
  message: string;
};

type AppVersionResponse = {
  ok?: boolean;
  android?: Partial<AndroidUpdateInfo>;
};

let hasCheckedAndroidAppUpdate = false;

function parseVersionCode(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function getCurrentAndroidVersionCode() {
  // Constants.nativeBuildVersion was removed in expo-constants v17/SDK 55.
  // Use Constants.expoConfig.android.versionCode (requires android.versionCode in app.json)
  // as the authoritative source for the installed native versionCode.
  return (
    parseVersionCode(Constants.expoConfig?.android?.versionCode) ??
    0
  );
}

function normalizeAndroidUpdateInfo(input: AppVersionResponse['android']): AndroidUpdateInfo | null {
  if (!input) return null;

  const latestVersionCode = parseVersionCode(input.latestVersionCode);
  if (!latestVersionCode || !input.apkUrl) return null;

  return {
    latestVersionCode,
    latestVersionName: input.latestVersionName || String(latestVersionCode),
    apkUrl: input.apkUrl,
    forceUpdate: Boolean(input.forceUpdate),
    message: input.message || '发现新版本，请下载更新。',
  };
}

export function useAndroidAppUpdateCheck() {
  const [updateInfo, setUpdateInfo] = useState<AndroidUpdateInfo | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'android' || hasCheckedAndroidAppUpdate) {
      return;
    }

    hasCheckedAndroidAppUpdate = true;
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`${env.apiBaseUrl.replace(/\/$/, '')}/api/mobile/app-version`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
        });

        if (!response.ok) return;

        const payload = (await response.json()) as AppVersionResponse;
        const android = normalizeAndroidUpdateInfo(payload.android);
        const currentVersionCode = getCurrentAndroidVersionCode();

        if (!cancelled && payload.ok && android && android.latestVersionCode > currentVersionCode) {
          setUpdateInfo(android);
        }
      } catch {
        // Version checks should never block app startup.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    updateInfo,
    dismissUpdate: () => {
      if (!updateInfo?.forceUpdate) {
        setUpdateInfo(null);
      }
    },
  };
}
