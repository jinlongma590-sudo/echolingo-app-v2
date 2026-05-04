import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchVocabularyNotebook,
  isVocabularyAuthError,
  subscribeVocabularyDataRefresh,
  type VocabularyProgressResponse,
} from '@/services/api/vocabulary';
import { getVocabularyUserErrorMessage } from '@/services/api/vocabularyErrorCopy';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import type { StoredSession } from '@/types/auth';

type NotebookCache = {
  userKey: string;
  data: VocabularyProgressResponse;
};

let notebookCache: NotebookCache | null = null;
const notebookInflightByUser = new Map<string, Promise<VocabularyProgressResponse>>();

function getVocabularyUserKey(session: StoredSession) {
  return session.user?.id ?? session.accessToken;
}

async function fetchNotebookShared(session: StoredSession) {
  const userKey = getVocabularyUserKey(session);
  const inflight = notebookInflightByUser.get(userKey);
  if (inflight) return inflight;

  const task = fetchVocabularyNotebook(session).then((next) => {
    notebookCache = { userKey, data: next };
    return next;
  });

  notebookInflightByUser.set(userKey, task);
  try {
    return await task;
  } finally {
    notebookInflightByUser.delete(userKey);
  }
}

export function useVocabularyNotebookData() {
  const session = useAppSession();
  const [data, setData] = useState<VocabularyProgressResponse | null>(null);
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
        notebookCache = null;
        setData(null);
        setLoading(false);
        setError(null);
        setAuthRequired(false);
        return;
      }

      const userKey = getVocabularyUserKey(session.session);
      const cached = notebookCache?.userKey === userKey ? notebookCache.data : null;
      if (cached) {
        setData(cached);
      }

      setLoading(!cached);
      setError(null);
      setAuthRequired(false);
      try {
        const next = await fetchNotebookShared(session.session);
        setData(next);
      } catch (err) {
        if (isVocabularyAuthError(err)) {
          const refreshedSession = await session.refreshSession();
          if (!refreshedSession) {
            notebookCache = null;
            setData(null);
            setAuthRequired(true);
            setError(null);
          } else {
            try {
              const retry = await fetchNotebookShared(refreshedSession);
              setData(retry);
              setAuthRequired(false);
              setError(null);
            } catch (retryError) {
              setData(null);
              setAuthRequired(false);
              setError(getVocabularyUserErrorMessage(retryError, 'notebook_load'));
            }
          }
        } else {
          if (!cached) {
            setData(null);
          }
          setError(getVocabularyUserErrorMessage(err, 'notebook_load'));
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

  return { data, loading, error, authRequired, refresh };
}
