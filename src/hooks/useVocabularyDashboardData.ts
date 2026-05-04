import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchVocabularyDashboard,
  isVocabularyAuthError,
  subscribeVocabularyDataRefresh,
  type VocabularyDashboard,
} from '@/services/api/vocabulary';
import { getVocabularyUserErrorMessage } from '@/services/api/vocabularyErrorCopy';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import type { StoredSession } from '@/types/auth';

type DashboardCache = {
  userKey: string;
  data: VocabularyDashboard;
};

let dashboardCache: DashboardCache | null = null;
const dashboardInflightByUser = new Map<string, Promise<VocabularyDashboard>>();

function getVocabularyUserKey(session: StoredSession) {
  return session.user?.id ?? session.accessToken;
}

async function fetchDashboardShared(session: StoredSession) {
  const userKey = getVocabularyUserKey(session);
  const inflight = dashboardInflightByUser.get(userKey);
  if (inflight) return inflight;

  const task = fetchVocabularyDashboard(session).then((next) => {
    dashboardCache = { userKey, data: next };
    return next;
  });

  dashboardInflightByUser.set(userKey, task);
  try {
    return await task;
  } finally {
    dashboardInflightByUser.delete(userKey);
  }
}

export function useVocabularyDashboardData() {
  const session = useAppSession();
  const [dashboard, setDashboard] = useState<VocabularyDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const inflightRefreshRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (inflightRefreshRef.current) {
      return inflightRefreshRef.current;
    }

    const task = (async () => {
      if (session.isHydrating) {
        setLoading(true);
        setError(null);
        setAuthRequired(false);
        return;
      }

      if (!session.session || session.status !== 'authenticated') {
        dashboardCache = null;
        setDashboard(null);
        setLoading(false);
        setError(null);
        setAuthRequired(false);
        return;
      }

      const userKey = getVocabularyUserKey(session.session);
      const cached = dashboardCache?.userKey === userKey ? dashboardCache.data : null;
      if (cached) {
        setDashboard(cached);
      }

      setLoading(!cached);
      setError(null);
      setAuthRequired(false);
      try {
        const next = await fetchDashboardShared(session.session);
        setDashboard(next);
      } catch (err) {
        if (isVocabularyAuthError(err)) {
          const refreshedSession = await session.refreshSession();
          if (!refreshedSession) {
            dashboardCache = null;
            setDashboard(null);
            setAuthRequired(true);
            setError(null);
          } else {
            try {
              const retry = await fetchDashboardShared(refreshedSession);
              setDashboard(retry);
              setAuthRequired(false);
              setError(null);
            } catch (retryError) {
              setDashboard(null);
              setAuthRequired(false);
              setError(getVocabularyUserErrorMessage(retryError, 'dashboard_load'));
            }
          }
        } else {
          if (!cached) {
            setDashboard(null);
          }
          setError(getVocabularyUserErrorMessage(err, 'dashboard_load'));
        }
      } finally {
        setLoading(false);
      }
    })();

    inflightRefreshRef.current = task;

    try {
      await task;
    } finally {
      if (inflightRefreshRef.current === task) {
        inflightRefreshRef.current = null;
      }
    }

    return task;
  }, [session, session.isHydrating, session.session, session.status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return subscribeVocabularyDataRefresh(() => {
      void refresh();
    });
  }, [refresh]);

  return { dashboard, loading, error, authRequired, refresh };
}
