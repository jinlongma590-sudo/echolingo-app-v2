import { Platform } from 'react-native';

import { env } from '@/lib/env';

type MobileCheckoutErrorResponse = {
  error?: {
    code?: string;
    message?: string;
  };
};

export type MobileCheckoutProduct =
  | 'membership_lifetime'
  | 'speaking_credits_5'
  | 'speaking_credits_15'
  | 'speaking_credits_30';

export class MobileCheckoutApiError extends Error {
  code: string;
  status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = 'MobileCheckoutApiError';
    this.code = code;
    this.status = status;
  }
}

function buildMobileCheckoutUrl() {
  return `${env.apiBaseUrl.replace(/\/$/, '')}/api/mobile/checkout/create`;
}

function resolveClientPlatform() {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'web';
}

export async function createMobileCheckout(
  accessToken: string,
  product: MobileCheckoutProduct = 'membership_lifetime',
): Promise<{ checkoutUrl: string; orderNo?: string }> {
  const response = await fetch(buildMobileCheckoutUrl(), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'x-client-platform': resolveClientPlatform(),
    },
    body: JSON.stringify({
      product,
      platform: 'android_apk',
    }),
  });

  const contentType = response.headers.get('content-type') ?? response.headers.get('Content-Type') ?? '';
  const bodyText = await response.text().catch(() => '');
  const parsed =
    /application\/json/i.test(contentType) && bodyText
      ? (JSON.parse(bodyText) as { checkoutUrl?: string; orderNo?: string } | MobileCheckoutErrorResponse)
      : null;

  if (!response.ok) {
    const fallbackFailureMessage =
      product === 'membership_lifetime'
        ? '暂时无法创建开通订单，请稍后重试。'
        : '暂时无法创建购买订单，请稍后重试。';
    const message =
      (parsed as MobileCheckoutErrorResponse | null)?.error?.message ||
      (response.status === 401 ? '请先登录后再继续。' : fallbackFailureMessage);
    const code =
      (parsed as MobileCheckoutErrorResponse | null)?.error?.code ||
      (response.status === 401 ? 'unauthorized' : 'request_failed');
    throw new MobileCheckoutApiError(code, message, response.status);
  }

  const checkoutUrl = (parsed as { checkoutUrl?: string } | null)?.checkoutUrl?.trim();
  if (!checkoutUrl) {
    throw new MobileCheckoutApiError(
      'invalid_response',
      product === 'membership_lifetime'
        ? '开通链接返回异常，请稍后重试。'
        : '购买链接返回异常，请稍后重试。',
      response.status,
    );
  }

  return {
    checkoutUrl,
    orderNo: (parsed as { orderNo?: string } | null)?.orderNo,
  };
}
