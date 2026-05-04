import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { IapVerifyApiError, verifyIapPurchase } from '@/services/api/iapVerify';
import { type AppIapProduct } from '@/services/iap/iapCatalog';
import {
  loadPendingStoreKitTransactions,
  requestIapProductPurchase,
  finishIapPendingTransaction,
  isUserCancelledPurchaseError,
} from '@/services/iap/iapPurchase';
import {
  loadPendingIapTransactions,
  mergePendingIapTransactions,
  removePendingIapTransaction,
  replacePendingIapTransactions,
  upsertPendingIapTransaction,
} from '@/services/iap/iapPendingTransactions';
import { loadRestorableIapTransactions } from '@/services/iap/iapRestore';
import type {
  IapPendingTransaction,
  IapProcessedPendingResult,
  IapPurchasePhase,
  IapRestoreSummary,
  IapStatusTone,
} from '@/services/iap/iapTypes';

type UseIapPurchaseFlowOptions = {
  accessToken: string | null;
  refreshAccount: () => Promise<unknown>;
};

type PhasePresentation = {
  title: string | null;
  detail: string | null;
  tone: IapStatusTone;
};

type UseIapPurchaseFlowResult = {
  phase: IapPurchasePhase;
  phaseTitle: string | null;
  phaseDetail: string | null;
  phaseTone: IapStatusTone;
  pendingTransaction: IapPendingTransaction | null;
  pendingCount: number;
  restoreSummary: IapRestoreSummary | null;
  isBusy: boolean;
  purchaseProduct: (product: AppIapProduct) => Promise<void>;
  resumePendingTransaction: () => Promise<void>;
  restorePurchases: () => Promise<void>;
  refreshPendingTransactions: () => Promise<void>;
  resetPhase: () => void;
};

function summarizeRestore(summary: IapRestoreSummary) {
  if (summary.foundCount === 0) {
    return '没有找到可恢复的购买。';
  }

  const parts = [
    `已检查 ${summary.foundCount} 笔购买记录`,
    `成功处理 ${summary.processedCount} 笔`,
  ];

  if (summary.duplicatedCount > 0) {
    parts.push(`已识别 ${summary.duplicatedCount} 笔重复记录`);
  }

  if (summary.creditsAdded > 0) {
    parts.push(`到账 ${summary.creditsAdded} Credits`);
  }

  if (summary.restoredMembership) {
    parts.push('已恢复会员权益');
  }

  if (summary.failedCount > 0) {
    parts.push(`失败 ${summary.failedCount} 笔`);
  }

  return `${parts.join('，')}。`;
}

function buildPhasePresentation(params: {
  phase: IapPurchasePhase;
  message: string | null;
  restoreSummary: IapRestoreSummary | null;
}): PhasePresentation {
  const { phase, message, restoreSummary } = params;

  switch (phase) {
    case 'loading_product':
      return { title: '正在读取商品', detail: '正在读取 App Store 商品信息。', tone: 'blue' };
    case 'purchasing':
      return { title: '正在购买', detail: '已发起 App Store 购买请求，请稍候。', tone: 'blue' };
    case 'verifying':
      return { title: '正在确认购买', detail: '正在确认购买结果并更新账号权益。', tone: 'amber' };
    case 'finishing':
      return { title: '正在同步购买状态', detail: '购买已确认，正在同步当前状态。', tone: 'amber' };
    case 'success':
      return {
        title: '购买成功',
        detail: message ?? '购买已完成，账号权益已刷新。',
        tone: 'green',
      };
    case 'cancelled':
      return {
        title: '已取消购买',
        detail: message ?? '你已取消本次购买，当前没有发放任何权益。',
        tone: 'neutral',
      };
    case 'product_unavailable':
      return {
        title: '商品暂不可用',
        detail: message ?? '暂未从 App Store 获取到商品价格，请稍后再试。',
        tone: 'red',
      };
    case 'verify_failed':
      return {
        title: '购买确认失败，请稍后重试',
        detail: message ?? '这笔购买暂未完成确认，你可以稍后重试或使用恢复购买。',
        tone: 'red',
      };
    case 'finish_failed':
      return {
        title: '购买状态同步失败，请稍后重试',
        detail:
          message ??
          '权益可能已更新，如状态暂未显示，可稍后重试或使用恢复购买。',
        tone: 'amber',
      };
    case 'restore_checking':
      return {
        title: '正在恢复购买',
        detail: '正在查找已购买的权益并恢复到当前账号。',
        tone: 'blue',
      };
    case 'restore_success':
      return {
        title: '恢复购买完成',
        detail: restoreSummary ? summarizeRestore(restoreSummary) : '已完成恢复购买。',
        tone: 'green',
      };
    case 'restore_empty':
      return {
        title: '没有可恢复交易',
        detail: '当前 App Store 账号下没有待恢复的购买记录。',
        tone: 'neutral',
      };
    case 'error':
      return {
        title: '购买流程未完成',
        detail: message ?? '请稍后重试，或使用恢复购买找回已购买的权益。',
        tone: 'red',
      };
    case 'idle':
    default:
      return { title: null, detail: null, tone: 'neutral' };
  }
}

async function safelyRefreshAccount(refreshAccount: () => Promise<unknown>) {
  try {
    await refreshAccount();
    return true;
  } catch (error) {
    console.warn('iap_refresh_mobile_me_failed', error);
    return false;
  }
}

function normalizeMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function normalizeVerifyFailureMessage(error: unknown) {
  if (error instanceof IapVerifyApiError) {
    if (error.code === 'apple_verification_not_configured') {
      return '购买确认失败，请稍后重试。如已购买，可点击“恢复购买”。';
    }

    return error.message || '购买确认暂时失败，请稍后重试。';
  }

  return normalizeMessage(error, '购买确认暂时失败，请稍后重试。');
}

export function useIapPurchaseFlow(options: UseIapPurchaseFlowOptions): UseIapPurchaseFlowResult {
  const { accessToken, refreshAccount } = options;
  const [phase, setPhase] = useState<IapPurchasePhase>('idle');
  const [phaseMessage, setPhaseMessage] = useState<string | null>(null);
  const [pendingTransaction, setPendingTransaction] = useState<IapPendingTransaction | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [restoreSummary, setRestoreSummary] = useState<IapRestoreSummary | null>(null);

  const refreshPendingTransactions = useCallback(async () => {
    if (Platform.OS !== 'ios') {
      setPendingTransaction(null);
      setPendingCount(0);
      return;
    }

    const stored = await loadPendingIapTransactions();
    let storeKitPending: IapPendingTransaction[] = [];

    try {
      storeKitPending = await loadPendingStoreKitTransactions();
    } catch (error) {
      console.warn('iap_load_store_pending_transactions_failed', error);
    }

    const merged = mergePendingIapTransactions([...stored, ...storeKitPending]);
    await replacePendingIapTransactions(merged);
    setPendingTransaction(merged[0] ?? null);
    setPendingCount(merged.length);
  }, []);

  useEffect(() => {
    void refreshPendingTransactions();
  }, [refreshPendingTransactions]);

  useFocusEffect(
    useCallback(() => {
      void refreshPendingTransactions();
      return undefined;
    }, [refreshPendingTransactions]),
  );

  const processPendingTransaction = useCallback(
    async (pending: IapPendingTransaction): Promise<IapProcessedPendingResult> => {
      if (!accessToken) {
        return {
          status: 'verify_failed',
          errorCode: 'unauthorized',
          message: '请先登录后再继续。',
        };
      }

      const nextPending: IapPendingTransaction = {
        ...pending,
        attemptCount: Math.max(pending.attemptCount, 0) + 1,
        lastVerifyAttemptAt: new Date().toISOString(),
      };

      await upsertPendingIapTransaction(nextPending);
      setPendingTransaction(nextPending);
      setPendingCount((count) => Math.max(count, 1));
      setPhase('verifying');
      setPhaseMessage('正在确认这笔购买。');

      let verifyResponse;
      try {
        verifyResponse = await verifyIapPurchase(accessToken, nextPending.verifyPayload);
      } catch (error) {
        const message = normalizeVerifyFailureMessage(error);

        return {
          status: 'verify_failed',
          errorCode: error instanceof IapVerifyApiError ? error.code : 'verify_failed',
          message,
        };
      }

      if (verifyResponse.shouldFinishTransaction !== true) {
        return {
          status: 'verify_failed',
          errorCode: 'finish_not_allowed',
          message: '这笔购买暂时还不能完成确认，请稍后再试。',
        };
      }

      setPhase('finishing');
      setPhaseMessage('正在同步购买状态。');

      try {
        await finishIapPendingTransaction(nextPending);
      } catch (error) {
        const refreshSucceeded = await safelyRefreshAccount(refreshAccount);
        return {
          status: 'finish_failed',
          verifyResponse,
          refreshFailed: !refreshSucceeded,
          message:
            '权益可能已更新，但购买状态暂未同步完成。请稍后重试或使用恢复购买。',
        };
      }

      await removePendingIapTransaction(nextPending.key);
      const refreshSucceeded = await safelyRefreshAccount(refreshAccount);
      await refreshPendingTransactions();

      return {
        status: 'success',
        verifyResponse,
        refreshFailed: !refreshSucceeded,
      };
    },
    [accessToken, refreshAccount, refreshPendingTransactions],
  );

  const purchaseProduct = useCallback(
    async (product: AppIapProduct) => {
      setRestoreSummary(null);

      if (!accessToken) {
        setPhase('error');
        setPhaseMessage('请先登录后再继续。');
        return;
      }

      if (!product.storeAvailable) {
        setPhase('product_unavailable');
        setPhaseMessage('暂未从 App Store 获取到该商品价格，请稍后再试。');
        return;
      }

      setPhase('purchasing');
      setPhaseMessage('已发起 App Store 购买请求。');

      try {
        const pending = await requestIapProductPurchase(product);
        await upsertPendingIapTransaction(pending);
        await refreshPendingTransactions();

        const result = await processPendingTransaction(pending);
        if (result.status === 'success') {
          setPhase('success');
          setPhaseMessage(
            result.refreshFailed
              ? '购买已完成，账号状态会在下次刷新后同步。'
              : '购买已完成，账号权益已刷新。',
          );
          return;
        }

        if (result.status === 'finish_failed') {
          setPhase('finish_failed');
          setPhaseMessage(
            result.refreshFailed
              ? `${result.message} 账号状态稍后刷新后会同步。`
              : result.message,
          );
          await refreshPendingTransactions();
          return;
        }

        setPhase('verify_failed');
        setPhaseMessage(result.message);
        await refreshPendingTransactions();
      } catch (error) {
        if (isUserCancelledPurchaseError(error)) {
          setPhase('cancelled');
          setPhaseMessage('你已取消本次购买。');
          return;
        }

        const message = normalizeMessage(error, '没有完成购买，请稍后再试。');
        const purchaseError =
          error && typeof error === 'object' && 'code' in error
            ? (error as { code?: string })
            : null;

        if (purchaseError?.code === 'product_unavailable') {
          setPhase('product_unavailable');
        } else {
          setPhase('error');
        }

        setPhaseMessage(message);
      }
    },
    [accessToken, processPendingTransaction, refreshPendingTransactions],
  );

  const resumePendingTransaction = useCallback(async () => {
    setRestoreSummary(null);

    const pending = pendingTransaction ?? (await loadPendingIapTransactions())[0] ?? null;
    if (!pending) {
      setPhase('restore_empty');
      setPhaseMessage('当前没有需要继续处理的购买。');
      return;
    }

    const result = await processPendingTransaction(pending);
    if (result.status === 'success') {
      setPhase('success');
      setPhaseMessage(
        result.refreshFailed
          ? '购买已恢复，账号状态会在下次刷新后同步。'
          : '购买已恢复，账号权益已刷新。',
      );
      return;
    }

    if (result.status === 'finish_failed') {
      setPhase('finish_failed');
      setPhaseMessage(
        result.refreshFailed ? `${result.message} 账号状态稍后刷新后会同步。` : result.message,
      );
      return;
    }

    setPhase('verify_failed');
    setPhaseMessage(result.message);
  }, [pendingTransaction, processPendingTransaction]);

  const restorePurchases = useCallback(async () => {
    setRestoreSummary(null);

    if (!accessToken) {
      setPhase('error');
      setPhaseMessage('请先登录后再继续。');
      return;
    }

    setPhase('restore_checking');
    setPhaseMessage('正在查找可恢复的购买。');

    try {
      const restorable = await loadRestorableIapTransactions();

      if (restorable.length === 0) {
        await refreshPendingTransactions();
        setPhase('restore_empty');
        setPhaseMessage('没有找到可恢复的购买。');
        return;
      }

      let processedCount = 0;
      let duplicatedCount = 0;
      let failedCount = 0;
      let creditsAdded = 0;
      let restoredMembership = false;

      for (const pending of restorable) {
        await upsertPendingIapTransaction(pending);
        const result = await processPendingTransaction(pending);

        if (result.status === 'success') {
          processedCount += 1;
          if (result.verifyResponse.duplicated) {
            duplicatedCount += 1;
          }
          if (result.verifyResponse.entitlementType === 'membership') {
            restoredMembership = true;
          }
          creditsAdded += Math.max(result.verifyResponse.creditsAdded ?? 0, 0);
          continue;
        }

        if (result.status === 'finish_failed') {
          processedCount += 1;
          failedCount += 1;
          if (result.verifyResponse.duplicated) {
            duplicatedCount += 1;
          }
          if (result.verifyResponse.entitlementType === 'membership') {
            restoredMembership = true;
          }
          creditsAdded += Math.max(result.verifyResponse.creditsAdded ?? 0, 0);
          continue;
        }

        failedCount += 1;
      }

      const summary: IapRestoreSummary = {
        foundCount: restorable.length,
        processedCount,
        duplicatedCount,
        failedCount,
        creditsAdded,
        restoredMembership,
      };

      setRestoreSummary(summary);
      await refreshPendingTransactions();

      if (processedCount === 0) {
        setPhase('error');
        setPhaseMessage('恢复购买失败，请稍后再试。');
        return;
      }

      setPhase('restore_success');
      setPhaseMessage(summarizeRestore(summary));
    } catch (error) {
      setPhase('error');
      setPhaseMessage(normalizeMessage(error, '恢复购买失败，请稍后再试。'));
    }
  }, [accessToken, processPendingTransaction, refreshPendingTransactions]);

  const resetPhase = useCallback(() => {
    setPhase('idle');
    setPhaseMessage(null);
    setRestoreSummary(null);
  }, []);

  const presentation = useMemo(
    () => buildPhasePresentation({ phase, message: phaseMessage, restoreSummary }),
    [phase, phaseMessage, restoreSummary],
  );

  return {
    phase,
    phaseTitle: presentation.title,
    phaseDetail: presentation.detail,
    phaseTone: presentation.tone,
    pendingTransaction,
    pendingCount,
    restoreSummary,
    isBusy:
      phase === 'loading_product'
      || phase === 'purchasing'
      || phase === 'verifying'
      || phase === 'finishing'
      || phase === 'restore_checking',
    purchaseProduct,
    resumePendingTransaction,
    restorePurchases,
    refreshPendingTransactions,
    resetPhase,
  };
}
