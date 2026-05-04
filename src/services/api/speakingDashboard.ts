import { env } from '@/lib/env';
import { SpeakingApiError } from '@/services/api/speakingPractice';
import type { StoredSession } from '@/types/auth';
import type { NormalizedSpeakingScoreSource } from '@/utils/speakingDashboard';

export type SpeakingDashboardRecentScore = {
  sessionId: string;
  scenarioId: string | null;
  score: number | null;
  startedAt: string | null;
  scenarioTitle: string | null;
  mode: string;
};

export type SpeakingDashboardLatestSession = {
  sessionId: string;
  scenarioId: string | null;
  status: string | null;
  startedAt: string | null;
  score: number | null;
  mode: string;
};

export type SpeakingDashboardLatestScored = SpeakingDashboardLatestSession & {
  fluency: number | null;
  pronunciation: number | null;
  accuracy: number | null;
  vocabulary: number | null;
  grammar: number | null;
  coherence: number | null;
  logic: number | null;
  suggestion: string | null;
  source: NormalizedSpeakingScoreSource;
};

export type SpeakingDashboardSummary = {
  ok: true;
  credits: number;
  totalSessions: number;
  averageScore: number | null;
  v2ScoredCount: number;
  fallbackScoredCount: number;
  recentScores: SpeakingDashboardRecentScore[];
  latestSessionAt: string | null;
  recentSessions: SpeakingDashboardLatestSession[];
  latestSession: SpeakingDashboardLatestSession | null;
  latestScored: SpeakingDashboardLatestScored | null;
  weeklyPracticeCount: number;
  suggestion: string | null;
};

function buildApiUrl(path: string) {
  return `${env.apiBaseUrl.replace(/\/$/, '')}${path}`;
}

function truncateApiPreview(text: string, maxLength = 180) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function buildDashboardError(status: number, text: string, contentType?: string | null) {
  let parsed: { error?: string; code?: string } | null = null;
  try {
    parsed = JSON.parse(text) as { error?: string; code?: string };
  } catch {
    parsed = null;
  }

  const code =
    parsed?.code ||
    (status === 401
      ? 'unauthorized'
      : status === 403
        ? 'forbidden'
        : status >= 500
          ? 'service_error'
          : 'unknown_error');
  const preview = truncateApiPreview(parsed?.error || text || `HTTP ${status}`);

  return new SpeakingApiError(code, preview || '口语摘要加载失败，请稍后再试。', {
    status,
    rawMessage: preview,
    contentType: contentType ?? undefined,
  });
}

export async function fetchSpeakingDashboardSummary(
  session: StoredSession,
  options?: { signal?: AbortSignal },
) {
  const response = await fetch(buildApiUrl('/api/mobile/speaking/dashboard-summary'), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
    },
    signal: options?.signal,
  });

  if (!response.ok) {
    const contentType = response.headers.get('content-type') ?? response.headers.get('Content-Type');
    const text = await response.text().catch(() => '');
    throw buildDashboardError(response.status, text, contentType);
  }

  const contentType = response.headers.get('content-type') ?? response.headers.get('Content-Type') ?? '';
  if (!/application\/json/i.test(contentType)) {
    const bodyPreview = truncateApiPreview(await response.text().catch(() => ''), 180);
    throw new SpeakingApiError('service_error', '口语摘要返回格式异常，请稍后再试。', {
      status: response.status,
      rawMessage: bodyPreview,
      contentType,
    });
  }

  const data = (await response.json()) as SpeakingDashboardSummary | { ok?: false; error?: string; code?: string };
  if (!data || data.ok !== true) {
    throw new SpeakingApiError(data?.code ?? 'service_error', data?.error ?? '口语摘要加载失败，请稍后再试。');
  }

  return data;
}
