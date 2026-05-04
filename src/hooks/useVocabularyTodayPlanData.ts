import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchVocabularyTodayPlan,
  isVocabularyAuthError,
  subscribeVocabularyDataRefresh,
  type TodayPlanResponse,
} from '@/services/api/vocabulary';
import { getVocabularyUserErrorMessage } from '@/services/api/vocabularyErrorCopy';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import type { StoredSession } from '@/types/auth';

type TodayPlanCache = {
  userKey: string;
  data: TodayPlanResponse;
};

let todayPlanCache: TodayPlanCache | null = null;
const todayPlanInflightByUser = new Map<string, Promise<TodayPlanResponse>>();

function getVocabularyUserKey(session: StoredSession) {
  return session.user?.id ?? session.accessToken;
}

async function fetchTodayPlanShared(session: StoredSession) {
  const userKey = getVocabularyUserKey(session);
  const inflight = todayPlanInflightByUser.get(userKey);
  if (inflight) return inflight;

  const task = fetchVocabularyTodayPlan(session).then((next) => {
    todayPlanCache = { userKey, data: next };
    return next;
  });

  todayPlanInflightByUser.set(userKey, task);
  try {
    return await task;
  } finally {
    todayPlanInflightByUser.delete(userKey);
  }
}

export function useVocabularyTodayPlanData() {
  const session = useAppSession();
  const [plan, setPlan] = useState<TodayPlanResponse | null>(null);
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
        todayPlanCache = null;
        setPlan(null);
        setLoading(false);
        setError(null);
        setAuthRequired(false);
        return;
      }

      const userKey = getVocabularyUserKey(session.session);
      const cached = todayPlanCache?.userKey === userKey ? todayPlanCache.data : null;
      if (cached) {
        setPlan(cached);
      }

      setLoading(!cached);
      setError(null);
      setAuthRequired(false);
      try {
        const next = await fetchTodayPlanShared(session.session);
        setPlan(next);
      } catch (err) {
        if (isVocabularyAuthError(err)) {
          const refreshedSession = await session.refreshSession();
          if (!refreshedSession) {
            todayPlanCache = null;
            setPlan(null);
            setAuthRequired(true);
            setError(null);
          } else {
            try {
              const retry = await fetchTodayPlanShared(refreshedSession);
              setPlan(retry);
              setAuthRequired(false);
              setError(null);
            } catch (retryError) {
              setPlan(null);
              setAuthRequired(false);
              setError(getVocabularyUserErrorMessage(retryError, 'today_plan_load'));
            }
          }
        } else {
          if (!cached) {
            setPlan(null);
          }
          setError(getVocabularyUserErrorMessage(err, 'today_plan_load'));
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

  return { plan, loading, error, authRequired, refresh };
}
