const PRODUCTION_API_BASE_URL = 'https://echolingo.cn';

function normalizeBaseUrl(value?: string | null) {
  return (value || '').trim().replace(/\/+$/, '');
}

function isLocalOrInsecureApiBaseUrl(value: string) {
  if (!value) return false;
  return /^http:\/\/|^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168(?:\.\d{1,3}){2})(?::\d+)?(?:\/|$)/i.test(
    value,
  );
}

function resolveRuntimeApiBaseUrl(rawValue?: string | null) {
  const normalizedRawValue = normalizeBaseUrl(rawValue);
  const releaseRejectedLocalUrl = !__DEV__ && isLocalOrInsecureApiBaseUrl(normalizedRawValue);
  if (releaseRejectedLocalUrl) {
    return {
      value: PRODUCTION_API_BASE_URL,
      releaseRejectedLocalUrl: true,
    };
  }

  return {
    value: normalizedRawValue || PRODUCTION_API_BASE_URL,
    releaseRejectedLocalUrl: false,
  };
}

const rawApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
const rawWebApiBaseUrl = process.env.EXPO_PUBLIC_ECHOLINGO_WEB_API_BASE;
const resolvedApiBaseUrl = resolveRuntimeApiBaseUrl(rawApiBaseUrl);
const resolvedWebApiBaseUrl = resolveRuntimeApiBaseUrl(rawWebApiBaseUrl || rawApiBaseUrl);

export const env = {
  apiBaseUrl: resolvedApiBaseUrl.value,
  webApiBaseUrl: resolvedWebApiBaseUrl.value,
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://qjowqrcgfakopkatqtuk.supabase.co',
  supabaseAnonKey:
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqb3dxcmNnZmFrb3BrYXRxdHVrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NzY0NjgsImV4cCI6MjA4ODQ1MjQ2OH0.71bXmagxGuoa7VdypPJABZ3HWhYuQe2iFO3oQe8XC6Q',
  mediaDomain: process.env.EXPO_PUBLIC_MEDIA_DOMAIN ?? 'https://media.echolingo.cn',
} as const;

console.log(
  '[env] runtime_api_config',
  JSON.stringify({
    __DEV__,
    hasRawApiBaseUrl: Boolean(normalizeBaseUrl(rawApiBaseUrl)),
    hasRawWebApiBaseUrl: Boolean(normalizeBaseUrl(rawWebApiBaseUrl)),
    apiBaseUrl: env.apiBaseUrl,
    webApiBaseUrl: env.webApiBaseUrl,
    releaseLocalUrlFallbackTriggered:
      resolvedApiBaseUrl.releaseRejectedLocalUrl || resolvedWebApiBaseUrl.releaseRejectedLocalUrl,
  }),
);

export const hasSupabaseEnv = Boolean(env.supabaseUrl && env.supabaseAnonKey);
