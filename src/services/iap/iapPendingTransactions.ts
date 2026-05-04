import * as SecureStore from 'expo-secure-store';

import type { IapPendingTransaction } from '@/services/iap/iapTypes';

const IAP_PENDING_TRANSACTIONS_KEY = 'echolingo.iap.pending-transactions.v1';

function warn(event: string, error: unknown) {
  console.warn(event, error instanceof Error ? error.message : String(error ?? 'unknown_error'));
}

function parsePendingTransactions(raw: string | null) {
  if (!raw) {
    return [] as IapPendingTransaction[];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as IapPendingTransaction[]) : [];
  } catch (error) {
    warn('iap_pending_transactions_parse_failed', error);
    return [];
  }
}

function sortPendingTransactions(items: IapPendingTransaction[]) {
  return [...items].sort((a, b) => {
    const aTime = Date.parse(a.createdAt) || 0;
    const bTime = Date.parse(b.createdAt) || 0;
    return bTime - aTime;
  });
}

function isSamePendingTransaction(a: IapPendingTransaction, b: IapPendingTransaction) {
  if (a.transactionId && b.transactionId) {
    return a.transactionId === b.transactionId;
  }

  return a.key === b.key;
}

async function writePendingTransactions(items: IapPendingTransaction[]) {
  try {
    if (items.length === 0) {
      await SecureStore.deleteItemAsync(IAP_PENDING_TRANSACTIONS_KEY);
      return;
    }

    await SecureStore.setItemAsync(IAP_PENDING_TRANSACTIONS_KEY, JSON.stringify(sortPendingTransactions(items)));
  } catch (error) {
    warn('iap_pending_transactions_save_failed', error);
  }
}

export async function loadPendingIapTransactions() {
  try {
    const raw = await SecureStore.getItemAsync(IAP_PENDING_TRANSACTIONS_KEY);
    return sortPendingTransactions(parsePendingTransactions(raw));
  } catch (error) {
    warn('iap_pending_transactions_load_failed', error);
    return [] as IapPendingTransaction[];
  }
}

export async function replacePendingIapTransactions(items: IapPendingTransaction[]) {
  await writePendingTransactions(items);
}

export async function upsertPendingIapTransaction(item: IapPendingTransaction) {
  const current = await loadPendingIapTransactions();
  const next = sortPendingTransactions([
    item,
    ...current.filter((existing) => !isSamePendingTransaction(existing, item)),
  ]);
  await writePendingTransactions(next);
  return next;
}

export async function removePendingIapTransaction(key: string) {
  const current = await loadPendingIapTransactions();
  const next = current.filter((item) => item.key !== key);
  await writePendingTransactions(next);
  return next;
}

export function mergePendingIapTransactions(items: IapPendingTransaction[]) {
  const merged: IapPendingTransaction[] = [];

  for (const item of sortPendingTransactions(items)) {
    if (!merged.some((existing) => isSamePendingTransaction(existing, item))) {
      merged.push(item);
    }
  }

  return merged;
}
