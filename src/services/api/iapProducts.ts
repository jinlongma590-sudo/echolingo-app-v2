import { env } from '@/lib/env';

export type MobileIapProduct = {
  productId: string;
  type: 'membership' | 'credits';
  displayName: string;
  description: string;
  creditsAmount: number | null;
  priceCny?: number | null;
  featured: boolean;
  sortOrder: number;
};

type IapProductsResponse = {
  products?: MobileIapProduct[];
};

export class IapProductsApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'IapProductsApiError';
    this.status = status;
  }
}

function buildIapProductsUrl() {
  return `${env.apiBaseUrl.replace(/\/$/, '')}/api/mobile/iap/products`;
}

export async function fetchMobileIapProducts(): Promise<MobileIapProduct[]> {
  const response = await fetch(buildIapProductsUrl(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  const contentType = response.headers.get('content-type') ?? response.headers.get('Content-Type') ?? '';
  const bodyText = await response.text().catch(() => '');
  const parsed =
    /application\/json/i.test(contentType) && bodyText ? (JSON.parse(bodyText) as IapProductsResponse) : null;

  if (!response.ok) {
    throw new IapProductsApiError('商品目录暂时读取失败，请稍后重试。', response.status);
  }

  const products = parsed?.products;
  if (!Array.isArray(products)) {
    throw new IapProductsApiError('商品目录返回格式异常。', response.status);
  }

  return products;
}
