import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { type LearningRecord } from '@/services/api/learning';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import {
  fetchSharedLearningRecords,
  getCachedLearningRecords,
  isLearningRecordsCacheStale,
  subscribeLearningRecords,
  type LearningRecordsSnapshot,
} from '@/store/learningRecordsStore';
import type { LibraryDashboardSnapshot } from '@/types/libraryDashboard';
import type { EpisodeStub } from '@/types/echolingo';
import {
  buildLearningOverview,
  getDateKey,
  sortEpisodes,
  stableDailyPick,
} from '@/utils/libraryDashboard';

type UseLibraryDashboardResult = {
  records: LearningRecord[];
  loading: boolean;
  error: string | null;
  snapshot: LibraryDashboardSnapshot;
};

function fallbackRecommendations(episodes: EpisodeStub[], excludedIds: string[], count: number) {
  const excludeSet = new Set(excludedIds);
  const latestEpisodes = sortEpisodes(episodes, 'latest');
  return latestEpisodes.filter((episode) => !excludeSet.has(episode.id)).slice(0, count);
}

export function useLibraryDashboard(
  episodes: EpisodeStub[],
  totalEpisodes: number,
): UseLibraryDashboardResult {
  const session = useAppSession();
  const [records, setRecords] = useState<LearningRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyLearningSnapshot = useCallback(
    (nextSnapshot: LearningRecordsSnapshot = getCachedLearningRecords(session.session)) => {
      if (session.status !== 'authenticated' || !session.session) {
        return;
      }
      setRecords(nextSnapshot.records);
      setLoading(nextSnapshot.isLoading && nextSnapshot.records.length === 0);
      setError(nextSnapshot.records.length === 0 ? nextSnapshot.error : null);
    },
    [session.session, session.status],
  );

  const loadLearningRecords = useCallback(
    async (force = false) => {
      if (session.isHydrating) {
        return;
      }

      if (session.status !== 'authenticated' || !session.session) {
        setRecords([]);
        setLoading(false);
        setError(null);
        return;
      }

      const cached = getCachedLearningRecords(session.session);
      applyLearningSnapshot(cached);

      if (!force && cached.fetchedAt && !cached.error && !isLearningRecordsCacheStale(session.session)) {
        return;
      }

      try {
        await fetchSharedLearningRecords({
          session: session.session,
          refreshSession: session.refreshSession,
          force,
          keepPreviousOnError: true,
        });
      } catch {
        // The shared store has already published the error snapshot.
      }
    },
    [
      applyLearningSnapshot,
      session.isHydrating,
      session.refreshSession,
      session.session,
      session.status,
    ],
  );

  useEffect(() => {
    if (session.status !== 'authenticated' || !session.session) {
      setRecords([]);
      setLoading(false);
      setError(null);
      return undefined;
    }

    const unsubscribe = subscribeLearningRecords((nextSnapshot) => {
      if (nextSnapshot.userKey !== session.session?.user?.id) {
        return;
      }
      applyLearningSnapshot(nextSnapshot);
    });
    applyLearningSnapshot();
    return unsubscribe;
  }, [applyLearningSnapshot, session.session, session.status]);

  useEffect(() => {
    void loadLearningRecords(false);
  }, [loadLearningRecords]);

  useFocusEffect(
    useCallback(() => {
      if (
        session.isHydrating ||
        session.status !== 'authenticated' ||
        !session.session
      ) {
        return undefined;
      }

      const cached = getCachedLearningRecords(session.session);
      if (cached.error || isLearningRecordsCacheStale(session.session)) {
        void loadLearningRecords(Boolean(cached.error));
      }
      return undefined;
    }, [
      loadLearningRecords,
      session.isHydrating,
      session.session,
      session.status,
    ]),
  );

  const snapshot = useMemo<LibraryDashboardSnapshot>(() => {
    const completedEpisodeIds = records
      .filter((record) => record.status === 'mastered')
      .map((record) => record.episode.id);
    const dateKey = getDateKey();
    const recommendedPool = stableDailyPick(episodes, dateKey, completedEpisodeIds, 3);
    const [recommendedEpisode] = recommendedPool;
    const recommendationFallback = fallbackRecommendations(
      episodes,
      recommendedPool.map((episode) => episode.id),
      2,
    );
    const recommendationList = [
      ...recommendedPool.filter((episode) => episode.id !== recommendedEpisode?.id).slice(0, 2),
      ...recommendationFallback,
    ]
      .filter(
        (episode, index, source) =>
          Boolean(episode) &&
          episode.id !== recommendedEpisode?.id &&
          source.findIndex((item) => item.id === episode.id) === index,
      )
      .slice(0, 2);

    const overview = buildLearningOverview(
      records,
      totalEpisodes,
      recommendedEpisode?.difficulty ?? null,
    );

    return {
      recommendedEpisode: recommendedEpisode ?? fallbackRecommendations(episodes, [], 1)[0] ?? null,
      recommendationList,
      overview,
      completedEpisodeIds,
    };
  }, [episodes, records, totalEpisodes]);

  return { records, loading, error, snapshot };
}
