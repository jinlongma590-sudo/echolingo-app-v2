import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type EmitterSubscription } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import type { Scenario } from '@/data/scenarios';
import type { StoredSession } from '@/types/auth';
import type {
  SpeakingCredits,
  SpeakingExpressionStylesResponse,
  SpeakingScoreResult,
} from '@/services/api/speakingPractice';
import {
  SpeakingApiError,
  completeSpeakingSession,
  createSpeakingSession,
  fetchSpeakingCredits,
  generateSpeakingExpressionStyles,
  scoreSpeakingMessage,
  updateSpeakingSessionProgress,
} from '@/services/api/speakingPractice';
import {
  addPcmCaptureStatsListener,
  addPcmChunkListener,
  getPcmCaptureSupport,
  startPcmCapture,
  stopPcmCapture,
} from '@/services/audio/pcmCapture';
import { createWavBytes, decodeBase64, encodeBase64, resamplePcm16, writeBase64AudioToCacheFile } from '@/services/audio/pcmUtils';
import { SpeakingTtsPlayback } from '@/services/audio/ttsPlayback';
import { logRealtimeTransportConfig, OpenAiRealtimeWsClient } from '@/services/realtime/openaiRealtimeWsClient';
import { logXfyunApiBaseConfig, XfyunRtasrStreamingClient, runXfyunIseAssessment } from '@/services/api/xfyunStreamingAssess';
import type { SpeakingRuntimeError } from '@/types/speaking';
import type { SpeakingRecorderCapability } from '@/types/speaking';
import type {
  OpenAiRealtimeWsEvent,
  PcmCaptureSupport,
  PcmDualAssistantMessage,
  PcmDualConversationMessage,
  PcmDualRuntimeStage,
  PcmDualRuntimeValue,
  PcmDualUserAudio,
  PcmDualUserMessage,
  UserTurnAssessment,
  XfyunPronunciationDebug,
  XfyunRtasrTranscript,
} from '@/types/pcmDualStream';
import type {
  ExpressionStyleResult,
  SpeakingExpressionStylesState,
  SpeakingExpressionEvaluation,
  SpeakingRoundAnalysis,
  XfyunPronunciationAssessment,
} from '@/types/xfyunSpeakingAssessment';

const ENABLE_V1_PCM_DUAL_STREAM_RUNTIME = true;
const PCM_SAMPLE_RATE = 24000;
const PCM_CHANNELS = 1;
const PCM_CHUNK_MS = 40;
const PCM_PRECONNECT_BUFFER_MS = 3000;
const MIN_ROUND_DURATION_MS = 800;
const MIN_CAPTURED_BYTES = 12000;
const LOG_PREFIX = '[V1_PCM_DUAL]';
const FALLBACK_INITIAL_GREETING = "Hi! Let's start this speaking practice. What would you like to say first?";

function buildInitialGreetingText(scenario: Scenario): { text: string; source: 'scenario_openingLine' | 'fallback' } {
  const openingLine = scenario.openingLine?.trim();
  if (openingLine) {
    return { text: openingLine, source: 'scenario_openingLine' };
  }
  return { text: FALLBACK_INITIAL_GREETING, source: 'fallback' };
}

type ActiveRound = {
  roundId: number;
  userMessageId: string;
  assistantMessageId: string;
  startedAt: number;
  stopRequestedAt: number | null;
  chunks24k: Uint8Array[];
  rtasrClient: XfyunRtasrStreamingClient | null;
  openAiFirstTextAt: number | null;
  openAiFirstAudioAt: number | null;
  userTranscript: string | null;
  recordingDurationMs: number | null;
  audioSize: number | null;
  realtimeState: 'idle' | 'connecting' | 'connected' | 'failed';
  rtasrState: 'idle' | 'connecting' | 'connected' | 'failed';
  pendingRealtimeChunks24k: Uint8Array[];
  pendingRtasrChunks16k: Uint8Array[];
  firstChunkLogged: boolean;
  assistantMessageAppended: boolean;
  realtimeCommitStarted: boolean;
  rtasrFinishStarted: boolean;
  realtimeBufferedChunkCount: number;
  realtimeAudioChunksSent: number;
  chineseHelpIntentDetected: boolean;
  blockedResponseIds: Set<string>;
  webApiUnavailable: boolean;
};

type AssessmentExpressionStatus = SpeakingExpressionEvaluation['status'];
type PlaybackAction =
  | 'user_audio'
  | 'reference_us'
  | 'reference_uk'
  | 'better_expression'
  | 'expression_ai_read'
  | 'loop_follow';

function log(step: string, payload: Record<string, unknown>) {
  console.log(`${LOG_PREFIX} ${step} = ${JSON.stringify(payload)}`);
}

function roundForLog(value: number, precision = 3) {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

function readAscii(bytes: Uint8Array, offset: number, length: number) {
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(bytes[offset + index] ?? 0);
  }
  return value;
}

function readUint16Le(bytes: Uint8Array, offset: number) {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUint32Le(bytes: Uint8Array, offset: number) {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)
  ) >>> 0;
}

function summarizePcm16Signal(bytes: Uint8Array) {
  const sampleCount = Math.floor(bytes.byteLength / 2);
  if (sampleCount <= 0) {
    return {
      samples: 0,
      rms: 0,
      peak: 0,
      zeroRatio: 1,
    };
  }

  let sumSquares = 0;
  let peak = 0;
  let zeroLikeCount = 0;
  for (let offset = 0; offset + 1 < bytes.byteLength; offset += 2) {
    let sample = readUint16Le(bytes, offset);
    if (sample >= 0x8000) {
      sample -= 0x10000;
    }
    const abs = Math.abs(sample);
    peak = Math.max(peak, abs);
    sumSquares += sample * sample;
    if (abs <= 1) {
      zeroLikeCount += 1;
    }
  }

  return {
    samples: sampleCount,
    rms: roundForLog(Math.sqrt(sumSquares / sampleCount), 2),
    peak,
    zeroRatio: roundForLog(zeroLikeCount / sampleCount, 4),
  };
}

function normalizePcm16ForIse(bytes: Uint8Array) {
  const signal = summarizePcm16Signal(bytes);
  if (signal.samples <= 0 || signal.peak <= 0 || signal.rms <= 0) {
    return {
      bytes,
      applied: false,
      gain: 1,
      before: signal,
      after: signal,
      reason: 'empty_or_silent',
    };
  }

  const targetRms = 1800;
  const targetPeak = 12000;
  const maxGain = 160;
  const gain = Math.max(
    1,
    Math.min(maxGain, targetRms / signal.rms, targetPeak / signal.peak),
  );

  if (gain <= 1.05) {
    return {
      bytes,
      applied: false,
      gain: roundForLog(gain, 3),
      before: signal,
      after: signal,
      reason: 'already_loud_enough',
    };
  }

  const output = new Uint8Array(bytes.byteLength);
  for (let offset = 0; offset + 1 < bytes.byteLength; offset += 2) {
    let sample = readUint16Le(bytes, offset);
    if (sample >= 0x8000) {
      sample -= 0x10000;
    }
    const normalized = Math.max(-32768, Math.min(32767, Math.round(sample * gain)));
    output[offset] = normalized & 0xff;
    output[offset + 1] = (normalized >> 8) & 0xff;
  }

  return {
    bytes: output,
    applied: true,
    gain: roundForLog(gain, 3),
    before: signal,
    after: summarizePcm16Signal(output),
    reason: 'low_ise_level',
  };
}

function getPcm16DurationMs(bytes: Uint8Array, sampleRate: number, channels: number) {
  if (sampleRate <= 0 || channels <= 0) return 0;
  return Math.round((bytes.byteLength / (sampleRate * channels * 2)) * 1000);
}

function parseWavHeaderForLog(bytes: Uint8Array) {
  return {
    riff: readAscii(bytes, 0, 4),
    fileSize: readUint32Le(bytes, 4) + 8,
    wave: readAscii(bytes, 8, 4),
    fmt: readAscii(bytes, 12, 4),
    audioFormat: readUint16Le(bytes, 20),
    channels: readUint16Le(bytes, 22),
    sampleRate: readUint32Le(bytes, 24),
    byteRate: readUint32Le(bytes, 28),
    blockAlign: readUint16Le(bytes, 32),
    bitsPerSample: readUint16Le(bytes, 34),
    dataMarker: readAscii(bytes, 36, 4),
    dataSize: readUint32Le(bytes, 40),
  };
}

function createMessageId(prefix: 'user' | 'assistant') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashPlaybackValue(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

function detectChineseHelpIntent(text: string) {
  return [
    /speak chinese/i,
    /can you speak chinese/i,
    /explain.*chinese/i,
    /i don't understand/i,
    /do not understand/i,
    /用中文/,
    /中文解释/,
    /听不懂/,
    /我听不懂/,
    /\b中文\b/,
  ].some((pattern) => pattern.test(text));
}

function countChineseChars(text: string) {
  return (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
}

function countLatinWords(text: string) {
  return (text.match(/[A-Za-z]{2,}/g) ?? []).length;
}

function containsChineseChars(text: string) {
  return countChineseChars(text) > 0;
}

function isLikelyInvalidEnglishTranscript(transcript: string, scenarioId: string) {
  void scenarioId;
  const normalized = transcript.trim();
  if (!normalized) return true;
  const chineseCharCount = countChineseChars(normalized);
  const latinWordCount = countLatinWords(normalized);
  const fillerOnlyChinese = /^[\s嗯啊呃额哦呀吗了开？?，,。！!、]+$/.test(normalized);

  if (fillerOnlyChinese) return true;
  if (chineseCharCount > 0 && latinWordCount === 0) return true;
  if (/[A-Za-z]/.test(normalized) && latinWordCount === 0) return true;
  return false;
}

function countRepeatedNgrams(text: string, size: number) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < size) return 0;
  const counts = new Map<string, number>();
  for (let index = 0; index <= words.length - size; index += 1) {
    const key = words.slice(index, index + size).join(' ');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Math.max(0, ...counts.values());
}

function isRepeatedCumulativeTranscript(text: string) {
  const normalizedWords = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (normalizedWords.length <= 18) {
    return false;
  }
  const repeatedTwoGramCount = countRepeatedNgrams(text, 2);
  const repeatedThreeGramCount = countRepeatedNgrams(text, 3);
  const firstBigram = normalizedWords.slice(0, 2).join(' ');
  const firstBigramCount =
    firstBigram && normalizedWords.length >= 2
      ? normalizedWords
          .map((_, index) => normalizedWords.slice(index, index + 2).join(' '))
          .filter((value) => value === firstBigram).length
      : 0;
  return repeatedThreeGramCount > 2 || repeatedTwoGramCount > 3 || firstBigramCount > 2;
}

function isValidEnglishReferenceText(referenceText: string) {
  const normalized = referenceText.trim();
  if (!normalized) return false;
  if (containsChineseChars(normalized)) return false;
  return countLatinWords(normalized) >= 2;
}

function detectForbiddenAssistantLanguage(text: string) {
  const checks: Array<{ language: string; reason: string; pattern: RegExp }> = [
    { language: 'zh-CN', reason: 'chinese_chars', pattern: /[\u4e00-\u9fff]/ },
    { language: 'de', reason: 'german_keywords', pattern: /\b(schön|dass|bitte|heute|sprechen|möchtest|hallo|danke|guten)\b/i },
    { language: 'fr', reason: 'french_keywords', pattern: /\b(bonjour|merci|voudrais|s'il vous plaît|aujourd'hui)\b/i },
    { language: 'pt', reason: 'portuguese_keywords', pattern: /\b(ol[aá]|obrigado|obrigada|por favor|voc[eê]|gostaria)\b/i },
    { language: 'ru', reason: 'cyrillic_chars', pattern: /[А-Яа-яЁё]/ },
    {
      language: 'es',
      reason: 'spanish_keywords_or_accents',
      pattern:
        /\b(claro|gracias|quiero|puedo|por favor|hoy|m[eé]todo|gesti[oó]n|urgente|importante|consiste|puedes|quieres|que s[ií])\b|[áéíóúñ¿¡]/i,
    },
    { language: 'ja', reason: 'japanese_chars', pattern: /[ぁ-んァ-ヶ一-龯]/ },
    { language: 'ko', reason: 'korean_chars', pattern: /[가-힣]/ },
  ];
  const normalized = text.trim();
  if (!normalized) return null;
  const matched = checks.find((item) => item.pattern.test(normalized));
  return matched ?? null;
}

function getRtasrFallbackText(message?: string | null) {
  void message;
  return '语音识别暂时不可用，请重试';
}

function getRtasrFallbackRuntimeMessage() {
  return '语音识别暂时不可用，已切换为 AI 对话';
}

function getRtasrRecognizingText() {
  return '正在识别…';
}

function isWebApiUnavailableMessage(message?: string | null) {
  return /web_api_unreachable|network request failed|could not connect|xfyun_sign_failed|health_failed|rtasr_websocket_error|rtasr_connect_timeout/i.test(message || '');
}

function buildIdleExpressionStyles(): SpeakingExpressionStylesState {
  return {
    status: 'idle',
    americanCasual: null,
    businessFormal: null,
    britishNatural: null,
    errorMessage: null,
  };
}

function buildLoadingExpressionStyles(): SpeakingExpressionStylesState {
  return {
    status: 'loading',
    americanCasual: null,
    businessFormal: null,
    britishNatural: null,
    errorMessage: null,
  };
}

function mapExpressionStylesResponse(response: SpeakingExpressionStylesResponse): SpeakingExpressionStylesState {
  return {
    status: 'ready',
    americanCasual: response.americanCasual,
    businessFormal: response.businessFormal,
    britishNatural: response.britishNatural,
    errorMessage: null,
  };
}

function buildAssistantSafeFallbackText(scenarioId: string) {
  if (scenarioId === 'coffee-order') {
    return 'Sure. What size latte would you like?';
  }
  return "Sure. Let's keep practicing in English. Could you say that again?";
}

function detectAssistantTopicViolation(text: string, scenarioId: string) {
  const normalized = text.trim();
  if (!normalized) return null;
  if (scenarioId === 'coffee-order') {
    const coffeeOffTopicPattern = /\b(eisenhower|method|productivity|time management|task|tasks|urgent|important)\b/i;
    if (coffeeOffTopicPattern.test(normalized)) {
      return 'coffee_order_off_topic_keywords';
    }
  }
  return null;
}

function isLikelyEnglishUserSentence(text: string) {
  const normalized = text.trim();
  if (!normalized) return false;
  if (containsChineseChars(normalized)) return false;
  if (/[áéíóúñ¿¡À-ÿ]/.test(normalized)) return false;
  if (countLatinWords(normalized) < 2) return false;
  return true;
}

function buildInitialAnalysis(roundId: number, transcriptText: string): SpeakingRoundAnalysis {
  return {
    roundId,
    source: 'pcm_dual_stream',
    transcriptText,
    grammarStatus: 'correct',
    grammarLabel: '分析中',
    grammarTitle: '语法 / 表达',
    grammarExplanationZh: '语法与表达分析待接入。',
    pronunciationScore: null,
    naturalnessScore: null,
    optimizedSentence: null,
    polishedExplanationZh: '更地道表达待生成。',
    explanationZh: '发音评测进行中…',
    suggestions: ['系统正在补充本句的语法和地道表达分析。'],
    assessment: null,
    expression: buildPendingExpressionEvaluation(),
    expressionStyles: buildIdleExpressionStyles(),
  };
}

function buildPendingExpressionEvaluation(): SpeakingExpressionEvaluation {
  return {
    status: 'pending',
    grammarStatus: 'correct',
    grammarTitle: '分析中',
    grammarFeedbackZh: '语法与表达分析进行中。',
    betterExpression: null,
    betterExpressionZh: 'AI 正在分析表达、发音和地道度',
    nativeScore: null,
    nativeFeedbackZh: 'AI 正在分析表达、发音和地道度',
  };
}

function buildFailedExpressionEvaluation(message = '语法与表达分析待接入/生成失败'): SpeakingExpressionEvaluation {
  return {
    status: 'failed',
    grammarStatus: 'needs_improvement',
    grammarTitle: '待后补',
    grammarFeedbackZh: message,
    betterExpression: null,
    betterExpressionZh: message,
    nativeScore: null,
    nativeFeedbackZh: message,
  };
}

function buildInitialAssessment(roundId: number): UserTurnAssessment {
  return {
    roundId,
    transcript: '',
    userAudio: null,
    pronunciation: null,
    pronunciationDebug: null,
    expression: buildPendingExpressionEvaluation(),
    expressionStyles: buildIdleExpressionStyles(),
    skipped: null,
  };
}

function mapScoreToExpressionEvaluation(score: SpeakingScoreResult, transcript: string): SpeakingExpressionEvaluation {
  const correction = score.correction;
  const grammarStatus =
    correction?.type === 'ok' || !correction ? 'correct' : 'needs_improvement';
  const betterExpressionCandidate = correction?.fixed?.trim() || null;
  const betterExpression = isLikelyEnglishUserSentence(betterExpressionCandidate || '') ? betterExpressionCandidate : null;
  const grammarFeedbackZh =
    correction?.reason?.trim() ||
    (grammarStatus === 'correct' ? '语法基本正确，表达已经可以被自然理解。' : '这句表达还能再自然一点。') ||
    null;
  const betterExpressionZh = correction?.reason?.trim() || score.suggestion?.trim() || '建议把表达说得更完整、更自然。';

  return {
    status: 'ready',
    grammarStatus,
    grammarTitle: grammarStatus === 'correct' ? '语法正确' : '需要优化',
    grammarFeedbackZh,
    betterExpression,
    betterExpressionZh,
    nativeScore: Number.isFinite(score.vocabulary) ? score.vocabulary : score.overall,
    nativeFeedbackZh: score.suggestion?.trim() || grammarFeedbackZh,
  };
}

function trimPendingChunks(chunks: Uint8Array[]) {
  const maxChunks = Math.max(1, Math.ceil(PCM_PRECONNECT_BUFFER_MS / PCM_CHUNK_MS));
  while (chunks.length > maxChunks) {
    chunks.shift();
  }
}

function buildTranscriptJson(messages: PcmDualConversationMessage[]) {
  return messages.map((message) => ({
    id: message.id,
    role: message.role === 'assistant' ? 'assistant' : 'user',
    text: message.text,
    timestamp: message.timestamp,
    roundId: message.roundId,
    transcriptStatus: message.role === 'user' ? message.transcriptStatus : message.replyStatus,
  }));
}

function buildScoreJson(messages: PcmDualConversationMessage[]) {
  const userMessages = messages.filter(
    (message): message is PcmDualUserMessage => message.role === 'user',
  );
  const pronunciationScores = userMessages
    .map((message) => message.analysis?.pronunciationScore)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const latestOverall = pronunciationScores.at(-1) ?? null;
  const averageOverall =
    pronunciationScores.length > 0
      ? Math.round(pronunciationScores.reduce((sum, value) => sum + value, 0) / pronunciationScores.length)
      : null;

  return {
    runtime: 'pcm_dual_stream',
    rounds: userMessages.length,
    latestOverall,
    averageOverall,
  };
}

function useMountedRef() {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return mountedRef;
}

export function useSpeakingV1PcmDualStreamRuntime({
  session,
  scenario,
}: {
  session: StoredSession | null;
  scenario: Scenario;
}): PcmDualRuntimeValue & { runtimeError: SpeakingRuntimeError | null } {
  const mountedRef = useMountedRef();
  const [stage, setStage] = useState<PcmDualRuntimeStage>('idle');
  const [messages, setMessages] = useState<PcmDualConversationMessage[]>([]);
  const [runtimeError, setRuntimeError] = useState<SpeakingRuntimeError | null>(null);
  const [captureSupport, setCaptureSupport] = useState<PcmCaptureSupport | null>(null);
  const [credits, setCredits] = useState<SpeakingCredits | null>(null);
  const [creditsLoading, setCreditsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentRoundId, setCurrentRoundId] = useState(0);
  const [playbackMessageId, setPlaybackMessageId] = useState<string | null>(null);
  const [playbackText, setPlaybackText] = useState<string | null>(null);

  const messagesRef = useRef<PcmDualConversationMessage[]>([]);
  const activeRoundRef = useRef<ActiveRound | null>(null);
  const activeRoundIdRef = useRef<number | null>(null);
  const openAiClientRef = useRef<OpenAiRealtimeWsClient | null>(null);
  const ttsPlaybackRef = useRef(new SpeakingTtsPlayback());
  const pcmChunkSubscriptionRef = useRef<EmitterSubscription | null>(null);
  const pcmStatsSubscriptionRef = useRef<EmitterSubscription | null>(null);
  const turnCountRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const roundIdRef = useRef(0);
  const autoPlayedResponseIdsRef = useRef(new Set<string>());
  const autoPlayedMessageIdsRef = useRef(new Set<string>());
  const loopPlaybackTokenRef = useRef(0);
  const assistantAccumulatedTextRef = useRef(new Map<string, string>());
  const initialGreetingStartedRef = useRef(false);
  const initialGreetingDoneRef = useRef(false);
  const betterExpressionAudioCacheRef = useRef(new Map<string, string>());
  const playbackLifecycleTokenRef = useRef(0);
  const runtimeDisposedRef = useRef(false);
  const playbackGuardRef = useRef({
    activeKey: null as string | null,
    activeStartedAt: 0,
    lastRequestKey: null as string | null,
    lastRequestAt: 0,
  });

  const isActiveRound = useCallback((roundId: number) => activeRoundIdRef.current === roundId, []);

  const logStaleRoundEventIgnored = useCallback((eventName: string, roundId: number) => {
    log('stale_round_event_ignored', {
      eventName,
      roundId,
      activeRoundId: activeRoundIdRef.current,
    });
  }, []);

  const shouldIgnoreRoundEvent = useCallback(
    (eventName: string, roundId: number) => {
      if (isActiveRound(roundId)) {
        return false;
      }
      logStaleRoundEventIgnored(eventName, roundId);
      return true;
    },
    [isActiveRound, logStaleRoundEventIgnored],
  );

  useEffect(() => {
    runtimeDisposedRef.current = false;
    return () => {
      runtimeDisposedRef.current = true;
      playbackLifecycleTokenRef.current += 1;
      loopPlaybackTokenRef.current += 1;
      ttsPlaybackRef.current.stop('runtime_unmounted');
    };
  }, []);

  const appendMessage = useCallback((message: PcmDualConversationMessage) => {
    setMessages((prev) => {
      const next = [...prev, message];
      messagesRef.current = next;
      return next;
    });
  }, []);

  const patchMessage = useCallback(
    (messageId: string, patch: Partial<PcmDualConversationMessage> | ((message: PcmDualConversationMessage) => PcmDualConversationMessage)) => {
      setMessages((prev) => {
        const next = prev.map((message) => {
          if (message.id !== messageId) return message;
          return typeof patch === 'function' ? patch(message) : ({ ...message, ...patch } as PcmDualConversationMessage);
        });
        messagesRef.current = next;
        return next;
      });
    },
    [],
  );

  const clearError = useCallback(() => setRuntimeError(null), []);

  const runPlaybackGuard = useCallback(
    async ({
      roundId,
      action,
      value,
      run,
    }: {
      roundId: number;
      action: PlaybackAction;
      value: string;
      run: (key: string) => Promise<'played' | 'failed' | 'cancelled' | void>;
    }) => {
      const normalizedValue = value.trim();
      const key = `${roundId}:${action}:${hashPlaybackValue(normalizedValue)}`;
      const now = Date.now();
      const guard = playbackGuardRef.current;

      if (guard.lastRequestKey === key && now - guard.lastRequestAt < 700) {
        log('playback_request_deduped', {
          roundId,
          action,
          key,
        });
        return;
      }

      guard.lastRequestKey = key;
      guard.lastRequestAt = now;

      if (guard.activeKey === key) {
        log('playback_request_ignored_active_duplicate', {
          roundId,
          action,
          key,
        });
        return;
      }

      if (guard.activeKey && guard.activeKey !== key) {
        const previousKey = guard.activeKey;
        loopPlaybackTokenRef.current += 1;
        ttsPlaybackRef.current.stop('playback_interrupted');
        setPlaybackMessageId(null);
        setPlaybackText(null);
        log('playback_interrupt_previous', {
          previousKey,
          nextKey: key,
          action,
        });
      }

      guard.activeKey = key;
      guard.activeStartedAt = now;
      log('playback_start', {
        roundId,
        action,
        key,
      });

      try {
        const result = await run(key);
        if (result === 'cancelled') {
          if (playbackGuardRef.current.activeKey === key) {
            playbackGuardRef.current.activeKey = null;
          }
          return;
        }
        if (playbackGuardRef.current.activeKey === key) {
          playbackGuardRef.current.activeKey = null;
        }
        log('playback_done', {
          roundId,
          action,
          key,
        });
      } catch (error) {
        if (playbackGuardRef.current.activeKey === key) {
          playbackGuardRef.current.activeKey = null;
        }
        log('playback_failed', {
          roundId,
          action,
          key,
          message: normalizeError(error, 'playback_failed'),
        });
        throw error;
      }
    },
    [],
  );

  const updateUserRoundData = useCallback(
    (
      messageId: string,
      updater: (message: PcmDualUserMessage) => PcmDualUserMessage,
      logStep?: string,
      logPayload?: Record<string, unknown>,
    ) => {
      patchMessage(messageId, (message) => updater(message as PcmDualUserMessage));
      if (logStep) {
        log(logStep, logPayload ?? { messageId });
      }
      log('assessment_updated', {
        messageId,
        ...(logPayload ?? {}),
      });
    },
    [patchMessage],
  );

  const markAssessmentPipelineSkippedDueToWebApiUnavailable = useCallback(
    (round: ActiveRound, reasonMessage?: string | null) => {
      round.webApiUnavailable = true;
      const fallbackText = getRtasrFallbackText(reasonMessage);
      log('rtasr_unavailable_fallback_start', {
        roundId: round.roundId,
        reason: 'web_api_unreachable',
        message: reasonMessage ?? null,
        fallbackText,
      });
      log('rtasr_unavailable_reason', {
        roundId: round.roundId,
        reason: 'web_api_unreachable',
        message: reasonMessage ?? null,
      });
      updateUserRoundData(
        round.userMessageId,
        (message) => {
          const current = message as PcmDualUserMessage;
          return {
            ...current,
            text: fallbackText,
            transcriptStatus: 'unavailable',
            transcriptSource: 'fallback',
            pronunciation: null,
            pronunciationDebug: {
              started: false,
              skipped: true,
              skipReason: 'web_api_unreachable',
              referenceTextUsed: null,
            },
            analysis: null,
            turnAssessment: {
              ...(current.turnAssessment ?? buildInitialAssessment(round.roundId)),
              transcript: '',
              userAudio: current.turnAssessment?.userAudio ?? current.userAudio ?? null,
              pronunciation: null,
              pronunciationDebug: {
                started: false,
                skipped: true,
                skipReason: 'web_api_unreachable',
                referenceTextUsed: null,
              },
              expression: buildPendingExpressionEvaluation(),
              expressionStyles: buildIdleExpressionStyles(),
              skipped: {
                reason: 'web_api_unreachable',
                rawTranscript: '',
              },
            },
            analysisStatus: 'failed',
          };
        },
      );
      if (mountedRef.current) {
        setRuntimeError({
          scope: 'recording',
          message: getRtasrFallbackRuntimeMessage(),
          recoverable: true,
        });
      }
      log('assessment_pipeline_skipped_due_to_web_api_unreachable', {
        roundId: round.roundId,
        message: reasonMessage ?? null,
      });
      log('expression_eval_skipped', {
        roundId: round.roundId,
        reason: 'web_api_unreachable',
      });
      log('expression_styles_skipped', {
        roundId: round.roundId,
        reason: 'web_api_unreachable',
      });
      log('ise_skipped', {
        roundId: round.roundId,
        reason: 'web_api_unreachable',
        referenceText: null,
      });
    },
    [mountedRef, updateUserRoundData],
  );

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    setStage('idle');
    setMessages([]);
    messagesRef.current = [];
    setRuntimeError(null);
    setSessionId(null);
    sessionIdRef.current = null;
    setCurrentRoundId(0);
    turnCountRef.current = 0;
    roundIdRef.current = 0;
    activeRoundRef.current = null;
    activeRoundIdRef.current = null;
    setPlaybackMessageId(null);
    setPlaybackText(null);
    autoPlayedResponseIdsRef.current.clear();
    autoPlayedMessageIdsRef.current.clear();
    assistantAccumulatedTextRef.current.clear();
    playbackGuardRef.current.activeKey = null;
    playbackGuardRef.current.activeStartedAt = 0;
    playbackGuardRef.current.lastRequestKey = null;
    playbackGuardRef.current.lastRequestAt = 0;
    betterExpressionAudioCacheRef.current.clear();
    openAiClientRef.current?.close();
    openAiClientRef.current = null;
  }, [scenario.id]);

  useEffect(() => {
    logRealtimeTransportConfig();
    try {
      logXfyunApiBaseConfig();
    } catch (error) {
      log('web_api_unreachable', {
        url: null,
        message: normalizeError(error, 'xfyun_api_base_config_failed'),
        suggestion:
          '请设置 EXPO_PUBLIC_ECHOLINGO_WEB_API_BASE，开发时可指向 http://你的Mac局域网IP:3000。',
      });
    }
    log('realtime_language_policy', {
      defaultReplyLanguage: 'en',
      allowChineseHelp: true,
      allowedAssistantLanguages: ['en', 'zh-CN'],
      forbiddenAssistantLanguagesCount: 6,
    });
  }, []);

  const refreshCredits = useCallback(async () => {
    if (!session) {
      setCredits(null);
      return;
    }
    setCreditsLoading(true);
    try {
      const nextCredits = await fetchSpeakingCredits(session);
      if (!mountedRef.current) return;
      setCredits(nextCredits);
    } catch (error) {
      if (!mountedRef.current) return;
      setRuntimeError({
        scope: 'session',
        message: normalizeError(error, '口语额度加载失败'),
        recoverable: true,
      });
    } finally {
      if (mountedRef.current) {
        setCreditsLoading(false);
      }
    }
  }, [mountedRef, session]);

  useEffect(() => {
    void refreshCredits();
  }, [refreshCredits]);

  useEffect(() => {
    let disposed = false;
    void getPcmCaptureSupport()
      .then((support) => {
        if (!disposed && mountedRef.current) {
          setCaptureSupport(support);
          log('pcm_capture_supported', {
            supported: support.supported,
            reason: support.reason ?? null,
            platform: support.platform,
          });
        }
      })
      .catch((error) => {
        if (!disposed) {
          log('pcm_capture_failed', {
            message: normalizeError(error, 'pcm_capture_support_check_failed'),
          });
        }
      });
    return () => {
      disposed = true;
    };
  }, [mountedRef]);

  const handleRealtimeEvent = useCallback(
    async (event: OpenAiRealtimeWsEvent) => {
      const eventRoundId =
        event.type === 'assistant_text_delta' || event.type === 'assistant_audio_delta' || event.type === 'assistant_response_done'
          ? event.roundId ?? null
          : null;
      if (eventRoundId != null && shouldIgnoreRoundEvent(event.type, eventRoundId)) {
        return;
      }

      const activeRound = activeRoundRef.current;
      if (!activeRound) {
        return;
      }

      if (event.type === 'assistant_text_delta') {
        ensureAssistantMessage(activeRound);
        if (!activeRound.openAiFirstTextAt) {
          activeRound.openAiFirstTextAt = Date.now();
          log('ai_first_text_delta', {
            roundId: activeRound.roundId,
            userStopToAiFirstTextDeltaMs:
              activeRound.stopRequestedAt != null ? activeRound.openAiFirstTextAt - activeRound.stopRequestedAt : null,
            textPreview: event.textDelta.slice(0, 80),
          });
        }
        const responseKey = event.responseId ?? `round_${activeRound.roundId}`;
        const nextAccumulated = `${assistantAccumulatedTextRef.current.get(responseKey) ?? ''}${event.textDelta}`;
        const forbiddenLanguage = detectForbiddenAssistantLanguage(nextAccumulated);
        const topicViolation = detectAssistantTopicViolation(nextAccumulated, scenario.id);
        if (forbiddenLanguage || topicViolation) {
          const fallbackText = buildAssistantSafeFallbackText(scenario.id);
          assistantAccumulatedTextRef.current.set(responseKey, fallbackText);
          if (event.responseId) {
            activeRound.blockedResponseIds.add(event.responseId);
          }
          patchMessage(activeRound.assistantMessageId, (message) => ({
            ...(message as PcmDualAssistantMessage),
            text: fallbackText,
            replyStatus: 'pending',
          }));
          if (forbiddenLanguage) {
            log('assistant_language_violation_detected', {
              roundId: activeRound.roundId,
              scenarioId: scenario.id,
              scenarioTitle: scenario.name,
              responseId: event.responseId ?? null,
              textPreview: nextAccumulated.slice(0, 120),
              detectedReason: `${forbiddenLanguage.language}:${forbiddenLanguage.reason}`,
            });
          }
          if (topicViolation) {
            log('assistant_topic_violation_detected', {
              roundId: activeRound.roundId,
              scenarioId: scenario.id,
              scenarioTitle: scenario.name,
              responseId: event.responseId ?? null,
              textPreview: nextAccumulated.slice(0, 120),
              detectedReason: topicViolation,
            });
          }
          return;
        }
        assistantAccumulatedTextRef.current.set(responseKey, nextAccumulated);
        patchMessage(activeRound.assistantMessageId, (message) => ({
          ...(message as PcmDualAssistantMessage),
          text: nextAccumulated,
          replyStatus: 'pending',
        }));
        log('assistant_text_delta_accumulated', {
          responseId: event.responseId ?? null,
          accumulatedLength: nextAccumulated.length,
        });
        log('assistant_text_delta_applied', {
          roundId: activeRound.roundId,
          messageId: activeRound.assistantMessageId,
          responseId: event.responseId ?? null,
          sourceType: event.sourceType ?? null,
          deltaPreview: event.textDelta.slice(0, 80),
          accumulatedLength: nextAccumulated.length,
        });
        setStage((current) => (current === 'playing' ? current : 'thinking'));
        return;
      }

      if (event.type === 'assistant_audio_delta') {
        if (!activeRound.openAiFirstAudioAt) {
          activeRound.openAiFirstAudioAt = Date.now();
          log('ai_first_audio_delta', {
            roundId: activeRound.roundId,
            userStopToAiAudioMs:
              activeRound.stopRequestedAt != null ? activeRound.openAiFirstAudioAt - activeRound.stopRequestedAt : null,
            audioBytes: event.audioBytes,
          });
        }
        return;
      }

      if (event.type === 'assistant_response_done') {
        ensureAssistantMessage(activeRound);
        const responseKey = event.responseId ?? `round_${activeRound.roundId}`;
        const accumulatedText = assistantAccumulatedTextRef.current.get(responseKey) ?? '';
        const blockedByLanguageGuard = event.responseId ? activeRound.blockedResponseIds.has(event.responseId) : false;
        const finalTextCandidate = event.assistantText.trim();
        const bestAvailableText =
          finalTextCandidate.length >= accumulatedText.length ? finalTextCandidate : accumulatedText;
        const forbiddenLanguage = detectForbiddenAssistantLanguage(bestAvailableText);
        const topicViolation = detectAssistantTopicViolation(bestAvailableText, scenario.id);
        const blockedByGuard = blockedByLanguageGuard || Boolean(forbiddenLanguage) || Boolean(topicViolation);
        const finalizedText = blockedByGuard ? buildAssistantSafeFallbackText(scenario.id) : bestAvailableText;
        if (finalTextCandidate && finalTextCandidate.length < accumulatedText.length) {
          log('assistant_text_final_ignored_shorter', {
            roundId: activeRound.roundId,
            responseId: event.responseId ?? null,
            accumulatedLength: accumulatedText.length,
            finalLength: finalTextCandidate.length,
          });
        }
        if (forbiddenLanguage) {
          log('assistant_language_violation_detected', {
            roundId: activeRound.roundId,
            scenarioId: scenario.id,
            scenarioTitle: scenario.name,
            responseId: event.responseId ?? null,
            textPreview: bestAvailableText.slice(0, 120),
            detectedReason: `${forbiddenLanguage.language}:${forbiddenLanguage.reason}`,
          });
        }
        if (topicViolation) {
          log('assistant_topic_violation_detected', {
            roundId: activeRound.roundId,
            scenarioId: scenario.id,
            scenarioTitle: scenario.name,
            responseId: event.responseId ?? null,
            textPreview: bestAvailableText.slice(0, 120),
            detectedReason: topicViolation,
          });
        }
        let audioFileUri: string | null = null;
        if (event.audioBase64 && !blockedByGuard) {
          try {
            const pcmBytes = decodeBase64(event.audioBase64);
            const wavBytes = createWavBytes(pcmBytes, event.audioSampleRate ?? PCM_SAMPLE_RATE, 1);
            audioFileUri = await writeBase64AudioToCacheFile(encodeBase64(wavBytes), 'wav');
          } catch (error) {
            log('realtime_error', {
              roundId: activeRound.roundId,
              message: normalizeError(error, 'assistant_audio_file_write_failed'),
            });
          }
        }

        patchMessage(activeRound.assistantMessageId, (message) => ({
          ...(message as PcmDualAssistantMessage),
          text: finalizedText || message.text || '...',
          audioFileUri,
          audioMimeType: audioFileUri ? 'audio/wav' : null,
          replyStatus: 'ready',
        }));
        log('assistant_text_finalized', {
          roundId: activeRound.roundId,
          messageId: activeRound.assistantMessageId,
          responseId: event.responseId ?? null,
          sourceType: event.sourceType ?? null,
          textLength: finalizedText.length,
          textPreview: finalizedText.slice(0, 120),
        });

        log('ai_response_done', {
          roundId: activeRound.roundId,
          textLength: finalizedText.length,
          audioBytes: event.audioBytes,
        });
        assistantAccumulatedTextRef.current.delete(responseKey);
        if (event.responseId) {
          activeRound.blockedResponseIds.delete(event.responseId);
        }

        if (audioFileUri) {
          const responseId = event.responseId ?? null;
          const hasPlayedResponseId = responseId
            ? autoPlayedResponseIdsRef.current.has(responseId)
            : false;
          const hasPlayedMessageId = autoPlayedMessageIdsRef.current.has(activeRound.assistantMessageId);
          if (hasPlayedResponseId || hasPlayedMessageId) {
            log('ai_audio_play_skipped_duplicate', {
              responseId,
              messageId: activeRound.assistantMessageId,
            });
          } else {
        if (responseId) {
          autoPlayedResponseIdsRef.current.add(responseId);
        }
        autoPlayedMessageIdsRef.current.add(activeRound.assistantMessageId);
        await playAssistantAudio(activeRound.assistantMessageId, audioFileUri, finalizedText);
          }
        } else if (mountedRef.current) {
          setStage('idle');
        }

        const totalMs = Date.now() - activeRound.startedAt;
        if (shouldIgnoreRoundEvent('round_done', activeRound.roundId)) {
          return;
        }
        log('round_done', {
          roundId: activeRound.roundId,
          totalMs,
        });
        return;
      }

      if (event.type === 'error' && mountedRef.current) {
        if (activeRound.stopRequestedAt != null) {
          patchMessage(activeRound.assistantMessageId, {
            text: 'AI 回复失败，请重试',
            replyStatus: 'failed',
          });
        }
        setRuntimeError({
          scope: 'chat',
          message: event.message,
          recoverable: true,
        });
      }
    },
    [mountedRef, patchMessage, shouldIgnoreRoundEvent],
  );

  const getOrCreateRealtimeClient = useCallback(() => {
    if (!session) {
      throw new Error('请先登录后再开始练习。');
    }
    if (!openAiClientRef.current || openAiClientRef.current.getConnectionState() === 'failed') {
      openAiClientRef.current?.close();
      openAiClientRef.current = new OpenAiRealtimeWsClient({
        session,
        scenario,
        onEvent: (event) => {
          void handleRealtimeEvent(event);
        },
      });
    }
    return openAiClientRef.current;
  }, [handleRealtimeEvent, scenario, session]);

  const ensurePracticeSession = useCallback(async () => {
    if (!session) {
      throw new Error('请先登录后再开始练习。');
    }
    if (sessionIdRef.current) {
      return sessionIdRef.current;
    }
    const created = await createSpeakingSession(session, {
      scenarioId: scenario.id,
      mode: scenario.id === 'free-chat' ? 'free_chat' : 'scenario',
    });
    if (!mountedRef.current) {
      return created.sessionId;
    }
    setSessionId(created.sessionId);
    sessionIdRef.current = created.sessionId;
    return created.sessionId;
  }, [mountedRef, scenario.id, session]);

  const playStoredAudio = useCallback(
    async (
      messageId: string,
      roundId: number,
      uri: string,
      text: string,
      type: 'assistant' | 'user' | 'better_expression',
      options?: {
        durationMs?: number | null;
        cleanupFileAfterPlay?: boolean;
        guardKey?: string;
        debugHooks?: {
          onCreateSoundStart?: () => void;
          onCreateSoundDone?: () => void;
          onPlayAsyncStart?: () => void;
          onPlayAsyncDone?: () => void;
          onPlaybackError?: (error: unknown) => void;
        };
      },
    ): Promise<'played' | 'failed' | 'cancelled'> => {
      const playbackToken = playbackLifecycleTokenRef.current;
      if (!mountedRef.current || runtimeDisposedRef.current) return 'cancelled';
      setPlaybackMessageId(messageId);
      setPlaybackText(text);
      setStage('playing');

      if (type === 'assistant') {
        log('ai_audio_play_start', {
          messageId,
          audioFileUri: uri,
        });
      } else if (type === 'user') {
        log('user_audio_play_start', {
          roundId,
          uri,
          durationMs: options?.durationMs ?? null,
        });
      } else {
        log('better_expression_tts_start', {
          roundId,
          text,
        });
      }

      let result: 'played' | 'failed' | 'cancelled';
      try {
        if (playbackToken !== playbackLifecycleTokenRef.current || runtimeDisposedRef.current) {
          return 'cancelled';
        }
        result = await ttsPlaybackRef.current.playUri(
          uri,
          text,
          undefined,
          {
            cleanupFileAfterPlay: options?.cleanupFileAfterPlay,
            reason: type === 'assistant' ? 'assistant_audio' : type === 'user' ? 'user_audio' : 'better_expression_audio',
            debugHooks: options?.debugHooks,
          },
        );
      } catch (error) {
        if (type === 'assistant') {
          log('ai_audio_play_failed', {
            messageId,
            audioFileUri: uri,
            errorMessage: normalizeError(error, 'ai_audio_play_failed'),
          });
        }
        throw error;
      }

      if (
        playbackToken !== playbackLifecycleTokenRef.current ||
        runtimeDisposedRef.current ||
        options?.guardKey &&
        playbackGuardRef.current.activeKey !== options.guardKey &&
        result === 'cancelled'
      ) {
        return result;
      }

      if (!mountedRef.current || runtimeDisposedRef.current || playbackToken !== playbackLifecycleTokenRef.current) return result;
      setPlaybackMessageId(null);
      setPlaybackText(null);
      setStage((current) => (current === 'playing' ? 'idle' : current));

      if (result === 'played') {
        if (type === 'assistant') {
          log('ai_audio_play_done', {
            messageId,
            audioFileUri: uri,
          });
        } else if (type === 'user') {
          log('user_audio_play_done', { roundId });
        } else if (type === 'better_expression') {
          log('better_expression_tts_done', { roundId, text });
        }
      } else if (result === 'failed') {
        if (type === 'assistant') {
          log('ai_audio_play_failed', {
            messageId,
            audioFileUri: uri,
            errorMessage: 'ai_audio_play_failed',
          });
        } else if (type === 'user') {
          log('user_audio_play_failed', {
            roundId,
            message: 'user_audio_play_failed',
          });
        } else if (type === 'better_expression') {
          log('better_expression_tts_failed', {
            roundId,
            text,
            message: 'better_expression_tts_failed',
          });
        }
      }
      return result;
    },
    [mountedRef],
  );

  const playAssistantAudio = useCallback(
    async (
      messageId: string,
      audioFileUri: string,
      text: string,
      options?: {
        debugHooks?: {
          onCreateSoundStart?: () => void;
          onCreateSoundDone?: () => void;
          onPlayAsyncStart?: () => void;
          onPlayAsyncDone?: () => void;
          onPlaybackError?: (error: unknown) => void;
        };
      },
    ) => {
      return playStoredAudio(messageId, -1, audioFileUri, text, 'assistant', {
        cleanupFileAfterPlay: false,
        debugHooks: options?.debugHooks,
      });
    },
    [playStoredAudio],
  );

  const ensureAssistantMessage = useCallback(
    (round: ActiveRound) => {
      if (round.assistantMessageAppended) {
        return;
      }
      round.assistantMessageAppended = true;
      log('assistant_text_message_created', {
        roundId: round.roundId,
        messageId: round.assistantMessageId,
      });
      appendMessage({
        id: round.assistantMessageId,
        role: 'assistant',
        roundId: round.roundId,
        text: '',
        timestamp: Date.now(),
        replyStatus: 'pending',
      });
    },
    [appendMessage],
  );

  const failAssistantMessage = useCallback(
    (round: ActiveRound, message: string) => {
      ensureAssistantMessage(round);
      patchMessage(round.assistantMessageId, {
        text: message,
        replyStatus: 'failed',
      });
    },
    [ensureAssistantMessage, patchMessage],
  );

  const flushRealtimeBufferedAudio = useCallback((round: ActiveRound) => {
    const client = openAiClientRef.current;
    if (!client || !client.isConnected() || round.pendingRealtimeChunks24k.length === 0) {
      return;
    }
    const pendingChunks = [...round.pendingRealtimeChunks24k];
    round.pendingRealtimeChunks24k = [];
    log('realtime_buffer_flush_start', {
      roundId: round.roundId,
      bufferedChunks: pendingChunks.length,
      bufferedMs: pendingChunks.length * PCM_CHUNK_MS,
    });
    for (const chunk of pendingChunks) {
      client.appendInputAudio(chunk);
      round.realtimeAudioChunksSent += 1;
      if (round.realtimeAudioChunksSent === 1 || round.realtimeAudioChunksSent % 25 === 0) {
        log('realtime_audio_chunk_sent', {
          roundId: round.roundId,
          chunksSent: round.realtimeAudioChunksSent,
          bytesSent: chunk.byteLength,
          source: 'buffer_flush',
        });
      }
    }
    log('realtime_buffer_flush_done', {
      roundId: round.roundId,
      flushedChunks: pendingChunks.length,
    });
  }, []);

  const triggerRealtimeCommit = useCallback(
    (round: ActiveRound) => {
      if (round.realtimeCommitStarted) {
        return;
      }
      round.realtimeCommitStarted = true;
      ensureAssistantMessage(round);
      const committed = openAiClientRef.current?.commitAndCreateResponse(round.roundId);
      if (!committed) {
        failAssistantMessage(round, 'AI 回复失败，请重试');
      }
    },
    [ensureAssistantMessage, failAssistantMessage],
  );

  const startRealtimeConnectInBackground = useCallback(
    (round: ActiveRound) => {
      let client: OpenAiRealtimeWsClient;
      try {
        client = getOrCreateRealtimeClient();
      } catch (error) {
        round.realtimeState = 'failed';
        log('realtime_connect_failed', {
          roundId: round.roundId,
          message: normalizeError(error, 'realtime_client_init_failed'),
          phase: 'unknown',
        });
        return;
      }

      round.realtimeState = 'connecting';
      void client
        .connect()
        .then(() => {
          if (shouldIgnoreRoundEvent('realtime_connect_open', round.roundId)) {
            return;
          }
          round.realtimeState = 'connected';
          try {
            flushRealtimeBufferedAudio(round);
          } catch (error) {
            round.realtimeState = 'failed';
            failAssistantMessage(round, 'AI 回复失败，请重试');
            log('realtime_error', {
              roundId: round.roundId,
              message: normalizeError(error, 'realtime_buffer_flush_failed'),
            });
            return;
          }
          if (round.stopRequestedAt != null) {
            triggerRealtimeCommit(round);
          }
        })
        .catch((error) => {
          if (shouldIgnoreRoundEvent('realtime_connect_failed', round.roundId)) {
            return;
          }
          round.realtimeState = 'failed';
          const message = normalizeError(error, 'openai_realtime_connect_failed');
          const isRelayServerFailure = /openai_connect|openai_relay|etimedout|timedout/i.test(message);
          if (round.stopRequestedAt != null) {
            failAssistantMessage(round, isRelayServerFailure ? 'AI 连接失败，请检查 relay 服务端' : 'AI 回复失败，请重试');
          }
          if (mountedRef.current) {
            setRuntimeError({
              scope: 'chat',
              message: isRelayServerFailure
                ? 'AI 连接失败，请检查 relay 服务端'
                : `Realtime 连接失败：${message}`,
              recoverable: true,
            });
          }
        });
    },
    [failAssistantMessage, flushRealtimeBufferedAudio, getOrCreateRealtimeClient, mountedRef, shouldIgnoreRoundEvent, triggerRealtimeCommit],
  );

  const flushRtasrBufferedAudio = useCallback((round: ActiveRound) => {
    if (!round.rtasrClient || round.pendingRtasrChunks16k.length === 0) {
      return;
    }
    const pendingChunks = [...round.pendingRtasrChunks16k];
    round.pendingRtasrChunks16k = [];
    for (const chunk of pendingChunks) {
      round.rtasrClient.appendPcmChunk(chunk);
    }
  }, []);

  const runExpressionStyles = useCallback(
    async (
      round: ActiveRound,
      input: {
        transcript: string;
        currentBetterExpression: string;
        currentExplanationZh: string;
      },
    ) => {
      if (shouldIgnoreRoundEvent('expression_styles_start', round.roundId)) {
        return;
      }
      if (!session || !input.transcript.trim() || !input.currentBetterExpression.trim()) {
        return;
      }

      if (round.chineseHelpIntentDetected) {
        log('expression_styles_skipped', {
          roundId: round.roundId,
          reason: 'chinese_help_turn',
        });
        return;
      }

      if (isLikelyInvalidEnglishTranscript(input.transcript, scenario.id) || containsChineseChars(input.transcript)) {
        log('expression_styles_skipped', {
          roundId: round.roundId,
          reason: 'invalid_transcript',
        });
        return;
      }

      updateUserRoundData(
        round.userMessageId,
        (message) => {
          const current = message as PcmDualUserMessage;
          const currentAnalysis = current.analysis ?? buildInitialAnalysis(round.roundId, input.transcript);
          return {
            ...current,
            analysis: {
              ...currentAnalysis,
              expressionStyles: buildLoadingExpressionStyles(),
            },
            turnAssessment: {
              ...(current.turnAssessment ?? buildInitialAssessment(round.roundId)),
              transcript: input.transcript,
              userAudio: current.turnAssessment?.userAudio ?? current.userAudio ?? null,
              pronunciation: current.turnAssessment?.pronunciation ?? current.pronunciation,
              pronunciationDebug: current.turnAssessment?.pronunciationDebug ?? current.pronunciationDebug,
              expression: current.turnAssessment?.expression ?? buildPendingExpressionEvaluation(),
              expressionStyles: buildLoadingExpressionStyles(),
            },
          };
        },
      );

      log('expression_styles_start', {
        roundId: round.roundId,
        transcript: input.transcript,
      });

      try {
        const styles = await generateSpeakingExpressionStyles(session, {
          transcript: input.transcript,
          scenarioId: scenario.id,
          scenarioTitle: scenario.name,
          level: scenario.level,
          currentBetterExpression: input.currentBetterExpression,
          currentExplanationZh: input.currentExplanationZh,
        });
        if (shouldIgnoreRoundEvent('expression_styles_done', round.roundId)) {
          return;
        }
        const mappedStyles = mapExpressionStylesResponse(styles);

        updateUserRoundData(
          round.userMessageId,
          (message) => {
            const current = message as PcmDualUserMessage;
            const currentAnalysis = current.analysis ?? buildInitialAnalysis(round.roundId, input.transcript);
            return {
              ...current,
              analysis: {
                ...currentAnalysis,
                expressionStyles: mappedStyles,
              },
              turnAssessment: {
                ...(current.turnAssessment ?? buildInitialAssessment(round.roundId)),
                transcript: input.transcript,
                userAudio: current.turnAssessment?.userAudio ?? current.userAudio ?? null,
                pronunciation: current.turnAssessment?.pronunciation ?? current.pronunciation,
                pronunciationDebug: current.turnAssessment?.pronunciationDebug ?? current.pronunciationDebug,
                expression: current.turnAssessment?.expression ?? buildPendingExpressionEvaluation(),
                expressionStyles: mappedStyles,
              },
            };
          },
        );

        log('expression_styles_done', {
          roundId: round.roundId,
          hasAmericanCasual: Boolean(mappedStyles.americanCasual?.expression),
          hasBusinessFormal: Boolean(mappedStyles.businessFormal?.expression),
          hasBritishNatural: Boolean(mappedStyles.britishNatural?.expression),
        });
      } catch (error) {
        if (shouldIgnoreRoundEvent('expression_styles_failed', round.roundId)) {
          return;
        }
        updateUserRoundData(
          round.userMessageId,
          (message) => {
            const current = message as PcmDualUserMessage;
            const currentAnalysis = current.analysis ?? buildInitialAnalysis(round.roundId, input.transcript);
            const failedStyles: SpeakingExpressionStylesState = {
              ...buildIdleExpressionStyles(),
              status: 'failed',
              errorMessage: normalizeError(error, 'expression_styles_failed'),
            };
            return {
              ...current,
              analysis: {
                ...currentAnalysis,
                expressionStyles: failedStyles,
              },
              turnAssessment: {
                ...(current.turnAssessment ?? buildInitialAssessment(round.roundId)),
                transcript: input.transcript,
                userAudio: current.turnAssessment?.userAudio ?? current.userAudio ?? null,
                pronunciation: current.turnAssessment?.pronunciation ?? current.pronunciation,
                pronunciationDebug: current.turnAssessment?.pronunciationDebug ?? current.pronunciationDebug,
                expression: current.turnAssessment?.expression ?? buildPendingExpressionEvaluation(),
                expressionStyles: failedStyles,
              },
            };
          },
        );

        const apiError = error instanceof SpeakingApiError ? error : null;
        log('expression_styles_failed', {
          roundId: round.roundId,
          status: apiError?.status ?? null,
          contentType: apiError?.contentType ?? null,
          bodyPreview: apiError?.rawMessage ?? normalizeError(error, 'expression_styles_failed'),
        });
      }
    },
    [scenario.id, scenario.level, scenario.name, session, shouldIgnoreRoundEvent, updateUserRoundData],
  );

  const runExpressionEvaluation = useCallback(
    async (round: ActiveRound, transcriptText: string) => {
      if (shouldIgnoreRoundEvent('expression_eval_start', round.roundId)) {
        return;
      }
      if (!session || !transcriptText.trim()) {
        return;
      }

      if (round.chineseHelpIntentDetected) {
        log('expression_eval_skipped', {
          roundId: round.roundId,
          reason: 'chinese_help_turn',
        });
        return;
      }

      if (isLikelyInvalidEnglishTranscript(transcriptText, scenario.id)) {
        log('expression_eval_skipped', {
          roundId: round.roundId,
          reason: 'invalid_transcript',
        });
        return;
      }

      const assistantPreviousMessage =
        [...messagesRef.current]
          .reverse()
          .find(
            (message): message is PcmDualAssistantMessage =>
              message.role === 'assistant' &&
              message.roundId < round.roundId &&
              message.text.trim().length > 0,
          )?.text ?? '';

      log('expression_eval_start', {
        roundId: round.roundId,
        transcript: transcriptText,
        scenarioId: scenario.id,
        scenarioTitle: scenario.name,
        level: scenario.level,
      });

      try {
        const score = await scoreSpeakingMessage(session, {
          userText: transcriptText,
          scenarioId: scenario.id,
          scenarioTitle: scenario.name,
          assistantPreviousMessage,
          level: scenario.level,
        });
        if (shouldIgnoreRoundEvent('expression_eval_done', round.roundId)) {
          return;
        }
        const expression = mapScoreToExpressionEvaluation(score, transcriptText);

        updateUserRoundData(
          round.userMessageId,
          (message) => {
            const current = message as PcmDualUserMessage;
            const currentAnalysis = current.analysis ?? buildInitialAnalysis(round.roundId, transcriptText);
            return {
              ...current,
              analysis: {
                ...currentAnalysis,
                transcriptText,
                grammarStatus: expression.grammarStatus,
                grammarLabel: expression.grammarStatus === 'correct' ? '语法正确' : '需要优化',
                grammarTitle: expression.grammarTitle,
                grammarExplanationZh: expression.grammarFeedbackZh,
                naturalnessScore: expression.nativeScore,
                optimizedSentence: expression.betterExpression,
                polishedExplanationZh: expression.betterExpressionZh,
                explanationZh: expression.nativeFeedbackZh ?? currentAnalysis.explanationZh,
                suggestions: expression.nativeFeedbackZh ? [expression.nativeFeedbackZh] : currentAnalysis.suggestions,
                expression,
              },
              turnAssessment: {
                ...(current.turnAssessment ?? buildInitialAssessment(round.roundId)),
                transcript: transcriptText,
                userAudio: current.turnAssessment?.userAudio ?? current.userAudio ?? null,
                pronunciation: current.turnAssessment?.pronunciation ?? current.pronunciation,
                pronunciationDebug: current.turnAssessment?.pronunciationDebug ?? current.pronunciationDebug,
                expression,
                expressionStyles: current.turnAssessment?.expressionStyles ?? currentAnalysis.expressionStyles ?? buildIdleExpressionStyles(),
              },
            };
          },
          'assessment_expression_attached',
          {
            roundId: round.roundId,
            messageId: round.userMessageId,
            grammarStatus: expression.grammarStatus,
            nativeScore: expression.nativeScore,
            betterExpression: expression.betterExpression,
          },
        );

        log('expression_eval_done', {
          roundId: round.roundId,
          grammarStatus: expression.grammarStatus,
          betterExpression: expression.betterExpression,
          nativeScore: expression.nativeScore,
        });
        if (expression.betterExpression) {
          void runExpressionStyles(round, {
            transcript: transcriptText,
            currentBetterExpression: expression.betterExpression,
            currentExplanationZh: expression.betterExpressionZh ?? expression.nativeFeedbackZh ?? '',
          });
        }
      } catch (error) {
        if (shouldIgnoreRoundEvent('expression_eval_failed', round.roundId)) {
          return;
        }
        const failedExpression = buildFailedExpressionEvaluation();
        updateUserRoundData(
          round.userMessageId,
          (message) => {
            const current = message as PcmDualUserMessage;
            const currentAnalysis = current.analysis ?? buildInitialAnalysis(round.roundId, transcriptText);
            return {
              ...current,
              analysis: {
                ...currentAnalysis,
                transcriptText,
                grammarStatus: 'needs_improvement',
                grammarLabel: '待后补',
                grammarTitle: failedExpression.grammarTitle,
                grammarExplanationZh: failedExpression.grammarFeedbackZh,
                naturalnessScore: null,
                optimizedSentence: null,
                polishedExplanationZh: failedExpression.betterExpressionZh,
                explanationZh: failedExpression.nativeFeedbackZh ?? currentAnalysis.explanationZh,
                expression: failedExpression,
              },
              turnAssessment: {
                ...(current.turnAssessment ?? buildInitialAssessment(round.roundId)),
                transcript: transcriptText,
                userAudio: current.turnAssessment?.userAudio ?? current.userAudio ?? null,
                pronunciation: current.turnAssessment?.pronunciation ?? current.pronunciation,
                pronunciationDebug: current.turnAssessment?.pronunciationDebug ?? current.pronunciationDebug,
                expression: failedExpression,
                expressionStyles: current.turnAssessment?.expressionStyles ?? currentAnalysis.expressionStyles ?? buildIdleExpressionStyles(),
              },
            };
          },
          'assessment_expression_attached',
          {
            roundId: round.roundId,
            messageId: round.userMessageId,
            failed: true,
          },
        );
        log('expression_eval_failed', {
          roundId: round.roundId,
          message: normalizeError(error, 'expression_eval_failed'),
        });
      }
    },
    [runExpressionStyles, scenario.id, scenario.level, scenario.name, session, shouldIgnoreRoundEvent, updateUserRoundData],
  );

  const handleRtasrResult = useCallback(
    async (round: ActiveRound, transcript: XfyunRtasrTranscript) => {
      if (shouldIgnoreRoundEvent('rtasr_final', round.roundId)) {
        return;
      }
      const text = transcript.normalizedText || transcript.text;
      if (text) {
        round.chineseHelpIntentDetected = detectChineseHelpIntent(text);
        if (round.chineseHelpIntentDetected) {
          log('chinese_help_intent_detected', {
            roundId: round.roundId,
            transcript: text,
          });
          log('chinese_help_turn_detected', {
            roundId: round.roundId,
            transcript: text,
          });
          updateUserRoundData(round.userMessageId, (message) => {
            const current = message as PcmDualUserMessage;
            return {
              ...current,
              text,
              transcriptStatus: 'ready',
              transcriptSource: 'xfyun_rtasr',
              analysis: null,
              turnAssessment: {
                ...(current.turnAssessment ?? buildInitialAssessment(round.roundId)),
                transcript: text,
                userAudio: current.turnAssessment?.userAudio ?? current.userAudio ?? null,
                pronunciation: null,
                pronunciationDebug: {
                  started: false,
                  skipped: true,
                  skipReason: 'chinese_help_turn',
                  referenceTextUsed: null,
                },
                expression: buildPendingExpressionEvaluation(),
                expressionStyles: buildIdleExpressionStyles(),
                skipped: {
                  reason: 'chinese_help_turn',
                  rawTranscript: text,
                },
              },
              analysisStatus: 'failed',
            };
          }, 'assessment_transcript_attached', {
            roundId: round.roundId,
            messageId: round.userMessageId,
            transcript: text,
            chineseHelpTurn: true,
          });
          log('assessment_skipped', {
            roundId: round.roundId,
            reason: 'chinese_help_turn',
          });
          log('expression_eval_skipped', {
            roundId: round.roundId,
            reason: 'chinese_help_turn',
          });
          log('expression_styles_skipped', {
            roundId: round.roundId,
            reason: 'chinese_help_turn',
          });
          log('ise_skipped', {
            roundId: round.roundId,
            reason: 'non_english_or_invalid_reference',
            referenceText: text,
          });
          return;
        }

        if (isLikelyInvalidEnglishTranscript(text, scenario.id)) {
          log('transcript_guard_rejected', {
            roundId: round.roundId,
            transcript: text,
            reason: 'chinese_filler_or_non_english',
            scenarioId: scenario.id,
          });
          updateUserRoundData(round.userMessageId, (message) => {
            const current = message as PcmDualUserMessage;
            return {
              ...current,
              text: "I didn't catch that clearly. Please try again.",
              transcriptStatus: 'rejected',
              transcriptSource: 'xfyun_rtasr',
              analysis: null,
              turnAssessment: {
                ...(current.turnAssessment ?? buildInitialAssessment(round.roundId)),
                transcript: '',
                userAudio: current.turnAssessment?.userAudio ?? current.userAudio ?? null,
                pronunciation: null,
                pronunciationDebug: {
                  started: false,
                  skipped: true,
                  skipReason: 'invalid_transcript',
                  referenceTextUsed: null,
                },
                expression: buildPendingExpressionEvaluation(),
                expressionStyles: buildIdleExpressionStyles(),
                skipped: {
                  reason: 'invalid_transcript',
                  rawTranscript: text,
                },
              },
              analysisStatus: 'failed',
            };
          }, 'assessment_transcript_attached', {
            roundId: round.roundId,
            messageId: round.userMessageId,
            rejected: true,
          });
          log('assessment_skipped', {
            roundId: round.roundId,
            reason: 'invalid_transcript',
          });
          log('expression_eval_skipped', {
            roundId: round.roundId,
            reason: 'invalid_transcript',
          });
          log('expression_styles_skipped', {
            roundId: round.roundId,
            reason: 'invalid_transcript',
          });
          log('ise_skipped', {
            roundId: round.roundId,
            reason: 'non_english_or_invalid_reference',
            referenceText: text,
          });
          return;
        }

        if (isRepeatedCumulativeTranscript(text)) {
          log('transcript_guard_rejected', {
            roundId: round.roundId,
            transcript: text,
            reason: 'repeated_cumulative_transcript',
            scenarioId: scenario.id,
          });
          updateUserRoundData(round.userMessageId, (message) => {
            const current = message as PcmDualUserMessage;
            return {
              ...current,
              text: "I didn't catch that clearly. Please try again.",
              transcriptStatus: 'rejected',
              transcriptSource: 'xfyun_rtasr',
              analysis: null,
              turnAssessment: {
                ...(current.turnAssessment ?? buildInitialAssessment(round.roundId)),
                transcript: '',
                userAudio: current.turnAssessment?.userAudio ?? current.userAudio ?? null,
                pronunciation: null,
                pronunciationDebug: {
                  started: false,
                  skipped: true,
                  skipReason: 'repeated_cumulative_transcript',
                  referenceTextUsed: null,
                },
                expression: buildPendingExpressionEvaluation(),
                expressionStyles: buildIdleExpressionStyles(),
                skipped: {
                  reason: 'invalid_transcript',
                  rawTranscript: text,
                },
              },
              analysisStatus: 'failed',
            };
          }, 'assessment_transcript_attached', {
            roundId: round.roundId,
            messageId: round.userMessageId,
            rejected: true,
            repeatedCumulative: true,
          });
          log('assessment_skipped', {
            roundId: round.roundId,
            reason: 'repeated_cumulative_transcript',
          });
          log('expression_eval_skipped', {
            roundId: round.roundId,
            reason: 'repeated_cumulative_transcript',
          });
          log('expression_styles_skipped', {
            roundId: round.roundId,
            reason: 'repeated_cumulative_transcript',
          });
          log('ise_skipped', {
            roundId: round.roundId,
            reason: 'repeated_cumulative_transcript',
            referenceText: text,
          });
          return;
        }

        round.userTranscript = text;
        updateUserRoundData(round.userMessageId, (message) => {
          const current = message as PcmDualUserMessage;
          const currentAnalysis = current.analysis ?? buildInitialAnalysis(round.roundId, text);
          return {
            ...current,
            text,
            transcriptStatus: 'ready',
            transcriptSource: 'xfyun_rtasr',
            analysis: {
              ...currentAnalysis,
              transcriptText: text,
              expression: currentAnalysis.expression ?? buildPendingExpressionEvaluation(),
              expressionStyles: currentAnalysis.expressionStyles ?? buildIdleExpressionStyles(),
            },
            turnAssessment: {
              ...(current.turnAssessment ?? buildInitialAssessment(round.roundId)),
              transcript: text,
              userAudio: current.turnAssessment?.userAudio ?? current.userAudio ?? null,
              pronunciation: current.turnAssessment?.pronunciation ?? current.pronunciation,
              pronunciationDebug: current.turnAssessment?.pronunciationDebug ?? current.pronunciationDebug,
              expression: current.turnAssessment?.expression ?? buildPendingExpressionEvaluation(),
              expressionStyles: current.turnAssessment?.expressionStyles ?? buildIdleExpressionStyles(),
              skipped: null,
            },
            analysisStatus: current.analysisStatus === 'failed' ? 'failed' : 'pending',
          };
        }, 'assessment_transcript_attached', {
          roundId: round.roundId,
          messageId: round.userMessageId,
          transcript: text,
        });
        log('user_bubble_updated', {
          roundId: round.roundId,
          normalizedText: transcript.normalizedText,
          rawTextBeforeNormalize: transcript.rawTextBeforeNormalize,
          mergeStrategy: transcript.mergeStrategy,
        });
        void runExpressionEvaluation(round, text);
      } else {
        updateUserRoundData(round.userMessageId, (message) => ({
          ...(message as PcmDualUserMessage),
          text: getRtasrFallbackText('missing_transcript'),
          transcriptStatus: 'failed',
          transcriptSource: 'fallback',
          pronunciationDebug: {
            started: false,
            skipped: true,
            skipReason: 'missing_transcript',
            referenceTextUsed: null,
          },
          analysisStatus: 'failed',
        }), 'assessment_transcript_attached', {
          roundId: round.roundId,
          messageId: round.userMessageId,
          failed: true,
        });
        log('rtasr_unavailable_reason', {
          roundId: round.roundId,
          reason: 'missing_transcript',
          message: 'missing_transcript',
        });
        log('ise_skipped', {
          roundId: round.roundId,
          reason: 'missing_transcript',
        });
        return;
      }

      const referenceText = text;
      if (!isValidEnglishReferenceText(referenceText) || round.chineseHelpIntentDetected) {
        updateUserRoundData(round.userMessageId, (message) => {
          const current = message as PcmDualUserMessage;
          const currentAnalysis = current.analysis ?? buildInitialAnalysis(round.roundId, text);
          return {
            ...current,
            pronunciation: null,
            pronunciationDebug: {
              started: false,
              skipped: true,
              skipReason: 'non_english_or_invalid_reference',
              referenceTextUsed: referenceText,
            },
            turnAssessment: {
              ...(current.turnAssessment ?? buildInitialAssessment(round.roundId)),
              transcript: text,
              userAudio: current.turnAssessment?.userAudio ?? current.userAudio ?? null,
              pronunciation: null,
              pronunciationDebug: {
                started: false,
                skipped: true,
                skipReason: 'non_english_or_invalid_reference',
                referenceTextUsed: referenceText,
              },
              expression: current.turnAssessment?.expression ?? buildPendingExpressionEvaluation(),
              expressionStyles: current.turnAssessment?.expressionStyles ?? currentAnalysis.expressionStyles ?? buildIdleExpressionStyles(),
              skipped: current.turnAssessment?.skipped ?? null,
            },
            analysis: {
              ...currentAnalysis,
              transcriptText: text,
            },
          };
        });
        log('ise_skipped', {
          roundId: round.roundId,
          reason: 'non_english_or_invalid_reference',
          referenceText,
        });
        return;
      }

      const pcm24k = mergeUint8Arrays(round.chunks24k);
      const pcm16kRaw = resamplePcm16(pcm24k, PCM_SAMPLE_RATE, 16000);
      const iseNormalization = normalizePcm16ForIse(pcm16kRaw);
      const pcm16k = iseNormalization.bytes;
      const iseWav16k = createWavBytes(pcm16k, 16000, PCM_CHANNELS);
      const iseDurationMs = getPcm16DurationMs(pcm16k, 16000, PCM_CHANNELS);
      const iseSignal = summarizePcm16Signal(pcm16k);
      let iseDebugRawUri: string | null = null;
      let iseDebugWavUri: string | null = null;
      try {
        iseDebugRawUri = await writeBase64AudioToCacheFile(encodeBase64(pcm16k), 'pcm');
        iseDebugWavUri = await writeBase64AudioToCacheFile(encodeBase64(iseWav16k), 'wav');
      } catch (error) {
        log('ise_audio_debug_file_failed', {
          roundId: round.roundId,
          errorMessage: normalizeError(error, 'ise_debug_audio_write_failed'),
        });
      }
      log('ise_audio_file_info', {
        roundId: round.roundId,
        source: 'active_round_chunks24k',
        chunks24k: round.chunks24k.length,
        pcm24kBytes: pcm24k.byteLength,
        pcm16kBytes: pcm16kRaw.byteLength,
        isePcm16kBytes: pcm16k.byteLength,
        wav16kBytes: iseWav16k.byteLength,
        sourceSampleRate: PCM_SAMPLE_RATE,
        iseSampleRate: 16000,
        channels: PCM_CHANNELS,
        encoding: 'pcm16le',
        debugRawPcmUri: iseDebugRawUri,
        debugWavUri: iseDebugWavUri,
      });
      log('ise_audio_normalization', {
        roundId: round.roundId,
        applied: iseNormalization.applied,
        gain: iseNormalization.gain,
        reason: iseNormalization.reason,
        before: iseNormalization.before,
        after: iseNormalization.after,
      });
      log('ise_audio_wav_header', {
        roundId: round.roundId,
        ...parseWavHeaderForLog(iseWav16k),
      });
      log('ise_audio_duration_ms', {
        roundId: round.roundId,
        durationMs: iseDurationMs,
      });
      log('ise_audio_rms_peak_zero_ratio', {
        roundId: round.roundId,
        ...iseSignal,
      });
      log('ise_reference_text', {
        roundId: round.roundId,
        referenceText,
      });
      let iseResult: Awaited<ReturnType<typeof runXfyunIseAssessment>>;
      try {
        iseResult = await runXfyunIseAssessment({
          roundId: round.roundId,
          pcm16k,
          transcriptText: text,
          referenceText,
        });
      } catch (error) {
        if (shouldIgnoreRoundEvent('ise_failed', round.roundId)) {
          return;
        }
        const debug: XfyunPronunciationDebug = {
          started: true,
          skipped: false,
          errorCode: 'ISE_UNAVAILABLE',
          errorMessage: normalizeError(error, 'ise_assessment_failed'),
          referenceTextUsed: referenceText,
          category: 'read_sentence',
          language: 'en_us',
        };
        updateUserRoundData(round.userMessageId, (message) => {
          const current = message as PcmDualUserMessage;
          const currentAnalysis = current.analysis ?? buildInitialAnalysis(round.roundId, text);
          return {
            ...current,
            text,
            transcriptStatus: 'ready',
            transcriptSource: 'xfyun_rtasr',
            pronunciation: null,
            pronunciationDebug: debug,
            turnAssessment: {
              ...(current.turnAssessment ?? buildInitialAssessment(round.roundId)),
              transcript: text,
              userAudio: current.turnAssessment?.userAudio ?? current.userAudio ?? null,
              pronunciation: null,
              pronunciationDebug: debug,
              expression: current.turnAssessment?.expression ?? buildPendingExpressionEvaluation(),
              expressionStyles: current.turnAssessment?.expressionStyles ?? currentAnalysis.expressionStyles ?? buildIdleExpressionStyles(),
              skipped: current.turnAssessment?.skipped ?? null,
            },
            analysis: {
              ...currentAnalysis,
              transcriptText: text,
              pronunciationScore: null,
              assessment: null,
              explanationZh:
                currentAnalysis.explanationZh === '发音评测进行中…'
                  ? '发音评分失败，请重试'
                  : currentAnalysis.explanationZh,
            },
            analysisStatus: current.analysisStatus,
          };
        }, 'assessment_pronunciation_attached', {
          roundId: round.roundId,
          messageId: round.userMessageId,
          unavailable: true,
        });
        log('pronunciation_unavailable', {
          roundId: round.roundId,
          errorCode: debug.errorCode,
          errorMessage: debug.errorMessage,
        });
        return;
      }
      if (shouldIgnoreRoundEvent('ise_done', round.roundId)) {
        return;
      }

      const assessment = iseResult.assessment;
      if (assessment) {
        updateUserRoundData(round.userMessageId, (message) => {
          const current = message as PcmDualUserMessage;
          const currentAnalysis = current.analysis ?? buildInitialAnalysis(round.roundId, text);
          return {
            ...current,
            pronunciation: assessment,
            pronunciationDebug: iseResult.debug,
            turnAssessment: {
              ...(current.turnAssessment ?? buildInitialAssessment(round.roundId)),
              transcript: text,
              userAudio: current.turnAssessment?.userAudio ?? current.userAudio ?? null,
              pronunciation: assessment,
              pronunciationDebug: iseResult.debug,
              expression: current.turnAssessment?.expression ?? buildPendingExpressionEvaluation(),
              expressionStyles: current.turnAssessment?.expressionStyles ?? currentAnalysis.expressionStyles ?? buildIdleExpressionStyles(),
            },
            analysis: {
              ...currentAnalysis,
              transcriptText: text,
              pronunciationScore: assessment.overallScore,
              assessment,
              explanationZh: currentAnalysis.explanationZh === '发音评测进行中…' ? '发音评分已回填，语法/表达分析待后补。' : currentAnalysis.explanationZh,
            },
            analysisStatus: 'ready',
          };
        }, 'assessment_pronunciation_attached', {
          roundId: round.roundId,
          messageId: round.userMessageId,
          overall: assessment.overallScore,
          accuracy: assessment.accuracyScore,
          fluency: assessment.fluencyScore,
          integrity: assessment.integrityScore,
          standard: assessment.standardScore,
          wordsCount: assessment.words.length,
        });
        log('pronunciation_received', {
          roundId: round.roundId,
          overall: assessment.overallScore,
          wordsCount: assessment.words.length,
        });
      } else {
        updateUserRoundData(round.userMessageId, (message) => {
          const current = message as PcmDualUserMessage;
          const currentAnalysis = current.analysis ?? buildInitialAnalysis(round.roundId, text);
          return {
            ...current,
            text,
            transcriptStatus: 'ready',
            transcriptSource: 'xfyun_rtasr',
            pronunciation: null,
            pronunciationDebug: iseResult.debug,
            turnAssessment: {
              ...(current.turnAssessment ?? buildInitialAssessment(round.roundId)),
              transcript: text,
              userAudio: current.turnAssessment?.userAudio ?? current.userAudio ?? null,
              pronunciation: null,
              pronunciationDebug: iseResult.debug,
              expression: current.turnAssessment?.expression ?? buildPendingExpressionEvaluation(),
              expressionStyles: current.turnAssessment?.expressionStyles ?? currentAnalysis.expressionStyles ?? buildIdleExpressionStyles(),
            },
            analysis: {
              ...currentAnalysis,
              transcriptText: text,
              pronunciationScore: null,
              assessment: null,
              explanationZh:
                currentAnalysis.explanationZh === '发音评测进行中…'
                  ? '发音评分失败，请重试'
                  : currentAnalysis.explanationZh,
            },
            analysisStatus: current.analysisStatus,
          };
        }, 'assessment_pronunciation_attached', {
          roundId: round.roundId,
          messageId: round.userMessageId,
          unavailable: true,
        });
        log('pronunciation_unavailable', {
          roundId: round.roundId,
          errorCode: iseResult.debug.errorCode ?? null,
          errorMessage: iseResult.debug.errorMessage ?? null,
        });
      }
    },
    [runExpressionEvaluation, shouldIgnoreRoundEvent, updateUserRoundData],
  );

  const triggerRtasrFinish = useCallback(
    (round: ActiveRound) => {
      if (round.rtasrFinishStarted || !round.rtasrClient) {
        return;
      }
      round.rtasrFinishStarted = true;
      void round.rtasrClient
        .finish()
        .then(async (transcript) => {
          if (shouldIgnoreRoundEvent('rtasr_finish_done', round.roundId)) {
            return;
          }
          await handleRtasrResult(round, transcript);
        })
        .catch((error) => {
          if (shouldIgnoreRoundEvent('rtasr_finish_failed', round.roundId)) {
            return;
          }
          const message = normalizeError(error, 'rtasr_finish_failed');
          if (isWebApiUnavailableMessage(message)) {
            markAssessmentPipelineSkippedDueToWebApiUnavailable(round, message);
          } else {
            log('rtasr_unavailable_reason', {
              roundId: round.roundId,
              reason: 'rtasr_finish_failed',
              message,
            });
            patchMessage(round.userMessageId, {
              text: getRtasrFallbackText(message),
              transcriptStatus: 'failed',
              transcriptSource: 'fallback',
              analysisStatus: 'failed',
            });
          }
          log('rtasr_error', {
            roundId: round.roundId,
            message,
          });
        });
    },
    [handleRtasrResult, markAssessmentPipelineSkippedDueToWebApiUnavailable, patchMessage, shouldIgnoreRoundEvent],
  );

  const startRtasrConnectInBackground = useCallback(
    (round: ActiveRound) => {
      const rtasrClient = new XfyunRtasrStreamingClient(round.roundId);
      round.rtasrClient = rtasrClient;
      round.rtasrState = 'connecting';

      void rtasrClient
        .connect()
        .then(() => {
          if (shouldIgnoreRoundEvent('rtasr_connect_open', round.roundId)) {
            return;
          }
          round.rtasrState = 'connected';
          flushRtasrBufferedAudio(round);
          if (round.stopRequestedAt != null) {
            triggerRtasrFinish(round);
          }
        })
        .catch((error) => {
          if (shouldIgnoreRoundEvent('rtasr_connect_failed', round.roundId)) {
            return;
          }
          round.rtasrState = 'failed';
          const message = normalizeError(error, 'rtasr_connect_failed');
          log('rtasr_error', {
            roundId: round.roundId,
            message,
          });
          if (isWebApiUnavailableMessage(message)) {
            round.webApiUnavailable = true;
            log('rtasr_unavailable_reason', {
              roundId: round.roundId,
              reason: 'web_api_unreachable',
              message,
            });
            if (mountedRef.current) {
              setRuntimeError({
                scope: 'recording',
                message: getRtasrFallbackRuntimeMessage(),
                recoverable: true,
              });
            }
            if (round.stopRequestedAt != null) {
              markAssessmentPipelineSkippedDueToWebApiUnavailable(round, message);
            }
            return;
          }
          if (round.stopRequestedAt != null) {
            log('rtasr_unavailable_reason', {
              roundId: round.roundId,
              reason: 'rtasr_connect_failed',
              message,
            });
            patchMessage(round.userMessageId, {
              text: getRtasrFallbackText(message),
              transcriptStatus: 'failed',
              transcriptSource: 'fallback',
              analysisStatus: 'failed',
            });
          }
        });
    },
    [flushRtasrBufferedAudio, markAssessmentPipelineSkippedDueToWebApiUnavailable, mountedRef, patchMessage, shouldIgnoreRoundEvent, triggerRtasrFinish],
  );

  useEffect(() => {
    pcmChunkSubscriptionRef.current?.remove();
    pcmStatsSubscriptionRef.current?.remove();

    pcmChunkSubscriptionRef.current = addPcmChunkListener((event) => {
      const activeRound = activeRoundRef.current;
      if (!activeRound) {
        return;
      }
      const bytes24k = decodeBase64(event.pcmBase64);
      activeRound.chunks24k.push(bytes24k);
      if (!activeRound.firstChunkLogged) {
        activeRound.firstChunkLogged = true;
        log('pcm_chunk_first', {
          roundId: activeRound.roundId,
          bytes: event.bytes,
          sampleRate: event.sampleRate,
          channels: event.channels,
          chunkMs: event.chunkMs,
        });
      }

      let bytes16k: Uint8Array;
      try {
        bytes16k = resamplePcm16(bytes24k, event.sampleRate, 16000);
      } catch (error) {
        log('pcm_capture_failed', {
          roundId: activeRound.roundId,
          message: normalizeError(error, 'pcm_resample_failed'),
        });
        return;
      }

      try {
        if (activeRound.realtimeState === 'connected') {
          openAiClientRef.current?.appendInputAudio(bytes24k);
          activeRound.realtimeAudioChunksSent += 1;
          if (activeRound.realtimeAudioChunksSent === 1 || activeRound.realtimeAudioChunksSent % 25 === 0) {
            log('realtime_audio_chunk_sent', {
              roundId: activeRound.roundId,
              chunksSent: activeRound.realtimeAudioChunksSent,
              bytesSent: bytes24k.byteLength,
              source: 'live',
            });
          }
        } else if (activeRound.realtimeState === 'connecting' || activeRound.realtimeState === 'idle') {
          activeRound.pendingRealtimeChunks24k.push(bytes24k);
          trimPendingChunks(activeRound.pendingRealtimeChunks24k);
          activeRound.realtimeBufferedChunkCount += 1;
          if (activeRound.realtimeBufferedChunkCount === 1 || activeRound.realtimeBufferedChunkCount % 25 === 0) {
            log('realtime_audio_buffered_before_connect', {
              roundId: activeRound.roundId,
              bufferedChunks: activeRound.pendingRealtimeChunks24k.length,
              bufferedMs: activeRound.pendingRealtimeChunks24k.length * PCM_CHUNK_MS,
            });
          }
        }
      } catch (error) {
        log('realtime_error', {
          roundId: activeRound.roundId,
          message: normalizeError(error, 'realtime_audio_append_failed'),
        });
      }

      try {
        if (activeRound.rtasrState === 'connected') {
          activeRound.rtasrClient?.appendPcmChunk(bytes16k);
        } else if (activeRound.rtasrState === 'connecting' || activeRound.rtasrState === 'idle') {
          activeRound.pendingRtasrChunks16k.push(bytes16k);
          trimPendingChunks(activeRound.pendingRtasrChunks16k);
        }
      } catch (error) {
        log('rtasr_error', {
          roundId: activeRound.roundId,
          message: normalizeError(error, 'rtasr_audio_append_failed'),
        });
      }
    }) ?? null;

    pcmStatsSubscriptionRef.current = addPcmCaptureStatsListener((event) => {
      const activeRound = activeRoundRef.current;
      if (!activeRound) {
        return;
      }
      log('pcm_capture_stats', {
        roundId: activeRound.roundId,
        elapsedMs: event.elapsedMs,
        chunksEmitted: event.chunksEmitted,
        bytesEmitted: event.bytesEmitted,
        sampleRate: event.sampleRate,
        channels: event.channels,
        chunkMs: event.chunkMs,
      });
    }) ?? null;

    return () => {
      pcmChunkSubscriptionRef.current?.remove();
      pcmStatsSubscriptionRef.current?.remove();
      pcmChunkSubscriptionRef.current = null;
      pcmStatsSubscriptionRef.current = null;
    };
  }, []);

  const startRecording = useCallback(async () => {
    if (!ENABLE_V1_PCM_DUAL_STREAM_RUNTIME) {
      return;
    }
    if (!session) {
      setRuntimeError({
        scope: 'permission',
        message: '请先登录后再开始练习。',
        recoverable: true,
      });
      return;
    }
    if (stage === 'recording') {
      return;
    }
    if (stage === 'playing' || playbackGuardRef.current.activeKey || playbackMessageId) {
      loopPlaybackTokenRef.current += 1;
      ttsPlaybackRef.current.stop('ai_audio_interrupted_by_mic');
      playbackGuardRef.current.activeKey = null;
      playbackGuardRef.current.activeStartedAt = 0;
      setPlaybackMessageId(null);
      setPlaybackText(null);
      setStage('idle');
      log('ai_audio_interrupted_by_mic', {
        scenarioId: scenario.id,
        playbackMessageId: playbackMessageId ?? null,
      });
    }
    setRuntimeError(null);
    setStage('starting');
    log('mic_press', {
      scenarioId: scenario.id,
      stage,
    });

    try {
      if (captureSupport && !captureSupport.supported) {
        throw new Error(captureSupport.reason || 'pcm_capture_not_supported');
      }

      roundIdRef.current += 1;
      const nextRoundId = roundIdRef.current;
      const userMessageId = createMessageId('user');
      const assistantMessageId = createMessageId('assistant');
      const startedAt = Date.now();
      const nextRound: ActiveRound = {
        roundId: nextRoundId,
        userMessageId,
        assistantMessageId,
        startedAt,
        stopRequestedAt: null,
        chunks24k: [],
        rtasrClient: null,
        openAiFirstTextAt: null,
        openAiFirstAudioAt: null,
        userTranscript: null,
        recordingDurationMs: null,
        audioSize: null,
        realtimeState: 'idle',
        rtasrState: 'idle',
        pendingRealtimeChunks24k: [],
        pendingRtasrChunks16k: [],
        firstChunkLogged: false,
        assistantMessageAppended: false,
        realtimeCommitStarted: false,
        rtasrFinishStarted: false,
        realtimeBufferedChunkCount: 0,
        realtimeAudioChunksSent: 0,
        chineseHelpIntentDetected: false,
        blockedResponseIds: new Set<string>(),
        webApiUnavailable: false,
      };
      activeRoundRef.current = nextRound;
      activeRoundIdRef.current = nextRoundId;

      setCurrentRoundId(nextRoundId);
      log('round_started', {
        roundId: nextRoundId,
      });
      appendMessage({
        id: userMessageId,
        role: 'user',
        roundId: nextRoundId,
        text: '',
        timestamp: Date.now(),
        userAudio: null,
        transcriptStatus: 'listening',
        transcriptSource: 'fallback',
        pronunciation: null,
        pronunciationDebug: null,
        analysis: null,
        turnAssessment: buildInitialAssessment(nextRoundId),
        analysisStatus: 'pending',
      });
      log('user_message_created', {
        roundId: nextRoundId,
        text: '',
      });
      log('assessment_created', {
        roundId: nextRoundId,
        messageId: userMessageId,
      });

      void ensurePracticeSession().catch((error) => {
        log('practice_session_failed', {
          roundId: nextRoundId,
          message: normalizeError(error, 'create_practice_session_failed'),
        });
        if (!mountedRef.current) return;
        setRuntimeError({
          scope: 'session',
          message: normalizeError(error, '创建练习会话失败'),
          recoverable: true,
        });
      });

      log('pcm_capture_start_requested', {
        roundId: nextRoundId,
        sampleRate: PCM_SAMPLE_RATE,
        channels: PCM_CHANNELS,
        chunkMs: PCM_CHUNK_MS,
      });
      const startResult = await startPcmCapture({
        sampleRate: PCM_SAMPLE_RATE,
        channels: PCM_CHANNELS,
        chunkMs: PCM_CHUNK_MS,
      });
      if (!startResult.ok) {
        throw new Error(startResult.reason || 'pcm_capture_start_failed');
      }

      log('pcm_capture_started', {
        roundId: nextRoundId,
        sampleRate: startResult.sampleRate,
        channels: startResult.channels,
        chunkMs: startResult.chunkMs,
        format: startResult.format,
      });
      setStage('recording');

      startRealtimeConnectInBackground(nextRound);
      startRtasrConnectInBackground(nextRound);
    } catch (error) {
      activeRoundRef.current?.rtasrClient?.close();
      activeRoundRef.current = null;
      activeRoundIdRef.current = null;
      log('pcm_capture_failed', {
        message: normalizeError(error, 'pcm_capture_start_failed'),
      });
      if (!mountedRef.current) return;
      setStage('error');
      setRuntimeError({
        scope: 'recording',
        message: normalizeError(error, '开始录音失败'),
        recoverable: true,
      });
    }
  }, [
    appendMessage,
    captureSupport,
    ensurePracticeSession,
    mountedRef,
    playbackMessageId,
    scenario.id,
    session,
    stage,
    startRealtimeConnectInBackground,
    startRtasrConnectInBackground,
  ]);

  const stopRecording = useCallback(async () => {
    const activeRound = activeRoundRef.current;
    if (!activeRound) {
      return;
    }

    setStage('recognizing');
    activeRound.stopRequestedAt = Date.now();
    patchMessage(activeRound.userMessageId, {
      text: getRtasrRecognizingText(),
      transcriptStatus: 'recognizing',
    });

    try {
      const stopResult = await stopPcmCapture();
      log('pcm_capture_stopped', {
        roundId: activeRound.roundId,
        durationMs: stopResult.durationMs,
        capturedBytes: stopResult.capturedBytes,
      });
      const merged24k = mergeUint8Arrays(activeRound.chunks24k);
      const wav24k = createWavBytes(merged24k, PCM_SAMPLE_RATE, PCM_CHANNELS);
      const localAudioUri = await writeBase64AudioToCacheFile(encodeBase64(wav24k), 'wav');
      activeRound.recordingDurationMs = stopResult.durationMs;
      activeRound.audioSize = wav24k.byteLength;
      const userAudio: PcmDualUserAudio = {
        uri: localAudioUri,
        durationMs: stopResult.durationMs,
        size: wav24k.byteLength,
        mimeType: 'audio/wav',
      };

      updateUserRoundData(activeRound.userMessageId, (message) => {
        const current = message as PcmDualUserMessage;
        return {
          ...current,
          localAudioUri,
          userAudio,
          recordingDurationMs: stopResult.durationMs,
          audioSize: wav24k.byteLength,
          turnAssessment: {
            ...(current.turnAssessment ?? buildInitialAssessment(activeRound.roundId)),
            transcript: current.turnAssessment?.transcript ?? '',
            userAudio,
            pronunciation: current.turnAssessment?.pronunciation ?? null,
            pronunciationDebug: current.turnAssessment?.pronunciationDebug ?? null,
            expression: current.turnAssessment?.expression ?? buildPendingExpressionEvaluation(),
            expressionStyles: current.turnAssessment?.expressionStyles ?? buildIdleExpressionStyles(),
          },
        };
      }, 'assessment_audio_attached', {
        roundId: activeRound.roundId,
        messageId: activeRound.userMessageId,
        durationMs: stopResult.durationMs,
        size: wav24k.byteLength,
      });

      log('recording_stop', {
        roundId: activeRound.roundId,
        uri: localAudioUri,
        durationMs: stopResult.durationMs,
        size: wav24k.byteLength,
      });

      if (stopResult.durationMs < MIN_ROUND_DURATION_MS || stopResult.capturedBytes < MIN_CAPTURED_BYTES) {
        log('round_discarded_too_short', {
          roundId: activeRound.roundId,
          durationMs: stopResult.durationMs,
          capturedBytes: stopResult.capturedBytes,
          minDurationMs: MIN_ROUND_DURATION_MS,
          minCapturedBytes: MIN_CAPTURED_BYTES,
        });
        activeRound.rtasrClient?.close();
        activeRound.rtasrClient = null;
        openAiClientRef.current?.close();
        openAiClientRef.current = null;
        patchMessage(activeRound.userMessageId, {
          text: '',
          transcriptStatus: 'failed',
          transcriptSource: 'fallback',
          pronunciationDebug: {
            started: false,
            skipped: true,
            skipReason: 'too_short',
            referenceTextUsed: null,
          },
          analysisStatus: 'failed',
        });
        activeRoundRef.current = null;
        activeRoundIdRef.current = null;
        setStage('idle');
        return;
      }

      ensureAssistantMessage(activeRound);

      if (activeRound.realtimeState === 'connected') {
        triggerRealtimeCommit(activeRound);
      } else if (activeRound.realtimeState === 'failed') {
        failAssistantMessage(activeRound, 'AI 回复失败，请重试');
      }

      if (activeRound.rtasrState === 'connected') {
        triggerRtasrFinish(activeRound);
      } else if (activeRound.rtasrState === 'failed') {
        if (activeRound.webApiUnavailable) {
          markAssessmentPipelineSkippedDueToWebApiUnavailable(activeRound, 'web_api_unreachable');
        } else {
          log('rtasr_unavailable_reason', {
            roundId: activeRound.roundId,
            reason: 'rtasr_state_failed_after_stop',
            message: 'rtasr_state_failed_after_stop',
          });
          patchMessage(activeRound.userMessageId, {
            text: getRtasrFallbackText('rtasr_state_failed_after_stop'),
            transcriptStatus: 'failed',
            transcriptSource: 'fallback',
            analysisStatus: 'failed',
          });
        }
      }

      turnCountRef.current += 1;
      if (session && sessionIdRef.current) {
        void updateSpeakingSessionProgress(session, sessionIdRef.current, turnCountRef.current).catch((error) => {
          if (!mountedRef.current) return;
          setRuntimeError({
            scope: 'session',
            message: normalizeError(error, '同步练习进度失败'),
            recoverable: true,
          });
        });
      }
    } catch (error) {
      log('pcm_capture_failed', {
        roundId: activeRound.roundId,
        message: normalizeError(error, 'pcm_capture_stop_failed'),
      });
      if (!mountedRef.current) return;
      setStage('error');
      setRuntimeError({
        scope: 'recording',
        message: normalizeError(error, '结束录音失败'),
        recoverable: true,
      });
    }
  }, [ensureAssistantMessage, failAssistantMessage, markAssessmentPipelineSkippedDueToWebApiUnavailable, mountedRef, patchMessage, session, triggerRealtimeCommit, triggerRtasrFinish, updateUserRoundData]);

  /**
   * 文字输入发送：Android V1 无 PCM 原生模块时的 fallback，或 iOS 上文字输入模式
   * 流程：创建 text_input 回合 → 连接 OpenAI Realtime → 发 conversation.item.create + response.create
   */
  const sendTextMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !ENABLE_V1_PCM_DUAL_STREAM_RUNTIME) return;
      if (!session) {
        setRuntimeError({ scope: 'permission', message: '请先登录后再开始练习。', recoverable: true });
        return;
      }
      if (stage === 'recording') return;

      // 中断正在播放的 AI 音频
      if (stage === 'playing' || playbackGuardRef.current.activeKey || playbackMessageId) {
        loopPlaybackTokenRef.current += 1;
        ttsPlaybackRef.current.stop('ai_audio_interrupted_by_text_input');
        playbackGuardRef.current.activeKey = null;
        playbackGuardRef.current.activeStartedAt = 0;
        setPlaybackMessageId(null);
        setPlaybackText(null);
        setStage('idle');
      }

      setRuntimeError(null);
      setStage('thinking');
      log('text_round_start', { scenarioId: scenario.id, textLength: trimmed.length });

      roundIdRef.current += 1;
      const nextRoundId = roundIdRef.current;
      const userMessageId = createMessageId('user');
      const assistantMessageId = createMessageId('assistant');

      const nextRound: ActiveRound = {
        roundId: nextRoundId,
        userMessageId,
        assistantMessageId,
        startedAt: Date.now(),
        stopRequestedAt: Date.now(), // 文字回合无录音阶段，直接视为已停止
        chunks24k: [],
        rtasrClient: null,
        openAiFirstTextAt: null,
        openAiFirstAudioAt: null,
        userTranscript: trimmed,
        recordingDurationMs: null,
        audioSize: null,
        realtimeState: 'idle',
        rtasrState: 'idle',
        pendingRealtimeChunks24k: [],
        pendingRtasrChunks16k: [],
        firstChunkLogged: false,
        assistantMessageAppended: false,
        realtimeCommitStarted: true, // 文字回合不走��频 commit 流程
        rtasrFinishStarted: true,    // 文字回合无 RTASR
        realtimeBufferedChunkCount: 0,
        realtimeAudioChunksSent: 0,
        chineseHelpIntentDetected: false,
        blockedResponseIds: new Set<string>(),
        webApiUnavailable: false,
      };
      activeRoundRef.current = nextRound;
      activeRoundIdRef.current = nextRoundId;
      setCurrentRoundId(nextRoundId);

      appendMessage({
        id: userMessageId,
        role: 'user',
        roundId: nextRoundId,
        text: trimmed,
        timestamp: Date.now(),
        userAudio: null,
        transcriptStatus: 'ready',
        transcriptSource: 'text_input',
        pronunciation: null,
        pronunciationDebug: null,
        analysis: buildInitialAnalysis(nextRoundId, trimmed),
        turnAssessment: buildInitialAssessment(nextRoundId),
        analysisStatus: 'pending',
      });

      void ensurePracticeSession().catch((error) => {
        log('practice_session_failed', {
          roundId: nextRoundId,
          message: normalizeError(error, 'create_practice_session_failed'),
        });
      });

      ensureAssistantMessage(nextRound);

      let client: OpenAiRealtimeWsClient;
      try {
        client = getOrCreateRealtimeClient();
      } catch (error) {
        nextRound.realtimeState = 'failed';
        failAssistantMessage(nextRound, 'AI 回复失败，请重试');
        if (!mountedRef.current) return;
        setStage('idle');
        setRuntimeError({ scope: 'chat', message: 'AI 初始化失败', recoverable: true });
        return;
      }

      nextRound.realtimeState = 'connecting';
      void client
        .connect()
        .then(() => {
          if (shouldIgnoreRoundEvent('text_round_realtime_connected', nextRoundId)) return;
          nextRound.realtimeState = 'connected';
          const sent = client.sendTextItemAndCreateResponse(trimmed, nextRoundId);
          if (!sent) {
            failAssistantMessage(nextRound, 'AI 回复失败，请重试');
            if (mountedRef.current) setStage('idle');
          }
        })
        .catch((error) => {
          if (shouldIgnoreRoundEvent('text_round_realtime_failed', nextRoundId)) return;
          nextRound.realtimeState = 'failed';
          const message = normalizeError(error, 'openai_realtime_connect_failed');
          failAssistantMessage(nextRound, 'AI 连接失败，请重试');
          if (mountedRef.current) {
            setStage('idle');
            setRuntimeError({ scope: 'chat', message: `连接失败：${message}`, recoverable: true });
          }
        });
    },
    [
      appendMessage,
      ensureAssistantMessage,
      ensurePracticeSession,
      failAssistantMessage,
      getOrCreateRealtimeClient,
      mountedRef,
      playbackMessageId,
      scenario.id,
      session,
      shouldIgnoreRoundEvent,
      stage,
    ],
  );

  const replayAssistantAudio = useCallback(
    async (messageId: string) => {
      const message = messagesRef.current.find(
        (item): item is PcmDualAssistantMessage => item.id === messageId && item.role === 'assistant',
      );
      const audioUri = message?.audioFileUri ?? message?.audioUrl ?? null;
      log('assistant_replay_start', {
        messageId,
        uri: audioUri,
        currentStage: stage,
        currentPlayingMessageId: playbackMessageId,
      });
      if (stage === 'playing' && playbackMessageId === messageId) {
        log('assistant_replay_while_already_playing', {
          messageId,
          uri: audioUri,
          currentStage: stage,
        });
      }
      if (!message || !audioUri) {
        log('assistant_replay_failed', {
          messageId,
          errorName: 'MissingAudioUri',
          message: 'assistant_audio_uri_missing',
          stackPreview: null,
        });
        return;
      }
      try {
        const fileInfo = (await FileSystem.getInfoAsync(audioUri)) as {
          exists: boolean;
          size?: number | null;
        };
        log('assistant_replay_file_info', {
          messageId,
          exists: fileInfo.exists,
          size: fileInfo.size ?? null,
          uriPreview: audioUri.slice(0, 120),
        });
        if (!fileInfo.exists) {
          log('assistant_replay_file_missing', {
            messageId,
            uriPreview: audioUri.slice(0, 120),
          });
          return;
        }
      } catch (error) {
        log('assistant_replay_failed', {
          messageId,
          errorName: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : 'assistant_replay_file_info_failed',
          stackPreview: error instanceof Error ? error.stack?.slice(0, 180) ?? null : null,
        });
        return;
      }
      loopPlaybackTokenRef.current += 1;
      await playAssistantAudio(message.id, audioUri, message.text, {
        debugHooks: {
          onCreateSoundStart: () => {
            log('assistant_replay_create_sound_start', { messageId });
          },
          onCreateSoundDone: () => {
            log('assistant_replay_create_sound_done', { messageId });
          },
          onPlayAsyncStart: () => {
            log('assistant_replay_play_async_start', { messageId });
          },
          onPlayAsyncDone: () => {
            log('assistant_replay_play_async_done', { messageId });
          },
          onPlaybackError: (error) => {
            log('assistant_replay_failed', {
              messageId,
              errorName: error instanceof Error ? error.name : 'UnknownError',
              message: error instanceof Error ? error.message : 'assistant_replay_playback_failed',
              stackPreview: error instanceof Error ? error.stack?.slice(0, 180) ?? null : null,
            });
          },
        },
      });
    },
    [playAssistantAudio, playbackMessageId, stage],
  );

  const replayUserAudio = useCallback(
    async (messageId: string) => {
      const message = messagesRef.current.find(
        (item): item is PcmDualUserMessage => item.id === messageId && item.role === 'user',
      );
      const userAudio = message?.turnAssessment?.userAudio ?? message?.userAudio ?? null;
      if (!message || !userAudio?.uri) {
        return;
      }
      await runPlaybackGuard({
        roundId: message.roundId,
        action: 'user_audio',
        value: userAudio.uri,
        run: async () => {
          loopPlaybackTokenRef.current += 1;
          return playStoredAudio(message.id, message.roundId, userAudio.uri, message.text, 'user', {
            durationMs: userAudio.durationMs,
            cleanupFileAfterPlay: false,
            guardKey: `${message.roundId}:user_audio:${hashPlaybackValue(userAudio.uri)}`,
          });
        },
      });
    },
    [playStoredAudio, runPlaybackGuard],
  );

  const playBetterExpression = useCallback(
    async (messageId: string) => {
      const message = messagesRef.current.find(
        (item): item is PcmDualUserMessage => item.id === messageId && item.role === 'user',
      );
      const text = message?.turnAssessment?.expression?.betterExpression?.trim() || message?.analysis?.optimizedSentence?.trim() || '';
      if (!message || !text) {
        return;
      }
      const valueKey = text;
      await runPlaybackGuard({
        roundId: message.roundId,
        action: 'better_expression',
        value: valueKey,
        run: async (key) => {
          loopPlaybackTokenRef.current += 1;
          const cacheKey = `${message.roundId}:${hashPlaybackValue(text)}`;

          log('better_expression_tts_requested', {
            roundId: message.roundId,
            text,
          });

          if (!session) {
            log('better_expression_tts_failed', {
              roundId: message.roundId,
              text,
              message: 'missing_session',
            });
            return 'failed';
          }

          let uri = betterExpressionAudioCacheRef.current.get(cacheKey) ?? null;
          if (!uri) {
            log('better_expression_audio_play_start', {
              roundId: message.roundId,
              source: 'synthesize',
              text,
            });
            uri = await ttsPlaybackRef.current.synthesize(session, text);
            betterExpressionAudioCacheRef.current.set(cacheKey, uri);
          } else {
            log('better_expression_audio_play_start', {
              roundId: message.roundId,
              source: 'cache',
              text,
            });
          }

          const result = await playStoredAudio(message.id, message.roundId, uri, text, 'better_expression', {
            cleanupFileAfterPlay: false,
            guardKey: key,
          });
          if (result === 'played') {
            log('better_expression_audio_play_done', {
              roundId: message.roundId,
              text,
            });
          } else if (result === 'failed') {
            log('better_expression_audio_failed', {
              roundId: message.roundId,
              text,
              message: 'better_expression_audio_play_failed',
            });
          }
          return result;
        },
      }).catch((error) => {
        log('better_expression_tts_failed', {
          roundId: message.roundId,
          text,
          message: normalizeError(error, 'better_expression_tts_failed'),
        });
        log('better_expression_audio_failed', {
          roundId: message.roundId,
          text,
          message: normalizeError(error, 'better_expression_audio_failed'),
        });
      });
    },
    [playStoredAudio, runPlaybackGuard, session],
  );

  const playReferenceText = useCallback(
    async ({
      messageId,
      roundId,
      text,
      accent,
      purpose = 'reference',
    }: {
      messageId: string;
      roundId: number;
      text: string;
      accent: 'us' | 'uk';
      purpose?: 'reference' | 'expression_ai_read';
    }) => {
      const normalized = text.trim();
      if (!session || !normalized) {
        return;
      }
      const action: PlaybackAction =
        purpose === 'expression_ai_read'
          ? 'expression_ai_read'
          : accent === 'us'
            ? 'reference_us'
            : 'reference_uk';
      await runPlaybackGuard({
        roundId,
        action,
        value: normalized,
        run: async (key) => {
          loopPlaybackTokenRef.current += 1;

          log('reference_tts_requested', {
            roundId,
            accent,
            purpose,
            text: normalized,
          });

          const uri = await ttsPlaybackRef.current.synthesize(session, normalized, accent === 'us' ? 'marin' : 'alloy');
          return playStoredAudio(messageId, roundId, uri, normalized, 'better_expression', {
            cleanupFileAfterPlay: true,
            guardKey: key,
          });
        },
      }).catch((error) => {
        log('reference_tts_failed', {
          roundId,
          accent,
          purpose,
          message: normalizeError(error, 'reference_tts_failed'),
        });
      });
    },
    [playStoredAudio, runPlaybackGuard, session],
  );

  const loopPracticeText = useCallback(
    async ({
      messageId,
      roundId,
      text,
      times = 3,
      gapMs = 600,
    }: {
      messageId: string;
      roundId: number;
      text: string;
      times?: number;
      gapMs?: number;
    }) => {
      const normalized = text.trim();
      if (!session || !normalized) {
        return;
      }
      await runPlaybackGuard({
        roundId,
        action: 'loop_follow',
        value: normalized,
        run: async (key) => {
          loopPlaybackTokenRef.current += 1;
          const token = loopPlaybackTokenRef.current;
          log('loop_follow_requested', {
            roundId,
            text: normalized,
            times,
            gapMs,
          });

          for (let index = 0; index < times; index += 1) {
            if (loopPlaybackTokenRef.current !== token) {
              return 'cancelled';
            }
            try {
              const uri = await ttsPlaybackRef.current.synthesize(session, normalized);
              if (loopPlaybackTokenRef.current !== token) {
                return 'cancelled';
              }
              const result = await playStoredAudio(messageId, roundId, uri, normalized, 'better_expression', {
                cleanupFileAfterPlay: true,
                guardKey: key,
              });
              if (result === 'cancelled') {
                return result;
              }
            } catch (error) {
              log('loop_follow_failed', {
                roundId,
                iteration: index + 1,
                message: normalizeError(error, 'loop_follow_failed'),
              });
              throw error;
            }
            if (index < times - 1) {
              await delay(gapMs);
            }
          }
          return 'played';
        },
      });
    },
    [playStoredAudio, runPlaybackGuard, session],
  );

  const requestRepeatRound = useCallback(
    async ({ messageId, roundId }: { messageId: string; roundId: number }) => {
      void messageId;
      loopPlaybackTokenRef.current += 1;
      ttsPlaybackRef.current.stop();
      if (!mountedRef.current) return;
      setPlaybackMessageId(null);
      setPlaybackText(null);
      setStage('idle');
      setRuntimeError(null);
      log('repeat_requested', {
        roundId,
      });
    },
    [mountedRef],
  );

  const endSession = useCallback(
    async (status: 'completed' | 'aborted' = 'completed') => {
      playbackLifecycleTokenRef.current += 1;
      loopPlaybackTokenRef.current += 1;
      ttsPlaybackRef.current.stop('session_ended');
      openAiClientRef.current?.close();
      activeRoundRef.current?.rtasrClient?.close();
      activeRoundRef.current = null;
      try {
        await stopPcmCapture();
      } catch {
        // ignore cleanup failure
      }
      if (session && sessionIdRef.current) {
        await completeSpeakingSession(session, sessionIdRef.current, {
          status,
          transcriptJson: buildTranscriptJson(messagesRef.current),
          scoreJson: buildScoreJson(messagesRef.current),
        }).catch(() => undefined);
      }
      if (!mountedRef.current) return;
      setStage('idle');
      setPlaybackMessageId(null);
      setPlaybackText(null);
      autoPlayedResponseIdsRef.current.clear();
      autoPlayedMessageIdsRef.current.clear();
      assistantAccumulatedTextRef.current.clear();
      playbackGuardRef.current.activeKey = null;
      playbackGuardRef.current.activeStartedAt = 0;
      playbackGuardRef.current.lastRequestKey = null;
      playbackGuardRef.current.lastRequestAt = 0;
      initialGreetingStartedRef.current = false;
      initialGreetingDoneRef.current = false;
    },
    [mountedRef, session],
  );

  useEffect(() => {
    if (!session) {
      log('initial_greeting_skipped', {
        scenarioId: scenario.id,
        reason: 'missing_session',
      });
      return;
    }
    if (initialGreetingStartedRef.current || initialGreetingDoneRef.current) {
      log('initial_greeting_skipped', {
        scenarioId: scenario.id,
        reason: 'already_started',
      });
      return;
    }
    if (activeRoundRef.current || messagesRef.current.some((message) => message.role === 'assistant')) {
      log('initial_greeting_skipped', {
        scenarioId: scenario.id,
        reason: 'existing_messages_or_active_round',
      });
      return;
    }

    initialGreetingStartedRef.current = true;
    const greetingMessageId = createMessageId('assistant');
    const { text: greetingText, source: greetingSource } = buildInitialGreetingText(scenario);
    log('initial_greeting_start', {
      scenarioId: scenario.id,
      source: greetingSource,
      text: greetingText,
    });
    appendMessage({
      id: greetingMessageId,
      role: 'assistant',
      roundId: 0,
      text: '',
      timestamp: Date.now(),
      replyStatus: 'pending',
      audioFileUri: null,
      audioMimeType: null,
    });
    log('initial_greeting_message_created', {
      scenarioId: scenario.id,
      messageId: greetingMessageId,
      pending: true,
    });

    void (async () => {
      const greetingPlaybackToken = playbackLifecycleTokenRef.current;
      try {
        const uri = await ttsPlaybackRef.current.synthesize(session, greetingText, 'marin');
        if (
          !mountedRef.current ||
          runtimeDisposedRef.current ||
          greetingPlaybackToken !== playbackLifecycleTokenRef.current
        ) {
          log('initial_greeting_play_skipped_inactive_runtime', {
            scenarioId: scenario.id,
            messageId: greetingMessageId,
          });
          return;
        }
        patchMessage(greetingMessageId, {
          text: greetingText,
          audioFileUri: uri,
          audioMimeType: 'audio/mpeg',
          replyStatus: 'ready',
        });
        log('initial_greeting_audio_start', {
          scenarioId: scenario.id,
          messageId: greetingMessageId,
        });
        await playAssistantAudio(greetingMessageId, uri, greetingText);
        initialGreetingDoneRef.current = true;
        log('initial_greeting_done', {
          scenarioId: scenario.id,
          messageId: greetingMessageId,
        });
      } catch (error) {
        patchMessage(greetingMessageId, {
          text: greetingText,
          audioFileUri: null,
          audioMimeType: null,
          replyStatus: 'ready',
        });
        initialGreetingDoneRef.current = true;
        setStage('idle');
        log('initial_greeting_tts_failed_text_fallback', {
          scenarioId: scenario.id,
          messageId: greetingMessageId,
          reason: normalizeError(error, 'initial_greeting_failed'),
        });
        log('initial_greeting_done', {
          scenarioId: scenario.id,
          messageId: greetingMessageId,
          audioPlayed: false,
        });
      }
    })();
  }, [appendMessage, patchMessage, playAssistantAudio, scenario.id, scenario.openingLine, session]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        log('app_state_cleanup_requested', {
          nextState,
          scenarioId: scenario.id,
        });
        void endSession('aborted');
      }
    });
    return () => {
      subscription.remove();
    };
  }, [endSession, scenario.id]);

  useEffect(() => {
    return () => {
      void endSession('aborted');
      betterExpressionAudioCacheRef.current.clear();
      ttsPlaybackRef.current.remove();
    };
  }, [endSession]);

  const recorderCapability = useMemo<SpeakingRecorderCapability>(
    () => ({
      available: captureSupport?.supported ?? false,
      provider: captureSupport?.supported ? 'pcm-capture' : 'none',
      reason: captureSupport?.supported ? undefined : captureSupport?.reason ?? 'pcm_capture_not_supported',
    }),
    [captureSupport],
  );

  return {
    enabled: ENABLE_V1_PCM_DUAL_STREAM_RUNTIME,
    stage,
    messages,
    error: runtimeError,
    runtimeError,
    recorderCapability,
    captureSupport,
    creditsLoading,
    credits: credits ? { balanceCredits: credits.balanceCredits } : null,
    sessionId,
    playbackText,
    currentRoundId,
    playbackMessageId,
    clearError,
    endSession,
    startRecording,
    stopRecording,
    sendTextMessage,
    replayAssistantAudio,
    replayUserAudio,
    playBetterExpression,
    playReferenceText,
    loopPracticeText,
    requestRepeatRound,
  };
}

function mergeUint8Arrays(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}
