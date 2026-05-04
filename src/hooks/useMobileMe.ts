import React, { useCallback, useEffect, useState } from 'react';

import {
  ensureMobileAiWallet,
  fetchMobileMe,
  isMobileMeAuthError,
  isMobileMeNetworkError,
  type MobileMeResponse,
} from '@/services/api/mobileMe';
import { useAppSession } from '@/services/auth/AppSessionProvider';

type UseMobileMeStatus = 'no_session' | 'loading' | 'ready' | 'sync_failed';

type UseMobileMeResult = {
  status: UseMobileMeStatus;
  data: MobileMeResponse | null;
  error: string | null;
  refresh: () => Promise<MobileMeResponse | null>;
};

type SharedMobileMeState = {
  status: UseMobileMeStatus;
  data: MobileMeResponse | null;
  error: string | null;
  loadedAccessToken: string | null;
  requestId: number;
};

const ensuredWalletUserIds = new Set<string>();
const inflightEnsureWalletByUserId = new Map<string, Promise<void>>();
const mobileMeListeners = new Set<() => void>();
let sharedMobileMeState: SharedMobileMeState = {
  status: 'no_session',
  data: null,
  error: null,
  loadedAccessToken: null,
  requestId: 0,
};

function emitMobileMeChange() {
  mobileMeListeners.forEach((listener) => listener());
}

function setSharedMobileMeState(next: Partial<SharedMobileMeState>) {
  sharedMobileMeState = {
    ...sharedMobileMeState,
    ...next,
  };
  emitMobileMeChange();
}

function resetSharedMobileMeState() {
  sharedMobileMeState = {
    status: 'no_session',
    data: null,
    error: null,
    loadedAccessToken: null,
    requestId: sharedMobileMeState.requestId + 1,
  };
  emitMobileMeChange();
}

function subscribeMobileMe(listener: () => void) {
  mobileMeListeners.add(listener);
  return () => {
    mobileMeListeners.delete(listener);
  };
}

function resetEnsureWalletState() {
  ensuredWalletUserIds.clear();
  inflightEnsureWalletByUserId.clear();
}

async function ensureWalletOnce(userId: string, accessToken: string) {
  if (ensuredWalletUserIds.has(userId)) {
    return;
  }

  const inflight = inflightEnsureWalletByUserId.get(userId);
  if (inflight) {
    await inflight;
    return;
  }

  const task = (async () => {
    await ensureMobileAiWallet(accessToken);
    ensuredWalletUserIds.add(userId);
  })();

  inflightEnsureWalletByUserId.set(userId, task);

  try {
    await task;
  } finally {
    inflightEnsureWalletByUserId.delete(userId);
  }
}

export function useMobileMe(): UseMobileMeResult {
  const session = useAppSession();
  const [snapshot, setSnapshot] = useState(() => ({
    status: sharedMobileMeState.status,
    data: sharedMobileMeState.data,
    error: sharedMobileMeState.error,
  }));

  useEffect(() => {
    return subscribeMobileMe(() => {
      setSnapshot({
        status: sharedMobileMeState.status,
        data: sharedMobileMeState.data,
        error: sharedMobileMeState.error,
      });
    });
  }, []);

  useEffect(() => {
    if (session.isHydrating) {
      return;
    }

    if (session.status !== 'authenticated') {
      resetEnsureWalletState();
      resetSharedMobileMeState();
    }
  }, [session.isHydrating, session.status]);

  const load = useCallback(async (): Promise<MobileMeResponse | null> => {
    const accessToken = session.session?.accessToken;
    const hasSharedData = Boolean(sharedMobileMeState.data);

    if (session.isHydrating) {
      setSharedMobileMeState({
        status: 'loading',
        error: null,
        requestId: sharedMobileMeState.requestId + 1,
      });
      return sharedMobileMeState.data;
    }

    if (session.status !== 'authenticated') {
      setSharedMobileMeState({
        status: 'no_session',
        data: null,
        error: null,
        loadedAccessToken: null,
        requestId: sharedMobileMeState.requestId + 1,
      });
      return null;
    }

    if (!accessToken) {
      setSharedMobileMeState({
        status: hasSharedData ? 'loading' : 'sync_failed',
        data: sharedMobileMeState.data,
        error: hasSharedData ? null : '账号信息暂时无法同步，请稍后重试。',
        loadedAccessToken: sharedMobileMeState.loadedAccessToken,
        requestId: sharedMobileMeState.requestId + 1,
      });
      return sharedMobileMeState.data;
    }

    const requestId = sharedMobileMeState.requestId + 1;
    setSharedMobileMeState({
      status: 'loading',
      error: null,
      requestId,
    });

    try {
      let next = await fetchMobileMe(accessToken);
      if (requestId !== sharedMobileMeState.requestId) return null;

      if (
        next.user.id &&
        next.entitlements.speakingCredits <= 0 &&
        !ensuredWalletUserIds.has(next.user.id)
      ) {
        try {
          await ensureWalletOnce(next.user.id, accessToken);
          const refreshed = await fetchMobileMe(accessToken);
          if (requestId !== sharedMobileMeState.requestId) return null;
          next = refreshed;
        } catch (ensureError) {
          console.warn('mobile_me_ensure_ai_wallet_failed', ensureError);
        }
      }

      setSharedMobileMeState({
        data: next,
        status: 'ready',
        loadedAccessToken: accessToken,
      });
      return next;
    } catch (err) {
      if (requestId !== sharedMobileMeState.requestId) return null;

      if (isMobileMeAuthError(err)) {
        if (session.status === 'authenticated') {
          setSharedMobileMeState({
            status: 'sync_failed',
            error: err.message || '账号信息暂时无法同步，请稍后重试。',
            loadedAccessToken: accessToken,
          });
          return sharedMobileMeState.data;
        }

        setSharedMobileMeState({
          data: null,
          status: 'no_session',
          error: null,
          loadedAccessToken: null,
        });
        return null;
      }

      const nextError = isMobileMeNetworkError(err)
        ? '账号信息暂时无法同步，请稍后重试。'
        : err instanceof Error
          ? err.message
          : '账号信息暂时无法同步，请稍后重试。';

      setSharedMobileMeState({
        data: session.status === 'authenticated' ? sharedMobileMeState.data : null,
        status: session.status === 'authenticated' ? 'sync_failed' : 'no_session',
        error: nextError,
        loadedAccessToken: session.status === 'authenticated' ? accessToken : null,
      });
      return sharedMobileMeState.data;
    }
  }, [session.isHydrating, session.session?.accessToken, session.status]);

  useEffect(() => {
    const accessToken = session.session?.accessToken ?? null;

    if (session.isHydrating) {
      return;
    }

    if (!accessToken || session.status !== 'authenticated') {
      void load();
      return;
    }

    if (
      sharedMobileMeState.loadedAccessToken === accessToken &&
      (sharedMobileMeState.status === 'ready' || sharedMobileMeState.status === 'loading')
    ) {
      return;
    }

    void load();
  }, [load, session.isHydrating, session.session?.accessToken, session.status]);

  return {
    status: snapshot.status,
    data: snapshot.data,
    error: snapshot.error,
    refresh: load,
  };
}
