import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
  loadBusinessIapProducts,
  loadStoreProducts,
  mergeIapCatalog,
  type AppIapProduct,
} from '@/services/iap/iapCatalog';

type UseIapCatalogResult = {
  products: AppIapProduct[];
  membershipProduct: AppIapProduct | null;
  creditProducts: AppIapProduct[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  usingFallbackCatalog: boolean;
  storePriceAvailable: boolean;
};

export function useIapCatalog(): UseIapCatalogResult {
  const [products, setProducts] = useState<AppIapProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingFallbackCatalog, setUsingFallbackCatalog] = useState(false);
  const inflightRefreshRef = useRef<Promise<void> | null>(null);
  const lastSuccessfulRefreshAtRef = useRef(0);
  const lastRefreshFailedRef = useRef(true);
  const productCountRef = useRef(0);

  const refresh = useCallback(async () => {
    if (inflightRefreshRef.current) {
      return inflightRefreshRef.current;
    }

    const task = (async () => {
      setLoading(true);
      setError(null);

      const business = await loadBusinessIapProducts();
      setUsingFallbackCatalog(business.usingFallback);

      try {
        const storeProducts = await loadStoreProducts(business.products.map((product) => product.productId));
        const mergedProducts = mergeIapCatalog(
          business.products,
          storeProducts,
          business.usingFallback,
        );
        setProducts(mergedProducts);
        productCountRef.current = mergedProducts.length;
        lastSuccessfulRefreshAtRef.current = Date.now();
        lastRefreshFailedRef.current = false;
      } catch (err) {
        const mergedProducts = mergeIapCatalog(business.products, null, business.usingFallback);
        setProducts(mergedProducts);
        productCountRef.current = mergedProducts.length;
        lastRefreshFailedRef.current = true;
        setError(err instanceof Error ? err.message : '暂时无法获取 App Store 价格，请稍后重试。');
      } finally {
        setLoading(false);
      }
    })();

    inflightRefreshRef.current = task;

    try {
      await task;
    } finally {
      inflightRefreshRef.current = null;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      const shouldRefresh =
        productCountRef.current === 0 ||
        lastRefreshFailedRef.current ||
        Date.now() - lastSuccessfulRefreshAtRef.current >= 60_000;

      if (shouldRefresh) {
        void refresh();
      }
      return undefined;
    }, [refresh]),
  );

  const membershipProduct = products.find((product) => product.type === 'membership') ?? null;
  const creditProducts = products.filter((product) => product.type === 'credits');
  const storePriceAvailable = products.some((product) => product.storeAvailable && Boolean(product.displayPrice));

  return {
    products,
    membershipProduct,
    creditProducts,
    loading,
    error,
    refresh,
    usingFallbackCatalog,
    storePriceAvailable,
  };
}
