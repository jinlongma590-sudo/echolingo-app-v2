import { Platform } from 'react-native';

import { env } from '@/lib/env';

export type VerifyIapPurchasePayload = {
  productId: string;
  transactionId: string;
  originalTransactionId?: string | null;
  transactionDate?: number | null;
  environment?: string | null;
  purchaseToken?: string | null;
  purchaseId?: string | null;
  transactionReceipt?: string | null;
  signedTransactionInfo?: string | null;
  raw?: unknown;
};

export type VerifyIapPurchaseResponse = {
  ok: true;
  productId: string;
  transactionId: string;
  originalTransactionId?: string | null;
  duplicated: boolean;
  entitlementApplied: boolean;
  entitlementType?: 'membership' | 'credits';
  creditsAdded?: number;
  activated?: boolean;
  shouldFinishTransaction: boolean;
  message?: string;
};

type VerifyIapFailureResponse = {
  ok?: false;
  code?: string;
  message?: string;
  error?: {
    code?: string;
    message?: string;
  };
};

export class IapVerifyApiError extends Error {
  code: string;
  status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = 'IapVerifyApiError';
    this.code = code;
    this.status = status;
  }
}

function buildVerifyUrl() {
  return `${env.apiBaseUrl.replace(/\/$/, '')}/api/mobile/iap/verify`;
}

function resolveClientPlatform() {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'web';
}

function summarizeSignedTransactionInfo(value: string | null | undefined) {
  return {
    hasSignedTransactionInfo: Boolean(value && value.trim()),
    signedTransactionInfoLength: value?.length ?? 0,
    signedTransactionInfoHeader: value ? value.slice(0, 20) : null,
  };
}

function devLog(event: string, payload: Record<string, unknown>) {
  if (typeof __DEV__ === 'boolean' && __DEV__) {
    console.log(event, payload);
  }
}

export async function verifyIapPurchase(
  accessToken: string,
  payload: VerifyIapPurchasePayload,
): Promise<VerifyIapPurchaseResponse> {
  devLog('[iapVerify] request payload', {
    productId: payload.productId,
    transactionId: payload.transactionId,
    originalTransactionId: payload.originalTransactionId ?? null,
    environment: payload.environment ?? null,
    purchaseId: payload.purchaseId ?? null,
    ...summarizeSignedTransactionInfo(payload.signedTransactionInfo),
  });

  const response = await fetch(buildVerifyUrl(), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'x-client-platform': resolveClientPlatform(),
    },
    body: JSON.stringify(payload),
  });

  const contentType = response.headers.get('content-type') ?? response.headers.get('Content-Type') ?? '';
  const bodyText = await response.text().catch(() => '');
  const parsed =
    /application\/json/i.test(contentType) && bodyText
      ? (JSON.parse(bodyText) as VerifyIapPurchaseResponse | VerifyIapFailureResponse)
      : null;

  if (!response.ok) {
    const errorPayload = parsed as VerifyIapFailureResponse | null;
    const message =
      errorPayload?.message ||
      errorPayload?.error?.message ||
      (response.status === 401 ? '请先登录后再继续。' : '购买确认失败，请稍后重试。');
    const code =
      errorPayload?.code ||
      errorPayload?.error?.code ||
      (response.status === 401 ? 'unauthorized' : 'request_failed');
    throw new IapVerifyApiError(code, message, response.status);
  }

  if (!parsed || (parsed as VerifyIapPurchaseResponse).ok !== true) {
    throw new IapVerifyApiError('invalid_response', '购买结果返回异常，请稍后重试。', response.status);
  }

  const success = parsed as VerifyIapPurchaseResponse;
  devLog('[iapVerify] response summary', {
    ok: success.ok,
    productId: success.productId,
    transactionId: success.transactionId,
    originalTransactionId: success.originalTransactionId ?? null,
    duplicated: success.duplicated,
    entitlementApplied: success.entitlementApplied,
    entitlementType: success.entitlementType ?? null,
    activated: success.activated ?? null,
    creditsAdded: success.creditsAdded ?? null,
    shouldFinishTransaction: success.shouldFinishTransaction,
  });

  return success;
}
