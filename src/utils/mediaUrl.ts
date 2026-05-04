import { env } from '@/lib/env';

const LEGACY_R2_COVER_HOST = 'pub-bf6a17cf6a89408daa2cd1729c101e5c.r2.dev';

function ensureTrailingSlash(value: string) {
  return value.endsWith('/') ? value : `${value}/`;
}

function normalizeAbsoluteUrl(input: string) {
  try {
    const parsed = new URL(input);
    const normalizedMediaBase = ensureTrailingSlash(env.mediaDomain.replace(/\/$/, ''));

    if (parsed.hostname === LEGACY_R2_COVER_HOST && parsed.pathname.startsWith('/covers/')) {
      return new URL(parsed.pathname.replace(/^\/+/, ''), normalizedMediaBase).toString();
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export function normalizeMediaUrl(rawValue?: string | null) {
  if (typeof rawValue !== 'string') {
    return null;
  }

  const value = rawValue.trim();
  if (!value) {
    return null;
  }

  if (/^https?:\/\//i.test(value)) {
    return normalizeAbsoluteUrl(value);
  }

  if (value.startsWith('//')) {
    return normalizeAbsoluteUrl(`https:${value}`);
  }

  if (value.startsWith('/')) {
    return `${env.apiBaseUrl.replace(/\/$/, '')}${value}`;
  }

  if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/|$)/i.test(value)) {
    return normalizeAbsoluteUrl(`https://${value.replace(/^\/+/, '')}`);
  }

  if (/(cloudflare|r2\.dev|aliyuncs\.com|amazonaws\.com|oss-|media\.echolingo\.cn)/i.test(value)) {
    return normalizeAbsoluteUrl(`https://${value.replace(/^\/+/, '')}`);
  }

  return null;
}

export function normalizeCoverUrl(rawValue?: string | null) {
  return normalizeMediaUrl(rawValue);
}
