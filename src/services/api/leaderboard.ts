import { env } from '@/lib/env';
import type { StoredSession } from '@/types/auth';
import { buildSupabaseUrl } from '@/services/supabase/rest';

export interface MonthlyLeaderboardItem {
  userId: string;
  displayName: string;
  totalSeconds: number;
  rank: number;
  isCurrentUser: boolean;
}

export interface MonthlyLeaderboardSnapshot {
  month: string;
  leaderboard: MonthlyLeaderboardItem[];
  currentUserRank: number | null;
  currentUserSeconds: number;
  winnerSeconds: number;
  totalParticipants: number;
}

type RpcLeaderboardRow = {
  month: string;
  leaderboard: Array<{
    user_id: string;
    display_name: string;
    total_seconds: number;
    rank: number;
    is_current_user: boolean;
  }> | null;
  current_user_rank: number | null;
  current_user_seconds: number | null;
  winner_seconds: number | null;
  total_participants: number | null;
};

type SupabaseErrorPayload = {
  code?: string;
  message?: string;
  hint?: string | null;
  details?: string | null;
};

export class LeaderboardApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'LeaderboardApiError';
    this.status = status;
    this.code = code;
  }
}

function buildMonthDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeDisplayName(raw: string | null | undefined, rank: number) {
  const trimmed = raw?.trim();
  return trimmed || `学习者 ${rank}`;
}

async function parseErrorPayload(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as SupabaseErrorPayload;
  } catch {
    return { message: text };
  }
}

export function isLeaderboardAuthOrPermissionError(error: unknown) {
  if (!(error instanceof LeaderboardApiError)) return false;
  const normalized = `${error.code ?? ''} ${error.message}`.toLowerCase();
  return (
    error.status === 401 ||
    error.status === 403 ||
    normalized.includes('jwt expired') ||
    normalized.includes('pgrst303') ||
    normalized.includes('unauthorized') ||
    normalized.includes('permission denied') ||
    normalized.includes('permission')
  );
}

export async function fetchMonthlyLeaderboard(session?: StoredSession | null): Promise<MonthlyLeaderboardSnapshot> {
  const response = await fetch(buildSupabaseUrl('/rest/v1/rpc/get_monthly_leaderboard'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${session?.accessToken ?? env.supabaseAnonKey}`,
    },
    body: JSON.stringify({
      month_date: buildMonthDate(),
      timezone: 'Asia/Shanghai',
      current_user_uuid: session?.user?.id ?? null,
      limit_count: 5,
    }),
  });

  if (!response.ok) {
    const payload = await parseErrorPayload(response);
    throw new LeaderboardApiError(
      payload?.message ?? '排行榜加载失败',
      response.status,
      payload?.code,
    );
  }

  const rows = (await response.json()) as RpcLeaderboardRow[] | null;
  const result = Array.isArray(rows) ? rows[0] : null;

  if (!result) {
    return {
      month: buildMonthDate().slice(0, 7),
      leaderboard: [],
      currentUserRank: null,
      currentUserSeconds: 0,
      winnerSeconds: 0,
      totalParticipants: 0,
    };
  }

  return {
    month: result.month,
    leaderboard: (result.leaderboard ?? []).map((item) => ({
      userId: item.user_id,
      displayName: normalizeDisplayName(item.display_name, item.rank),
      totalSeconds: item.total_seconds ?? 0,
      rank: item.rank,
      isCurrentUser: Boolean(item.is_current_user),
    })),
    currentUserRank: result.current_user_rank,
    currentUserSeconds: result.current_user_seconds ?? 0,
    winnerSeconds: result.winner_seconds ?? 0,
    totalParticipants: result.total_participants ?? 0,
  };
}
