import { env } from '@/lib/env';
import type { SessionUser, StoredSession } from '@/types/auth';
import { buildRestTableUrl, buildSupabaseUrl, supabaseCount, supabaseFetchJson } from '@/services/supabase/rest';

export interface AccountSummary {
  user: SessionUser;
  favoritesCount: number;
  notesCount: number;
  learnedEpisodesCount: number;
  recentEpisode: {
    id: string;
    title: string;
    duration: string;
  } | null;
}

export interface AccountWalletSnapshot {
  id: number;
  user_id: string;
  total_earned: number;
  available_balance: number;
  withdrawn_amount: number;
  created_at: string;
  updated_at: string;
}

export interface WithdrawalHistoryItem {
  id: number;
  user_id: string;
  wallet_id: number | null;
  amount: number;
  alipay_phone: string | null;
  real_name: string | null;
  status: string;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface InviteStatsSnapshot {
  total_invited: number;
  total_rewards: number;
  invite_code: string;
}

export interface InviteHistoryItem {
  id: number;
  invited_user_id: string;
  reward_amount: number;
  status: string;
  created_at: string;
  invited_user: {
    email: string | null;
    name: string | null;
  };
}

export interface AccountAssetsSnapshot {
  wallet: AccountWalletSnapshot;
  hasPendingWithdrawal: boolean;
  withdrawalHistory: WithdrawalHistoryItem[];
  inviteStats: InviteStatsSnapshot;
  inviteCode: string;
  inviteHistory: InviteHistoryItem[];
}

export async function deleteCurrentAccount(session: StoredSession): Promise<{ success: true }> {
  const response = await fetch(`${env.apiBaseUrl}/api/account/delete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
    },
  });

  const payload = (await response.json().catch(() => null)) as
    | { success?: boolean; error?: string; message?: string }
    | null;

  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || payload?.message || '删除账号失败');
  }

  return { success: true };
}

type LearningRow = {
  episode_id: string;
  last_reviewed_at: string | null;
  status: string;
};

type EpisodeRow = {
  id: string;
  title: string;
  duration: string;
};

type UserProfileInviteRow = {
  invite_code: string | null;
};

type InviteBaseRow = {
  id: number;
  invited_user_id: string;
  reward_amount: number;
  status: string;
  created_at: string;
};

type InviteProfileRow = {
  id: string;
  email: string | null;
  name: string | null;
};

function buildZeroWallet(userId: string): AccountWalletSnapshot {
  const now = new Date().toISOString();
  return {
    id: 0,
    user_id: userId,
    total_earned: 0,
    available_balance: 0,
    withdrawn_amount: 0,
    created_at: now,
    updated_at: now,
  };
}

async function postSupabaseRpc<T>(
  session: StoredSession,
  rpcName: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(buildSupabaseUrl(`/rest/v1/rpc/${rpcName}`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${rpcName} failed`);
  }

  return (await response.json()) as T;
}

function normalizeInviteStats(
  input: InviteStatsSnapshot | InviteStatsSnapshot[] | null | undefined,
): InviteStatsSnapshot | null {
  if (!input) return null;
  if (Array.isArray(input)) return input[0] ?? null;
  return input;
}

async function fetchInviteCode(session: StoredSession, userId: string) {
  const profileRows = await supabaseFetchJson<UserProfileInviteRow[]>(
    `/rest/v1/user_profiles?select=invite_code&id=eq.${userId}&limit=1`,
    undefined,
    session.accessToken,
  ).catch(() => [] as UserProfileInviteRow[]);

  const currentInviteCode = profileRows[0]?.invite_code?.trim();
  if (currentInviteCode) return currentInviteCode;

  const createdInviteCode = await postSupabaseRpc<string | string[]>(session, 'get_or_create_invite_code', {
    user_uuid: userId,
  }).catch(() => '');

  if (Array.isArray(createdInviteCode)) return createdInviteCode[0] ?? '';
  return createdInviteCode ?? '';
}

async function fetchInviteStats(session: StoredSession, userId: string, inviteCode: string): Promise<InviteStatsSnapshot> {
  const rpcStats = await postSupabaseRpc<InviteStatsSnapshot | InviteStatsSnapshot[] | null>(
    session,
    'get_invitation_stats',
    { user_uuid: userId },
  )
    .then((result) => normalizeInviteStats(result))
    .catch(() => null);

  if (rpcStats) {
    return {
      total_invited: rpcStats.total_invited ?? 0,
      total_rewards: rpcStats.total_rewards ?? 0,
      invite_code: rpcStats.invite_code || inviteCode,
    };
  }

  const completedInvites = await supabaseFetchJson<Pick<InviteBaseRow, 'reward_amount'>[]>(
    `/rest/v1/invites?select=reward_amount&inviter_user_id=eq.${userId}&status=eq.completed&limit=200`,
    undefined,
    session.accessToken,
  ).catch(() => [] as Pick<InviteBaseRow, 'reward_amount'>[]);

  return {
    total_invited: completedInvites.length,
    total_rewards: completedInvites.reduce((sum, item) => sum + Number(item.reward_amount || 0), 0),
    invite_code: inviteCode,
  };
}

async function fetchInviteHistory(session: StoredSession, userId: string): Promise<InviteHistoryItem[]> {
  const inviteRows = await supabaseFetchJson<InviteBaseRow[]>(
    `/rest/v1/invites?select=id,invited_user_id,reward_amount,status,created_at&inviter_user_id=eq.${userId}&order=created_at.desc&limit=20`,
    undefined,
    session.accessToken,
  ).catch(() => [] as InviteBaseRow[]);

  if (inviteRows.length === 0) return [];

  const invitedUserIds = Array.from(new Set(inviteRows.map((item) => item.invited_user_id).filter(Boolean)));
  const profileRows =
    invitedUserIds.length > 0
      ? await supabaseFetchJson<InviteProfileRow[]>(
          `/rest/v1/user_profiles?select=id,email,name&id=in.(${invitedUserIds.join(',')})`,
          undefined,
          session.accessToken,
        ).catch(() => [] as InviteProfileRow[])
      : [];

  const profileMap = new Map(profileRows.map((item) => [item.id, item]));

  return inviteRows.map((item) => {
    const profile = profileMap.get(item.invited_user_id);
    return {
      ...item,
      invited_user: {
        email: profile?.email ?? null,
        name: profile?.name ?? null,
      },
    };
  });
}

export async function fetchAccountAssets(session: StoredSession): Promise<AccountAssetsSnapshot> {
  const userId = session.user?.id;
  if (!userId) {
    throw new Error('No authenticated user');
  }

  const [walletRows, withdrawalHistory, pendingRows, inviteCode] = await Promise.all([
    supabaseFetchJson<AccountWalletSnapshot[]>(
      `/rest/v1/user_wallets?select=id,user_id,total_earned,available_balance,withdrawn_amount,created_at,updated_at&user_id=eq.${userId}&limit=1`,
      undefined,
      session.accessToken,
    ).catch(() => [] as AccountWalletSnapshot[]),
    supabaseFetchJson<WithdrawalHistoryItem[]>(
      `/rest/v1/withdrawal_requests?select=id,user_id,wallet_id,amount,alipay_phone,real_name,status,admin_note,created_at,updated_at&user_id=eq.${userId}&order=created_at.desc&limit=20`,
      undefined,
      session.accessToken,
    ).catch(() => [] as WithdrawalHistoryItem[]),
    supabaseFetchJson<Array<{ id: number }>>(
      `/rest/v1/withdrawal_requests?select=id&user_id=eq.${userId}&status=eq.pending&limit=1`,
      undefined,
      session.accessToken,
    ).catch(() => [] as Array<{ id: number }>),
    fetchInviteCode(session, userId),
  ]);

  const [inviteStats, inviteHistory] = await Promise.all([
    fetchInviteStats(session, userId, inviteCode).catch(() => ({
      total_invited: 0,
      total_rewards: 0,
      invite_code: inviteCode,
    })),
    fetchInviteHistory(session, userId).catch(() => [] as InviteHistoryItem[]),
  ]);

  return {
    wallet: walletRows[0] ?? buildZeroWallet(userId),
    hasPendingWithdrawal: pendingRows.length > 0,
    withdrawalHistory,
    inviteStats,
    inviteCode: inviteCode || inviteStats.invite_code || '',
    inviteHistory,
  };
}

export async function fetchAccountSummary(session: StoredSession): Promise<AccountSummary> {
  const accessToken = session.accessToken;
  const userId = session.user?.id;

  if (!userId || !session.user) {
    throw new Error('No authenticated user');
  }

  const [favoritesCount, notesCount, learningRows] = await Promise.all([
    supabaseCount('favorites', { select: 'id', user_id: `eq.${userId}`, limit: '1' }, accessToken),
    supabaseCount('sentence_notes', { select: 'id', user_id: `eq.${userId}`, limit: '1' }, accessToken).catch(
      () => 0,
    ),
    supabaseFetchJson<LearningRow[]>(
      `/rest/v1/learning_progress?select=episode_id,last_reviewed_at,status&user_id=eq.${userId}&order=last_reviewed_at.desc.nullslast&limit=30`,
      undefined,
      accessToken,
    ).catch(() => []),
  ]);

  const learnedEpisodes = Array.from(
    new Set(
      learningRows
        .filter((row) => row.episode_id && (row.status === 'reviewed' || row.status === 'mastered'))
        .map((row) => row.episode_id),
    ),
  );

  const recentEpisodeId =
    learningRows.find((row) => row.episode_id && row.last_reviewed_at)?.episode_id ?? learnedEpisodes[0] ?? null;

  let recentEpisode: EpisodeRow | null = null;
  if (recentEpisodeId) {
    const url = new URL(buildRestTableUrl('episodes'));
    url.searchParams.set('select', 'id,title,duration');
    url.searchParams.set('id', `eq.${recentEpisodeId}`);
    url.searchParams.set('limit', '1');
    const episodeRows = await supabaseFetchJson<EpisodeRow[]>(url.pathname + url.search, undefined, accessToken).catch(
      () => [],
    );
    recentEpisode = episodeRows[0] ?? null;
  }

  return {
    user: session.user,
    favoritesCount,
    notesCount,
    learnedEpisodesCount: learnedEpisodes.length,
    recentEpisode,
  };
}
