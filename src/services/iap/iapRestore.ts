import { getAvailablePurchases } from 'expo-iap';
import { Platform } from 'react-native';

import {
  fromPurchaseToPendingTransaction,
  isKnownIapProductId,
  withIapConnection,
} from '@/services/iap/iapPurchase';
import type { IapPendingTransaction } from '@/services/iap/iapTypes';

export async function loadRestorableIapTransactions(): Promise<IapPendingTransaction[]> {
  if (Platform.OS !== 'ios') {
    return [];
  }

  return withIapConnection(async () => {
    const purchases = await getAvailablePurchases();
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
