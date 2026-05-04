import type { LearningRecord } from '@/services/api/learning';
import type { EpisodeStub } from '@/types/echolingo';

export type LibrarySortMode = 'latest' | 'duration' | 'difficulty';
export type LibraryViewMode = 'grid' | 'list';
export type LibraryTrendDirection = 'up' | 'flat' | 'down';

export type LibraryLearningOverview = {
  completedCount: number;
  inProgressCount: number;
  cumulativeEpisodes: number;
  totalReviewedSentences: number;
  totalReviewCount: number;
  episodesTouchedToday: number;
  activeDaysLast7: number;
  activeDaysPrevious7: number;
  completionRatio: number;
  weeklySeries: number[];
  trend: LibraryTrendDirection;
  learningStateLabel: string;
  currentDifficulty: string | null;
  currentDifficultyLabel: '最近学习难度' | '推荐难度';
  lastLearningRecord: LearningRecord | null;
  lastProgressRatio: number | null;
};

export type LibraryDashboardSnapshot = {
  recommendedEpisode: EpisodeStub | null;
  recommendationList: EpisodeStub[];
  overview: LibraryLearningOverview;
  completedEpisodeIds: string[];
};
