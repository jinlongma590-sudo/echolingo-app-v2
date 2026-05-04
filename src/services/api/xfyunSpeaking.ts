import { env } from '@/lib/env';
import type { UltraSpeechAudioSource } from '@/services/audio/ultraSpeechAudioSource';
import { normalizeXfyunIseResult } from '@/services/speaking/normalizeXfyunIseResult';
import { normalizeXfyunRtasrResult } from '@/services/speaking/normalizeXfyunRtasrResult';
import type {
  XfyunPronunciationAssessment,
  XfyunTranscriptResult,
} from '@/types/xfyunSpeakingAssessment';

type XfyunFetchOptions = {
  roundId: number | string;
  audioSource: UltraSpeechAudioSource;
};

function buildXfyunApiUrl(path: string) {
  return `${env.apiBaseUrl.replace(/\/$/, '')}${path}`;
}

export class XfyunSpeakingApiError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'XfyunSpeakingApiError';
    this.code = code;
  }
}

function ensureAudioSource(path: string, options: XfyunFetchOptions) {
  if (options.audioSource.type === 'uploaded_file' && options.audioSource.uri) {
    return;
  }

  if (options.audioSource.type === 'native_tap' && options.audioSource.uri) {
    return;
  }

  const reason =
    options.audioSource.type === 'none'
      ? options.audioSource.reason
      : options.audioSource.type === 'native_tap'
        ? 'native_tap_result_not_ready'
      : 'audio_source_not_allowed_for_formal_v1';
  console.log(
    `[V1_XFYUN] api_skipped_no_audio_source = ${JSON.stringify({
      roundId: options.roundId,
      path,
      reason,
    })}`,
  );
  throw new XfyunSpeakingApiError('NO_AUDIO_SOURCE', reason);
}

async function fetchJson(path: string) {
  const response = await fetch(buildXfyunApiUrl(path), {
    headers: {
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`XFYUN dev route failed: ${response.status}`);
  }
  return (await response.json()) as unknown;
}

export async function fetchDevXfyunRtasrResult(options: XfyunFetchOptions): Promise<XfyunTranscriptResult | null> {
  ensureAudioSource('/api/dev/xfyun/rtasr', options);
  return normalizeXfyunRtasrResult(await fetchJson('/api/dev/xfyun/rtasr'));
}

export async function fetchDevXfyunIseResult(options: XfyunFetchOptions): Promise<XfyunPronunciationAssessment | null> {
  ensureAudioSource('/api/dev/xfyun/ise', options);
  return normalizeXfyunIseResult(await fetchJson('/api/dev/xfyun/ise'));
}
