import { env } from '@/lib/env';

export function buildSupabaseUrl(path: string) {
  return `${env.supabaseUrl.replace(/\/$/, '')}${path}`;
}

export function buildRestTableUrl(table: string, query?: Record<string, string | undefined>) {
  const url = new URL(buildSupabaseUrl(`/rest/v1/${table}`));
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value) {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
}

export function parseCount(headers: Headers) {
  const contentRange = headers.get('content-range');
  if (!contentRange) return 0;
  const total = contentRange.split('/')[1];
  return total ? Number(total) || 0 : 0;
}

const DEFAULT_SUPABASE_TIMEOUT_MS = 8000;

export async function supabaseFetchJson<T>(
  path: string,
  init?: RequestInit,
  accessToken?: string,
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  headers.set('apikey', env.supabaseAnonKey);
  headers.set('Authorization', `Bearer ${accessToken ?? env.supabaseAnonKey}`);

  const externalSignal = init?.signal ?? null;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort();
  }, DEFAULT_SUPABASE_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort);
    }
  }

  let response: Response;
  try {
    response = await fetch(buildSupabaseUrl(path), {
      ...init,
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted && (!externalSignal || !externalSignal.aborted)) {
      throw new Error(`supabase_request_timeout_after_${DEFAULT_SUPABASE_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Supabase request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function supabaseCount(
  table: string,
  query: Record<string, string | undefined>,
  accessToken: string,
) {
  const headers = new Headers();
  headers.set('Accept', 'application/json');
  headers.set('apikey', env.supabaseAnonKey);
  headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('Prefer', 'count=exact');

  const response = await fetch(buildRestTableUrl(table, query), {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Supabase count failed: ${response.status}`);
  }

  return parseCount(response.headers);
}
