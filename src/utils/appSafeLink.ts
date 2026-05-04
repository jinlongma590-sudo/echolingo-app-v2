import { Linking, Platform } from 'react-native';

/**
 * iOS app-safe 参数需要 Web 端配合：
 * - hideNav=1 时隐藏官网导航
 * - noPurchase=1 时隐藏注册、登录、价格、购买、激活、升级入口
 * - 页面内部链接也不能跳转到购买路径
 */

const ECHOLINGO_HOSTS = new Set(['echolingo.cn', 'www.echolingo.cn']);
const ECHOLINGO_ALLOWED_PATHS = [
  '/support',
  '/privacy',
  '/terms',
  '/account/delete',
  '/feedback',
  '/resources',
  '/resources/',
  '/learningtechniques',
  '/learningtechniques/',
];
const ECHOLINGO_BLOCKED_PATH_KEYWORDS = [
  '/pricing',
  '/upgrade',
  '/payment',
  '/checkout',
  '/subscribe',
  '/membership',
  '/account',
  '/auth/login',
  '/auth/sign-in',
  '/auth/sign-up',
  '/pay',
  '/purchase',
  '/price',
  '/vip',
  '/member',
  '/plan',
  '/order',
  '/invoice',
  '/alipay',
  '/wechat',
  '/stripe',
];
const ECHOLINGO_BLOCKED_QUERY_KEYWORDS = [
  'pay',
  'purchase',
  'price',
  'vip',
  'member',
  'plan',
  'order',
  'invoice',
  'alipay',
  'wechat',
  'stripe',
  'checkout',
  'upgrade',
  'subscribe',
];

function tryParseUrl(url: string) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function isEchoLingoUrl(url: string): boolean {
  const parsed = tryParseUrl(url);
  if (!parsed) return false;
  return ECHOLINGO_HOSTS.has(parsed.hostname.toLowerCase());
}

function normalizePathname(pathname: string) {
  if (!pathname) return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

function isAllowedEchoLingoPath(pathname: string) {
  const normalized = normalizePathname(pathname);
  return ECHOLINGO_ALLOWED_PATHS.some((allowedPath) => {
    const normalizedAllowed = normalizePathname(allowedPath);
    return normalized === normalizedAllowed || normalized.startsWith(`${normalizedAllowed}/`);
  });
}

function hasBlockedKeyword(value: string, keywords: string[]) {
  const normalized = value.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
}

export function isBlockedEchoLingoUrl(url: string): boolean {
  const parsed = tryParseUrl(url);
  if (!parsed || !isEchoLingoUrl(url)) return false;

  const pathname = normalizePathname(parsed.pathname);
  if (isAllowedEchoLingoPath(pathname)) {
    return false;
  }

  if (pathname === '/') {
    return true;
  }

  if (hasBlockedKeyword(pathname, ECHOLINGO_BLOCKED_PATH_KEYWORDS)) {
    return true;
  }

  const query = parsed.searchParams.toString().toLowerCase();
  if (query && hasBlockedKeyword(query, ECHOLINGO_BLOCKED_QUERY_KEYWORDS)) {
    return true;
  }

  return false;
}

export function toAppSafeUrl(url: string): string {
  if (Platform.OS !== 'ios' || !isEchoLingoUrl(url)) {
    return url;
  }

  const parsed = tryParseUrl(url);
  if (!parsed) return url;

  parsed.searchParams.set('app', 'ios');
  parsed.searchParams.set('source', 'app');
  parsed.searchParams.set('hideNav', '1');
  parsed.searchParams.set('noPurchase', '1');

  return parsed.toString();
}

export async function openAppSafeUrl(url: string): Promise<void> {
  if (Platform.OS === 'ios' && isBlockedEchoLingoUrl(url)) {
    throw new Error('blocked_purchase_risk_url');
  }
  await Linking.openURL(toAppSafeUrl(url));
}
