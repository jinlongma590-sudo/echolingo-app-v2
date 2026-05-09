import {
  createSpeakingRealtimeCall,
  getSpeakingRealtimeToken,
} from '@/services/api/speakingPractice';
import { SpeakingRealtimeClient } from '@/services/realtime/speakingRealtimeClient';
import type { StoredSession } from '@/types/auth';
import type { SpeakingV2TransportEvent } from '@/types/speakingV2';

export type RoastRealtimeAsrEvent = SpeakingV2TransportEvent & { requestId: string };
export type RoastRealtimeAsrMode = 'default' | 'verbatim';

export interface RoastRealtimeAsrController {
  requestId: string;
  client: SpeakingRealtimeClient;
  connectedAt: number;
  tokenMs: number;
  connectMs: number;
  stop: () => Promise<void>;
}

export interface StartRoastRealtimeAsrInput {
  requestId: string;
  mode?: RoastRealtimeAsrMode;
  session: StoredSession;
  signal?: AbortSignal;
  onEvent: (event: RoastRealtimeAsrEvent) => void;
}

const ROAST_ASR_DEFAULT_PROMPT = [
  'ASR-only English short sentence test for EchoLingo Roast Lab.',
  'Transcribe only the English words the learner says.',
  'Do not translate.',
  'Do not generate any assistant reply.',
  'The expected test sentence may be: I very like this app.',
].join(' ');

const ROAST_ASR_VERBATIM_PROMPT = [
  'Transcribe exactly what the speaker says in English.',
  'Chinese English learner: expect accent, broken English, Chinglish, wrong grammar, filler words, direct Chinese translations, fragments, repeated words, and odd phrases.',
  'Do not correct grammar, polish, or rewrite into natural English.',
  'Do not replace broken phrases with what you think the speaker meant.',
  'Keep unnatural word order and real mistakes; the coach will fix them later.',
  'Preserve examples: "I very like", "play phone", "open the light", "close the light", "I no have time", "I want improve my English", "I am boring", "my boss let me work overtime but no money", "teach me dirty words", and "people mountain people sea".',
  'Do not change "I very like" to "I really like".',
  'Do not change "play phone" to "play for".',
  'Do not change "on the bed" to "another bite".',
  'Do not change broken English into correct English.',
  'Keep profanity or dirty-word requests if actually spoken.',
  'Never invent "how when", "how many like", or "bite"; stay literal.',
].join(' ');

const ROAST_ASR_TRANSCRIPTION_LANGUAGE = 'en';
const ROAST_ASR_PROMPT_WARN_LENGTH = 1000;

const DEFAULT_ROAST_VAD_SILENCE_DURATION_MS = 650;
const ALLOWED_ROAST_VAD_SILENCE_DURATION_MS = new Set([500, 550, 650]);

function getRoastAsrPrompt(mode: RoastRealtimeAsrMode) {
  return mode === 'verbatim' ? ROAST_ASR_VERBATIM_PROMPT : ROAST_ASR_DEFAULT_PROMPT;
}

function warnIfRoastAsrPromptTooLong(prompt: string, mode: RoastRealtimeAsrMode) {
  if (
    prompt.length > ROAST_ASR_PROMPT_WARN_LENGTH
    && typeof __DEV__ === 'boolean'
    && __DEV__
  ) {
    console.warn('[ROAST_ASR_PROMPT_LENGTH_WARN]', JSON.stringify({
      mode,
      promptLength: prompt.length,
      warnLength: ROAST_ASR_PROMPT_WARN_LENGTH,
    }));
  }
}

function resolveRoastVadSilenceDurationMs() {
  const raw = process.env.EXPO_PUBLIC_ROAST_VAD_SILENCE_DURATION_MS?.trim() ?? '';
  const parsed = Number(raw);
  const silenceDurationMs = raw && ALLOWED_ROAST_VAD_SILENCE_DURATION_MS.has(parsed)
    ? parsed
    : DEFAULT_ROAST_VAD_SILENCE_DURATION_MS;
  console.log('[ROAST_VAD_EXPERIMENT]', JSON.stringify({
    silenceDurationMs,
    requestedSilenceDurationMs: raw || null,
    enabled: Boolean(raw),
    source: raw ? 'EXPO_PUBLIC_ROAST_VAD_SILENCE_DURATION_MS' : 'default',
    allowedValues: [650, 550, 500],
    ignoredInvalidValue: Boolean(raw && !ALLOWED_ROAST_VAD_SILENCE_DURATION_MS.has(parsed)),
  }));
  return silenceDurationMs;
}

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('Roast realtime ASR aborted.');
    error.name = 'AbortError';
    throw error;
  }
}

export async function startRoastRealtimeAsr(input: StartRoastRealtimeAsrInput): Promise<RoastRealtimeAsrController> {
  const client = new SpeakingRealtimeClient();
  if (!client.capability.available) {
    throw new Error(client.capability.reason || 'Realtime ASR is not available in this build.');
  }

  const mode = input.mode ?? 'default';
  const prompt = getRoastAsrPrompt(mode);
  const vadSilenceDurationMs = resolveRoastVadSilenceDurationMs();
  warnIfRoastAsrPromptTooLong(prompt, mode);
  console.log('[ROAST_ASR_CONFIG]', JSON.stringify({
    mode,
    language: ROAST_ASR_TRANSCRIPTION_LANGUAGE,
    vadSilenceDurationMs,
  }));
  console.log('[ROAST_ASR_VERBATIM_PROMPT]', JSON.stringify({
    enabled: mode === 'verbatim',
    promptLength: prompt.length,
    version: mode === 'verbatim' ? 'chinese_learner_verbatim_v2' : 'default',
  }));
  const t0 = now();
  const tokenStartedAt = now();
  throwIfAborted(input.signal);
  const token = await getSpeakingRealtimeToken(input.session, {
    scenarioId: 'roast-realtime-asr-lab',
    scenarioName: mode === 'verbatim' ? 'Roast Realtime ASR Verbatim Lab' : 'Roast Realtime ASR Lab',
    aiName: mode === 'verbatim' ? 'Verbatim ASR Listener' : 'Realtime ASR Listener',
    aiRole: mode === 'verbatim' ? 'verbatim transcription-only listener' : 'transcription-only listener',
    systemPrompt: prompt,
  }, {
    signal: input.signal,
  });
  const tokenDoneAt = now();
  throwIfAborted(input.signal);

  await client.connect({
    requestId: input.requestId,
    signal: input.signal,
    ephemeralKey: token.clientSecret,
    model: token.model,
    asrOnly: true,
    sessionInstructions: prompt,
    inputTranscriptionPrompt: prompt,
    inputTranscriptionLanguage: ROAST_ASR_TRANSCRIPTION_LANGUAGE,
    vadSilenceDurationMs,
    createCall: async (offerSdp) => {
      const call = await createSpeakingRealtimeCall({
        ephemeralKey: token.clientSecret,
        sdp: offerSdp,
      }, {
        signal: input.signal,
      });
      return { answerSdp: call.answerSdp };
    },
    onEvent: (event) => input.onEvent({ ...event, requestId: input.requestId }),
  });
  throwIfAborted(input.signal);
  client.unmuteMic();

  const connectedAt = now();
  return {
    requestId: input.requestId,
    client,
    connectedAt,
    tokenMs: Math.round(tokenDoneAt - tokenStartedAt),
    connectMs: Math.round(connectedAt - t0),
    stop: async () => {
      await client.disconnect();
    },
  };
}
