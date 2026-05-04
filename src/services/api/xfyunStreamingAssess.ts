import { encodeBase64 } from '@/services/audio/pcmUtils';
import { env } from '@/lib/env';
import type {
  XfyunPronunciationDebug,
  XfyunRtasrTranscript,
} from '@/types/pcmDualStream';
import type {
  XfyunPhoneAssessment,
  XfyunPronunciationAssessment,
  XfyunSyllableAssessment,
  XfyunWordAssessment,
} from '@/types/xfyunSpeakingAssessment';

const LOG_PREFIX = '[V1_PCM_DUAL]';
const RTASR_TIMEOUT_MS = 8000;
const RTASR_FINAL_WAIT_MS = 5000;
const RTASR_FRAME_INTERVAL_MS = 40;
const ISE_TIMEOUT_MS = 12000;
const ISE_FRAME_BYTES = 1280;
const ISE_FRAME_INTERVAL_MS = 40;
const LOCAL_WEB_API_HEALTH_TIMEOUT_MS = 4000;
const LOCAL_WEB_API_SIGN_TIMEOUT_MS = 8000;

type LooseRecord = Record<string, unknown>;

type SignedUrlResponse = {
  ok: boolean;
  signedUrl?: string;
  appId?: string;
  error?: {
    code?: string;
    message?: string;
  };
};

function log(step: string, payload: Record<string, unknown>) {
  console.log(`${LOG_PREFIX} ${step} = ${JSON.stringify(payload)}`);
}

type WebApiConfig = {
  webApiBase: string;
  rtasrSignUrl: string;
  iseSignUrl: string;
  source: 'env.webApiBaseUrl' | 'env.apiBaseUrl';
};

let cachedWebApiConfigKey: string | null = null;
let cachedWebApiConfig: WebApiConfig | null = null;
let cachedHealthCheck: { key: string; ok: boolean } | null = null;

function classifyAbortReason(input: {
  message?: string | null;
  timedOut?: boolean;
  staleRound?: boolean;
  explicitAbortReason?: string | null;
}) {
  if (input.staleRound) return 'stale_round';
  if (input.timedOut) return 'timeout';
  if (input.explicitAbortReason) return input.explicitAbortReason;
  if (/abort|aborted/i.test(input.message || '')) return 'abort';
  return null;
}

function getFetchErrorMeta(input: {
  error: unknown;
  timedOut?: boolean;
  staleRound?: boolean;
  explicitAbortReason?: string | null;
}) {
  const errorName = input.error instanceof Error ? input.error.name : 'UnknownError';
  const message = input.error instanceof Error ? input.error.message : 'unknown_error';
  return {
    errorName,
    message,
    abortReason: classifyAbortReason({
      message,
      timedOut: input.timedOut,
      staleRound: input.staleRound,
      explicitAbortReason: input.explicitAbortReason,
    }),
  };
}

function normalizeUnknownError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function normalizeBaseUrl(baseUrl?: string | null) {
  return (baseUrl || '').trim().replace(/\/+$/, '');
}

function summarizeResponsePreview(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 160);
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripXmlTags(value: string) {
  return value.replace(/<[^>]+>/g, ' ');
}

function normalizeDisplayWord(value: string) {
  return decodeHtmlEntities(stripXmlTags(value)).replace(/\s+/g, ' ').trim();
}

function sanitizeIseReferenceText(referenceText: string) {
  const normalized = normalizeSpacing(referenceText)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\b[Ii]'d\b/g, 'I would')
    .replace(/\b[Yy]ou'd\b/g, 'you would')
    .replace(/\b[Hh]e'd\b/g, 'he would')
    .replace(/\b[Ss]he'd\b/g, 'she would')
    .replace(/\b[Ww]e'd\b/g, 'we would')
    .replace(/\b[Tt]hey'd\b/g, 'they would')
    .replace(/\b[Ii]'m\b/g, 'I am')
    .replace(/\b[Cc]an't\b/g, 'cannot')
    .replace(/\b[Ww]on't\b/g, 'will not')
    .replace(/\b([A-Za-z]+)n't\b/g, '$1 not')
    .replace(/\b([A-Za-z]+)'re\b/g, '$1 are')
    .replace(/\b([A-Za-z]+)'ve\b/g, '$1 have')
    .replace(/\b([A-Za-z]+)'ll\b/g, '$1 will')
    .replace(/\b([A-Za-z]+)'s\b/g, '$1 is')
    .replace(/[^A-Za-z0-9\s,.!?;:-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return referenceText.trim();
  }
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function isPauseToken(value: string) {
  const normalized = normalizeDisplayWord(value).toLowerCase();
  return ['sil', '<sil>', 'silence', 'sp', 'spn', 'unknown'].includes(normalized);
}

function countChineseChars(text: string) {
  return (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
}

function countLatinWords(text: string) {
  return (text.match(/[A-Za-z]{2,}/g) ?? []).length;
}

function isValidEnglishAssessmentReferenceText(referenceText: string) {
  const normalized = referenceText.trim();
  if (!normalized) return false;
  if (countChineseChars(normalized) > 0) return false;
  return countLatinWords(normalized) >= 2;
}

function isLocalNetworkBaseUrl(baseUrl: string) {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?::\d+)?$/i.test(
    baseUrl,
  );
}

function getWebApiConfig(): WebApiConfig {
  const explicitBase = normalizeBaseUrl(env.webApiBaseUrl);
  const fallbackBase = normalizeBaseUrl(env.apiBaseUrl);
  const webApiBase = explicitBase || fallbackBase;
  const source = explicitBase ? 'env.webApiBaseUrl' : 'env.apiBaseUrl';

  if (!webApiBase) {
    throw new Error('missing_EXPO_PUBLIC_ECHOLINGO_WEB_API_BASE');
  }

  const cacheKey = `${source}:${webApiBase}`;
  if (cachedWebApiConfig && cachedWebApiConfigKey === cacheKey) {
    return cachedWebApiConfig;
  }

  cachedWebApiConfigKey = cacheKey;
  cachedWebApiConfig = {
    webApiBase,
    rtasrSignUrl: `${webApiBase}/api/dev/xfyun/rtasr-sign`,
    iseSignUrl: `${webApiBase}/api/dev/xfyun/ise-sign`,
    source,
  };

  log('api_base_config', cachedWebApiConfig);
  return cachedWebApiConfig;
}

export function logXfyunApiBaseConfig() {
  return getWebApiConfig();
}

async function ensureLocalWebApiReachable(
  config: WebApiConfig,
  path: '/api/dev/xfyun/rtasr-sign' | '/api/dev/xfyun/ise-sign',
  options?: { roundId?: number | null },
) {
  if (!isLocalNetworkBaseUrl(config.webApiBase)) {
    return;
  }

  const baseUrl = path.includes('ise') ? config.iseSignUrl : config.rtasrSignUrl;
  const healthUrl = `${baseUrl}?health=1`;
  const cacheKey = healthUrl;
  if (cachedHealthCheck?.key === cacheKey && cachedHealthCheck.ok) {
    return;
  }

  const controller = new AbortController();
  const startedAt = Date.now();
  let timedOut = false;
  const isRtasr = path.includes('rtasr');
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    controller.abort('health_check_timeout');
  }, LOCAL_WEB_API_HEALTH_TIMEOUT_MS);
  log('web_api_health_check_start', {
    url: healthUrl,
    roundId: options?.roundId ?? null,
    timeoutMs: LOCAL_WEB_API_HEALTH_TIMEOUT_MS,
  });
  try {
    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    const rawText = await response.text();
    const elapsedMs = Date.now() - startedAt;
    log(isRtasr ? 'rtasr_sign_health_status' : 'ise_sign_health_status', {
      roundId: options?.roundId ?? null,
      fullUrl: healthUrl,
      status: response.status,
      elapsedMs,
      responsePreview: summarizeResponsePreview(rawText),
    });
    if (!response.ok) {
      throw new Error(`web_api_health_failed_${response.status}_${rawText.slice(0, 120)}`);
    }
    cachedHealthCheck = {
      key: cacheKey,
      ok: true,
    };
    log('web_api_health_check_done', {
      url: healthUrl,
      roundId: options?.roundId ?? null,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    const meta = getFetchErrorMeta({
      error,
      timedOut,
      explicitAbortReason: typeof controller.signal.reason === 'string' ? controller.signal.reason : null,
    });
    log(isRtasr ? 'rtasr_unavailable_reason' : 'ise_unavailable_reason', {
      roundId: options?.roundId ?? null,
      fullUrl: healthUrl,
      status: null,
      elapsedMs: Date.now() - startedAt,
      errorName: meta.errorName,
      message: meta.message,
      responsePreview: null,
      abortReason: meta.abortReason,
      stage: 'health_check',
    });
    log('web_api_health_check_failed', {
      url: healthUrl,
      roundId: options?.roundId ?? null,
      errorName: meta.errorName,
      message: meta.message,
      elapsedMs: Date.now() - startedAt,
      abortReason: meta.abortReason,
      willContinueSignRequest: true,
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function fetchSignedUrl(
  path: '/api/dev/xfyun/rtasr-sign' | '/api/dev/xfyun/ise-sign',
  options?: { roundId?: number | null },
) {
  const config = getWebApiConfig();
  const isRtasr = path.includes('rtasr');
  await ensureLocalWebApiReachable(config, path, options);

  const fullUrl = `${config.webApiBase}${path}`;
  const startedAt = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    controller.abort('sign_request_timeout');
  }, LOCAL_WEB_API_SIGN_TIMEOUT_MS);

  log(isRtasr ? 'rtasr_sign_request_start' : 'ise_sign_request_start', {
    fullUrl,
    roundId: options?.roundId ?? null,
    source: config.source,
    timeoutMs: LOCAL_WEB_API_SIGN_TIMEOUT_MS,
  });

  let response: Response;
  try {
    response = await fetch(fullUrl, {
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
  } catch (error) {
    const meta = getFetchErrorMeta({
      error,
      timedOut,
      explicitAbortReason: typeof controller.signal.reason === 'string' ? controller.signal.reason : null,
    });
    log(isRtasr ? 'rtasr_sign_request_failed' : 'ise_sign_request_failed', {
      fullUrl,
      roundId: options?.roundId ?? null,
      status: null,
      errorName: meta.errorName,
      message: meta.message,
      elapsedMs: Date.now() - startedAt,
      abortReason: meta.abortReason,
      rawPreview: null,
      isNetworkRequestFailed: /network request failed/i.test(meta.message),
    });
    log(isRtasr ? 'rtasr_sign_http_status' : 'ise_sign_http_status', {
      roundId: options?.roundId ?? null,
      fullUrl,
      status: null,
      elapsedMs: Date.now() - startedAt,
      errorName: meta.errorName,
      message: meta.message,
      abortReason: meta.abortReason,
    });
    log(isRtasr ? 'rtasr_sign_response_preview' : 'ise_sign_response_preview', {
      roundId: options?.roundId ?? null,
      fullUrl,
      status: null,
      responsePreview: null,
    });
    log(isRtasr ? 'rtasr_unavailable_reason' : 'ise_unavailable_reason', {
      roundId: options?.roundId ?? null,
      fullUrl,
      status: null,
      elapsedMs: Date.now() - startedAt,
      errorName: meta.errorName,
      message: meta.message,
      responsePreview: null,
      abortReason: meta.abortReason,
      stage: 'sign_request',
    });
    log('web_api_unreachable', {
      url: fullUrl,
      roundId: options?.roundId ?? null,
      errorName: meta.errorName,
      message: meta.message,
      abortReason: meta.abortReason,
      elapsedMs: Date.now() - startedAt,
      suggestion:
        '如果使用本机 Next dev server，请确保 npm run dev -- -H 0.0.0.0 -p 3000，且 iPhone 与 Mac 在同一局域网。',
    });
    throw new Error(`web_api_unreachable:${meta.message}`);
  } finally {
    clearTimeout(timeoutHandle);
  }

  const text = await response.text();
  const responsePreview = summarizeResponsePreview(text);
  log(isRtasr ? 'rtasr_sign_http_status' : 'ise_sign_http_status', {
    roundId: options?.roundId ?? null,
    fullUrl,
    status: response.status,
    elapsedMs: Date.now() - startedAt,
    errorName: null,
    message: null,
    abortReason: null,
  });
  log(isRtasr ? 'rtasr_sign_response_preview' : 'ise_sign_response_preview', {
    roundId: options?.roundId ?? null,
    fullUrl,
    status: response.status,
    responsePreview,
  });
  let parsed: SignedUrlResponse | null = null;
  try {
    parsed = JSON.parse(text) as SignedUrlResponse;
  } catch {
    parsed = null;
  }

  if (!response.ok || !parsed?.ok || !parsed?.signedUrl) {
    log(isRtasr ? 'rtasr_sign_request_failed' : 'ise_sign_request_failed', {
      fullUrl,
      roundId: options?.roundId ?? null,
      status: response.status,
      errorName: 'HttpError',
      message: parsed?.error?.message || `xfyun_sign_failed_${response.status}`,
      elapsedMs: Date.now() - startedAt,
      abortReason: null,
      rawPreview: text.slice(0, 300),
      isNetworkRequestFailed: false,
    });
    log(isRtasr ? 'rtasr_unavailable_reason' : 'ise_unavailable_reason', {
      roundId: options?.roundId ?? null,
      fullUrl,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      errorName: 'HttpError',
      message: parsed?.error?.message || `xfyun_sign_failed_${response.status}`,
      responsePreview,
      abortReason: null,
      stage: 'sign_request',
    });
    log('web_api_unreachable', {
      url: fullUrl,
      roundId: options?.roundId ?? null,
      errorName: 'HttpError',
      message: parsed?.error?.message || `xfyun_sign_failed_${response.status}`,
      abortReason: null,
      elapsedMs: Date.now() - startedAt,
      suggestion:
        '如果使用本机 Next dev server，请确保 npm run dev -- -H 0.0.0.0 -p 3000，且 iPhone 与 Mac 在同一局域网。',
    });
    throw new Error(parsed?.error?.message || `xfyun_sign_failed_${response.status}`);
  }

  log(isRtasr ? 'rtasr_sign_request_success' : 'ise_sign_request_success', {
    fullUrl,
    roundId: options?.roundId ?? null,
    status: response.status,
    elapsedMs: Date.now() - startedAt,
    hasSignedUrl: Boolean(parsed.signedUrl),
  });
  return parsed;
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' ? (value as LooseRecord) : null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSpacing(text: string) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/([(\[])\s+/g, '$1')
    .replace(/\s+([)\]])/g, '$1')
    .trim();
}

function ensureTerminalPunctuation(text: string) {
  if (!text) return text;
  if (/[.!?]$/.test(text)) return text;
  if (/[a-z]/i.test(text)) {
    return `${text}.`;
  }
  return text;
}

function comparableText(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function comparablePhrase(text: string) {
  return normalizeSpacing(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function comparableWords(text: string) {
  return comparablePhrase(text).split(' ').filter(Boolean);
}

function sharedPrefixWordCount(left: string[], right: string[]) {
  const limit = Math.min(left.length, right.length);
  let count = 0;
  for (let index = 0; index < limit; index += 1) {
    if (left[index] !== right[index]) {
      break;
    }
    count += 1;
  }
  return count;
}

function countRepeatedNgrams(words: string[], size: number) {
  if (words.length < size) return 0;
  const counts = new Map<string, number>();
  for (let index = 0; index <= words.length - size; index += 1) {
    const key = words.slice(index, index + size).join(' ');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Math.max(0, ...counts.values());
}

function selectLongestSegment(segmentTexts: string[]) {
  return segmentTexts.reduce((longest, current) => {
    const currentLength = comparableText(current).length;
    const longestLength = comparableText(longest).length;
    if (currentLength > longestLength) {
      return current;
    }
    if (currentLength === longestLength) {
      return current;
    }
    return longest;
  }, segmentTexts[segmentTexts.length - 1] || segmentTexts[0] || '');
}

function detectCumulativeSegments(segmentTexts: string[]) {
  if (segmentTexts.length <= 1) {
    return {
      cumulative: false,
      selectedSegment: segmentTexts[0] ?? null,
    };
  }

  const selectedSegment = selectLongestSegment(segmentTexts);
  const selectedWords = comparableWords(selectedSegment);
  const selectedComparable = comparablePhrase(selectedSegment);
  if (!selectedComparable || selectedWords.length === 0) {
    return {
      cumulative: false,
      selectedSegment,
    };
  }

  let prefixLikeCount = 0;
  for (const segment of segmentTexts) {
    const segmentComparable = comparablePhrase(segment);
    const segmentWords = comparableWords(segment);
    if (!segmentComparable || segmentComparable === selectedComparable) {
      prefixLikeCount += 1;
      continue;
    }
    const sharedPrefix = sharedPrefixWordCount(segmentWords, selectedWords);
    const isContained = selectedComparable.includes(segmentComparable);
    const isPrefixGrowth =
      sharedPrefix >= Math.min(2, segmentWords.length) ||
      (segmentWords.length >= 3 && sharedPrefix / segmentWords.length >= 0.6);
    if (isContained || isPrefixGrowth) {
      prefixLikeCount += 1;
    }
  }

  return {
    cumulative: prefixLikeCount >= Math.max(2, Math.ceil(segmentTexts.length * 0.6)),
    selectedSegment,
  };
}

function compressRepeatedCumulativeTranscript(text: string, segmentTexts: string[]) {
  const normalized = normalizeTranscriptText(text);
  const words = comparableWords(normalized);
  if (words.length === 0) {
    return {
      changed: false,
      text: normalized,
      strategy: null as string | null,
    };
  }

  const selectedSegment = selectLongestSegment(segmentTexts);
  const normalizedSelected = normalizeTranscriptText(selectedSegment);
  const repeatedTwoGramCount = countRepeatedNgrams(words, 2);
  const repeatedThreeGramCount = countRepeatedNgrams(words, 3);
  const firstBigram = words.slice(0, 2).join(' ');
  const firstBigramCount =
    firstBigram && words.length >= 2
      ? words
          .map((_, index) => words.slice(index, index + 2).join(' '))
          .filter((value) => value === firstBigram).length
      : 0;
  const looksRepeated =
    words.length > 10 &&
    (repeatedThreeGramCount > 2 || repeatedTwoGramCount > 3 || firstBigramCount > 2);

  if (looksRepeated && normalizedSelected && normalizedSelected !== normalized) {
    return {
      changed: true,
      text: normalizedSelected,
      strategy: 'cumulative_prefix_dedupe',
    };
  }

  return {
    changed: false,
    text: normalized,
    strategy: null as string | null,
  };
}

function dedupeWords(text: string) {
  const words = normalizeSpacing(text).split(' ').filter(Boolean);
  const deduped: string[] = [];
  for (const word of words) {
    const current = comparableText(word);
    const previous = deduped.length > 0 ? comparableText(deduped[deduped.length - 1]) : '';
    if (current && current === previous) {
      continue;
    }
    deduped.push(word);
  }
  return normalizeSpacing(deduped.join(' '));
}

function normalizeRepeatedArticleA(text: string) {
  return text
    .replace(/\b[aA]{2,}(?=\s+[a-zA-Z])/g, 'a')
    .replace(/\b([aA])\s+([aA])(?=\s+[a-zA-Z])/g, 'a');
}

function normalizeTranscriptText(text: string) {
  return ensureTerminalPunctuation(
    dedupeWords(normalizeRepeatedArticleA(normalizeSpacing(text))),
  );
}

function sanitizeSegmentForMerge(segment: string) {
  const normalized = normalizeSpacing(segment)
    .replace(/^[,.;:!?]+/g, '')
    .replace(/^(uh|um|erm|ah)\b[,\s]*/i, '')
    .trim();
  return normalized;
}

function isNoiseOnlySegment(segment: string) {
  const phrase = comparablePhrase(segment);
  if (!phrase) return true;
  if (/^(uh|um|erm|ah|and|then|a|the)$/i.test(phrase)) return true;
  return false;
}

function isSegmentExtension(previous: string, current: string) {
  const previousComparable = comparablePhrase(previous);
  const currentComparable = comparablePhrase(current);
  if (!previousComparable || !currentComparable) return false;
  if (currentComparable === previousComparable) return true;

  const previousWords = comparableWords(previous);
  const currentWords = comparableWords(current);
  const sharedPrefix = sharedPrefixWordCount(previousWords, currentWords);
  const currentContainsPrevious = currentComparable.includes(previousComparable);
  const currentAddsWords = currentWords.length >= previousWords.length;

  return (
    (currentContainsPrevious && currentAddsWords) ||
    (sharedPrefix >= Math.min(previousWords.length, 2) && currentAddsWords)
  );
}

function sentenceFromSegment(segment: string) {
  const normalized = normalizeTranscriptText(segment);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function mergeSegmentTextsPreservingNewTailSegments(segmentTexts: string[]) {
  const keptSegments: string[] = [];
  const droppedSegments: string[] = [];

  for (const rawSegment of segmentTexts) {
    const current = sanitizeSegmentForMerge(rawSegment);
    if (!current || isNoiseOnlySegment(current)) {
      droppedSegments.push(rawSegment);
      continue;
    }

    const currentWords = comparableWords(current);
    const meaningfulWordCount = currentWords.filter(
      (word) => !['and', 'a', 'the', 'then', 'uh', 'um'].includes(word),
    ).length;

    if (keptSegments.length === 0) {
      if (meaningfulWordCount === 0 && currentWords.length < 3) {
        droppedSegments.push(rawSegment);
        continue;
      }
      keptSegments.push(current);
      continue;
    }

    const lastIndex = keptSegments.length - 1;
    const previous = keptSegments[lastIndex];

    if (isSegmentExtension(previous, current)) {
      keptSegments[lastIndex] = current;
      droppedSegments.push(previous);
      continue;
    }

    if (isSegmentExtension(current, previous)) {
      droppedSegments.push(rawSegment);
      continue;
    }

    if (meaningfulWordCount >= 2 || currentWords.length >= 3) {
      keptSegments.push(current);
      continue;
    }

    droppedSegments.push(rawSegment);
  }

  if (keptSegments.length > 1) {
    const lastSegmentPhrase = comparablePhrase(keptSegments[keptSegments.length - 1]);
    if (/^and then /.test(lastSegmentPhrase)) {
      droppedSegments.push(keptSegments.pop() || '');
    }
  }

  const finalText = normalizeSpacing(keptSegments.map(sentenceFromSegment).join(' '));
  return {
    changed: keptSegments.length > 1,
    text: finalText,
    keptSegments,
    droppedSegments,
    strategy: keptSegments.length > 1 ? 'preserve_new_tail_segments' : null,
  };
}

function parseRg(value: unknown): [number, number] | null {
  if (Array.isArray(value) && value.length >= 2) {
    const start = readNumber(value[0]);
    const end = readNumber(value[1]);
    if (start != null && end != null) {
      return [start, end];
    }
  }
  if (typeof value === 'string') {
    const match = value.match(/(\d+)\D+(\d+)/);
    if (match) {
      return [Number(match[1]), Number(match[2])];
    }
  }
  return null;
}

function buildTranscriptTextFromRows(rows: unknown[]) {
  const tokens = rows.flatMap((row) => {
    const ws = asRecord(row);
    const cws = Array.isArray(ws?.cw) ? ws.cw : [];
    return cws.map((cw) => readString(asRecord(cw)?.w)).filter(Boolean);
  });
  return normalizeSpacing(tokens.join(' '));
}

type RtasrSegment = {
  sn: number | null;
  type: number | null;
  pgs: string | null;
  rg: [number, number] | null;
  ls: boolean | null;
  text: string;
};

function extractRtasrSegment(resultJson: string): RtasrSegment {
  const parsed = JSON.parse(resultJson) as LooseRecord;
  const st = asRecord(asRecord(parsed.cn)?.st) ?? asRecord(parsed.st) ?? {};
  const rt = Array.isArray(st.rt) ? st.rt : Array.isArray(parsed.rt) ? parsed.rt : [];
  const sn = readNumber(parsed.seg_id, parsed.segId, parsed.sn, st.sn);
  const type = readNumber(st.type, parsed.type);
  const pgs = readString(st.pgs) || null;
  const rg = parseRg(st.rg);
  const ls = typeof st.ls === 'boolean' ? st.ls : null;
  const text = buildTranscriptTextFromRows(
    rt.flatMap((item) => {
      const record = asRecord(item);
      return Array.isArray(record?.ws) ? record.ws : [];
    }),
  );
  return {
    sn,
    type,
    pgs,
    rg,
    ls,
    text,
  };
}

function buildRtasrTranscript(segmentsBySn: Map<number, RtasrSegment>, fallbackSegments: RtasrSegment[]) {
  const orderedSegments = [...segmentsBySn.entries()]
    .sort((a, b) => a[0] - b[0])
    .map((item) => item[1]);
  const segments = orderedSegments.length > 0 ? orderedSegments : fallbackSegments;
  const segmentTexts = segments.map((item) => item.text).filter(Boolean);
  const rawTextBeforeNormalize = normalizeSpacing(segmentTexts.join(' '));

  if (segmentTexts.length === 0) {
    return {
      text: '',
      mergeStrategy: 'empty',
      cumulativeDetected: false,
      selectedSegment: null,
      segmentTexts,
      rawTextBeforeNormalize: '',
      normalizedText: '',
    };
  }

  const { cumulative, selectedSegment } = detectCumulativeSegments(segmentTexts);

  if (cumulative) {
    const latest = normalizeTranscriptText(selectedSegment || '');
    return {
      text: latest,
      mergeStrategy: 'last_cumulative_segment',
      cumulativeDetected: true,
      selectedSegment,
      segmentTexts,
      rawTextBeforeNormalize,
      normalizedText: latest,
    };
  }

  const usedPgs = segments.some((segment) => segment.pgs === 'rpl' || segment.pgs === 'apd');
  const joined = normalizeTranscriptText(rawTextBeforeNormalize);
  const preservedTail = mergeSegmentTextsPreservingNewTailSegments(segmentTexts);
  if (preservedTail.changed && preservedTail.text.length >= Math.max(35, (selectedSegment || '').length)) {
    log('transcript_segment_merge_debug', {
      strategy: preservedTail.strategy,
      originalSegmentCount: segmentTexts.length,
      keptSegments: preservedTail.keptSegments,
      droppedSegments: preservedTail.droppedSegments,
      finalText: preservedTail.text,
    });
    log('transcript_tail_segments_preserved', {
      finalText: preservedTail.text,
      keptSegments: preservedTail.keptSegments,
    });
    return {
      text: preservedTail.text,
      mergeStrategy: preservedTail.strategy ?? 'preserve_new_tail_segments',
      cumulativeDetected: false,
      selectedSegment,
      segmentTexts,
      rawTextBeforeNormalize,
      normalizedText: preservedTail.text,
    };
  }
  const compressed = compressRepeatedCumulativeTranscript(joined, segmentTexts);
  if (compressed.changed) {
    log('transcript_cumulative_dedupe_applied', {
      beforePreview: joined.slice(0, 180),
      after: compressed.text,
      segmentCount: segmentTexts.length,
      strategy: compressed.strategy,
    });
    log('transcript_segment_merge_debug', {
      strategy: compressed.strategy,
      originalSegmentCount: segmentTexts.length,
      keptSegments: [compressed.text],
      droppedSegments: segmentTexts.filter((segment) => normalizeTranscriptText(segment) !== compressed.text),
      finalText: compressed.text,
    });
  }
  return {
    text: compressed.text,
    mergeStrategy: compressed.changed ? compressed.strategy ?? 'cumulative_prefix_dedupe' : usedPgs ? 'pgs_rg_replace' : 'sn_dedupe_join',
    cumulativeDetected: compressed.changed,
    selectedSegment: compressed.changed ? selectedSegment : null,
    segmentTexts,
    rawTextBeforeNormalize,
    normalizedText: compressed.text,
  };
}

export function debugBuildRtasrTranscriptFromSegments(segmentTexts: string[]) {
  const fallbackSegments = segmentTexts.map((text, index) => ({
    sn: index,
    type: 0,
    pgs: null,
    rg: null,
    ls: null,
    text,
  }));
  return buildRtasrTranscript(new Map(), fallbackSegments);
}

export class XfyunRtasrStreamingClient {
  private websocket: WebSocket | null = null;
  private readonly roundId: number;
  private readonly startedAt: number;
  private readonly segmentsBySn = new Map<number, RtasrSegment>();
  private readonly fallbackSegments: RtasrSegment[] = [];
  private readonly transcriptState: XfyunRtasrTranscript = {
    text: '',
    rawTextBeforeNormalize: '',
    normalizedText: '',
    mergeStrategy: 'pending',
    segmentCount: 0,
    partialCount: 0,
    finalLikeCount: 0,
    firstResultMs: null,
    finalTranscriptMs: null,
  };
  private resolveFinal: ((value: XfyunRtasrTranscript) => void) | null = null;
  private rejectFinal: ((reason?: unknown) => void) | null = null;
  private finalPromise: Promise<XfyunRtasrTranscript>;
  private finished = false;
  private openedAt: number | null = null;
  private audioChunksSent = 0;
  private audioBytesSent = 0;
  private endFrameSent = false;
  private endFrameAtMs: number | null = null;
  private closeReason: string | null = null;
  private errorMessage: string | null = null;
  private finalWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private sendQueue: Uint8Array[] = [];
  private sendLoopRunning = false;
  private sendDrainResolvers: Array<() => void> = [];

  constructor(roundId: number) {
    this.roundId = roundId;
    this.startedAt = Date.now();
    this.finalPromise = new Promise<XfyunRtasrTranscript>((resolve, reject) => {
      this.resolveFinal = resolve;
      this.rejectFinal = reject;
    });
  }

  async connect() {
    const signed = await fetchSignedUrl('/api/dev/xfyun/rtasr-sign', { roundId: this.roundId });
    log('rtasr_connect_start', {
      roundId: this.roundId,
    });
    log('v2_rtasr_connect_start', {
      roundId: this.roundId,
    });
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(signed.signedUrl!);
      this.websocket = ws;
      const timeoutHandle = setTimeout(() => {
        log('rtasr_ws_error', {
          roundId: this.roundId,
          message: 'rtasr_connect_timeout',
          closeReason: this.closeReason,
          audioChunksSent: this.audioChunksSent,
          audioBytesSent: this.audioBytesSent,
          endFrameSent: this.endFrameSent,
          endFrameAtMs: this.endFrameAtMs,
        });
        try {
          ws.close();
        } catch {
          // ignore
        }
        reject(new Error('rtasr_connect_timeout'));
      }, RTASR_TIMEOUT_MS);

      ws.onopen = () => {
        clearTimeout(timeoutHandle);
        this.openedAt = Date.now();
        log('rtasr_connect_open', {
          roundId: this.roundId,
          connectionOpenMs: this.openedAt - this.startedAt,
        });
        log('v2_rtasr_open', {
          roundId: this.roundId,
          connectionOpenMs: this.openedAt - this.startedAt,
        });
        resolve();
      };

      ws.onmessage = (event) => {
        this.handleMessage(String(event.data ?? ''));
      };

      ws.onerror = () => {
        clearTimeout(timeoutHandle);
        log('rtasr_ws_error', {
          roundId: this.roundId,
          message: 'rtasr_websocket_error',
          closeReason: this.closeReason,
          audioChunksSent: this.audioChunksSent,
          audioBytesSent: this.audioBytesSent,
          endFrameSent: this.endFrameSent,
          endFrameAtMs: this.endFrameAtMs,
        });
        this.errorMessage = 'rtasr_websocket_error';
        log('v2_rtasr_error', {
          roundId: this.roundId,
          message: this.errorMessage,
          audioChunksSent: this.audioChunksSent,
          audioBytesSent: this.audioBytesSent,
          endFrameSent: this.endFrameSent,
        });
        reject(new Error('rtasr_websocket_error'));
      };

      ws.onclose = (event) => {
        clearTimeout(timeoutHandle);
        this.closeReason =
          typeof event?.reason === 'string' && event.reason
            ? event.reason
            : typeof event?.code === 'number'
              ? `close_code_${event.code}`
              : this.closeReason;
        log('rtasr_session_closed', {
          roundId: this.roundId,
          audioChunksSent: this.audioChunksSent,
          audioBytesSent: this.audioBytesSent,
          endFrameSent: this.endFrameSent,
          endFrameAtMs: this.endFrameAtMs,
          closeReason: this.closeReason,
        });
        log('v2_rtasr_closed', {
          roundId: this.roundId,
          audioChunksSent: this.audioChunksSent,
          audioBytesSent: this.audioBytesSent,
          endFrameSent: this.endFrameSent,
          endFrameAtMs: this.endFrameAtMs,
          closeReason: this.closeReason,
          errorMessage: this.errorMessage,
        });
        if (!this.finished && !this.transcriptState.normalizedText.trim()) {
          log('rtasr_ws_close_before_final', {
            roundId: this.roundId,
            closeReason: this.closeReason,
            audioChunksSent: this.audioChunksSent,
            audioBytesSent: this.audioBytesSent,
            endFrameSent: this.endFrameSent,
            endFrameAtMs: this.endFrameAtMs,
          });
        }
        if (!this.finished) {
          this.finalize();
        }
      };
    });
  }

  appendPcmChunk(pcmChunk: Uint8Array) {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.sendQueue.push(new Uint8Array(pcmChunk));
    void this.runSendLoop();
  }

  async finish() {
    log('v2_rtasr_end_frame_send_start', {
      roundId: this.roundId,
      queuedChunks: this.sendQueue.length,
      audioChunksSent: this.audioChunksSent,
      audioBytesSent: this.audioBytesSent,
      endFrameSent: this.endFrameSent,
    });
    await this.waitForSendQueueDrain();
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN && !this.endFrameSent) {
      this.endFrameSent = true;
      this.endFrameAtMs = Date.now() - this.startedAt;
      this.websocket.send('{"end": true}');
      log('rtasr_audio_end_sent', {
        roundId: this.roundId,
        audioChunksSent: this.audioChunksSent,
        audioBytesSent: this.audioBytesSent,
        endFrameAtMs: this.endFrameAtMs,
      });
      log('v2_rtasr_end_frame_sent', {
        roundId: this.roundId,
        audioChunksSent: this.audioChunksSent,
        audioBytesSent: this.audioBytesSent,
        endFrameAtMs: this.endFrameAtMs,
      });
    }
    if (!this.finished && !this.finalWaitTimer) {
      log('v2_rtasr_wait_final_start', {
        roundId: this.roundId,
        timeoutMs: RTASR_FINAL_WAIT_MS,
      });
      this.finalWaitTimer = setTimeout(() => {
        this.closeReason = 'finish_wait_timeout';
        try {
          this.websocket?.close();
        } catch {
          // ignore
        }
        if (!this.finished) {
          this.finalize();
        }
      }, RTASR_FINAL_WAIT_MS);
    }
    return this.finalPromise;
  }

  close() {
    if (this.websocket) {
      try {
        this.websocket.close();
      } catch {
        // ignore
      }
    }
    if (!this.finished) {
      this.finalize();
    }
  }

  private handleMessage(raw: string) {
    try {
      const payload = JSON.parse(raw) as LooseRecord;
      if (payload.action === 'error') {
        const errorCode = readString(payload.code) || 'unknown';
        const errorMessage = readString(payload.desc) || 'rtasr_remote_error';
        this.errorMessage = `rtasr_remote_error_${errorCode}_${errorMessage}`;
        this.closeReason = errorMessage;
        log('rtasr_error', {
          roundId: this.roundId,
          message: this.errorMessage,
          audioChunksSent: this.audioChunksSent,
          audioBytesSent: this.audioBytesSent,
          endFrameSent: this.endFrameSent,
          endFrameAtMs: this.endFrameAtMs,
          closeReason: this.closeReason,
        });
        log('v2_rtasr_error', {
          roundId: this.roundId,
          message: this.errorMessage,
          audioChunksSent: this.audioChunksSent,
          audioBytesSent: this.audioBytesSent,
          endFrameSent: this.endFrameSent,
          endFrameAtMs: this.endFrameAtMs,
          closeReason: this.closeReason,
        });
        this.finalize();
        try {
          this.websocket?.close();
        } catch {
          // ignore
        }
        return;
      }
      if (payload.action !== 'result') {
        return;
      }
      const data = readString(payload.data);
      if (!data) return;

      const segment = extractRtasrSegment(data);
      if (!segment.text) return;

      const elapsedMs = Date.now() - this.startedAt;
      if (this.transcriptState.firstResultMs == null) {
        this.transcriptState.firstResultMs = elapsedMs;
        log('rtasr_first_result', {
          roundId: this.roundId,
          firstResultMs: elapsedMs,
        });
      }

      if (segment.type === 1) {
        this.transcriptState.partialCount += 1;
      } else {
        this.transcriptState.finalLikeCount += 1;
        this.transcriptState.finalTranscriptMs = elapsedMs;
      }

      if (typeof segment.sn === 'number') {
        if (segment.pgs === 'rpl' && segment.rg) {
          for (const key of [...this.segmentsBySn.keys()]) {
            if (key >= segment.rg[0] && key <= segment.rg[1]) {
              this.segmentsBySn.delete(key);
            }
          }
        }
        this.segmentsBySn.set(segment.sn, segment);
      } else {
        this.fallbackSegments.push(segment);
      }

      this.updateMergedTranscript();
    } catch (error) {
      this.errorMessage = normalizeUnknownError(error, 'rtasr_message_parse_failed');
      log('v2_rtasr_error', {
        roundId: this.roundId,
        message: this.errorMessage,
        audioChunksSent: this.audioChunksSent,
        audioBytesSent: this.audioBytesSent,
        endFrameSent: this.endFrameSent,
        endFrameAtMs: this.endFrameAtMs,
        closeReason: this.closeReason,
      });
      this.finalize();
    }
  }

  private async runSendLoop() {
    if (this.sendLoopRunning) return;
    this.sendLoopRunning = true;
    try {
      while (this.sendQueue.length > 0) {
        if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
          break;
        }
        const pcmChunk = this.sendQueue.shift();
        if (!pcmChunk) {
          continue;
        }
        const arrayBuffer = pcmChunk.buffer.slice(
          pcmChunk.byteOffset,
          pcmChunk.byteOffset + pcmChunk.byteLength,
        );
        this.websocket.send(arrayBuffer as ArrayBuffer);
        this.audioChunksSent += 1;
        this.audioBytesSent += pcmChunk.byteLength;
        if (this.audioChunksSent === 1 || this.audioChunksSent % 25 === 0) {
          log('rtasr_audio_chunk_sent', {
            roundId: this.roundId,
            audioChunksSent: this.audioChunksSent,
            audioBytesSent: this.audioBytesSent,
          });
        }
        log('v2_rtasr_live_chunk_sent', {
          roundId: this.roundId,
          audioChunksSent: this.audioChunksSent,
          audioBytesSent: this.audioBytesSent,
          queuedChunks: this.sendQueue.length,
        });
        await sleep(RTASR_FRAME_INTERVAL_MS);
      }
    } finally {
      this.sendLoopRunning = false;
      if (this.sendQueue.length > 0 && this.websocket?.readyState === WebSocket.OPEN) {
        void this.runSendLoop();
      } else {
        const resolvers = this.sendDrainResolvers;
        this.sendDrainResolvers = [];
        resolvers.forEach((resolve) => resolve());
      }
    }
  }

  private waitForSendQueueDrain() {
    if (!this.sendQueue.length && !this.sendLoopRunning) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.sendDrainResolvers.push(resolve);
      void this.runSendLoop();
    });
  }

  private updateMergedTranscript() {
    const merged = buildRtasrTranscript(this.segmentsBySn, this.fallbackSegments);
    this.transcriptState.text = merged.text;
    this.transcriptState.rawTextBeforeNormalize = merged.rawTextBeforeNormalize;
    this.transcriptState.normalizedText = merged.normalizedText;
    this.transcriptState.mergeStrategy = merged.mergeStrategy;
    this.transcriptState.cumulativeDetected = merged.cumulativeDetected;
    this.transcriptState.selectedSegment = merged.selectedSegment;
    this.transcriptState.segmentTexts = merged.segmentTexts;
    this.transcriptState.segmentCount = merged.segmentTexts.length;
  }

  private finalize() {
    if (this.finished) return;
    this.finished = true;
    if (this.finalWaitTimer) {
      clearTimeout(this.finalWaitTimer);
      this.finalWaitTimer = null;
    }
    this.updateMergedTranscript();
    if (!this.transcriptState.normalizedText.trim()) {
      log('rtasr_no_final_fallback', {
        roundId: this.roundId,
        closeReason: this.closeReason,
        partialCount: this.transcriptState.partialCount,
        finalLikeCount: this.transcriptState.finalLikeCount,
        segmentCount: this.transcriptState.segmentCount,
        rawTextBeforeNormalize: this.transcriptState.rawTextBeforeNormalize,
      });
    }
    this.transcriptState.errorMessage = this.errorMessage;
    this.transcriptState.closeReason = this.closeReason;
    if (this.errorMessage) {
      log('v2_rtasr_error', {
        roundId: this.roundId,
        message: this.errorMessage,
        closeReason: this.closeReason,
        audioChunksSent: this.audioChunksSent,
        audioBytesSent: this.audioBytesSent,
        endFrameSent: this.endFrameSent,
      });
    } else if (this.transcriptState.normalizedText.trim()) {
      log('v2_rtasr_final_received', {
        roundId: this.roundId,
        normalizedText: this.transcriptState.normalizedText,
        audioChunksSent: this.audioChunksSent,
        audioBytesSent: this.audioBytesSent,
        endFrameSent: this.endFrameSent,
      });
    } else {
      log('v2_rtasr_final_empty', {
        roundId: this.roundId,
        closeReason: this.closeReason,
        audioChunksSent: this.audioChunksSent,
        audioBytesSent: this.audioBytesSent,
        endFrameSent: this.endFrameSent,
      });
    }
    log('rtasr_final', {
      roundId: this.roundId,
      firstResultMs: this.transcriptState.firstResultMs,
      finalTranscriptMs: this.transcriptState.finalTranscriptMs,
      stopToFinalMs:
        this.transcriptState.finalTranscriptMs != null && this.endFrameAtMs != null
          ? Math.max(0, this.transcriptState.finalTranscriptMs - this.endFrameAtMs)
          : null,
      rawTextBeforeNormalize: this.transcriptState.rawTextBeforeNormalize,
      normalizedText: this.transcriptState.normalizedText,
      mergeStrategy: this.transcriptState.mergeStrategy,
      cumulativeDetected: this.transcriptState.cumulativeDetected ?? false,
      selectedSegment: this.transcriptState.selectedSegment ?? null,
      segmentTexts: this.transcriptState.segmentTexts ?? [],
      segmentCount: this.transcriptState.segmentCount,
      partialCount: this.transcriptState.partialCount,
      finalLikeCount: this.transcriptState.finalLikeCount,
      audioChunksSent: this.audioChunksSent,
      audioBytesSent: this.audioBytesSent,
      endFrameSent: this.endFrameSent,
      endFrameAtMs: this.endFrameAtMs,
      closeReason: this.closeReason,
    });
    this.resolveFinal?.({ ...this.transcriptState });
  }
}

function parseAttributes(fragment: string) {
  const attrs: Record<string, string> = {};
  const regex = /([a-zA-Z0-9_:-]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(fragment))) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function parseTagAttributes(xml: string, tagName: string) {
  const regex = new RegExp(`<${tagName}\\b([^>]*)>`, 'g');
  const items: Record<string, string>[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml))) {
    items.push(parseAttributes(match[1]));
  }
  return items;
}

function findRootTag(xml: string, tags: string[]) {
  for (const tag of tags) {
    const attrs = parseTagAttributes(xml, tag)[0];
    if (attrs) {
      return { tag, attrs };
    }
  }
  return { tag: null, attrs: {} };
}

function listPresentTags(xml: string, tags: string[]) {
  return tags.filter((tag) => xml.includes(`<${tag}`));
}

function readAttrNumber(attrs: Record<string, string>, keys: string[]) {
  return readNumber(...keys.map((key) => Number(attrs[key])));
}

function findScoreAcrossTags(xml: string, tags: string[], keys: string[]) {
  for (const tag of tags) {
    const attrsList = parseTagAttributes(xml, tag);
    for (const attrs of attrsList) {
      const value = readAttrNumber(attrs, keys);
      if (value != null) {
        return value;
      }
    }
  }
  return null;
}

function findStringAttrAcrossTags(xml: string, tags: string[], keys: string[]) {
  for (const tag of tags) {
    const attrsList = parseTagAttributes(xml, tag);
    for (const attrs of attrsList) {
      for (const key of keys) {
        const value = readString(attrs[key]);
        if (value) {
          return value;
        }
      }
    }
  }
  return '';
}

function extractIseExceptInfo(xml: string) {
  const scoreTags = ['read_sentence', 'read_chapter', 'sentence', 'rec_paper', 'xml_result'];
  return findStringAttrAcrossTags(xml, scoreTags, ['except_info']);
}

function buildIseRawSummary(xml: string, words: XfyunWordAssessment[]) {
  const scoreTags = ['read_sentence', 'read_chapter', 'sentence', 'rec_paper', 'xml_result'];
  const presentTags = listPresentTags(xml, scoreTags);
  const exceptInfo = extractIseExceptInfo(xml);
  return {
    hasRaw: Boolean(xml.trim()),
    rawType: 'xml',
    rawPreview: xml.replace(/\s+/g, ' ').trim().slice(0, 240),
    topLevelKeys: presentTags,
    exceptInfo: exceptInfo || null,
    hasReadSentence: xml.includes('<read_sentence'),
    hasTotalScore: /total_score="/.test(xml),
    hasPhoneScore: /phone_score="/.test(xml),
    hasWordScore: /accuracy_score="/.test(xml) || words.some((word) => word.score != null),
    wordsCount: words.length,
  };
}

function parsePhoneBlocks(xml: string): XfyunPhoneAssessment[] {
  return parseTagAttributes(xml, 'phone').map((attrs) => ({
    content: normalizeDisplayWord(attrs.content ?? ''),
    score: readNumber(Number(attrs.total_score)),
    errorType: attrs.dp_message ?? null,
  }));
}

function parseSyllableBlocks(xml: string): XfyunSyllableAssessment[] {
  const regex = /<syll\b([^>]*)>([\s\S]*?)<\/syll>/g;
  const syllables: XfyunSyllableAssessment[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml))) {
    const attrs = parseAttributes(match[1]);
    syllables.push({
      content: normalizeDisplayWord(attrs.content ?? ''),
      score: readNumber(Number(attrs.total_score), Number(attrs.syll_score)),
      errorType: attrs.serr_msg ?? null,
      phones: parsePhoneBlocks(match[2]),
    });
  }
  return syllables;
}

function parseWordBlocks(xml: string): XfyunWordAssessment[] {
  const syllableRegex = /<word\b([^>]*)>([\s\S]*?)<\/word>/g;
  const words: XfyunWordAssessment[] = [];
  let match: RegExpExecArray | null;
  while ((match = syllableRegex.exec(xml))) {
    const attrs = parseAttributes(match[1]);
    words.push({
      word: normalizeDisplayWord(attrs.content ?? ''),
      score: readNumber(Number(attrs.total_score)),
      accuracyScore: readNumber(Number(attrs.accuracy_score)),
      errorType: attrs.werr_msg ?? null,
      beginMs: readNumber(Number(attrs.beg_pos)),
      endMs: readNumber(Number(attrs.end_pos)),
      syllables: parseSyllableBlocks(match[2]),
    });
  }
  return words;
}

function parseIseAssessment(xml: string, transcriptText: string) {
  const scoreTags = ['sentence', 'read_chapter', 'read_sentence', 'rec_paper', 'xml_result'];
  const root = findRootTag(xml, ['read_sentence', 'sentence', 'read_chapter', 'rec_paper', 'xml_result']);
  const attrs = root.attrs as Record<string, string>;
  const words = parseWordBlocks(xml);
  const iseRawSummary = buildIseRawSummary(xml, words);
  log('ise_raw_summary', iseRawSummary);
  const exceptInfo =
    readString(attrs.except_info) || findStringAttrAcrossTags(xml, scoreTags, ['except_info']);

  const overallFromAttrs =
    readNumber(Number(attrs.total_score)) ??
    findScoreAcrossTags(xml, scoreTags, ['total_score', 'overall', 'score']);
  const accuracy =
    readNumber(Number(attrs.accuracy_score), Number(attrs.phone_score)) ??
    findScoreAcrossTags(xml, scoreTags, ['accuracy_score', 'phone_score']);
  const fluency =
    readNumber(Number(attrs.fluency_score)) ??
    findScoreAcrossTags(xml, scoreTags, ['fluency_score']);
  const integrity =
    readNumber(Number(attrs.integrity_score)) ??
    findScoreAcrossTags(xml, scoreTags, ['integrity_score']);
  const standard =
    readNumber(Number(attrs.standard_score)) ??
    findScoreAcrossTags(xml, scoreTags, ['standard_score']);
  const scoredWords = words
    .map((word) => word.score ?? word.accuracyScore)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const fallbackOverall =
    scoredWords.length > 0
      ? Math.round((scoredWords.reduce((sum, value) => sum + value, 0) / scoredWords.length) * 10) / 10
      : null;
  const overall = overallFromAttrs ?? fallbackOverall;
  if (overallFromAttrs == null && fallbackOverall != null) {
    log('ise_overall_fallback_used', {
      wordsCount: scoredWords.length,
      fallbackOverall,
    });
  }
  const abnormalExceptInfo = Boolean(exceptInfo && exceptInfo !== '0');
  log('ise_except_info', {
    rootTag: root.tag,
    exceptInfo: exceptInfo || null,
    abnormal: abnormalExceptInfo,
  });
  const scoreSummary = {
    rootTag: root.tag,
    exceptInfo: exceptInfo || null,
    overall: overall ?? null,
    overallFromAttrs: overallFromAttrs ?? null,
    accuracy: accuracy ?? null,
    fluency: fluency ?? null,
    integrity: integrity ?? null,
    standard: standard ?? null,
    wordsCount: words.length,
    usedOverallFallback: overallFromAttrs == null && fallbackOverall != null,
  };
  log('ise_raw_score_summary', scoreSummary);
  log('ise_final_xml_except_info', {
    rootTag: root.tag,
    exceptInfo: exceptInfo || null,
    abnormal: abnormalExceptInfo,
  });
  log('ise_final_score_summary', scoreSummary);

  if (abnormalExceptInfo && (overall == null || overall <= 0)) {
    throw new Error(`ise_except_info_${exceptInfo}`);
  }

  return {
    provider: 'xfyun',
    engine: 'ise',
    transcriptText:
      normalizeDisplayWord(transcriptText) ||
      words
        .map((word) => word.word)
        .filter((word) => word && !isPauseToken(word))
        .join(' ')
        .trim(),
    overallScore: overall,
    accuracyScore: accuracy,
    fluencyScore: fluency,
    integrityScore: integrity,
    standardScore: standard,
    wordsPerMinute: readNumber(Number(attrs.speeking_speed)),
    words,
    raw: {
      rawType: 'xml',
      rawPreview: iseRawSummary.rawPreview,
      topLevelKeys: iseRawSummary.topLevelKeys,
      exceptInfo: exceptInfo || null,
    },
    usedOverallFallback: overallFromAttrs == null && fallbackOverall != null,
  } satisfies XfyunPronunciationAssessment;
}

function buildIseEvalText(category: string, referenceText: string) {
  if (category === 'read_word') {
    return `\uFEFF[word]\n${referenceText}`;
  }
  return `\uFEFF[content]\n${referenceText}`;
}

function summarizeIseBusinessForLog(business: LooseRecord) {
  const text = readString(business.text);
  return {
    ...business,
    text: text ? `${text.slice(0, 80)}${text.length > 80 ? '…' : ''}` : null,
    textLength: text.length,
  };
}

export async function runXfyunIseAssessment(input: {
  roundId: number;
  pcm16k: Uint8Array;
  transcriptText: string;
  referenceText: string;
  language?: string;
  category?: string;
}) {
  const language = input.language?.trim() || 'en_us';
  const category = input.category?.trim() || 'read_sentence';
  const signed = await fetchSignedUrl('/api/dev/xfyun/ise-sign', { roundId: input.roundId });
  const startedAt = Date.now();
  const originalReferenceText = input.referenceText.trim();
  const referenceText = sanitizeIseReferenceText(originalReferenceText);

  if (!originalReferenceText) {
    return {
      assessment: null,
      debug: {
        started: false,
        skipped: true,
        skipReason: 'missing_reference_text',
        timeoutMs: ISE_TIMEOUT_MS,
        referenceTextUsed: null,
        category,
        language,
      } satisfies XfyunPronunciationDebug,
    };
  }

  if (!isValidEnglishAssessmentReferenceText(originalReferenceText)) {
    log('ise_skipped', {
      roundId: input.roundId,
      reason: 'non_english_or_invalid_reference',
      referenceText: originalReferenceText,
    });
    return {
      assessment: null,
      debug: {
        started: false,
        skipped: true,
        skipReason: 'non_english_or_invalid_reference',
        timeoutMs: ISE_TIMEOUT_MS,
        referenceTextUsed: originalReferenceText,
        category,
        language,
      } satisfies XfyunPronunciationDebug,
    };
  }

  log('ise_reference_text_original', {
    roundId: input.roundId,
    referenceText: originalReferenceText,
  });
  log('ise_reference_text_for_ise', {
    roundId: input.roundId,
    referenceText,
  });
  log('ise_audio_payload_kind', {
    roundId: input.roundId,
    kind: 'raw_pcm16_16k',
    bytes: input.pcm16k.byteLength,
  });
  log('ise_start', {
    roundId: input.roundId,
    referenceText,
  });

  return await new Promise<{
    assessment: XfyunPronunciationAssessment | null;
    debug: XfyunPronunciationDebug;
  }>((resolve) => {
    let finished = false;
    let finalXml = '';
    const ws = new WebSocket(signed.signedUrl!);
    const timeoutHandle = setTimeout(() => {
      try {
        ws.close();
      } catch {
        // ignore
      }
      finalize(null, {
        started: true,
        skipped: false,
        timeoutMs: ISE_TIMEOUT_MS,
        durationMs: Date.now() - startedAt,
        errorCode: 'ISE_TIMEOUT',
        errorMessage: 'ise_timeout',
        referenceTextUsed: referenceText,
        category,
        language,
      });
    }, ISE_TIMEOUT_MS);

    const finalize = (assessment: XfyunPronunciationAssessment | null, debug: XfyunPronunciationDebug) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutHandle);
      if (assessment) {
        log('ise_done', {
          roundId: input.roundId,
          latencyMs: debug.durationMs ?? null,
          overall: assessment.overallScore ?? null,
          wordsCount: assessment.words.length,
        });
      } else {
        log('ise_failed', {
          roundId: input.roundId,
          errorCode: debug.errorCode ?? null,
          errorMessage: debug.errorMessage ?? null,
        });
      }
      resolve({ assessment, debug });
    };

    ws.onopen = async () => {
      const firstFrameBusiness = {
        category,
        sub: 'ise',
        ent: 'en_vip',
        cmd: 'ssb',
        auf: 'audio/L16;rate=16000',
        aue: 'raw',
        language,
        text: buildIseEvalText(category, referenceText),
        rst: 'entirety',
        rstcd: 'utf8',
        tte: 'utf-8',
        ttp_skip: true,
        ise_unite: '1',
        extra_ability: 'multi_dimension;syll_phone_err_msg',
      };
      log('ise_first_frame_business', {
        roundId: input.roundId,
        business: summarizeIseBusinessForLog(firstFrameBusiness),
      });
      log('ise_first_frame_data_status', {
        roundId: input.roundId,
        status: 0,
      });
      ws.send(
        JSON.stringify({
          common: {
            app_id: signed.appId,
          },
          business: firstFrameBusiness,
          data: {
            status: 0,
          },
        }),
      );

      let audioFrameCount = 0;
      for (let offset = 0; offset < input.pcm16k.length; offset += ISE_FRAME_BYTES) {
        const chunk = input.pcm16k.subarray(offset, Math.min(offset + ISE_FRAME_BYTES, input.pcm16k.length));
        const isFirst = offset === 0;
        ws.send(
          JSON.stringify({
            business: {
              cmd: 'auw',
              aus: isFirst ? 1 : 2,
              aue: 'raw',
            },
            data: {
              status: 1,
              data: encodeBase64(chunk),
              data_type: 1,
              encoding: 'raw',
            },
          }),
        );
        audioFrameCount += 1;
        await sleep(ISE_FRAME_INTERVAL_MS);
      }
      ws.send(
        JSON.stringify({
          business: {
            cmd: 'auw',
            aus: 4,
            aue: 'raw',
          },
          data: {
            status: 2,
            data: '',
            data_type: 1,
            encoding: 'raw',
          },
        }),
      );
      log('ise_mid_frame_count', {
        roundId: input.roundId,
        audioFrameCount,
        frameBytes: ISE_FRAME_BYTES,
      });
      log('ise_end_frame_sent', {
        roundId: input.roundId,
        status: 2,
        aus: 4,
        dataBytes: 0,
      });
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data ?? '')) as LooseRecord;
        const code = readNumber(payload.code);
        if (code != null && code !== 0) {
          finalize(null, {
            started: true,
            skipped: false,
            timeoutMs: ISE_TIMEOUT_MS,
            durationMs: Date.now() - startedAt,
            errorCode: 'ISE_REMOTE_ERROR',
            errorMessage: readString(payload.message) || readString(payload.desc) || `ise_error_${code}`,
            referenceTextUsed: referenceText,
            category,
            language,
          });
          return;
        }

        const data = asRecord(payload.data);
        const status = readNumber(data?.status);
        const base64 = readString(data?.data);
        if (base64) {
          const xml = decodeUtf8Base64(base64);
          if (xml.trim()) {
            finalXml = xml;
          }
        }

        if (status === 2) {
          if (!finalXml) {
            finalize(null, {
              started: true,
              skipped: false,
              timeoutMs: ISE_TIMEOUT_MS,
              durationMs: Date.now() - startedAt,
              errorCode: 'ISE_MISSING_FINAL_XML',
              errorMessage: 'ise_missing_final_xml',
              referenceTextUsed: referenceText,
              category,
              language,
            });
            return;
          }

          try {
            const assessment = parseIseAssessment(finalXml, input.transcriptText || referenceText);
            finalize(assessment, {
              started: true,
              skipped: false,
              timeoutMs: ISE_TIMEOUT_MS,
              durationMs: Date.now() - startedAt,
              referenceTextUsed: referenceText,
              wordsCount: assessment.words.length,
              category,
              language,
            });
          } catch (error) {
            finalize(null, {
              started: true,
              skipped: false,
              timeoutMs: ISE_TIMEOUT_MS,
              durationMs: Date.now() - startedAt,
              errorCode: 'ISE_PARSE_FAILED',
              errorMessage: error instanceof Error ? error.message : 'ise_parse_failed',
              referenceTextUsed: referenceText,
              category,
              language,
            });
          }
        }
      } catch (error) {
        finalize(null, {
          started: true,
          skipped: false,
          timeoutMs: ISE_TIMEOUT_MS,
          durationMs: Date.now() - startedAt,
          errorCode: 'ISE_MESSAGE_PARSE_FAILED',
          errorMessage: error instanceof Error ? error.message : 'ise_message_parse_failed',
          referenceTextUsed: referenceText,
          category,
          language,
        });
      }
    };

    ws.onerror = () => {
      finalize(null, {
        started: true,
        skipped: false,
        timeoutMs: ISE_TIMEOUT_MS,
        durationMs: Date.now() - startedAt,
        errorCode: 'ISE_WEBSOCKET_ERROR',
        errorMessage: 'ise_websocket_error',
        referenceTextUsed: referenceText,
        category,
        language,
      });
    };

    ws.onclose = (event) => {
      log('ise_ws_close_code', {
        roundId: input.roundId,
        code: event.code,
        reason: event.reason || null,
        wasClean: event.wasClean,
        hasFinalXml: Boolean(finalXml),
      });
      if (!finished && finalXml) {
        try {
          const assessment = parseIseAssessment(finalXml, input.transcriptText || referenceText);
          finalize(assessment, {
            started: true,
            skipped: false,
            timeoutMs: ISE_TIMEOUT_MS,
            durationMs: Date.now() - startedAt,
            referenceTextUsed: referenceText,
            wordsCount: assessment.words.length,
            category,
            language,
          });
        } catch (error) {
          finalize(null, {
            started: true,
            skipped: false,
            timeoutMs: ISE_TIMEOUT_MS,
            durationMs: Date.now() - startedAt,
            errorCode: 'ISE_CLOSED_WITH_PARSE_ERROR',
            errorMessage: error instanceof Error ? error.message : 'ise_closed_with_parse_error',
            referenceTextUsed: referenceText,
            category,
            language,
          });
        }
      }
    };
  });
}

function decodeUtf8Base64(base64: string) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  let bufferLength = clean.length * 0.75;
  if (clean.endsWith('==')) bufferLength -= 2;
  else if (clean.endsWith('=')) bufferLength -= 1;
  const bytes = new Uint8Array(bufferLength);
  let byteIndex = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const encoded1 = chars.indexOf(clean[i] ?? 'A');
    const encoded2 = chars.indexOf(clean[i + 1] ?? 'A');
    const encoded3 = chars.indexOf(clean[i + 2] ?? 'A');
    const encoded4 = chars.indexOf(clean[i + 3] ?? 'A');
    const triple =
      ((encoded1 & 63) << 18) |
      ((encoded2 & 63) << 12) |
      (((encoded3 < 0 ? 0 : encoded3) & 63) << 6) |
      ((encoded4 < 0 ? 0 : encoded4) & 63);
    if (byteIndex < bytes.length) bytes[byteIndex++] = (triple >> 16) & 0xff;
    if (byteIndex < bytes.length) bytes[byteIndex++] = (triple >> 8) & 0xff;
    if (byteIndex < bytes.length) bytes[byteIndex++] = triple & 0xff;
  }
  return new TextDecoder().decode(bytes);
}
