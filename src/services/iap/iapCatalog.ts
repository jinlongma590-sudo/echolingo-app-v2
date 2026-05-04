import { endConnection, fetchProducts, initConnection, type Product } from 'expo-iap';
import { Platform } from 'react-native';

import { fetchMobileIapProducts, type MobileIapProduct } from '@/services/api/iapProducts';

export type AppIapProduct = {
  productId: string;
  type: 'membership' | 'credits';
  displayName: string;
  description: string;
  creditsAmount: number | null;
  priceCny?: number | null;
  featured: boolean;
  sortOrder: number;
  storeAvailable: boolean;
  localizedPrice: string | null;
  displayPrice: string | null;
  displayPriceSource:
    | 'storekit_display_price'
    | 'storekit_numeric_price'
    | 'backend_price_fallback'
    | 'local_catalog_fallback'
    | 'unavailable';
  currencyCode: string | null;
  storeTitle: string | null;
  storeDescription: string | null;
};

export const FALLBACK_MOBILE_IAP_PRODUCTS: MobileIapProduct[] = [
  {
    productId: 'cn.echolingo.appv2.membership.activation',
    type: 'membership',
    displayName: 'EchoLingo 完整学习权限',
    description: '解锁完整精听训练、单词深度分析与学习记录同步。',
    creditsAmount: null,
    priceCny: 39.9,
    featured: true,
    sortOrder: 10,
  },
  {
    productId: 'cn.echolingo.appv2.credits.5',
    type: 'credits',
    displayName: '5 Credits',
    description: '适合轻量体验 AI 口语练习。',
    creditsAmount: 5,
    priceCny: 9.9,
    featured: false,
    sortOrder: 20,
  },
  {
    productId: 'cn.echolingo.appv2.credits.15',
    type: 'credits',
    displayName: '15 Credits',
    description: '适合持续练习几天的口语训练。',
    creditsAmount: 15,
    priceCny: 29.9,
    featured: true,
    sortOrder: 30,
  },
  {
    productId: 'cn.echolingo.appv2.credits.30',
    type: 'credits',
    displayName: '30 Credits',
    description: '适合较长周期的口语训练。',
    creditsAmount: 30,
    priceCny: 49.9,
    featured: false,
    sortOrder: 40,
  },
];

type StoreProductDebugInfo = {
  resolvedId: string | null;
  displayPrice: string | null;
  price: number | null;
  currencyCode: string | null;
  title: string | null;
  type: string | null;
};

function logIapCatalog(event: string, payload: Record<string, unknown>) {
  if (event.startsWith('[iap][') || (typeof __DEV__ === 'boolean' && __DEV__)) {
    console.log(`[${event}]`, payload);
  }
}

function sortProducts<T extends { sortOrder: number }>(products: T[]) {
  return [...products].sort((a, b) => a.sortOrder - b.sortOrder);
}

function readStoreProductId(product: Product) {
  const candidate = product as Product & {
    productId?: string | null;
    sku?: string | null;
  };

  return candidate.id ?? candidate.productId ?? candidate.sku ?? null;
}

function describeStoreProduct(product: Product): StoreProductDebugInfo {
  return {
    resolvedId: readStoreProductId(product),
    displayPrice: product.displayPrice ?? null,
    price: typeof product.price === 'number' && Number.isFinite(product.price) ? product.price : null,
    currencyCode: typeof product.currency === 'string' ? product.currency : null,
    title: product.displayName ?? product.title ?? null,
    type: product.type ?? null,
  };
}

function isBillingNotPreparedError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.toLowerCase().includes('billing is not prepared');
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeStoreProducts(products: Product[]) {
  return new Map(
    products.map((product) => [
      readStoreProductId(product),
      {
        localizedPrice: product.displayPrice ?? null,
        price: typeof product.price === 'number' && Number.isFinite(product.price) ? product.price : null,
        currencyCode: typeof product.currency === 'string' ? product.currency : null,
        storeTitle: product.displayName ?? product.title ?? null,
        storeDescription: product.description ?? null,
      },
    ]),
  );
}

function formatPriceFromCurrency(price: number | null, currencyCode: string | null) {
  if (typeof price !== 'number' || !Number.isFinite(price) || !currencyCode) {
    return null;
  }

  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    if (currencyCode === 'CNY') {
      return `¥${price.toFixed(2)}`;
    }

    return `${currencyCode} ${price.toFixed(2)}`;
  }
}

function shouldPreferNumericPrice(displayPrice: string | null, currencyCode: string | null) {
  if (!displayPrice || !currencyCode) {
    return false;
  }

  if (currencyCode === 'CNY' && /\$|US\$/i.test(displayPrice)) {
    return true;
  }

  if (currencyCode === 'USD' && /¥|￥|元/.test(displayPrice)) {
    return true;
  }

  return false;
}

function looksLikeUsdPrice(displayPrice: string | null) {
  if (!displayPrice) {
    return false;
  }

  return /\bUS\$\s*\d|\$\s*\d/.test(displayPrice);
}

function resolveDisplayPrice(params: {
  productId: string;
  localizedPrice: string | null;
  storeNumericPrice: number | null;
  currencyCode: string | null;
  backendPriceCny: number | null | undefined;
  usingFallbackCatalog: boolean;
}) {
  const {
    productId,
    localizedPrice,
    storeNumericPrice,
    currencyCode,
    backendPriceCny,
    usingFallbackCatalog,
  } = params;
  const numericDisplayPrice = formatPriceFromCurrency(storeNumericPrice, currencyCode);
  const backendDisplayPrice =
    typeof backendPriceCny === 'number' && Number.isFinite(backendPriceCny)
      ? `¥${backendPriceCny.toFixed(2)}`
      : null;

  let resolvedPrice: string | null = null;
  let source: AppIapProduct['displayPriceSource'] = 'unavailable';

  if (
    Platform.OS === 'ios' &&
    backendDisplayPrice &&
    looksLikeUsdPrice(localizedPrice) &&
    currencyCode !== 'CNY'
  ) {
    resolvedPrice = backendDisplayPrice;
    source = usingFallbackCatalog ? 'local_catalog_fallback' : 'backend_price_fallback';
  } else if (localizedPrice && !shouldPreferNumericPrice(localizedPrice, currencyCode)) {
    resolvedPrice = localizedPrice;
    source = 'storekit_display_price';
  } else if (numericDisplayPrice) {
    resolvedPrice = numericDisplayPrice;
    source = 'storekit_numeric_price';
  } else if (backendDisplayPrice) {
    resolvedPrice = backendDisplayPrice;
    source = usingFallbackCatalog ? 'local_catalog_fallback' : 'backend_price_fallback';
  }

  logIapCatalog('[iap][price] resolved display price', {
    productId,
    source,
    displayPrice: resolvedPrice,
    currencyCode,
    localizedPrice,
    numericDisplayPrice,
    backendDisplayPrice,
  });

  return {
    displayPrice: resolvedPrice,
    source,
  };
}

export function mergeIapCatalog(
  businessProducts: MobileIapProduct[],
  storeProducts: Product[] | null,
  usingFallbackCatalog = false,
): AppIapProduct[] {
  const storeProductMap = normalizeStoreProducts(storeProducts ?? []);
  const backendProductIds = sortProducts(businessProducts).map((product) => product.productId);
  const storeProductIds = [...storeProductMap.keys()].filter((value): value is string => Boolean(value));
  const unavailableBackendProductIds = backendProductIds.filter((productId) => !storeProductMap.has(productId));
  logIapCatalog('iap_catalog_storekit_join_result', {
    backendProductIds,
    storeProductCount: storeProducts?.length ?? 0,
    storeProductIds,
    unavailableBackendProductIds,
  });

  return sortProducts(businessProducts).map((product) => {
    const storeProduct = storeProductMap.get(product.productId);
    const resolvedDisplayPrice = resolveDisplayPrice({
      productId: product.productId,
      localizedPrice: storeProduct?.localizedPrice ?? null,
      storeNumericPrice: storeProduct?.price ?? null,
      currencyCode: storeProduct?.currencyCode ?? null,
      backendPriceCny: product.priceCny,
      usingFallbackCatalog,
    });

    return {
      ...product,
      storeAvailable: Boolean(storeProduct),
      localizedPrice: storeProduct?.localizedPrice ?? null,
      displayPrice: resolvedDisplayPrice.displayPrice,
      displayPriceSource: resolvedDisplayPrice.source,
      currencyCode: storeProduct?.currencyCode ?? null,
      storeTitle: storeProduct?.storeTitle ?? null,
      storeDescription: storeProduct?.storeDescription ?? null,
    };
  });
}

export async function loadBusinessIapProducts(): Promise<{
  products: MobileIapProduct[];
  usingFallback: boolean;
}> {
  try {
    const products = await fetchMobileIapProducts();
    logIapCatalog('iap_catalog_backend_products', {
      backendProductIds: sortProducts(products).map((product) => product.productId),
      usingFallback: false,
    });
    return {
      products: sortProducts(products),
      usingFallback: false,
    };
  } catch {
    logIapCatalog('iap_catalog_backend_products', {
      backendProductIds: sortProducts(FALLBACK_MOBILE_IAP_PRODUCTS).map((product) => product.productId),
      usingFallback: true,
    });
    return {
      products: sortProducts(FALLBACK_MOBILE_IAP_PRODUCTS),
      usingFallback: true,
    };
  }
}

export async function loadStoreProducts(productIds: string[]): Promise<Product[]> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return [];
  }

  if (productIds.length === 0) {
    return [];
  }

  logIapCatalog('iap_catalog_storekit_fetch_start', {
    requestedSkus: productIds,
  });

  let attempt = 0;

  while (attempt < 2) {
    attempt += 1;
    await initConnection();

    try {
      const products = await fetchProducts({
        skus: productIds,
        type: 'in-app',
      });
      const normalizedProducts = (products ?? []).filter((product): product is Product => product.type === 'in-app');
      logIapCatalog('[iap][products] storekit products loaded', {
        requestedSkus: productIds,
        storeProductCount: normalizedProducts.length,
        storeProducts: normalizedProducts.map((product) => ({
          productId: readStoreProductId(product),
          displayPrice: product.displayPrice ?? null,
          price: typeof product.price === 'number' && Number.isFinite(product.price) ? product.price : null,
          currencyCode: typeof product.currency === 'string' ? product.currency : null,
        })),
      });
      logIapCatalog('iap_catalog_storekit_fetch_result', {
        requestedSkus: productIds,
        storeProductCount: normalizedProducts.length,
        storeProductIds: normalizedProducts.map((product) => readStoreProductId(product)),
        storeProducts: normalizedProducts.map(describeStoreProduct),
      });
      return normalizedProducts;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? 'unknown_error');
      logIapCatalog('iap_catalog_storekit_fetch_failed', {
        requestedSkus: productIds,
        attempt,
        message,
      });

      if (attempt < 2 && isBillingNotPreparedError(error)) {
        await sleep(650);
        continue;
      }

      throw error;
    } finally {
      await endConnection();
    }
  }

  return [];
}
