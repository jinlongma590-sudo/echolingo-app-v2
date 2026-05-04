import type { StoredSession } from '@/types/auth';
import { supabaseFetchJson } from '@/services/supabase/rest';
import { SpeakingApiError } from '@/services/api/speakingPractice';

export interface SpeakingSession {
  id: string;
  user_id: string;
  scenario_id: string;
  mode: 'scenario' | 'free_chat';
  status: 'active' | 'completed' | 'aborted';
  turn_count: number;
  consumed_credits: number;
  started_at: string;
  ended_at: string | null;
  score_json: {
    fluency?: number;
    accuracy?: number;
    vocabulary?: number;
    overall?: number;
    suggestion?: string;
  } | null;
  transcript_json?: unknown[] | null;
}

function extractSpeakingSupabaseErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const trimmed = raw.trim();
  if (!trimmed) return '';

  try {
    const payload = JSON.parse(trimmed) as { code?: string; error?: string; message?: string };
    return [payload.code, payload.error, payload.message].filter(Boolean).join(' ');
  } catch {
    return trimmed;
  }
}

function normalizeSpeakingSessionError(error: unknown): never {
  const message = extractSpeakingSupabaseErrorMessage(error);
  const normalized = message.toLowerCase();

  if (
    normalized.includes('pgrst303') ||
    normalized.includes('jwt expired') ||
    normalized.includes('invalid jwt') ||
    normalized.includes('unauthorized') ||
    normalized.includes('unauthenticated')
  ) {
    throw new SpeakingApiError('unauthorized', '登录状态已失效，请重新登录。', {
      rawMessage: message,
    });
  }

  throw error instanceof Error ? error : new Error(String(error ?? '加载口语记录失败'));
}

export async function fetchSpeakingHistory(
  session: StoredSession,
  options?: { limit?: number; beforeStartedAt?: string; signal?: AbortSignal },
): Promise<SpeakingSession[]> {
  const userId = session.user?.id;
  if (!userId) throw new Error('未登录');

  try {
    const limit = Math.max(1, Math.min(options?.limit ?? 50, 100));
    const beforeFilter = options?.beforeStartedAt
      ? `&started_at=lt.${encodeURIComponent(options.beforeStartedAt)}`
      : '';
    console.log('[SpeakingHistory] speaking_history_fetch_start', JSON.stringify({ limit, hasCursor: Boolean(options?.beforeStartedAt) }));
    const rows = await supabaseFetchJson<SpeakingSession[]>(
      `/rest/v1/ai_practice_sessions?select=id,user_id,scenario_id,mode,status,turn_count,consumed_credits,started_at,ended_at,score_json&user_id=eq.${userId}${beforeFilter}&order=started_at.desc&limit=${limit}`,
      { signal: options?.signal },
      session.accessToken,
    );
    console.log('[SpeakingHistory] speaking_history_fetch_done', JSON.stringify({ count: rows.length, limit }));
    return rows;
  } catch (error) {
    normalizeSpeakingSessionError(error);
  }
}

export async function fetchSpeakingSessionDetail(
  session: StoredSession,
  sessionId: string,
): Promise<SpeakingSession | null> {
  const userId = session.user?.id;
  if (!userId) throw new Error('未登录');

  try {
    const rows = await supabaseFetchJson<SpeakingSession[]>(
      `/rest/v1/ai_practice_sessions?select=id,user_id,scenario_id,mode,status,turn_count,consumed_credits,started_at,ended_at,score_json,transcript_json&id=eq.${encodeURIComponent(
        sessionId,
      )}&user_id=eq.${userId}&limit=1`,
      undefined,
      session.accessToken,
    );

    return rows[0] ?? null;
  } catch (error) {
    normalizeSpeakingSessionError(error);
  }
}
