import { env, hasSupabaseEnv } from '@/lib/env';
import type { SessionUser, StoredSession } from '@/types/auth';
import { buildRestTableUrl, supabaseFetchJson } from '@/services/supabase/rest';
import { Platform } from 'react-native';
import {
  clearAuthSession,
  migrateLegacyFileSessionIfNeeded,
  saveAuthSession,
} from '@/services/auth/secureSessionStorage';
import { getOrCreateInstallationId } from '@/services/device/installationId';

type AuthFailurePayload = {
  id?: string;
  code?: string;
  status?: number;
  error_description?: string;
  msg?: string;
  message?: string;
  error?: string;
  details?: string;
  hint?: string;
};

const AUTH_REQUEST_TIMEOUT_MS = 8000;

async function fetchWithTimeout(
  input: string,
  init?: RequestInit,
  timeoutMs: number = AUTH_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const externalSignal = init?.signal ?? null;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort);
    }
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && (!externalSignal || !externalSignal.aborted)) {
      throw new Error(`auth_request_timeout_after_${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

export class AuthClientError extends Error {
  code?: string;
  status?: number;
  details?: string;
  hint?: string;
  cause?: unknown;

  constructor(message: string, options?: { code?: string; status?: number; details?: string; hint?: string; cause?: unknown }) {
    super(message);
    this.name = 'AuthClientError';
    this.code = options?.code;
    this.status = options?.status;
    this.details = options?.details;
    this.hint = options?.hint;
    this.cause = options?.cause;
  }
}

type AuthTokenResponse = {
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
  token_type: string;
  user: {
    id: string;
    email: string | null;
    user_metadata?: {
      name?: string;
      full_name?: string;
      avatar_url?: string;
      picture?: string;
    } | null;
  };
};

type MobileSignupResponse =
  | {
      ok: true;
      userId: string;
      email: string | null;
    }
  | {
      ok: false;
      code?: string;
      message?: string;
    };

type ProfileRow = {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  avatar: string | null;
};

function toSessionUser(
  user: AuthTokenResponse['user'] | { id: string; email: string | null; name?: string | null },
  profile?: ProfileRow | null,
): SessionUser {
  const fallbackName =
    'user_metadata' in user
      ? undefined
      : (user as { id: string; email: string | null; name?: string | null }).name;
  const derivedName =
    profile?.name ??
    ('user_metadata' in user ? user.user_metadata?.full_name ?? user.user_metadata?.name : fallbackName) ??
    user.email?.split('@')[0] ??
    null;

  return {
    id: user.id,
    email: profile?.email ?? user.email ?? null,
    displayName: derivedName,
    avatarUrl:
      profile?.avatar_url ??
      profile?.avatar ??
      ('user_metadata' in user ? user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null : null),
  };
}

export async function persistStoredSession(session: StoredSession | null) {
  await saveAuthSession(session);
}

export async function clearPersistedSession() {
  await clearAuthSession();
}

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error ?? '');
}

function devAuthLog(event: string, payload: Record<string, unknown>) {
  if (typeof __DEV__ === 'boolean' && __DEV__) {
    console.log(event, payload);
  }
}

function isAuthFailureMessage(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('invalid_grant') ||
    normalized.includes('refresh token') ||
    normalized.includes('jwt expired') ||
    normalized.includes('invalid jwt') ||
    normalized.includes('invalid token') ||
    normalized.includes('invalid claim') ||
    normalized.includes('unauthorized') ||
    normalized.includes('unauthenticated')
  );
}

function isTransientNetworkFailure(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('network request failed') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('network error') ||
    normalized.includes('load failed') ||
    normalized.includes('timeout')
  );
}

async function fetchProfile(accessToken: string, userId: string) {
  const url = new URL(buildRestTableUrl('user_profiles'));
  url.searchParams.set('select', 'id,email,name,avatar_url,avatar');
  url.searchParams.set('id', `eq.${userId}`);
  url.searchParams.set('limit', '1');

  const rows = await supabaseFetchJson<ProfileRow[]>(url.pathname + url.search, undefined, accessToken);
  return rows[0] ?? null;
}

async function fetchUser(accessToken: string) {
  return supabaseFetchJson<{
    id: string;
    email: string | null;
    user_metadata?: {
      name?: string;
      full_name?: string;
      avatar_url?: string;
      picture?: string;
    };
  }>(
    '/auth/v1/user',
    undefined,
    accessToken,
  );
}

function normalizeSession(payload: AuthTokenResponse, profile?: ProfileRow | null): StoredSession {
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
    tokenType: payload.token_type,
    user: toSessionUser(payload.user, profile),
  };
}

export async function signInWithPassword(email: string, password: string) {
  if (!hasSupabaseEnv) {
    throw new Error('Supabase Auth 未配置');
  }

  const response = await fetchWithTimeout(`${env.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: '*/*',
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${env.supabaseAnonKey}`,
      'X-Supabase-Api-Version': '2024-01-01',
      'X-Client-Info': 'echolingo-app-v2 auth-client',
      'x-application-name': 'echolingo-app-v2',
    },
    body: JSON.stringify({ email, password, gotrue_meta_security: {} }),
  });

  const payload = (await response.json()) as AuthTokenResponse | { error_description?: string; msg?: string; message?: string; error?: string };

  if (!response.ok) {
    const message =
      ('error_description' in payload && payload.error_description) ||
      ('msg' in payload && payload.msg) ||
      ('message' in payload && payload.message) ||
      ('error' in payload && typeof payload.error === 'string' && payload.error) ||
      '登录失败';
    throw new Error(message);
  }

  const authPayload = payload as AuthTokenResponse;
  const profile = await fetchProfile(authPayload.access_token, authPayload.user.id).catch(() => null);
  const session = normalizeSession(authPayload, profile);
  await saveAuthSession(session);
  return session;
}

export async function signInWithAppleIdentityToken(identityToken: string, nonce?: string) {
  if (!hasSupabaseEnv) {
    throw new Error('Supabase Auth 未配置');
  }

  devAuthLog('[auth_apple_exchange_request_debug]', {
    provider: 'apple',
    hasIdentityToken: Boolean(identityToken),
    identityTokenLength: identityToken.length,
    hasNonce: Boolean(nonce),
  });

  const response = await fetchWithTimeout(`${env.supabaseUrl}/auth/v1/token?grant_type=id_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: '*/*',
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${env.supabaseAnonKey}`,
      'X-Supabase-Api-Version': '2024-01-01',
      'X-Client-Info': 'echolingo-app-v2 auth-client',
      'x-application-name': 'echolingo-app-v2',
    },
    body: JSON.stringify({
      provider: 'apple',
      id_token: identityToken,
      ...(nonce ? { nonce } : {}),
    }),
  });

  const payload = (await response.json()) as AuthTokenResponse | AuthFailurePayload;

  devAuthLog('[auth_apple_exchange_response_debug]', {
    status: response.status,
    ok: response.ok,
    payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload) : [],
    error: 'error' in payload ? payload.error ?? null : null,
    errorDescription: 'error_description' in payload ? payload.error_description ?? null : null,
    msg: 'msg' in payload ? payload.msg ?? null : null,
    code: 'code' in payload ? payload.code ?? null : null,
  });

  if (!response.ok) {
    const failure = payload as AuthFailurePayload;
    const message =
      failure.error_description ||
      failure.error ||
      failure.msg ||
      failure.message ||
      'Apple 登录失败';
    throw new AuthClientError(message, {
      code: failure.code,
      status: response.status,
      details: failure.details,
      hint: failure.hint,
      cause: payload,
    });
  }

  const authPayload = payload as AuthTokenResponse;
  const profile = await fetchProfile(authPayload.access_token, authPayload.user.id).catch(() => null);
  const session = normalizeSession(authPayload, profile);
  await saveAuthSession(session);
  return session;
}

export async function signUpWithPassword(email: string, password: string): Promise<StoredSession | null> {
  if (!hasSupabaseEnv) {
    throw new Error('Supabase Auth 未配置');
  }

  const normalizedEmail = email.trim();
  const installationId = await getOrCreateInstallationId();
  const response = await fetchWithTimeout(`${env.apiBaseUrl.replace(/\/$/, '')}/api/mobile/auth/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      email: normalizedEmail,
      password,
      installationId,
      platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web',
      appVersion: null,
    }),
  });

  const payload = (await response.json().catch(() => null)) as MobileSignupResponse | AuthFailurePayload | null;

  devAuthLog('[auth_signup_response_debug]', {
    hasEmail: Boolean(normalizedEmail),
    status: response.status,
    ok: response.ok,
    payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload) : [],
    hasUser: Boolean(payload && 'userId' in payload && payload.userId),
    hasSession: false,
    hasAccessToken: false,
    code: payload && 'code' in payload ? payload.code ?? null : null,
  });

  if (!response.ok || !payload || ('ok' in payload && payload.ok === false)) {
    const code = payload && 'code' in payload && typeof payload.code === 'string' ? payload.code : undefined;
    const explicitMessage =
      code === 'device_signup_limit_reached'
        ? '该设备注册账号数量已达上限，请使用已有账号登录。'
        : code === 'email_already_exists'
          ? '该邮箱已注册，请直接登录'
          : undefined;
    const message =
      explicitMessage ||
      (payload && 'error_description' in payload && payload.error_description) ||
      (payload && 'error' in payload && typeof payload.error === 'string' && payload.error) ||
      (payload && 'msg' in payload && payload.msg) ||
      (payload && 'message' in payload && payload.message) ||
      '注册失败';
    const authError = new AuthClientError(message, {
      code,
      status: response.status,
      details: payload && 'details' in payload && typeof payload.details === 'string' ? payload.details : undefined,
      hint: payload && 'hint' in payload && typeof payload.hint === 'string' ? payload.hint : undefined,
      cause: payload,
    });

    devAuthLog('[auth_signup_failed_debug]', {
      hasEmail: Boolean(email.trim()),
      errorName: authError.name,
      errorMessage: authError.message,
      errorStatus: authError.status ?? null,
      errorCode: authError.code ?? null,
      errorDescription: payload && 'error_description' in payload ? payload.error_description ?? null : null,
      errorKeys: payload && typeof payload === 'object' ? Object.keys(payload) : [],
      hasUser: Boolean(payload && 'userId' in payload && payload.userId),
      hasSession: false,
    });
    throw authError;
  }

  devAuthLog('[auth_signup_success_debug]', {
    hasEmail: Boolean(normalizedEmail),
    hasUser: Boolean('userId' in payload ? payload.userId : null),
    hasSession: true,
  });

  return signInWithPassword(normalizedEmail, password);
}

export async function sendPasswordResetEmail(email: string) {
  if (!hasSupabaseEnv) {
    throw new Error('Supabase Auth 未配置');
  }

  const response = await fetchWithTimeout(`${env.supabaseUrl}/auth/v1/recover`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      apikey: env.supabaseAnonKey,
    },
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    const payload = (await response.json()) as { error_description?: string; msg?: string };
    throw new Error(payload.error_description ?? payload.msg ?? '发送失败，请检查邮箱');
  }
}

export async function signOut(session: StoredSession | null) {
  if (session?.accessToken) {
    try {
      await fetchWithTimeout(`${env.supabaseUrl}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          apikey: env.supabaseAnonKey,
          Authorization: `Bearer ${session.accessToken}`,
        },
      });
    } catch {
      // Ignore network/logout failures, local cleanup still matters.
    }
  }

  await clearAuthSession();
}

async function refreshSession(refreshToken: string) {
  const response = await fetchWithTimeout(`${env.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: '*/*',
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${env.supabaseAnonKey}`,
      'X-Supabase-Api-Version': '2024-01-01',
      'X-Client-Info': 'echolingo-app-v2 auth-client',
      'x-application-name': 'echolingo-app-v2',
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  const payload = (await response.json()) as AuthTokenResponse | { error_description?: string; msg?: string };
  if (!response.ok) {
    throw new Error(
      ('error_description' in payload && payload.error_description) ||
        ('msg' in payload && payload.msg) ||
        '刷新登录态失败',
    );
  }

  const authPayload = payload as AuthTokenResponse;
  const profile = await fetchProfile(authPayload.access_token, authPayload.user.id).catch(() => null);
  const session = normalizeSession(authPayload, profile);
  await saveAuthSession(session);
  return session;
}

export async function hydrateStoredSession() {
  if (!hasSupabaseEnv) return null;

  const stored = await migrateLegacyFileSessionIfNeeded();
  if (!stored) {
    console.log('[auth] hydrate_no_stored_session');
    return null;
  }

  const tokenExpired = stored.expiresAt <= Date.now() + 60_000;
  console.log('[auth] hydrate_start', {
    tokenExpired,
    hasRefreshToken: Boolean(stored.refreshToken),
    expiresInSec: Math.round((stored.expiresAt - Date.now()) / 1000),
  });

  try {
    let nextSession = stored;
    if (tokenExpired) {
      if (!stored.refreshToken) {
        console.log('[auth] hydrate_no_refresh_token_clearing_session');
        await clearAuthSession();
        return null;
      }
      nextSession = await refreshSession(stored.refreshToken);
      console.log('[auth] token_refreshed', {
        expiresInSec: Math.round((nextSession.expiresAt - Date.now()) / 1000),
      });
    }

    const user = await fetchUser(nextSession.accessToken);
    const profile = await fetchProfile(nextSession.accessToken, user.id).catch(() => null);

    const hydrated: StoredSession = {
      ...nextSession,
      user: toSessionUser(user, profile),
    };

    await saveAuthSession(hydrated);
    console.log('[auth] session_restored', { userId: hydrated.user?.id, tokenRefreshed: tokenExpired });
    return hydrated;
  } catch (error) {
    const message = extractErrorMessage(error);
    const isNetworkErr = isTransientNetworkFailure(message);
    const isAuthErr = isAuthFailureMessage(message);
    console.log('[auth] hydrate_error', {
      message: message.slice(0, 200),
      isNetworkErr,
      isAuthErr,
      action: isNetworkErr || !isAuthErr ? 'returning_stored' : 'clearing_session',
    });

    if (isNetworkErr) {
      return stored;
    }

    if (!isAuthErr) {
      return stored;
    }

    await clearAuthSession();
    return null;
  }
}
