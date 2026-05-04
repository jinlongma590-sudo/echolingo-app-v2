import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { fetchMobileIapProducts, type MobileIapProduct } from '@/services/api/iapProducts';
import { FALLBACK_MOBILE_IAP_PRODUCTS } from '@/services/iap/iapCatalog';

type UseIapProductsResult = {
  products: MobileIapProduct[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  usingFallback: boolean;
};

const IAP_PRODUCTS_REFRESH_STALE_MS = 60_000;

function sortProducts(products: MobileIapProduct[]) {
  return [...products].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function useIapProducts(): UseIapProductsResult {
  const [products, setProducts] = useState<MobileIapProduct[]>(sortProducts(FALLBACK_MOBILE_IAP_PRODUCTS));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingFallback, setUsingFallback] = useState(false);
  const inflightRefreshRef = useRef<Promise<void> | null>(null);
  const lastSuccessfulRefreshAtRef = useRef(0);
  const lastRefreshFailedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (inflightRefreshRef.current) {
      return inflightRefreshRef.current;
    }

    const task = (async () => {
      setLoading(true);
      setError(null);

      try {
        const next = await fetchMobileIapProducts();
        setProducts(sortProducts(next));
        setUsingFallback(false);
        lastSuccessfulRefreshAtRef.current = Date.now();
        lastRefreshFailedRef.current = false;
      } catch (err) {
        setProducts(sortProducts(FALLBACK_MOBILE_IAP_PRODUCTS));
        setUsingFallback(true);
        lastRefreshFailedRef.current = true;
        setError(err instanceof Error ? err.message : '商品目录暂时读取失败，请稍后重试。');
      } finally {
        setLoading(false);
      }
    })();

    inflightRefreshRef.current = task;
    try {
      await task;
    } finally {
      if (inflightRefreshRef.current === task) {
        inflightRefreshRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      const shouldRefresh =
        products.length === 0 ||
        lastRefreshFailedRef.current ||
        Date.now() - lastSuccessfulRefreshAtRef.current >= IAP_PRODUCTS_REFRESH_STALE_MS;

      if (shouldRefresh) {
        void refresh();
      }
      return undefined;
    }, [products.length, refresh]),
  );

  return {
    products,
    loading,
    error,
    refresh,
    usingFallback,
  };
}
