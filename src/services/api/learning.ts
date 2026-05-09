import {
  fetchEpisodesByIds,
  fetchSentencesByEpisodeIds,
  type EpisodeLookup,
} from '@/services/api/contentLookup';
import { env } from '@/lib/env';
import { buildRestTableUrl, supabaseFetchJson } from '@/services/supabase/rest';
import type { StoredSession } from '@/types/auth';

export type LearningStatus = 'new' | 'learning' | 'reviewed' | 'mastered';

type LearningProgressRow = {
  episode_id: string;
  sentence_id: number | null;
  status: LearningStatus;
  last_reviewed_at: string | null;
  review_count: number | null;
};

export interface LearningActivity {
  episodeId: string;
  sentenceId: number | null;
  status: LearningStatus;
  lastReviewedAt: string | null;
  reviewCount: number;
}

export interface LearningRecord {
  episode: EpisodeLookup;
  status: LearningStatus;
  lastReviewedAt: string | null;
  lastSentenceId: number | null;
  reviewedSentences: number;
  totalSentences: number;
  reviewCount: number;
}

export interface UserLearningRecordsBundle {
  records: LearningRecord[];
  activities: LearningActivity[];
}

export interface UpsertLearningProgressInput {
  episodeId: string;
  sentenceId: number;
  status: Exclude<LearningStatus, 'new'>;
  incrementReviewCount?: boolean;
}

function statusRank(status: LearningStatus) {
  switch (status) {
    case 'mastered':
      return 4;
    case 'reviewed':
      return 3;
    case 'learning':
      return 2;
    default:
      return 1;
  }
}

async function fetchLearningProgressRows(session: StoredSession): Promise<LearningProgressRow[]> {
  const userId = session.user?.id;
  if (!userId) {
    throw new Error('未登录');
  }

  return supabaseFetchJson<LearningProgressRow[]>(
    `/rest/v1/learning_progress?select=episode_id,sentence_id,status,last_reviewed_at,review_count&user_id=eq.${userId}&order=last_reviewed_at.desc.nullslast&limit=500`,
    undefined,
    session.accessToken,
  );
}

export async function upsertLearningProgress(
  session: StoredSession,
  input: UpsertLearningProgressInput,
): Promise<void> {
  const userId = session.user?.id;
  if (!userId) {
    throw new Error('未登录');
  }

  const now = new Date().toISOString();
  const lookupUrl = buildRestTableUrl('learning_progress', {
    select: 'id,review_count,status',
    user_id: `eq.${userId}`,
    episode_id: `eq.${input.episodeId}`,
    sentence_id: `eq.${input.sentenceId}`,
    limit: '1',
  });

  const existingRows = await fetch(lookupUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${session.accessToken}`,
    },
  });

  if (!existingRows.ok) {
    const text = await existingRows.text();
    throw new Error(text || '读取学习进度失败');
  }

  const existing = ((await existingRows.json()) as Array<{
    id: number;
    review_count: number | null;
    status: LearningStatus;
  }>)[0];

  const nextStatus: Exclude<LearningStatus, 'new'> =
    input.status === 'learning' && existing && (existing.status === 'reviewed' || existing.status === 'mastered')
      ? existing.status
      : input.status;

  const nextReviewCount = input.incrementReviewCount
    ? Math.max(existing?.review_count ?? 0, 0) + 1
    : Math.max(existing?.review_count ?? 0, 0);

  const payload = {
    user_id: userId,
    episode_id: input.episodeId,
    sentence_id: input.sentenceId,
    status: nextStatus,
    last_reviewed_at: nextStatus === 'reviewed' || nextStatus === 'mastered' ? now : null,
    review_count: nextReviewCount,
    updated_at: now,
  };

  const response = await fetch(buildRestTableUrl('learning_progress'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || '写入学习进度失败');
  }
}

function buildLearningActivities(rows: LearningProgressRow[]): LearningActivity[] {
  return rows.map((row) => ({
    episodeId: row.episode_id,
    sentenceId: row.sentence_id ?? null,
    status: row.status,
    lastReviewedAt: row.last_reviewed_at,
    reviewCount: row.review_count ?? 0,
  }));
}

async function buildLearningRecordsFromRows(
  session: StoredSession,
  rows: LearningProgressRow[],
): Promise<LearningRecord[]> {
  if (rows.length === 0) {
    return [];
  }

  const episodeIds = Array.from(new Set(rows.map((row) => row.episode_id).filter(Boolean)));
  const [episodes, sentences] = await Promise.all([
    fetchEpisodesByIds(session.accessToken, episodeIds),
    fetchSentencesByEpisodeIds(session.accessToken, episodeIds),
  ]);

  const totalSentenceMap = new Map<string, number>();
  sentences.forEach((sentence) => {
    totalSentenceMap.set(sentence.episode_id, (totalSentenceMap.get(sentence.episode_id) ?? 0) + 1);
  });

  const grouped = new Map<
    string,
    {
      latestAt: string | null;
      latestSentenceId: number | null;
      latestStatus: LearningStatus;
      maxStatus: LearningStatus;
      reviewedSentenceIds: Set<number>;
      reviewCount: number;
    }
  >();

  rows.forEach((row) => {
    const current = grouped.get(row.episode_id) ?? {
      latestAt: null,
      latestSentenceId: null,
      latestStatus: 'new' as LearningStatus,
      maxStatus: 'new' as LearningStatus,
      reviewedSentenceIds: new Set<number>(),
      reviewCount: 0,
    };

    if (!current.latestAt || (row.last_reviewed_at && new Date(row.last_reviewed_at).getTime() > new Date(current.latestAt).getTime())) {
      current.latestAt = row.last_reviewed_at;
      current.latestSentenceId = row.sentence_id ?? null;
      current.latestStatus = row.status;
    }

    if (statusRank(row.status) > statusRank(current.maxStatus)) {
      current.maxStatus = row.status;
    }

    if ((row.status === 'reviewed' || row.status === 'mastered') && row.sentence_id) {
      current.reviewedSentenceIds.add(row.sentence_id);
    }

    current.reviewCount += row.review_count ?? 0;
    grouped.set(row.episode_id, current);
  });

  return Array.from(grouped.entries())
    .map(([episodeId, item]) => {
      const episode = episodes.get(episodeId);
      if (!episode) {
        return null;
      }

      const totalSentences = totalSentenceMap.get(episodeId) ?? 0;
      const reviewedSentences = item.reviewedSentenceIds.size;
      let status: LearningStatus = item.maxStatus;
      if (totalSentences > 0 && reviewedSentences >= totalSentences) {
        status = 'mastered';
      } else if (reviewedSentences > 0 && status === 'learning') {
        status = 'reviewed';
      }

      return {
        episode,
        status,
        lastReviewedAt: item.latestAt,
        lastSentenceId: item.latestSentenceId,
        reviewedSentences,
        totalSentences,
        reviewCount: item.reviewCount,
      };
    })
    .filter((item): item is LearningRecord => item !== null)
    .sort((a, b) => new Date(b.lastReviewedAt ?? 0).getTime() - new Date(a.lastReviewedAt ?? 0).getTime());
}

export async function fetchUserLearningActivity(session: StoredSession): Promise<LearningActivity[]> {
  const rows = await fetchLearningProgressRows(session);
  return buildLearningActivities(rows);
}

export async function fetchUserLearningRecords(session: StoredSession): Promise<LearningRecord[]> {
  const rows = await fetchLearningProgressRows(session);
  return buildLearningRecordsFromRows(session, rows);
}

export async function fetchUserLearningRecordsBundle(
  session: StoredSession,
): Promise<UserLearningRecordsBundle> {
  const rows = await fetchLearningProgressRows(session);
  return {
    records: await buildLearningRecordsFromRows(session, rows),
    activities: buildLearningActivities(rows),
  };
}
