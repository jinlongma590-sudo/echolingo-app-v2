import { useCallback, useEffect, useMemo, useState } from 'react';

import { SCENARIOS } from '@/data/scenarios';
import type { DailyGoalSource } from '@/hooks/useDailyGoalTracker';
import { useLibraryData } from '@/hooks/useLibraryData';
import { useVocabularyTodayPlanData } from '@/hooks/useVocabularyTodayPlanData';
import { fetchUserLearningActivity, fetchUserLearningRecords, type LearningActivity, type LearningRecord } from '@/services/api/learning';
import { fetchSpeakingHistory, type SpeakingSession } from '@/services/api/speakingSessions';
import { fetchVocabularyProgressActivity, type ProgressActivity } from '@/services/api/vocabulary';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import type { HomeDashboard, HomeRecentLearningItem } from '@/types/homeDashboard';
import {
  buildDailyRecommendationPool,
  buildLastNDates,
  buildRecentStudyText,
  buildRecommendationItems,
  buildStreakDays,
  buildWeeklyLabel,
  buildWeeklySeries,
  formatIssueLabel,
  getDateKey,
  parseDateKey,
  rotateRecommendationItems,
} from '@/utils/homeDashboard';

type UseHomeDashboardOptions = {
  localGoalMinutes: number;
  localGoalLoaded: boolean;
  localGoalSource: DailyGoalSource;
};

type UseHomeDashboardResult = {
  dashboard: HomeDashboard;
  rotateRecommendations: () => void;
  refreshHomeRecommendations: (reason: string) => Promise<boolean>;
};

const DEFAULT_HOME_TARGET_MINUTES = 20;
const HOME_RECOMMENDATION_STALE_MS = 60_000;
const HOME_RECOMMENDATION_REFRESH_THROTTLE_MS = 30_000;

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function isValidGoalMinutes(value: number) {
  return Number.isFinite(value) && value > 0;
}

function scenarioNameForId(scenarioId: string) {
  return SCENARIOS.find((item) => item.id === scenarioId)?.name ?? scenarioId;
}

function sortByOccurredAtDescending<T extends { occurredAt: string | null }>(items: T[]) {
  return [...items].sort(
    (left, right) =>
      new Date(right.occurredAt ?? 0).getTime() - new Date(left.occurredAt ?? 0).getTime(),
  );
}

function listeningStatusLabel(status: LearningRecord['status']) {
  if (status === 'mastered') return '已完成';
  if (status === 'learning' || status === 'reviewed') return '学习中';
  return '最近学习';
}

function speakingStatusLabel(status: SpeakingSession['status']) {
  if (status === 'completed') return '已完成';
  if (status === 'active') return '学习中';
  return '最近学习';
}

function vocabularyStatusLabel(status: ProgressActivity['status']) {
  if (status === 'mastered') return '已完成';
  if (status === 'due' || status === 'mistake') return '学习中';
  return '最近学习';
}

function buildListeningRecentItems(records: LearningRecord[]): HomeRecentLearningItem[] {
  return sortByOccurredAtDescending(
    records.map((record) => ({
      id: `listening:${record.episode.id}`,
      type: 'listening' as const,
      title: record.episode.title,
      subtitle: `${record.episode.duration} · ${buildRecentStudyText(record.lastReviewedAt)}`,
      imageUrl: record.episode.cover ?? null,
      statusLabel: listeningStatusLabel(record.status),
      href: record.lastSentenceId
        ? `/episode/${record.episode.id}?sentence=${record.lastSentenceId}`
        : `/episode/${record.episode.id}`,
      occurredAt: record.lastReviewedAt,
    })),
  );
}

function buildSpeakingRecentItems(records: SpeakingSession[]): HomeRecentLearningItem[] {
  return sortByOccurredAtDescending(
    records.map((record) => ({
      id: `speaking:${record.id}`,
      type: 'speaking' as const,
      title: scenarioNameForId(record.scenario_id),
      subtitle: buildRecentStudyText(record.started_at),
      imageUrl: null,
      statusLabel: speakingStatusLabel(record.status),
      href: `/speaking/history-detail/${record.id}`,
      occurredAt: record.started_at,
    })),
  );
}

function buildVocabularyRecentItems(
  activities: ProgressActivity[],
  recommendedHref: string | null,
): HomeRecentLearningItem[] {
  const latestByBook = new Map<string, ProgressActivity>();

  activities.forEach((activity) => {
    const occurredAt = activity.lastReviewedAt ?? activity.createdAt;
    const current = latestByBook.get(activity.bookSlug);
    if (!current) {
      latestByBook.set(activity.bookSlug, activity);
      return;
    }
    const currentAt = current.lastReviewedAt ?? current.createdAt;
    if (new Date(occurredAt ?? 0).getTime() > new Date(currentAt ?? 0).getTime()) {
      latestByBook.set(activity.bookSlug, activity);
    }
  });

  return sortByOccurredAtDescending(
    Array.from(latestByBook.values()).map((activity) => {
      const occurredAt = activity.lastReviewedAt ?? activity.createdAt;
      return {
        id: `vocabulary:${activity.bookSlug || activity.wordId}`,
        type: 'vocabulary' as const,
        title: activity.bookTitle || '单词学习',
        subtitle: buildRecentStudyText(occurredAt),
        imageUrl: null,
        statusLabel: vocabularyStatusLabel(activity.status),
        href: recommendedHref ?? '/words',
        occurredAt,
      };
    }),
  );
}

function buildVocabularyTouchKeys(activities: ProgressActivity[]) {
  const touchKeys = new Set<string>();
  const dayKeys = new Set<string>();

  activities.forEach((activity) => {
    const createdDay = parseDateKey(activity.createdAt);
    const reviewedDay = parseDateKey(activity.lastReviewedAt);
    if (createdDay) {
      touchKeys.add(`${createdDay}:${activity.wordId}`);
      dayKeys.add(createdDay);
    }
    if (reviewedDay) {
      touchKeys.add(`${reviewedDay}:${activity.wordId}`);
      dayKeys.add(reviewedDay);
    }
  });

  return { touchKeys: Array.from(touchKeys), dayKeys: Array.from(dayKeys) };
}

function buildListeningTouchKeys(activities: LearningActivity[]) {
  const touchKeys = new Set<string>();
  const dayKeys = new Set<string>();

  activities.forEach((activity) => {
    const day = parseDateKey(activity.lastReviewedAt);
    if (!day) return;
    touchKeys.add(`${day}:${activity.episodeId}:${activity.sentenceId ?? 'root'}`);
    dayKeys.add(day);
  });

  return { touchKeys: Array.from(touchKeys), dayKeys: Array.from(dayKeys) };
}

function buildSpeakingTouchKeys(records: SpeakingSession[]) {
  const touchKeys = new Set<string>();
  const dayKeys = new Set<string>();

  records.forEach((record) => {
    const day = parseDateKey(record.started_at);
    if (!day) return;
    touchKeys.add(`${day}:${record.id}`);
    dayKeys.add(day);
  });

  return { touchKeys: Array.from(touchKeys), dayKeys: Array.from(dayKeys) };
}

export function useHomeDashboard(options: UseHomeDashboardOptions): UseHomeDashboardResult {
  const session = useAppSession();
  const {
    episodes,
    totalEpisodes,
    loading: libraryLoading,
    error: libraryError,
    lastSuccessAt: libraryLastSuccessAt,
    lastErrorAt: libraryLastErrorAt,
    lastRequestAt: libraryLastRequestAt,
    isEmptyResult: libraryIsEmptyResult,
    refresh: refreshLibrary,
  } = useLibraryData({ consumer: 'home' });
  const { plan: todayPlan, loading: vocabularyPlanLoading, error: vocabularyPlanError } =
    useVocabularyTodayPlanData();
  const [recommendationOffset, setRecommendationOffset] = useState(0);
  const [learningRecords, setLearningRecords] = useState<LearningRecord[]>([]);
  const [learningActivities, setLearningActivities] = useState<LearningActivity[]>([]);
  const [speakingRecords, setSpeakingRecords] = useState<SpeakingSession[]>([]);
  const [vocabularyActivities, setVocabularyActivities] = useState<ProgressActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (session.status !== 'authenticated' || !session.session) {
      setLearningRecords([]);
      setLearningActivities([]);
      setSpeakingRecords([]);
      setVocabularyActivities([]);
      setActivityLoading(false);
      setActivityError(null);
      return () => {
        cancelled = true;
      };
    }

    async function load() {
      setActivityLoading(true);
      setActivityError(null);
      const [recordsResult, activityResult, speakingResult, vocabularyResult] = await Promise.allSettled([
        fetchUserLearningRecords(session.session!),
        fetchUserLearningActivity(session.session!),
        fetchSpeakingHistory(session.session!),
        fetchVocabularyProgressActivity(session.session!),
      ]);

      if (cancelled) return;

      if (recordsResult.status === 'fulfilled') {
        setLearningRecords(recordsResult.value);
      } else {
        setLearningRecords([]);
      }

      if (activityResult.status === 'fulfilled') {
        setLearningActivities(activityResult.value);
      } else {
        setLearningActivities([]);
      }

      if (speakingResult.status === 'fulfilled') {
        setSpeakingRecords(speakingResult.value);
      } else {
        setSpeakingRecords([]);
      }

      if (vocabularyResult.status === 'fulfilled') {
        setVocabularyActivities(vocabularyResult.value);
      } else {
        setVocabularyActivities([]);
      }

      const errors = [recordsResult, activityResult, speakingResult, vocabularyResult]
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => (result.reason instanceof Error ? result.reason.message : String(result.reason ?? '')))
        .filter(Boolean);

      setActivityError(errors[0] ?? null);
      setActivityLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [session.session, session.status]);

  const dashboard = useMemo<HomeDashboard>(() => {
    const cloudTargetMinutes = todayPlan?.plan.dailyMinutesTarget ?? 0;
    const hasLocalGoalMinutes = isValidGoalMinutes(options.localGoalMinutes);
    const hasCloudGoalMinutes = isValidGoalMinutes(cloudTargetMinutes);
    const targetMinutes = hasLocalGoalMinutes
      ? Math.round(options.localGoalMinutes)
      : hasCloudGoalMinutes
        ? Math.round(cloudTargetMinutes)
        : DEFAULT_HOME_TARGET_MINUTES;
    const goalSource =
      hasLocalGoalMinutes
        ? options.localGoalSource
        : hasCloudGoalMinutes
          ? 'cloud'
          : 'localDefault';
    const todaySummary = todayPlan?.summary.today;
    const vocabularyCount =
      (todaySummary?.todayNewCompleted ?? 0) +
      (todaySummary?.todayReviewCompleted ?? 0) +
      (todaySummary?.todayMistakeCompleted ?? 0);
    const todayKey = getDateKey();
    const listeningCount = learningRecords.filter((record) => parseDateKey(record.lastReviewedAt) === todayKey).length;
    const speakingTodaySessions = speakingRecords.filter((record) => parseDateKey(record.started_at) === todayKey);
    const speakingCount = speakingTodaySessions.length;
    const totalUnits = listeningCount + vocabularyCount + speakingCount;
    const targetUnits =
      (todaySummary?.todayNewPlanned ?? 0) +
      (todaySummary?.todayReviewPlanned ?? 0) +
      (todaySummary?.todayMistakePlanned ?? 0);
    const progressRatio = targetUnits > 0 ? clamp(totalUnits / targetUnits) : 0;

    const listeningTouches = buildListeningTouchKeys(learningActivities);
    const vocabularyTouches = buildVocabularyTouchKeys(vocabularyActivities);
    const speakingTouches = buildSpeakingTouchKeys(speakingRecords);
    const weeklySeries = buildWeeklySeries({
      listeningKeys: listeningTouches.touchKeys,
      vocabularyKeys: vocabularyTouches.touchKeys,
      speakingKeys: speakingTouches.touchKeys,
    });
    const activeDays = weeklySeries.current.filter((item) => item.total > 0).length;
    const previousActiveDays = weeklySeries.previous.filter((item) => item.total > 0).length;
    const streakDays = buildStreakDays([
      ...listeningTouches.dayKeys,
      ...vocabularyTouches.dayKeys,
      ...speakingTouches.dayKeys,
    ]);

    const recommendedWordHref = todaySummary?.recommendedPrimaryHref ?? '/words';
    const recentLearning = sortByOccurredAtDescending([
      ...buildListeningRecentItems(learningRecords).slice(0, 2),
      ...buildVocabularyRecentItems(vocabularyActivities, recommendedWordHref).slice(0, 1),
      ...buildSpeakingRecentItems(speakingRecords).slice(0, 1),
    ]).slice(0, 3);

    const completedEpisodeIds = learningRecords
      .filter((record) => record.status === 'mastered')
      .map((record) => record.episode.id);
    const recentListeningEpisodeIds = recentLearning
      .filter((item) => item.type === 'listening')
      .map((item) => item.id.replace('listening:', ''));

    const recommendationPool = buildRecommendationItems(
      buildDailyRecommendationPool(episodes, todayKey, completedEpisodeIds, recentListeningEpisodeIds),
    );
    const recommendations = rotateRecommendationItems(recommendationPool, recommendationOffset, 3);

    const helperText =
      targetMinutes > 0
        ? `完成 ${targetMinutes} 分钟学习`
        : '今日目标待设置';

    return {
      loading:
        libraryLoading ||
        vocabularyPlanLoading ||
        activityLoading ||
        !options.localGoalLoaded,
      error: libraryError || vocabularyPlanError || activityError,
      goal: {
        targetMinutes,
        targetUnits,
        source: goalSource,
        completedUnits: totalUnits,
        progressRatio,
        label: targetMinutes > 0 ? '完成每日学习目标' : '今日目标待设置',
        progressLabel: targetMinutes > 0 ? `${totalUnits} / ${targetMinutes} 分钟` : '0 / 未设置',
        helperText,
      },
      todayProgress: {
        totalUnits,
        targetUnits,
        progressRatio,
        targetMinutes,
        listeningCount,
        vocabularyCount,
        speakingCount: session.status === 'authenticated' ? speakingCount : null,
        speakingAvailable: session.status === 'authenticated' && !activityLoading,
        detailHref: '/my/learning',
      },
      weekly: {
        activeDays,
        previousActiveDays,
        series: weeklySeries.current,
        label: buildWeeklyLabel(activeDays, previousActiveDays),
      },
      streak: {
        days: streakDays,
        source: 'aggregatedLearningRecords',
      },
      recentLearning,
      recommendations,
      recommendationPoolSize: recommendationPool.length,
      recommendationLoading: libraryLoading,
      recommendationEmptyConfirmed:
        !libraryLoading && !libraryError && libraryIsEmptyResult && recommendationPool.length === 0,
    };
  }, [
    activityError,
    activityLoading,
    episodes,
    learningActivities,
    learningRecords,
    libraryError,
    libraryIsEmptyResult,
    libraryLoading,
    options.localGoalLoaded,
    options.localGoalMinutes,
    options.localGoalSource,
    recommendationOffset,
    session.status,
    speakingRecords,
    todayPlan,
    vocabularyActivities,
    vocabularyPlanError,
    vocabularyPlanLoading,
  ]);

  useEffect(() => {
    setRecommendationOffset(0);
  }, [dashboard.recommendationPoolSize]);

  const refreshHomeRecommendations = useCallback(async (reason: string) => {
    const now = Date.now();
    const hasRecommendations = episodes.length > 0;
    const isStale = !libraryLastSuccessAt || now - libraryLastSuccessAt > HOME_RECOMMENDATION_STALE_MS;
    const shouldRefresh =
      !hasRecommendations ||
      Boolean(libraryError) ||
      Boolean(libraryLastErrorAt) ||
      libraryIsEmptyResult ||
      isStale;
    const canThrottle = hasRecommendations && !libraryError && !libraryLastErrorAt && !libraryIsEmptyResult;
    const throttled =
      canThrottle &&
      Boolean(libraryLastRequestAt) &&
      now - (libraryLastRequestAt ?? 0) < HOME_RECOMMENDATION_REFRESH_THROTTLE_MS;

    if (!shouldRefresh || throttled) {
      if (__DEV__) {
        console.debug('home_recommendations_refresh_skipped', {
          reason,
          source: !shouldRefresh ? 'fresh' : 'throttled',
          count: episodes.length,
          elapsedMs: libraryLastRequestAt ? now - libraryLastRequestAt : null,
        });
      }
      return false;
    }

    await refreshLibrary({ reason });
    return true;
  }, [
    episodes.length,
    libraryError,
    libraryIsEmptyResult,
    libraryLastErrorAt,
    libraryLastRequestAt,
    libraryLastSuccessAt,
    refreshLibrary,
  ]);

  return {
    dashboard,
    rotateRecommendations: () => {
      if (dashboard.recommendationPoolSize <= 1) return;
      setRecommendationOffset((current) => (current + 1) % dashboard.recommendationPoolSize);
    },
    refreshHomeRecommendations,
  };
}
