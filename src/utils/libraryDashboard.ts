import type { LearningRecord } from '@/services/api/learning';
import type { LibraryLearningOverview, LibrarySortMode, LibraryTrendDirection } from '@/types/libraryDashboard';
import type { EpisodeStub } from '@/types/echolingo';

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDayKey(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return toDateKey(date);
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeDifficultyScore(level?: string | null) {
  if (level === 'Advanced') return 3;
  if (level === 'Intermediate') return 2;
  if (level === 'Beginner') return 1;
  return 0;
}

function parseDurationMinutes(value?: string | null) {
  if (!value) return 0;
  const safe = value.trim().toLowerCase();
  if (!safe) return 0;

  const hourMatch = safe.match(/(\d+(?:\.\d+)?)\s*h/);
  const minuteMatch = safe.match(/(\d+(?:\.\d+)?)\s*m/);
  if (hourMatch || minuteMatch) {
    const hours = hourMatch ? Number(hourMatch[1]) : 0;
    const minutes = minuteMatch ? Number(minuteMatch[1]) : 0;
    return hours * 60 + minutes;
  }

  const clockMatch = safe.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (clockMatch) {
    const hours = clockMatch[3] ? Number(clockMatch[1]) : 0;
    const minutes = clockMatch[3] ? Number(clockMatch[2]) : Number(clockMatch[1]);
    const seconds = clockMatch[3] ? Number(clockMatch[3]) : Number(clockMatch[2]);
    return hours * 60 + minutes + seconds / 60;
  }

  const numberMatch = safe.match(/(\d+(?:\.\d+)?)/);
  return numberMatch ? Number(numberMatch[1]) : 0;
}

function issueOrderValue(episode: EpisodeStub) {
  return episode.display_issue_number ?? episode.issue_number ?? 0;
}

export function getDateKey(date = new Date()) {
  return toDateKey(date);
}

export function getLastLearningRecord(records: LearningRecord[]) {
  return [...records].sort(
    (left, right) =>
      new Date(right.lastReviewedAt ?? 0).getTime() - new Date(left.lastReviewedAt ?? 0).getTime(),
  )[0] ?? null;
}

export function getEpisodeProgress(record?: LearningRecord | null) {
  if (!record || record.totalSentences <= 0) return null;
  return Math.min(1, Math.max(0, record.reviewedSentences / record.totalSentences));
}

export function buildWeeklySeries(records: LearningRecord[], date = new Date()) {
  const dayCounts = new Map<string, number>();
  records.forEach((record) => {
    const key = parseDayKey(record.lastReviewedAt);
    if (!key) return;
    dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
  });

  return Array.from({ length: 7 }, (_, index) => {
    const cursor = new Date(date);
    cursor.setHours(0, 0, 0, 0);
    cursor.setDate(cursor.getDate() - (6 - index));
    return dayCounts.get(toDateKey(cursor)) ?? 0;
  });
}

export function deriveTrend(current7Days: number, previous7Days: number): LibraryTrendDirection {
  if (current7Days > previous7Days) return 'up';
  if (current7Days < previous7Days) return 'down';
  return 'flat';
}

export function deriveLearningState(overview: Pick<LibraryLearningOverview, 'cumulativeEpisodes' | 'activeDaysLast7' | 'completedCount' | 'inProgressCount'>) {
  if (overview.cumulativeEpisodes === 0) return '尚未开始';
  if (overview.activeDaysLast7 >= 3 || overview.completedCount > 0) return '稳定学习';
  if (overview.inProgressCount > 0) return '正在积累';
  return '正在积累';
}

export function stableDailyPick<T extends { id: string }>(
  episodes: T[],
  dateKey: string,
  excludeIds: Iterable<string> = [],
  count = 1,
) {
  const excludeSet = new Set(excludeIds);
  const primaryPool = episodes.filter((item) => !excludeSet.has(item.id));
  const pool = primaryPool.length > 0 ? primaryPool : episodes;

  return [...pool]
    .sort((left, right) => {
      const leftHash = hashString(`${dateKey}:${left.id}`);
      const rightHash = hashString(`${dateKey}:${right.id}`);
      if (leftHash !== rightHash) return leftHash - rightHash;
      return left.id.localeCompare(right.id);
    })
    .slice(0, count);
}

export function sortEpisodes(episodes: EpisodeStub[], mode: LibrarySortMode) {
  const cloned = [...episodes];
  if (mode === 'duration') {
    return cloned.sort((left, right) => {
      const diff = parseDurationMinutes(right.duration) - parseDurationMinutes(left.duration);
      if (diff !== 0) return diff;
      return issueOrderValue(right) - issueOrderValue(left);
    });
  }

  if (mode === 'difficulty') {
    return cloned.sort((left, right) => {
      const diff = normalizeDifficultyScore(right.difficulty) - normalizeDifficultyScore(left.difficulty);
      if (diff !== 0) return diff;
      return issueOrderValue(right) - issueOrderValue(left);
    });
  }

  return cloned.sort((left, right) => {
    const diff = issueOrderValue(right) - issueOrderValue(left);
    if (diff !== 0) return diff;
    return right.id.localeCompare(left.id);
  });
}

export function buildLearningOverview(
  records: LearningRecord[],
  totalEpisodes: number,
  fallbackDifficulty: string | null,
  date = new Date(),
): LibraryLearningOverview {
  const uniqueEpisodeIds = new Set(records.map((record) => record.episode.id));
  const completedEpisodeIds = new Set(
    records.filter((record) => record.status === 'mastered').map((record) => record.episode.id),
  );
  const inProgressEpisodeIds = new Set(
    records
      .filter(
        (record) =>
          record.status !== 'mastered' &&
          (record.reviewedSentences > 0 || record.lastSentenceId != null),
      )
      .map((record) => record.episode.id),
  );
  const lastLearningRecord = getLastLearningRecord(records);
  const todayKey = getDateKey(date);
  const todayRecords = records.filter((record) => parseDayKey(record.lastReviewedAt) === todayKey);
  const weeklySeries = buildWeeklySeries(records, date);

  const previousSeries = Array.from({ length: 7 }, (_, index) => {
    const cursor = new Date(date);
    cursor.setHours(0, 0, 0, 0);
    cursor.setDate(cursor.getDate() - (13 - index));
    const key = toDateKey(cursor);
    return records.filter((record) => parseDayKey(record.lastReviewedAt) === key).length;
  });

  const activeDaysLast7 = weeklySeries.filter((value) => value > 0).length;
  const activeDaysPrevious7 = previousSeries.filter((value) => value > 0).length;
  const completionRatio = totalEpisodes > 0 ? completedEpisodeIds.size / totalEpisodes : 0;
  const currentDifficulty = lastLearningRecord?.episode.difficulty ?? fallbackDifficulty ?? null;
  const currentDifficultyLabel = lastLearningRecord ? '最近学习难度' : '推荐难度';

  const overview: LibraryLearningOverview = {
    completedCount: completedEpisodeIds.size,
    inProgressCount: inProgressEpisodeIds.size,
    cumulativeEpisodes: uniqueEpisodeIds.size,
    totalReviewedSentences: records.reduce((sum, record) => sum + record.reviewedSentences, 0),
    totalReviewCount: records.reduce((sum, record) => sum + record.reviewCount, 0),
    episodesTouchedToday: todayRecords.length,
    activeDaysLast7,
    activeDaysPrevious7,
    completionRatio,
    weeklySeries,
    trend: deriveTrend(activeDaysLast7, activeDaysPrevious7),
    learningStateLabel: '尚未开始',
    currentDifficulty,
    currentDifficultyLabel,
    lastLearningRecord,
    lastProgressRatio: getEpisodeProgress(lastLearningRecord),
  };

  return {
    ...overview,
    learningStateLabel: deriveLearningState(overview),
  };
}
