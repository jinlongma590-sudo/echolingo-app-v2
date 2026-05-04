export type HomeGoalSource = 'cloud' | 'localDefault' | 'localUser';

export type HomeDashboardSeriesPoint = {
  date: string;
  total: number;
  listening: number;
  vocabulary: number;
  speaking: number;
};

export type HomeRecentLearningItem = {
  id: string;
  type: 'listening' | 'vocabulary' | 'speaking';
  title: string;
  subtitle: string;
  imageUrl?: string | null;
  statusLabel: string;
  href: string;
  occurredAt: string | null;
};

export type HomeRecommendationItem = {
  id: string;
  title: string;
  subtitle: string;
  imageUrl?: string | null;
  durationLabel?: string;
  difficulty?: string | null;
  tags: string[];
  href: string;
};

export type HomeDashboard = {
  loading: boolean;
  error: string | null;
  goal: {
    targetMinutes: number;
    targetUnits: number;
    source: HomeGoalSource;
    completedUnits: number;
    progressRatio: number;
    label: string;
    progressLabel: string;
    helperText: string;
  };
  todayProgress: {
    totalUnits: number;
    targetUnits: number;
    progressRatio: number;
    targetMinutes: number;
    listeningCount: number;
    vocabularyCount: number;
    speakingCount: number | null;
    speakingAvailable: boolean;
    detailHref: string;
  };
  weekly: {
    activeDays: number;
    previousActiveDays: number;
    series: HomeDashboardSeriesPoint[];
    label: string;
  };
  streak: {
    days: number;
    source: 'aggregatedLearningRecords';
  };
  recentLearning: HomeRecentLearningItem[];
  recommendations: HomeRecommendationItem[];
  recommendationPoolSize: number;
  recommendationLoading: boolean;
  recommendationEmptyConfirmed: boolean;
};
