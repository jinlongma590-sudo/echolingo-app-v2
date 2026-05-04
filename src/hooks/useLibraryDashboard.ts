import { useEffect, useMemo, useState } from 'react';

import { fetchUserLearningRecords, type LearningRecord } from '@/services/api/learning';
import { useAppSession } from '@/services/auth/AppSessionProvider';
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

  useEffect(() => {
    let cancelled = false;

    if (session.status !== 'authenticated' || !session.session) {
      setRecords([]);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const nextRecords = await fetchUserLearningRecords(session.session!);
        if (!cancelled) {
          setRecords(nextRecords);
        }
      } catch (err) {
        if (!cancelled) {
          setRecords([]);
          setError(err instanceof Error ? err.message : '学习记录加载失败');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [session.session, session.status]);

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
