import {
  endConnection,
  finishTransaction,
  getPendingTransactionsIOS,
  getTransactionJwsIOS,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  type Purchase,
} from 'expo-iap';
import { Platform } from 'react-native';

import type { VerifyIapPurchasePayload } from '@/services/api/iapVerify';
import type { AppIapProduct } from '@/services/iap/iapCatalog';
import type { MobileIapProduct } from '@/services/api/iapProducts';
import { FALLBACK_MOBILE_IAP_PRODUCTS } from '@/services/iap/iapCatalog';
import type { IapPendingTransaction, IapProductType } from '@/services/iap/iapTypes';

const PURCHASE_EVENT_TIMEOUT_MS = 45_000;

const PRODUCT_TYPE_MAP = new Map<string, IapProductType>(
  FALLBACK_MOBILE_IAP_PRODUCTS.map((product: MobileIapProduct) => [product.productId, product.type] as const),
);

export class IapPurchaseError extends Error {
  code: string;

  constructor(message: string, code = 'purchase_failed') {
    super(message);
    this.name = 'IapPurchaseError';
    this.code = code;
  }
}

function warn(event: string, error: unknown) {
  console.warn(event, error instanceof Error ? error.message : String(error ?? 'unknown_error'));
}

function devLog(event: string, payload: Record<string, unknown>) {
  if (typeof __DEV__ === 'boolean' && __DEV__) {
    console.log(event, payload);
  }
}

function summarizeSignedTransactionInfo(value: string | null) {
  return {
    hasSignedTransactionInfo: Boolean(value && value.trim()),
    signedTransactionInfoLength: value?.length ?? 0,
    signedTransactionInfoHeader: value ? value.slice(0, 20) : null,
  };
}

function getPurchaseEventKeys(raw: unknown) {
  if (Array.isArray(raw)) {
    return raw.map((item) =>
      item && typeof item === 'object' ? Object.keys(item as Record<string, unknown>) : [],
    );
  }

  if (raw && typeof raw === 'object') {
    return Object.keys(raw as Record<string, unknown>);
  }

  return [];
}

function resolveProductType(productId: string) {
  const productType = PRODUCT_TYPE_MAP.get(productId);
  if (!productType) {
    throw new IapPurchaseError('未知的 IAP 商品标识。', 'invalid_product');
  }
  return productType;
}

function resolvePendingKey(params: {
  productId: string;
  transactionId: string | null;
  purchaseId: string | null;
  createdAt: string;
}) {
  if (params.transactionId) {
    return params.transactionId;
  }

  if (params.purchaseId) {
    return `${params.productId}:${params.purchaseId}`;
  }

  return `${params.productId}:${params.createdAt}`;
}

function isPurchaseObject(value: unknown): value is Purchase {
  return Boolean(value && typeof value === 'object' && 'productId' in (value as Record<string, unknown>));
}

function selectPurchasedItem(raw: Purchase | Purchase[] | null, productId: string) {
  if (!raw) {
    return null;
  }

  if (Array.isArray(raw)) {
    return (
      raw.find((purchase) => purchase.productId === productId && purchase.purchaseState === 'purchased')
      ?? raw.find((purchase) => purchase.productId === productId)
      ?? raw[0]
      ?? null
    );
  }

  return raw.productId === productId ? raw : raw;
}

function extractErrorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return null;
}

export function isUserCancelledPurchaseError(error: unknown) {
  const code = extractErrorCode(error);
  if (code === 'user-cancelled') {
    return true;
  }

  if (error instanceof Error) {
    return /cancel/i.test(error.message);
  }

  return false;
}

async function loadSignedTransactionInfo(productId: string) {
  if (Platform.OS !== 'ios') {
    return null;
  }

  try {
    const jws = await getTransactionJwsIOS(productId);
    return typeof jws === 'string' && jws.trim() ? jws.trim() : null;
  } catch (error) {
    warn('iap_get_transaction_jws_failed', error);
    return null;
  }
}

export async function withIapConnection<T>(task: () => Promise<T>) {
  await initConnection();
  try {
    return await task();
  } finally {
    await endConnection();
  }
}

function createPurchaseWaiter(productId: string) {
  let settled = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  let removeUpdateListener = () => {};
  let removeErrorListener = () => {};

  const cleanup = () => {
    if (settled) return;
    settled = true;
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    removeUpdateListener();
    removeErrorListener();
  };

  const promise = new Promise<Purchase>((resolve, reject) => {
    const updatedSubscription = purchaseUpdatedListener((purchase) => {
      if (purchase.productId !== productId) {
        return;
      }

      if (purchase.purchaseState === 'pending') {
        return;
      }

      cleanup();
      resolve(purchase);
    });

    const errorSubscription = purchaseErrorListener((error) => {
      cleanup();
      reject(
        new IapPurchaseError(
          error.message || '没有完成购买，请稍后再试。',
          error.code || 'purchase_failed',
        ),
      );
    });

    removeUpdateListener = () => updatedSubscription.remove();
    removeErrorListener = () => errorSubscription.remove();
    timeout = setTimeout(() => {
      cleanup();
      reject(new IapPurchaseError('购买结果确认超时，请稍后重试。', 'purchase_timeout'));
    }, PURCHASE_EVENT_TIMEOUT_MS);
  });

  return {
    promise,
    dispose: cleanup,
  };
}

async function buildVerifyPayload(purchase: Purchase, raw: unknown): Promise<VerifyIapPurchasePayload> {
  const signedTransactionInfo = await loadSignedTransactionInfo(purchase.productId);
  const originalTransactionId =
    'originalTransactionIdentifierIOS' in purchase
    && typeof purchase.originalTransactionIdentifierIOS === 'string'
      ? purchase.originalTransactionIdentifierIOS
      : null;
  const environment =
    'environmentIOS' in purchase && typeof purchase.environmentIOS === 'string'
      ? purchase.environmentIOS
      : null;

  const payload: VerifyIapPurchasePayload = {
    productId: purchase.productId,
    transactionId: typeof purchase.transactionId === 'string' ? purchase.transactionId : '',
    originalTransactionId,
    transactionDate: typeof purchase.transactionDate === 'number' ? purchase.transactionDate : null,
    environment,
    purchaseToken: typeof purchase.purchaseToken === 'string' ? purchase.purchaseToken : null,
    purchaseId: typeof purchase.id === 'string' ? purchase.id : null,
    transactionReceipt: null,
    signedTransactionInfo,
    raw,
  };

  devLog('[iapPurchase] verify payload prepared', {
    productId: payload.productId,
    transactionId: payload.transactionId,
    originalTransactionId: payload.originalTransactionId ?? null,
    environment: payload.environment ?? null,
    ...summarizeSignedTransactionInfo(payload.signedTransactionInfo ?? null),
  });

  return payload;
}

export async function fromPurchaseToPendingTransaction(purchase: Purchase): Promise<IapPendingTransaction> {
  const nowIso = new Date().toISOString();
  const originalTransactionId =
    'originalTransactionIdentifierIOS' in purchase
    && typeof purchase.originalTransactionIdentifierIOS === 'string'
      ? purchase.originalTransactionIdentifierIOS
      : null;
  const environment =
    'environmentIOS' in purchase && typeof purchase.environmentIOS === 'string'
      ? purchase.environmentIOS
      : null;
  const purchaseId = typeof purchase.id === 'string' ? purchase.id : null;
  const transactionId = typeof purchase.transactionId === 'string' ? purchase.transactionId : null;
  if (!transactionId) {
    throw new IapPurchaseError('交易信息不完整，请稍后重试。', 'transaction_missing');
  }
  const verifyPayload = await buildVerifyPayload(purchase, purchase);
  const productType = resolveProductType(purchase.productId);

  return {
    key: resolvePendingKey({
      productId: purchase.productId,
      transactionId,
      purchaseId,
      createdAt: nowIso,
    }),
    productId: purchase.productId,
    productType,
    transactionId,
    originalTransactionId,
    transactionDate: typeof purchase.transactionDate === 'number' ? purchase.transactionDate : null,
    environment,
    purchaseToken: typeof purchase.purchaseToken === 'string' ? purchase.purchaseToken : null,
    purchaseId,
    transactionReceipt: null,
    signedTransactionInfo: verifyPayload.signedTransactionInfo ?? null,
    purchase,
    verifyPayload,
    createdAt: nowIso,
    attemptCount: 0,
  };
}

export function isKnownIapProductId(productId: string) {
  return PRODUCT_TYPE_MAP.has(productId);
}

export async function requestIapProductPurchase(product: AppIapProduct): Promise<IapPendingTransaction> {
  if (!product.storeAvailable) {
    throw new IapPurchaseError('商品暂不可用，请稍后再试。', 'product_unavailable');
  }

  if (Platform.OS !== 'ios') {
    throw new IapPurchaseError('当前仅支持 App Store 购买。', 'unsupported_platform');
  }

  return withIapConnection(async () => {
    const waiter = createPurchaseWaiter(product.productId);

    try {
      const rawPurchase = await requestPurchase({
        request: {
          apple: {
            sku: product.productId,
          },
          google: {
            skus: [product.productId],
          },
        },
        type: 'in-app',
      });

      const selectedPurchase = selectPurchasedItem(rawPurchase, product.productId) ?? (await waiter.promise);
      if (!selectedPurchase || !isPurchaseObject(selectedPurchase)) {
        throw new IapPurchaseError('没有完成购买，请稍后再试。', 'purchase_missing');
      }

      devLog('[iapPurchase] purchase result', {
        productId: selectedPurchase.productId,
        transactionId: selectedPurchase.transactionId ?? null,
        originalTransactionId: 'originalTransactionIdentifierIOS' in selectedPurchase
          ? selectedPurchase.originalTransactionIdentifierIOS ?? null
          : null,
        rawKeys: getPurchaseEventKeys(rawPurchase),
      });

      return fromPurchaseToPendingTransaction(selectedPurchase);
    } catch (error) {
      if (error instanceof IapPurchaseError) {
        throw error;
      }

      throw new IapPurchaseError(
        error instanceof Error ? error.message : '没有完成购买，请稍后再试。',
        extractErrorCode(error) ?? 'purchase_failed',
      );
    } finally {
      waiter.dispose();
    }
  });
}

export async function finishIapPendingTransaction(pending: IapPendingTransaction) {
  if (Platform.OS !== 'ios') {
    throw new IapPurchaseError('当前仅支持 App Store 交易完成。', 'unsupported_platform');
  }

  return withIapConnection(async () => {
    try {
      await finishTransaction({
        purchase: pending.purchase,
        isConsumable: pending.productType === 'credits',
      });
    } catch (error) {
      throw new IapPurchaseError(
        error instanceof Error ? error.message : '完成 App Store 交易失败。',
        'finish_failed',
      );
    }
  });
}

export async function loadPendingStoreKitTransactions(): Promise<IapPendingTransaction[]> {
  if (Platform.OS !== 'ios') {
    return [];
  }

  return withIapConnection(async () => {
    const purchases = await getPendingTransactionsIOS();
    const normalized: IapPendingTransaction[] = [];

    for (const purchase of purchases ?? []) {
      if (!purchase?.productId || !isKnownIapProductId(purchase.productId)) {
        continue;
      }

      normalized.push(await fromPurchaseToPendingTransaction(purchase));
    }

    return normalized;
  });
}
