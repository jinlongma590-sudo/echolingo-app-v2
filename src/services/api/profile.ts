import { env } from '@/lib/env';
import type { StoredSession } from '@/types/auth';
import { buildRestTableUrl, supabaseFetchJson } from '@/services/supabase/rest';

export interface UserProfileSnapshot {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  preferences: Record<string, unknown> | null;
  createdAt: string | null;
  updatedAt: string | null;
  activatedAt: string | null;
  source: string | null;
  inviteCode: string | null;
}

type UserProfileRow = {
  id: string;
  email: string | null;
  name: string | null;
  avatar_url?: string | null;
  avatar: string | null;
  preferences: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
  activated_at: string | null;
  source: string | null;
  invite_code: string | null;
};

export interface UpdateUserProfilePayload {
  displayName: string;
  signature: string;
}

function mapProfileRow(row: UserProfileRow): UserProfileSnapshot {
  return {
    id: row.id,
    email: row.email ?? null,
    name: row.name ?? null,
    avatarUrl: row.avatar_url ?? row.avatar ?? null,
    preferences: row.preferences ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    activatedAt: row.activated_at ?? null,
    source: row.source ?? null,
    inviteCode: row.invite_code ?? null,
  };
}

export async function fetchCurrentUserProfile(session: StoredSession): Promise<UserProfileSnapshot | null> {
  const userId = session.user?.id;
  if (!userId) {
    throw new Error('No authenticated user');
  }

  const rows = await supabaseFetchJson<UserProfileRow[]>(
    `/rest/v1/user_profiles?select=id,email,name,avatar_url,avatar,preferences,created_at,updated_at,activated_at,source,invite_code&id=eq.${userId}&limit=1`,
    undefined,
    session.accessToken,
  ).catch(() => [] as UserProfileRow[]);

  const row = rows[0];
  if (!row) return null;

  return mapProfileRow(row);
}

export async function updateUserProfile(
  session: StoredSession,
  payload: UpdateUserProfilePayload,
): Promise<UserProfileSnapshot> {
  const userId = session.user?.id;
  if (!userId) {
    throw new Error('No authenticated user');
  }

  const currentProfile = await fetchCurrentUserProfile(session).catch(() => null);
  const currentPreferences = { ...(currentProfile?.preferences ?? {}) };
  const nextSignature = payload.signature.trim();

  if (nextSignature) {
    currentPreferences.signature = nextSignature;
  } else {
    delete currentPreferences.signature;
  }

  const requestBody = {
    name: payload.displayName.trim(),
    preferences: currentPreferences,
  };

  const patchResponse = await fetch(buildRestTableUrl('user_profiles', { id: `eq.${userId}` }), {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!patchResponse.ok) {
    const text = await patchResponse.text();
    throw new Error(text || '更新资料失败');
  }

  const updatedRows = (await patchResponse.json()) as UserProfileRow[];
  if (updatedRows[0]) {
    return mapProfileRow(updatedRows[0]);
  }

  const insertResponse = await fetch(buildRestTableUrl('user_profiles'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify({
      id: userId,
      email: session.user?.email ?? null,
      ...requestBody,
    }),
  });

  if (!insertResponse.ok) {
    const text = await insertResponse.text();
    throw new Error(text || '创建资料失败');
  }

  const insertedRows = (await insertResponse.json()) as UserProfileRow[];
  const inserted = insertedRows[0];
  if (!inserted) {
    throw new Error('资料保存失败');
  }

  return mapProfileRow(inserted);
}
