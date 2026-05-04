import { normalizeXfyunIseResult } from '@/services/speaking/normalizeXfyunIseResult';
import { normalizeXfyunRtasrResult } from '@/services/speaking/normalizeXfyunRtasrResult';
import type { SpeakingRecordingResult } from '@/types/speaking';
import type {
  SpeakingRoundAnalysis,
  XfyunPronunciationAssessment,
  XfyunTranscriptResult,
} from '@/types/xfyunSpeakingAssessment';

type GatewayAssessWord = {
  word?: string;
  score?: number | null;
  accuracyScore?: number | null;
  errorType?: string | null;
  beginMs?: number | null;
  endMs?: number | null;
  syllables?: Array<{
    text?: string;
    score?: number | null;
    errorType?: string | null;
    beginMs?: number | null;
    endMs?: number | null;
    phones?: Array<{
      text?: string;
      score?: number | null;
      errorType?: string | null;
      beginMs?: number | null;
      endMs?: number | null;
    }>;
  }>;
};

type GatewayAssessResponse = {
  ok: boolean;
  mode: 'fast' | 'full';
  transcript: {
    text: string;
    provider: 'xfyun_rtasr';
    raw?: {
      firstTranscriptMs?: number | null;
      finalTranscriptMs?: number | null;
      partialCount?: number;
      finalLikeCount?: number;
      segmentsCount?: number;
      mergeStrategy?: string;
      rawTextBeforeNormalize?: string;
      segmentTexts?: string[];
      normalizedText?: string;
      rawSegments?: Array<Record<string, unknown>>;
      errors?: Array<{ stage: string; message: string }>;
    };
  } | null;
  pronunciation: {
    overall?: number | null;
    accuracy?: number | null;
    fluency?: number | null;
    integrity?: number | null;
    standard?: number | null;
    transcriptText?: string | null;
    words: GatewayAssessWord[];
    raw?: unknown;
  } | null;
  pronunciationDebug: {
    started: boolean;
    skipped: boolean;
    skipReason?: string;
    durationMs?: number | null;
    timeoutMs?: number;
    errorCode?: string;
    errorMessage?: string;
    rawPreview?: string | null;
    hasRawResult?: boolean;
    parseSuccess?: boolean;
    wordsCount?: number;
    category: string;
    language: string;
    referenceTextUsed?: string | null;
  };
  timing: {
    requestReceivedMs: number;
    audioReadMs: number;
    tempFileWriteMs: number;
    ffmpegConvertMs: number;
    rtasrStartMs?: number | null;
    totalMs: number;
    rtasrMs?: number | null;
    rtasrEndMs?: number | null;
    iseStartMs?: number | null;
    iseMs?: number | null;
    iseEndMs?: number | null;
    responseBuildMs: number;
    audioSize?: number;
    convertedPcmSize?: number;
  };
  performanceVerdict: {
    acceptableForRealtime: boolean;
    reason: string;
    targetMs: number;
    actualMs: number;
  };
  error?: {
    code: string;
    message: string;
  };
};

type GatewayAssessResult = {
  raw: GatewayAssessResponse;
  transcript: XfyunTranscriptResult | null;
  pronunciation: XfyunPronunciationAssessment | null;
  analysis: SpeakingRoundAnalysis | null;
};

export type GatewayAssessApiErrorDetails = {
  code: string;
  message: string;
  url: string;
  method: 'POST';
  baseUrl: string | null;
  endpoint: string;
  status?: number | null;
  contentType?: string | null;
  rawPreview?: string | null;
  fileUri?: string;
  fileName?: string;
  mimeType?: string;
  size?: number | null;
};

import { env } from '@/lib/env';

const LOG_PREFIX = '[GATEWAY_ASSESS_API]';
const ENDPOINT = '/api/dev/xfyun/gateway-assess';

function log(step: string, details: unknown = {}) {
  let normalized: string;
  try {
    normalized = JSON.stringify(details);
  } catch {
    normalized = String(details);
  }
  console.log(`${LOG_PREFIX} ${step} = ${normalized}`);
}

export class GatewayAssessApiError extends Error {
  details: GatewayAssessApiErrorDetails;

  constructor(details: GatewayAssessApiErrorDetails) {
    super(details.message);
    this.name = 'GatewayAssessApiError';
    this.details = details;
  }
}

function readGatewayApiBaseUrl() {
  const value = env.webApiBaseUrl;
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function buildGatewayUrl() {
  const baseUrl = readGatewayApiBaseUrl();
  if (!baseUrl) {
    throw new GatewayAssessApiError({
      code: 'MISSING_WEB_API_BASE',
      message:
        '缺少 EXPO_PUBLIC_ECHOLINGO_WEB_API_BASE。真机不能用 localhost / 127.0.0.1 访问 Mac，请配置例如 http://192.168.0.100:3000',
      url: '',
      method: 'POST',
      baseUrl: null,
      endpoint: ENDPOINT,
    });
  }
  return {
    baseUrl,
    endpoint: ENDPOINT,
    fullUrl: `${baseUrl.replace(/\/$/, '')}${ENDPOINT}`,
  };
}

function rawPreview(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function normalizeUploadMimeType(value: string | undefined) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return 'audio/mp4';
  if (normalized === 'audio/m4a') return 'audio/mp4';
  return normalized;
}

function mapWords(words: GatewayAssessWord[] | undefined) {
  return Array.isArray(words)
    ? words.map((word) => ({
        word: word.word ?? '--',
        score: typeof word.score === 'number' ? word.score : null,
        accuracyScore: typeof word.accuracyScore === 'number' ? word.accuracyScore : null,
        errorType: word.errorType ?? null,
        beginMs: typeof word.beginMs === 'number' ? word.beginMs : null,
        endMs: typeof word.endMs === 'number' ? word.endMs : null,
        syllables: Array.isArray(word.syllables)
          ? word.syllables.map((syllable) => ({
              content: syllable.text ?? '--',
              score: typeof syllable.score === 'number' ? syllable.score : null,
              errorType: syllable.errorType ?? null,
              beginMs: typeof syllable.beginMs === 'number' ? syllable.beginMs : null,
              endMs: typeof syllable.endMs === 'number' ? syllable.endMs : null,
              phones: Array.isArray(syllable.phones)
                ? syllable.phones.map((phone) => ({
                    content: phone.text ?? '--',
                    score: typeof phone.score === 'number' ? phone.score : null,
                    errorType: phone.errorType ?? null,
                    beginMs: typeof phone.beginMs === 'number' ? phone.beginMs : null,
                    endMs: typeof phone.endMs === 'number' ? phone.endMs : null,
                  }))
                : [],
            }))
          : [],
      }))
    : [];
}

function buildAnalysis(
  transcript: XfyunTranscriptResult | null,
  pronunciation: XfyunPronunciationAssessment | null,
): SpeakingRoundAnalysis | null {
  const transcriptText = transcript?.text || pronunciation?.transcriptText || '';
  if (!transcriptText && !pronunciation) {
    return null;
  }

  return {
    roundId: 1,
    source: 'api',
    transcriptText: transcriptText || '已识别语音',
    grammarStatus: 'needsOptimization',
    grammarLabel: '待后补',
    pronunciationScore: pronunciation?.overallScore ?? null,
    naturalnessScore: null,
    optimizedSentence: null,
    explanationZh:
      '当前 Gateway Probe 只验证真实录音经服务端转讯飞后的 transcript 与发音评分。语法、地道表达与中文解释尚未接入。',
    assessment: pronunciation,
  };
}

export async function uploadGatewayAssessAudio(input: {
  audio: SpeakingRecordingResult;
  referenceText?: string;
  language?: string;
  category?: string;
  mode?: 'fast' | 'full';
}): Promise<GatewayAssessResult> {
  const target = buildGatewayUrl();
  const uploadMimeType = normalizeUploadMimeType(input.audio.mimeType);
  log('request_start', {
    baseUrl: target.baseUrl,
    endpoint: target.endpoint,
    url: target.fullUrl,
    fileUri: input.audio.uri,
    fileName: input.audio.fileName || null,
    mimeType: uploadMimeType,
    size: input.audio.size ?? null,
    durationMs: input.audio.durationMs ?? null,
    referenceText: input.referenceText?.trim() ? `${input.referenceText.trim().slice(0, 120)}` : null,
  });

  const formData = new FormData();
  formData.append(
    'audio',
    {
      uri: input.audio.uri,
      type: uploadMimeType,
      name: input.audio.fileName || `gateway-probe-${Date.now()}.m4a`,
    } as never,
  );
  if (input.referenceText?.trim()) {
    formData.append('referenceText', input.referenceText.trim());
  }
  formData.append('language', input.language?.trim() || 'en_us');
  formData.append('category', input.category?.trim() || 'read_sentence');
  formData.append('mode', input.mode === 'full' ? 'full' : 'fast');
  formData.append('enablePronunciation', input.mode === 'full' ? 'true' : 'false');

  let response: Response;
  try {
    response = await fetch(target.fullUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
      },
      body: formData,
    });
  } catch (error) {
    throw new GatewayAssessApiError({
      code: 'NETWORK_REQUEST_FAILED',
      message: error instanceof Error ? error.message : String(error),
      url: target.fullUrl,
      method: 'POST',
      baseUrl: target.baseUrl,
      endpoint: target.endpoint,
      fileUri: input.audio.uri,
      fileName: input.audio.fileName,
      mimeType: uploadMimeType,
      size: input.audio.size ?? null,
    });
  }

  const contentType = response.headers.get('content-type');
  const rawText = await response.text();
  const preview = rawPreview(rawText);
  log('response_raw', {
    status: response.status,
    ok: response.ok,
    contentType,
    rawPreview: preview,
  });

  let payload: GatewayAssessResponse;
  try {
    payload = JSON.parse(rawText) as GatewayAssessResponse;
  } catch (error) {
    log('response_json_parse_failed', {
      message: error instanceof Error ? error.message : String(error),
      rawPreview: preview,
    });
    throw new GatewayAssessApiError({
      code: 'RESPONSE_JSON_PARSE_FAILED',
      message: error instanceof Error ? error.message : String(error),
      url: target.fullUrl,
      method: 'POST',
      baseUrl: target.baseUrl,
      endpoint: target.endpoint,
      status: response.status,
      contentType,
      rawPreview: preview,
      fileUri: input.audio.uri,
      fileName: input.audio.fileName,
      mimeType: uploadMimeType,
      size: input.audio.size ?? null,
    });
  }

  log('response_json_ok', {
    ok: payload.ok,
    hasTranscript: Boolean(payload.transcript?.text),
    hasPronunciation: Boolean(payload.pronunciation),
    error: payload.error?.code ?? null,
  });

  if (!response.ok || !payload.ok) {
    throw new GatewayAssessApiError({
      code: payload.error?.code || 'GATEWAY_ASSESS_FAILED',
      message: payload.error?.message || `gateway_assess_failed_${response.status}`,
      url: target.fullUrl,
      method: 'POST',
      baseUrl: target.baseUrl,
      endpoint: target.endpoint,
      status: response.status,
      contentType,
      rawPreview: preview,
      fileUri: input.audio.uri,
      fileName: input.audio.fileName,
      mimeType: uploadMimeType,
      size: input.audio.size ?? null,
    });
  }

  const transcript = normalizeXfyunRtasrResult({
    transcript: {
      text: payload.transcript?.text ?? '',
      finalText: payload.transcript?.text ?? '',
    },
    timing: {
      firstTranscriptMs: payload.timing.rtasrMs ?? null,
      finalTranscriptMs: payload.timing.rtasrMs ?? null,
    },
  });
  const pronunciation = normalizeXfyunIseResult(
    payload.pronunciation
      ? {
          transcriptText: payload.pronunciation.transcriptText ?? payload.transcript?.text ?? '',
          scores: {
            overall: payload.pronunciation.overall ?? null,
            accuracy: payload.pronunciation.accuracy ?? null,
            fluency: payload.pronunciation.fluency ?? null,
            integrity: payload.pronunciation.integrity ?? null,
            standard: payload.pronunciation.standard ?? null,
          },
          words: mapWords(payload.pronunciation.words),
        }
      : null,
  );

  if (transcript) {
    log('transcript_received', {
      textPreview: transcript.text.slice(0, 120),
      latencyMs: transcript.latencyMs,
    });
  }
  if (pronunciation) {
    log('pronunciation_received', {
      overall: pronunciation.overallScore,
      wordCount: pronunciation.words.length,
      syllableCount: pronunciation.words.reduce((sum, word) => sum + word.syllables.length, 0),
      phonemeCount: pronunciation.words.reduce(
        (sum, word) => sum + word.syllables.reduce((inner, syllable) => inner + syllable.phones.length, 0),
        0,
      ),
    });
  }

  return {
    raw: payload,
    transcript,
    pronunciation,
    analysis: buildAnalysis(transcript, pronunciation),
  };
}
