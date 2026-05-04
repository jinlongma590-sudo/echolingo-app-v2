import type { EpisodeStub } from '@/types/echolingo';
import type { HomeDashboardSeriesPoint, HomeRecommendationItem } from '@/types/homeDashboard';

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateKey(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return getDateKey(date);
}

export function formatIssueLabel(episode?: Pick<EpisodeStub, 'display_issue_number' | 'issue_number'> | null) {
  const issue = episode?.display_issue_number ?? episode?.issue_number ?? null;
  if (!issue) return '精选单集';
  return `第 ${String(issue).padStart(2, '0')} 期`;
}

export function formatShortDateTime(value?: string | null) {
  if (!value) return '刚刚学习';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚学习';

  const now = new Date();
  const sameDay =
    now.getFullYear() === date.getFullYear() &&
    now.getMonth() === date.getMonth() &&
    now.getDate() === date.getDate();
  const timeText = `${`${date.getHours()}`.padStart(2, '0')}:${`${date.getMinutes()}`.padStart(2, '0')}`;
  if (sameDay) return `今天 ${timeText}`;
  return `${date.getMonth() + 1}/${date.getDate()} ${timeText}`;
}

export function buildRecentStudyText(value?: string | null) {
  return `最近学习 ${formatShortDateTime(value)}`;
}

export function buildDailyRecommendationPool(
  episodes: EpisodeStub[],
  dateKey: string,
  completedIds: Iterable<string>,
  recentEpisodeIds: Iterable<string>,
) {
  const completedSet = new Set(completedIds);
  const recentSet = new Set(recentEpisodeIds);

  const sortByHash = (items: EpisodeStub[]) =>
    [...items].sort((left, right) => {
      const leftHash = hashString(`${dateKey}:${left.id}`);
      const rightHash = hashString(`${dateKey}:${right.id}`);
      if (leftHash !== rightHash) return leftHash - rightHash;
      return left.id.localeCompare(right.id);
    });

  const primary = episodes.filter((episode) => !completedSet.has(episode.id) && !recentSet.has(episode.id));
  const secondary = episodes.filter((episode) => !recentSet.has(episode.id));
  const fallback = episodes;

  const ordered = [...sortByHash(primary), ...sortByHash(secondary), ...sortByHash(fallback)];
  return ordered.filter(
    (episode, index, source) => source.findIndex((item) => item.id === episode.id) === index,
  );
}

export function buildRecommendationItems(
  episodes: EpisodeStub[],
): HomeRecommendationItem[] {
  return episodes.map((episode) => ({
    id: episode.id,
    title: episode.title,
    subtitle: `${formatIssueLabel(episode)} · ${episode.duration}`,
    imageUrl: episode.cover ?? null,
    durationLabel: episode.duration,
    difficulty: episode.difficulty ?? null,
    tags: (episode.tags ?? []).slice(0, 3),
    href: `/episode/${episode.id}`,
  }));
}

export function rotateRecommendationItems(
  items: HomeRecommendationItem[],
  offset: number,
  count: number,
) {
  if (items.length === 0) return [];
  return Array.from({ length: Math.min(count, items.length) }, (_, index) => {
    const item = items[(offset + index) % items.length];
    return item;
  }).filter((item): item is HomeRecommendationItem => Boolean(item));
}

export function buildLastNDates(days: number, date = new Date()) {
  return Array.from({ length: days }, (_, index) => {
    const cursor = new Date(date);
    cursor.setHours(0, 0, 0, 0);
    cursor.setDate(cursor.getDate() - (days - 1 - index));
    return getDateKey(cursor);
  });
}

export function buildWeeklySeries(params: {
  listeningKeys: string[];
  vocabularyKeys: string[];
  speakingKeys: string[];
  date?: Date;
}) {
  const listeningMap = new Map<string, number>();
  const vocabularyMap = new Map<string, number>();
  const speakingMap = new Map<string, number>();

  params.listeningKeys.forEach((key) => {
    listeningMap.set(key, (listeningMap.get(key) ?? 0) + 1);
  });
  params.vocabularyKeys.forEach((key) => {
    vocabularyMap.set(key, (vocabularyMap.get(key) ?? 0) + 1);
  });
  params.speakingKeys.forEach((key) => {
    speakingMap.set(key, (speakingMap.get(key) ?? 0) + 1);
  });

  const currentKeys = buildLastNDates(7, params.date);
  const previousKeys = buildLastNDates(14, params.date).slice(0, 7);

  const toPoint = (dateKey: string): HomeDashboardSeriesPoint => {
    const listening = listeningMap.get(dateKey) ?? 0;
    const vocabulary = vocabularyMap.get(dateKey) ?? 0;
    const speaking = speakingMap.get(dateKey) ?? 0;
    return {
      date: dateKey,
      total: listening + vocabulary + speaking,
      listening,
      vocabulary,
      speaking,
    };
  };

  return {
    current: currentKeys.map(toPoint),
    previous: previousKeys.map(toPoint),
  };
}

export function buildWeeklyLabel(activeDays: number, previousActiveDays: number) {
  if (activeDays > previousActiveDays) {
    return `最近 7 天活跃 ${activeDays} 天，比前 7 天多 ${activeDays - previousActiveDays} 天`;
  }
  if (activeDays < previousActiveDays) {
    return `最近 7 天活跃 ${activeDays} 天，比前 7 天少 ${previousActiveDays - activeDays} 天`;
  }
  return `最近 7 天活跃 ${activeDays} 天，与前 7 天持平`;
}

export function buildStreakDays(dayKeys: Iterable<string>, date = new Date()) {
  const set = new Set(dayKeys);
  let streak = 0;

  for (let offset = 0; offset < 366; offset += 1) {
    const cursor = new Date(date);
    cursor.setHours(0, 0, 0, 0);
    cursor.setDate(cursor.getDate() - offset);
    const key = getDateKey(cursor);
    if (set.has(key)) {
      streak += 1;
      continue;
    }
    break;
  }

  return streak;
}
