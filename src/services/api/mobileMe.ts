import { Platform } from 'react-native';

import { env } from '@/lib/env';

export interface MobileMeResponse {
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    displayName: string | null;
    avatarUrl?: string | null;
    avatar_url?: string | null;
    avatar?: string | null;
    imageUrl?: string | null;
    photoURL?: string | null;
  };
  profile: {
    activatedAt: string | null;
    source: string | null;
    inviteCode: string | null;
  };
  entitlements: {
    isActivated: boolean;
    canUsePremiumLibrary: boolean;
    canUseVocabulary: boolean;
    canUseAiPractice: boolean;
    speakingCredits: number;
    membershipType: string | null;
    membershipExpireAt: string | null;
  };
  platform: {
    paymentMode: 'apple_iap' | 'android_web_pay' | 'web_pay';
  };
}

type MobileMeErrorResponse = {
  error?: {
    code?: string;
    message?: string;
  };
};

export class MobileMeApiError extends Error {
  code: string;
  status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = 'MobileMeApiError';
    this.code = code;
    this.status = status;
  }
}

function buildMobileMeUrl() {
  return `${env.apiBaseUrl.replace(/\/$/, '')}/api/mobile/me`;
}

function buildEnsureWalletUrl() {
  return `${env.apiBaseUrl.replace(/\/$/, '')}/api/mobile/ensure-ai-wallet`;
}

function resolveClientPlatform() {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'web';
}

export function isMobileMeAuthError(error: unknown): error is MobileMeApiError {
  return error instanceof MobileMeApiError && error.code === 'unauthorized';
}

export function isMobileMeNetworkError(error: unknown) {
  if (error instanceof MobileMeApiError) {
    return false;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const normalized = error.message.toLowerCase();
  return (
    normalized.includes('network request failed') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('could not connect to the server') ||
    normalized.includes('connection refused') ||
    normalized.includes('timed out') ||
    normalized.includes('timeout') ||
    normalized.includes('load failed')
  );
}

export async function ensureMobileAiWallet(accessToken: string): Promise<{ speakingCredits: number }> {
  if (!accessToken.trim()) {
    throw new MobileMeApiError('missing_access_token', '请先登录后再继续。');
  }

  const response = await fetch(buildEnsureWalletUrl(), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'x-client-platform': resolveClientPlatform(),
    },
  });

  const contentType = response.headers.get('content-type') ?? response.headers.get('Content-Type') ?? '';
  const bodyText = await response.text().catch(() => '');
  const parsed =
    /application\/json/i.test(contentType) && bodyText
      ? (JSON.parse(bodyText) as { speakingCredits?: number } | MobileMeErrorResponse)
      : null;

  if (!response.ok) {
    const message =
      (parsed as MobileMeErrorResponse | null)?.error?.message ||
      (response.status === 401 ? '请先登录后再继续。' : '体验额度暂时初始化失败，请稍后重试。');
    const code =
      (parsed as MobileMeErrorResponse | null)?.error?.code ||
      (response.status === 401 ? 'unauthorized' : 'request_failed');
    throw new MobileMeApiError(code, message, response.status);
  }

  return {
    speakingCredits: Math.max(Number((parsed as { speakingCredits?: number } | null)?.speakingCredits ?? 0), 0),
  };
}

export async function fetchMobileMe(accessToken: string): Promise<MobileMeResponse> {
  if (!accessToken.trim()) {
    throw new MobileMeApiError('missing_access_token', '请先登录后再继续。');
  }

  const response = await fetch(buildMobileMeUrl(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'x-client-platform': resolveClientPlatform(),
    },
  });

  const contentType = response.headers.get('content-type') ?? response.headers.get('Content-Type') ?? '';
  const bodyText = await response.text().catch(() => '');
  const parsed =
    /application\/json/i.test(contentType) && bodyText
      ? (JSON.parse(bodyText) as MobileMeResponse | MobileMeErrorResponse)
      : null;

  if (!response.ok) {
    const message =
      (parsed as MobileMeErrorResponse | null)?.error?.message ||
      (response.status === 401 ? '请先登录后再继续。' : '账号信息暂时读取失败，请稍后重试。');
    const code =
      (parsed as MobileMeErrorResponse | null)?.error?.code ||
      (response.status === 401 ? 'unauthorized' : 'request_failed');
    throw new MobileMeApiError(code, message, response.status);
  }

  if (!parsed) {
    throw new MobileMeApiError('invalid_response', '账号信息返回格式异常。', response.status);
  }

  return parsed as MobileMeResponse;
}
