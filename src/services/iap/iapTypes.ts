import type { Purchase } from 'expo-iap';

import type { VerifyIapPurchasePayload, VerifyIapPurchaseResponse } from '@/services/api/iapVerify';

export type IapPurchasePhase =
  | 'idle'
  | 'loading_product'
  | 'purchasing'
  | 'verifying'
  | 'finishing'
  | 'success'
  | 'cancelled'
  | 'product_unavailable'
  | 'verify_failed'
  | 'finish_failed'
  | 'restore_checking'
  | 'restore_success'
  | 'restore_empty'
  | 'error';

export type IapProductType = 'membership' | 'credits';

export type IapStatusTone = 'neutral' | 'blue' | 'amber' | 'green' | 'red';

export type IapPendingTransaction = {
  key: string;
  productId: string;
  productType: IapProductType;
  transactionId: string | null;
  originalTransactionId: string | null;
  transactionDate: number | null;
  environment: string | null;
  purchaseToken: string | null;
  purchaseId: string | null;
  transactionReceipt: string | null;
  signedTransactionInfo: string | null;
  purchase: Purchase;
  verifyPayload: VerifyIapPurchasePayload;
  createdAt: string;
  lastVerifyAttemptAt?: string;
  attemptCount: number;
};

export type IapRestoreSummary = {
  foundCount: number;
  processedCount: number;
  duplicatedCount: number;
  failedCount: number;
  creditsAdded: number;
  restoredMembership: boolean;
};

export type IapProcessedPendingResult =
  | {
      status: 'success';
      verifyResponse: VerifyIapPurchaseResponse;
      refreshFailed: boolean;
    }
  | {
      status: 'verify_failed';
      errorCode: string;
      message: string;
    }
  | {
      status: 'finish_failed';
      verifyResponse: VerifyIapPurchaseResponse;
      message: string;
      refreshFailed: boolean;
    };
