import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import type { Scenario } from '@/data/scenarios';
import {
  completeSpeakingSession,
  createSpeakingSession,
  fetchSpeakingCredits,
  scoreSpeakingMessage,
  updateSpeakingSessionProgress,
} from '@/services/api/speakingPractice';
import {
  addPcmCaptureStatsListener,
  addPcmChunkListener,
  ensureCaptureActiveAfterPlayback,
  getPcmCaptureSupport,
  startPcmCapture,
  stopPcmCapture,
} from '@/services/audio/pcmCapture';
import { createWavBytes, decodeBase64, encodeBase64, resamplePcm16, writeBase64AudioToCacheFile } from '@/services/audio/pcmUtils';
import { SpeakingTtsPlayback } from '@/services/audio/ttsPlayback';
import { OpenAiRealtimeWsClient } from '@/services/realtime/openaiRealtimeWsClient';
import { runXfyunIseAssessment, XfyunRtasrStreamingClient } from '@/services/api/xfyunStreamingAssess';
import type { StoredSession } from '@/types/auth';
import type { OpenAiRealtimeWsEvent, PcmCaptureSupport, PcmDualUserAudio, XfyunPronunciationDebug, XfyunRtasrTranscript } from '@/types/pcmDualStream';
import type {
  SpeakingV2MetricScore,
  SpeakingV2ReplayItem,
  SpeakingV2ReportTurn,
  SpeakingV2ReviewPayload,
  SpeakingV2ReviewTiming,
  SpeakingV2RuntimeError,
  SpeakingV2TranscriptItem,
} from '@/types/speakingV2';

import { initialSpeakingV2State, speakingV2Reducer, type ExtendedSpeakingV2State } from './speakingV2Reducer';

const MAX_CALL_DURATION_SEC = 8 * 60;
const PCM_SAMPLE_RATE = 24000;
const PCM_CHANNELS = 1;
const PCM_CHUNK_MS = 40;
const PREBUFFER_MS = 320;
const LOCAL_VAD_START_LEVEL = 520;
const LOCAL_VAD_CONTINUE_LEVEL = 360;
const LOCAL_VAD_SILENCE_CHUNKS = 20;
const LOCAL_VAD_MIN_CHUNKS = 3;
const ASSISTANT_BARGE_IN_RMS = 1200;
const ASSISTANT_BARGE_IN_PEAK = 5000;
const ASSISTANT_BARGE_IN_MIN_CHUNKS = 3;
const ASSISTANT_ECHO_BASELINE_MS = 480;
const ASSISTANT_BARGE_IN_MIN_PLAYBACK_MS = 500;
const ASSISTANT_BARGE_IN_PREBUFFER_MS = 240;
const ASSISTANT_ECHO_RMS_MULTIPLIER = 2.5;
const ASSISTANT_ECHO_PEAK_MULTIPLIER = 1.8;
const MIN_USER_TURN_16K_CHUNKS = 12;
const MIN_USER_TURN_MS = 600;
const MIN_USER_TURN_GRACE_MS = 800;
const USER_TURN_MAX_MS = 8000;
const USER_TURN_LAST_VOICE_STOP_MS = 900;
const USER_TURN_POST_ROLL_MS = 280;
const MIN_ISE_AUDIO_16K_BYTES = 16000;
const LOCAL_VAD_SILENCE_MS = LOCAL_VAD_SILENCE_CHUNKS * PCM_CHUNK_MS;

type ReviewMetricName = keyof SpeakingV2ReviewPayload['metrics'];

type TimingStepName = 'session' | 'pcm_start';

type UserTurnRecord = {
  roundId: number;
  transcriptId: string;
  assistantReplyId: string | null;
  source: 'realtime_vad' | 'local_vad' | 'local_barge_in';
  responseRequested: boolean;
  silenceChunkCount: number;
  startedAt: number;
  stopRequestedAt: number | null;
  chunks24k: Uint8Array[];
  chunks16k: Uint8Array[];
  pendingRtasrChunks16k: Uint8Array[];
  rtasrClient: XfyunRtasrStreamingClient | null;
  rtasrState: 'idle' | 'connecting' | 'connected' | 'failed' | 'finished';
  rtasrFinishStarted: boolean;
  transcriptText: string;
  transcriptReady: boolean;
  userAudio: PcmDualUserAudio | null;
  durationMs: number | null;
  lastVoiceAt: number;
  totalAudioChunks16k: number;
  totalAudioBytes16k: number;
  rtasrSentChunks: number;
  rtasrSentBytes: number;
  finalizePending: boolean;
  finalizeSource: 'realtime_vad' | 'local_vad' | null;
  finalizeGraceDeadlineAt: number | null;
  forceStopTimeout: ReturnType<typeof setTimeout> | null;
  silenceStopTimeout: ReturnType<typeof setTimeout> | null;
  postRollTimeout: ReturnType<typeof setTimeout> | null;
  postRollPending: boolean;
  postRollStartedAt: number | null;
  postRollChunks24k: number;
  preRollChunks24k: number;
  preRollChunks16k: number;
  pronunciationAssessmentStarted: boolean;
};

type MicWindowDiagnosticState = {
  active: boolean;
  startedAt: number;
  endsAt: number;
  lastLoggedAt: number;
  maxRms: number;
  maxPeak: number;
  sumRms: number;
  chunks: number;
  voicedLikeChunks: number;
};

type AssistantEchoGuardState = {
  playbackStartedAt: number;
  assistantText: string;
  baselineRmsSum: number;
  baselinePeakMax: number;
  baselineChunks: number;
  baselineReady: boolean;
  echoBaselineRms: number;
  echoBaselinePeak: number;
  candidateChunks24k: Uint8Array[];
  candidateChunks16k: Uint8Array[];
};

function createTranscriptId(prefix: 'user' | 'ai') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function createRuntimeError(
  scope: SpeakingV2RuntimeError['scope'],
  message: string,
): SpeakingV2RuntimeError {
  return { scope, message };
}

function normalizeError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function averageScore(values: Array<number | null | undefined>) {
  const numeric = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!numeric.length) return null;
  return clampScore(numeric.reduce((sum, value) => sum + value, 0) / numeric.length);
}

function createUnavailableMetric(reason: string): SpeakingV2MetricScore {
  return {
    value: null,
    reason,
    source: 'unavailable',
  };
}

function sanitizeTranscriptText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[.!?,;:]+/, '')
    .trim();
}

function isMeaningfulTranscriptText(text: string) {
  const normalized = sanitizeTranscriptText(text);
  if (!normalized) return false;
  if (!/[A-Za-z0-9]/.test(normalized)) return false;
  if (/^(undefined|null|n\/a)$/i.test(normalized)) return false;
  return true;
}

function isReasonableAiReportText(text: string) {
  const normalized = sanitizeTranscriptText(text);
  if (!isMeaningfulTranscriptText(normalized)) return false;
  if (/!\.|\.!|\?,|,\?|\.{3,}|!{2,}|\?{2,}/.test(normalized)) return false;
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  return wordCount >= 2 || normalized.length >= 10;
}

function deriveGrammarMetricFromScore(score: {
  overall: number;
  vocabulary: number;
  errors?: Array<unknown>;
  correction?: { type?: 'error' | 'ok' | 'tip' };
}) {
  const errorPenalty = Math.min(18, (score.errors?.length ?? 0) * 6);
  const correctionPenalty = score.correction?.type === 'error' ? 8 : score.correction?.type === 'tip' ? 4 : 0;
  return clampScore(score.overall * 0.58 + score.vocabulary * 0.42 - errorPenalty - correctionPenalty);
}

function createEmptyTiming(): SpeakingV2ReviewTiming {
  return {
    totalMs: null,
    sessionMs: null,
    tokenMs: null,
    micPermissionMs: null,
    peerCreateMs: null,
    offerCreateMs: null,
    callsMs: null,
    remoteAnswerSetMs: null,
    dataChannelOpenMs: null,
    sessionUpdateSentMs: null,
    sessionUpdatedMs: null,
    initialGreetingSentMs: null,
    firstAssistantAudioStartedMs: null,
  };
}

function buildOpeningInstructions(scenario: Scenario) {
  return [
    'Start the scenario now.',
    `You are ${scenario.aiName}, the ${scenario.aiRole}.`,
    `Open with a short spoken line very close to: "${scenario.openingLine}".`,
    'Keep it warm, natural, and under two short sentences.',
  ].join(' ');
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

function measurePcm16Level(inputBytes: Uint8Array) {
  if (inputBytes.byteLength < 2) return 0;
  const samples = new Int16Array(inputBytes.buffer, inputBytes.byteOffset, Math.floor(inputBytes.byteLength / 2));
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    sum += Math.abs(samples[index] ?? 0);
  }
  return sum / samples.length;
}

function inspectPcm16Signal(inputBytes: Uint8Array) {
  if (inputBytes.byteLength < 2) {
    return {
      level: 0,
      rms: 0,
      peak: 0,
      zeroRatio: 1,
    };
  }
  const samples = new Int16Array(inputBytes.buffer, inputBytes.byteOffset, Math.floor(inputBytes.byteLength / 2));
  let sumAbs = 0;
  let sumSquares = 0;
  let peak = 0;
  let zeroCount = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    const magnitude = Math.abs(sample);
    sumAbs += magnitude;
    sumSquares += sample * sample;
    if (magnitude > peak) {
      peak = magnitude;
    }
    if (sample === 0) {
      zeroCount += 1;
    }
  }
  const sampleCount = samples.length || 1;
  return {
    level: sumAbs / sampleCount,
    rms: Math.sqrt(sumSquares / sampleCount),
    peak,
    zeroRatio: zeroCount / sampleCount,
  };
}

function trimPendingChunks(chunks: Uint8Array[]) {
  const maxChunks = Math.max(1, Math.ceil(PREBUFFER_MS / PCM_CHUNK_MS));
  while (chunks.length > maxChunks) {
    chunks.shift();
  }
}

function trimChunksToWindow(chunks: Uint8Array[], windowMs: number) {
  const maxChunks = Math.max(1, Math.ceil(windowMs / PCM_CHUNK_MS));
  while (chunks.length > maxChunks) {
    chunks.shift();
  }
}

function sumChunkBytes(chunks: Uint8Array[]) {
  return chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
}

function normalizeEchoCompareText(text: string) {
  return sanitizeTranscriptText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelyAssistantEchoTranscript(userText: string, assistantText: string) {
  const user = normalizeEchoCompareText(userText);
  const assistant = normalizeEchoCompareText(assistantText);
  if (!user || !assistant) return false;
  if (assistant.includes(user) && user.length >= 4) return true;
  const userWords = user.split(/\s+/).filter(Boolean);
  const assistantWords = new Set(assistant.split(/\s+/).filter(Boolean));
  if (userWords.length === 0) return false;
  const overlap = userWords.filter((word) => assistantWords.has(word)).length / userWords.length;
  return userWords.length <= 6 && overlap >= 0.75;
}

function useMountedRef() {
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return mountedRef;
}

async function buildReviewPayload(params: {
  session: StoredSession | null;
  scenario: Scenario;
  transcript: SpeakingV2TranscriptItem[];
  turnCount: number;
  timing: SpeakingV2ReviewTiming;
  reportTurns?: SpeakingV2ReportTurn[];
}) {
  const { session, scenario, transcript, turnCount, timing, reportTurns = [] } = params;
  const cleanedTranscript = transcript
    .map((item) => ({
      ...item,
      text: sanitizeTranscriptText(item.text),
    }))
    .filter((item) =>
      item.role === 'ai' ? isReasonableAiReportText(item.text) : isMeaningfulTranscriptText(item.text),
    );

  const userTurns = cleanedTranscript.filter((item) => item.role === 'user');
  const aiTurns = cleanedTranscript.filter((item) => item.role === 'ai');

  if (!session || userTurns.length === 0) {
    return {
      reviewVersion: 'v2',
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      userTurnCount: userTurns.length,
      aiTurnCount: aiTurns.length,
      totalTurns: turnCount > 0 ? turnCount : Math.max(userTurns.length, aiTurns.length),
      interruptCount: 0,
      userTranscriptSummary:
        userTurns.map((item) => item.text).join(' ').slice(0, 320) || '本轮未获取到用户转写，无法生成完整纠音。',
      aiTranscriptSummary:
        aiTurns.map((item) => item.text).join(' ').slice(0, 320) || '本轮未记录到 AI 回应文本。',
      metrics: {
        overall: createUnavailableMetric('用户有效转写不足，无法生成真实总评。'),
        pronunciation: createUnavailableMetric('V2-PCM 发音评测将在下一批接入。'),
        fluency: createUnavailableMetric('用户有效转写不足，无法计算真实流利度。'),
        grammar: createUnavailableMetric('用户有效转写不足，无法生成真实语法分析。'),
      },
      aiCoachFeedback: '本轮未获取到用户转写，无法生成完整纠音。',
      replayItems: cleanedTranscript.map((item) => ({
        id: item.id,
        role: item.role,
        text: item.text,
      })),
      userTranscriptAvailable: false,
      timing,
      note: '本次复盘只保留了有效 AI 文本和会话状态信息。',
      missingCapabilities: ['本轮未拿到稳定用户转写，报告按真实数据不足展示。', 'V2-PCM 发音评测将在下一批接入。'],
      turns: reportTurns,
    } satisfies SpeakingV2ReviewPayload;
  }

  const userScores = await Promise.all(
    userTurns.map(async (item) => {
      const itemIndex = cleanedTranscript.findIndex((entry) => entry.id === item.id);
      const assistantPreviousMessage = [...cleanedTranscript]
        .slice(0, itemIndex)
        .reverse()
        .find((entry) => entry.role === 'ai')?.text;

      try {
        const result = await scoreSpeakingMessage(session, {
          userText: item.text,
          scenarioId: scenario.id,
          scenarioTitle: scenario.name,
          assistantPreviousMessage,
          level: scenario.level,
        });
        return { itemId: item.id, result };
      } catch (error) {
        console.log('[V2_PCM][review] score-turn:error', item.id, normalizeError(error, 'score_turn_failed'));
        return { itemId: item.id, result: null };
      }
    }),
  );

  let aggregateScore: Awaited<ReturnType<typeof scoreSpeakingMessage>> | null = null;
  try {
    aggregateScore = await scoreSpeakingMessage(session, {
      userText: userTurns.map((item) => item.text).join(' '),
      scenarioId: scenario.id,
      scenarioTitle: scenario.name,
      assistantPreviousMessage: aiTurns[aiTurns.length - 1]?.text,
      level: scenario.level,
    });
  } catch (error) {
    console.log('[V2_PCM][review] score-aggregate:error', normalizeError(error, 'score_aggregate_failed'));
  }

  const perTurnScoreMap = new Map(userScores.map((entry) => [entry.itemId, entry.result]));
  const overallValue = aggregateScore?.overall ?? averageScore(userScores.map((entry) => entry.result?.overall));
  const fluencyValue = aggregateScore?.fluency ?? averageScore(userScores.map((entry) => entry.result?.fluency));
  const grammarValue =
    aggregateScore != null
      ? deriveGrammarMetricFromScore(aggregateScore)
      : averageScore(
          userScores.map((entry) => {
            if (!entry.result) return null;
            return deriveGrammarMetricFromScore(entry.result);
          }),
        );

  const replayItems: SpeakingV2ReplayItem[] = cleanedTranscript.map((item) => {
    if (item.role === 'ai') {
      return {
        id: item.id,
        role: 'ai',
        text: item.text,
      };
    }
    const score = perTurnScoreMap.get(item.id);
    return {
      id: item.id,
      role: 'user',
      text: item.text,
      correction:
        score?.correction?.fixed || score?.correction?.reason
          ? {
              fixed: score?.correction?.fixed?.trim() || null,
              note: score?.correction?.reason?.trim() || score?.suggestion?.trim() || null,
              source: 'score_api',
            }
          : {
              fixed: null,
              note: '暂无纠音建议',
              source: 'unavailable',
            },
    };
  });

  const missingCapabilities = ['V2-PCM 发音评测将在下一批接入。'];
  const aiCoachFeedback =
    aggregateScore?.suggestion?.trim() ||
    aggregateScore?.correction?.reason?.trim() ||
    userScores.map((entry) => entry.result?.suggestion?.trim()).find(Boolean) ||
    '已基于真实转写生成本轮复盘。';

  return {
    reviewVersion: 'v2',
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    userTurnCount: userTurns.length,
    aiTurnCount: aiTurns.length,
    totalTurns: turnCount > 0 ? turnCount : Math.max(userTurns.length, aiTurns.length),
    interruptCount: 0,
    userTranscriptSummary: userTurns.map((item) => item.text).join(' ').slice(0, 320),
    aiTranscriptSummary: aiTurns.map((item) => item.text).join(' ').slice(0, 320),
    metrics: {
      overall:
        overallValue != null
          ? { value: overallValue, reason: null, source: 'score_api' }
          : createUnavailableMetric('未能生成总评。'),
      pronunciation: createUnavailableMetric('V2-PCM 发音评测将在下一批接入。'),
      fluency:
        fluencyValue != null
          ? { value: fluencyValue, reason: null, source: 'score_api' }
          : createUnavailableMetric('未能生成流利度评分。'),
      grammar:
        grammarValue != null
          ? { value: grammarValue, reason: null, source: aggregateScore ? 'derived_from_score' : 'score_api' }
          : createUnavailableMetric('未能生成语法评分。'),
    },
    aiCoachFeedback,
    replayItems,
    userTranscriptAvailable: true,
    timing,
    note: '本次复盘基于 PCM 转写与真实评分结果生成。',
    missingCapabilities,
    turns: reportTurns,
  } satisfies SpeakingV2ReviewPayload;
}

export function useSpeakingV2PcmRuntime({
  session,
  scenario,
}: {
  session: StoredSession | null;
  scenario: Scenario;
}) {
  const mountedRef = useMountedRef();
  const [state, dispatch] = useReducer(speakingV2Reducer, initialSpeakingV2State);
  const [captureSupport, setCaptureSupport] = useState<PcmCaptureSupport | null>(null);

  const stateRef = useRef<ExtendedSpeakingV2State>(state);
  const clientRef = useRef<OpenAiRealtimeWsClient | null>(null);
  const ttsPlaybackRef = useRef<SpeakingTtsPlayback | null>(null);
  const currentUserTurnRef = useRef<UserTurnRecord | null>(null);
  const completedTurnsRef = useRef<UserTurnRecord[]>([]);
  const reportTurnsRef = useRef<Map<number, SpeakingV2ReportTurn>>(new Map());
  const roundIdRef = useRef(0);
  const progressSyncRef = useRef<{ lastSyncedTurnCount: number }>({ lastSyncedTurnCount: 0 });
  const assistantAudioActiveRef = useRef(false);
  const captureRunningRef = useRef(false);
  const initialGreetingRequestedRef = useRef(false);
  const initialGreetingDoneRef = useRef(false);
  const activeAssistantTranscriptIdRef = useRef<string | null>(null);
  const assistantResponseDoneRef = useRef(false);
  const assistantBargeInConsecutiveChunksRef = useRef(0);
  const assistantEchoGuardRef = useRef<AssistantEchoGuardState | null>(null);
  const currentAssistantPlaybackTextRef = useRef('');
  const callStartedAtRef = useRef<number | null>(null);
  const connectionStartedAtRef = useRef<number | null>(null);
  const timingRef = useRef<SpeakingV2ReviewTiming>(createEmptyTiming());
  const timingStepStartedAtRef = useRef<Partial<Record<TimingStepName, number>>>({});
  const pendingPcm24kRef = useRef<Uint8Array[]>([]);
  const pendingPcm16kRef = useRef<Uint8Array[]>([]);
  const durationTickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finalizeTurnTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalizeUserTurnRef = useRef<((source: 'realtime_vad' | 'local_vad', metrics?: { level?: number; rms?: number; peak?: number }, stopReason?: string) => UserTurnRecord | null) | null>(null);
  const sendCommitAndCreateResponseRef = useRef<((turn: UserTurnRecord, source: string) => void) | null>(null);
  const beforeGreetingChunksRef = useRef(0);
  const duringAssistantPlaybackChunksRef = useRef(0);
  const chunksAfterGreetingRef = useRef(0);
  const appendedAfterGreetingRef = useRef(0);
  const userMicWindowRef = useRef<MicWindowDiagnosticState | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const refreshCredits = useCallback(async () => {
    if (!session) return;
    const credits = await fetchSpeakingCredits(session);
    dispatch({ type: 'SET_CREDITS', credits: credits.balanceCredits });
  }, [session]);

  const beginTimingStep = useCallback((name: TimingStepName) => {
    timingStepStartedAtRef.current[name] = Date.now();
  }, []);

  const recordTimingDuration = useCallback((key: keyof SpeakingV2ReviewTiming, stepName: TimingStepName) => {
    const startedAt = timingStepStartedAtRef.current[stepName];
    if (!startedAt) return;
    timingRef.current[key] = Date.now() - startedAt;
  }, []);

  const recordTimingSinceStart = useCallback((key: keyof SpeakingV2ReviewTiming) => {
    if (!connectionStartedAtRef.current) return;
    timingRef.current[key] = Date.now() - connectionStartedAtRef.current;
  }, []);

  const resetDurationTicker = useCallback(() => {
    if (durationTickerRef.current) {
      clearInterval(durationTickerRef.current);
      durationTickerRef.current = null;
    }
  }, []);

  const clearFinalizeTurnTimeout = useCallback(() => {
    if (finalizeTurnTimeoutRef.current) {
      clearTimeout(finalizeTurnTimeoutRef.current);
      finalizeTurnTimeoutRef.current = null;
    }
  }, []);

  const clearTurnStopTimers = useCallback((turn: UserTurnRecord | null) => {
    if (!turn) return;
    if (turn.forceStopTimeout) {
      clearTimeout(turn.forceStopTimeout);
      turn.forceStopTimeout = null;
    }
    if (turn.silenceStopTimeout) {
      clearTimeout(turn.silenceStopTimeout);
      turn.silenceStopTimeout = null;
    }
    if (turn.postRollTimeout) {
      clearTimeout(turn.postRollTimeout);
      turn.postRollTimeout = null;
    }
  }, []);

  const startUserMicDiagnosticWindow = useCallback(() => {
    const startedAt = Date.now();
    userMicWindowRef.current = {
      active: true,
      startedAt,
      endsAt: startedAt + 8000,
      lastLoggedAt: 0,
      maxRms: 0,
      maxPeak: 0,
      sumRms: 0,
      chunks: 0,
      voicedLikeChunks: 0,
    };
    console.log('[V2_PCM][pcm] v2_after_greeting_listening_window_start', JSON.stringify({
      durationMs: 8000,
      connectionStatus: stateRef.current.connectionStatus,
      assistantAudioActive: assistantAudioActiveRef.current,
      initialGreetingDone: initialGreetingDoneRef.current,
      isMicMuted: stateRef.current.isMicMuted,
    }));
  }, []);

  const startDurationTicker = useCallback(() => {
    resetDurationTicker();
    durationTickerRef.current = setInterval(() => {
      if (!callStartedAtRef.current) return;
      const durationSec = Math.max(0, Math.floor((Date.now() - callStartedAtRef.current) / 1000));
      dispatch({
        type: 'SET_CALL_DURATION',
        durationSec,
        remainingDurationSec: Math.max(0, MAX_CALL_DURATION_SEC - durationSec),
      });
    }, 1000);
  }, [resetDurationTicker]);

  const getReportTurnIncompleteReason = useCallback((turn: SpeakingV2ReportTurn) => {
    if (turn.transcriptStatus === 'pending') return 'transcript_pending';
    if (turn.transcriptStatus === 'empty') return 'transcript_empty';
    if (turn.transcriptStatus === 'error') return 'transcript_error';
    if (turn.transcriptStatus === 'too_short') return 'turn_too_short';
    if (turn.transcriptStatus === 'echo_rejected') return 'echo_rejected';
    if (turn.commitStatus !== 'sent') return `commit_${turn.commitStatus}`;
    if (!isReasonableAiReportText(turn.aiResponseText)) return 'ai_response_missing';
    return null;
  }, []);

  const updateReportTurn = useCallback((
    roundId: number,
    patch: Partial<SpeakingV2ReportTurn>,
    logStep?: string,
  ) => {
    const existing = reportTurnsRef.current.get(roundId);
    if (!existing) return null;
    const next: SpeakingV2ReportTurn = {
      ...existing,
      ...patch,
    };
    next.reportReady =
      next.transcriptStatus === 'final' &&
      next.commitStatus === 'sent' &&
      isReasonableAiReportText(next.aiResponseText);
    reportTurnsRef.current.set(roundId, next);
    if (logStep) {
      console.log(`[V2_PCM][report] ${logStep}`, JSON.stringify({
        roundId,
        transcriptStatus: next.transcriptStatus,
        commitStatus: next.commitStatus,
        reportReady: next.reportReady,
        audio24kBytes: next.audio24kBytes,
        audio16kBytes: next.audio16kBytes,
        userTranscriptLength: next.userTranscript.length,
        aiResponseTextLength: next.aiResponseText.length,
        rtasrError: next.rtasrError,
      }));
    }
    if (next.reportReady) {
      console.log('[V2_PCM][report] v2_report_turn_ready', JSON.stringify({
        roundId,
        transcriptStatus: next.transcriptStatus,
        commitStatus: next.commitStatus,
      }));
    } else {
      const reason = getReportTurnIncompleteReason(next);
      if (reason) {
        console.log('[V2_PCM][report] v2_report_turn_incomplete_reason', JSON.stringify({
          roundId,
          reason,
          transcriptStatus: next.transcriptStatus,
          commitStatus: next.commitStatus,
        }));
      }
    }
    return next;
  }, [getReportTurnIncompleteReason]);

  const createReportTurn = useCallback((turn: UserTurnRecord) => {
    const reportTurn: SpeakingV2ReportTurn = {
      roundId: turn.roundId,
      source: turn.source,
      startedAt: turn.startedAt,
      endedAt: null,
      audio24kBytes: sumChunkBytes(turn.chunks24k),
      audio16kBytes: turn.totalAudioBytes16k,
      userAudio16kBytes: turn.totalAudioBytes16k,
      userAudio24kBytes: sumChunkBytes(turn.chunks24k),
      userAudioDurationMs: undefined,
      userTranscript: '',
      transcriptStatus: 'pending',
      rtasrError: null,
      pronunciationStatus: 'idle',
      pronunciation: null,
      pronunciationDebug: null,
      aiResponseText: '',
      aiResponseAudioBytes: 0,
      commitStatus: 'pending',
      reportReady: false,
    };
    reportTurnsRef.current.set(turn.roundId, reportTurn);
    console.log('[V2_PCM][report] v2_report_turn_created', JSON.stringify({
      roundId: turn.roundId,
      source: turn.source,
      startedAt: turn.startedAt,
      audio24kBytes: reportTurn.audio24kBytes,
      audio16kBytes: reportTurn.audio16kBytes,
    }));
    return reportTurn;
  }, []);

  const clearCurrentTurn = useCallback(() => {
    clearTurnStopTimers(currentUserTurnRef.current);
    currentUserTurnRef.current = null;
    pendingPcm24kRef.current = [];
    pendingPcm16kRef.current = [];
    clearFinalizeTurnTimeout();
  }, [clearFinalizeTurnTimeout, clearTurnStopTimers]);

  const flushRtasrBufferedAudio = useCallback((turn: UserTurnRecord) => {
    if (!turn.rtasrClient || turn.rtasrState !== 'connected' || turn.pendingRtasrChunks16k.length === 0) {
      return;
    }
    const pending = [...turn.pendingRtasrChunks16k];
    turn.pendingRtasrChunks16k = [];
    const pendingBytes = sumChunkBytes(pending);
    console.log('[V2_PCM][rtasr] v2_rtasr_pending_flush_start', JSON.stringify({
      roundId: turn.roundId,
      pendingChunks: pending.length,
      pendingBytes,
    }));
    pending.forEach((chunk) => {
      turn.rtasrClient?.appendPcmChunk(chunk);
    });
    turn.rtasrSentChunks += pending.length;
    turn.rtasrSentBytes += pendingBytes;
    console.log('[V2_PCM][rtasr] v2_turn_audio_chunk_sent_to_rtasr', JSON.stringify({
      roundId: turn.roundId,
      sentChunks: turn.rtasrSentChunks,
      sentBytes: turn.rtasrSentBytes,
      rtasrOpen: true,
      source: 'buffered',
      flushedChunks: pending.length,
      flushedBytes: pendingBytes,
    }));
    console.log('[V2_PCM][rtasr] v2_turn_pending_rtasr_flushed', JSON.stringify({
      roundId: turn.roundId,
      flushedChunks: pending.length,
      flushedBytes: pendingBytes,
    }));
    console.log('[V2_PCM][rtasr] v2_rtasr_pending_flush_done', JSON.stringify({
      roundId: turn.roundId,
      flushedChunks: pending.length,
      flushedBytes: pendingBytes,
    }));
  }, []);

  const triggerV2PronunciationAssessment = useCallback((turn: UserTurnRecord, transcriptText: string) => {
    if (turn.pronunciationAssessmentStarted) {
      return;
    }
    turn.pronunciationAssessmentStarted = true;
    const normalizedText = sanitizeTranscriptText(transcriptText);
    const pcm16k = mergeUint8Arrays(turn.chunks16k);
    const unavailableDebug = (skipReason: string): XfyunPronunciationDebug => ({
      started: false,
      skipped: true,
      skipReason,
      referenceTextUsed: normalizedText || null,
    });
    if (!isMeaningfulTranscriptText(normalizedText)) {
      const debug = unavailableDebug('missing_or_invalid_transcript');
      console.log('[V2_PCM][ise] v2_pronunciation_assessment_skipped', JSON.stringify({
        roundId: turn.roundId,
        reason: debug.skipReason,
        transcript: normalizedText,
      }));
      updateReportTurn(turn.roundId, {
        pronunciationStatus: 'unavailable',
        pronunciation: null,
        pronunciationDebug: debug,
      }, 'v2_report_turn_pronunciation_attached');
      return;
    }
    if (pcm16k.byteLength < MIN_ISE_AUDIO_16K_BYTES) {
      const debug = unavailableDebug('audio_too_short');
      console.log('[V2_PCM][ise] v2_pronunciation_assessment_skipped', JSON.stringify({
        roundId: turn.roundId,
        reason: debug.skipReason,
        pcm16kBytes: pcm16k.byteLength,
        minBytes: MIN_ISE_AUDIO_16K_BYTES,
      }));
      updateReportTurn(turn.roundId, {
        pronunciationStatus: 'unavailable',
        pronunciation: null,
        pronunciationDebug: debug,
      }, 'v2_report_turn_pronunciation_attached');
      return;
    }

    console.log('[V2_PCM][ise] v2_pronunciation_assessment_start', JSON.stringify({
      roundId: turn.roundId,
      transcript: normalizedText,
      pcm16kBytes: pcm16k.byteLength,
    }));
    updateReportTurn(turn.roundId, {
      pronunciationStatus: 'pending',
      pronunciation: null,
      pronunciationDebug: null,
    }, 'v2_report_turn_pronunciation_attached');

    void runXfyunIseAssessment({
      roundId: turn.roundId,
      pcm16k,
      transcriptText: normalizedText,
      referenceText: normalizedText,
    })
      .then((result) => {
        if (result.assessment) {
          console.log('[V2_PCM][ise] v2_pronunciation_assessment_ready', JSON.stringify({
            roundId: turn.roundId,
            overall: result.assessment.overallScore,
            accuracy: result.assessment.accuracyScore,
            fluency: result.assessment.fluencyScore,
            wordsCount: result.assessment.words.length,
          }));
          updateReportTurn(turn.roundId, {
            pronunciationStatus: 'ready',
            pronunciation: result.assessment,
            pronunciationDebug: result.debug,
          }, 'v2_report_turn_pronunciation_attached');
          return;
        }
        console.log('[V2_PCM][ise] v2_pronunciation_assessment_error', JSON.stringify({
          roundId: turn.roundId,
          errorCode: result.debug.errorCode ?? null,
          errorMessage: result.debug.errorMessage ?? null,
          skipped: result.debug.skipped,
          skipReason: result.debug.skipReason ?? null,
        }));
        updateReportTurn(turn.roundId, {
          pronunciationStatus: result.debug.skipped ? 'unavailable' : 'error',
          pronunciation: null,
          pronunciationDebug: result.debug,
        }, 'v2_report_turn_pronunciation_attached');
      })
      .catch((error) => {
        const debug: XfyunPronunciationDebug = {
          started: true,
          skipped: false,
          errorCode: 'ISE_EXCEPTION',
          errorMessage: normalizeError(error, 'ise_assessment_failed'),
          referenceTextUsed: normalizedText,
        };
        console.log('[V2_PCM][ise] v2_pronunciation_assessment_error', JSON.stringify({
          roundId: turn.roundId,
          errorCode: debug.errorCode,
          errorMessage: debug.errorMessage,
        }));
        updateReportTurn(turn.roundId, {
          pronunciationStatus: 'error',
          pronunciation: null,
          pronunciationDebug: debug,
        }, 'v2_report_turn_pronunciation_attached');
      });
  }, [updateReportTurn]);

  const handleRtasrResult = useCallback((turn: UserTurnRecord, transcript: XfyunRtasrTranscript) => {
    const text = sanitizeTranscriptText(transcript.text);
    turn.transcriptText = text;
    turn.transcriptReady = true;
    const isEchoRejected =
      turn.source === 'local_barge_in' &&
      !transcript.errorMessage &&
      isLikelyAssistantEchoTranscript(text, currentAssistantPlaybackTextRef.current);
    if (isEchoRejected) {
      console.log('[V2_PCM][rtasr] v2_rtasr_transcript_echo_rejected', JSON.stringify({
        roundId: turn.roundId,
        transcript: text,
        assistantText: currentAssistantPlaybackTextRef.current,
      }));
      updateReportTurn(turn.roundId, {
        userTranscript: text,
        transcriptStatus: 'echo_rejected',
        rtasrError: null,
        commitStatus: 'skipped',
      }, 'v2_report_turn_echo_rejected');
      console.log('[V2_PCM][realtime] v2_commit_skipped_echo_rejected', JSON.stringify({
        roundId: turn.roundId,
        source: turn.source,
      }));
      console.log('[V2_PCM][realtime] v2_commit_create_response_cancelled_echo', JSON.stringify({
        roundId: turn.roundId,
      }));
      dispatch({
        type: 'PATCH_TRANSCRIPT',
        id: turn.transcriptId,
        patch: {
          text: '',
          isFinal: true,
        },
      });
      if (stateRef.current.connectionStatus === 'connected') {
        dispatch({ type: 'SET_STAGE_STATE', stage: 'listening' });
        dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
      }
      return;
    }
    const transcriptStatus: SpeakingV2ReportTurn['transcriptStatus'] = transcript.errorMessage
      ? 'error'
      : text
        ? 'final'
        : 'empty';
      updateReportTurn(turn.roundId, {
        userTranscript: text,
        transcriptStatus,
        rtasrError: transcript.errorMessage ?? transcript.closeReason ?? null,
      }, 'v2_report_turn_transcript_attached');
      console.log('[V2_PCM][report] v2_report_transcript_round_mapping', JSON.stringify({
        roundId: turn.roundId,
        transcriptId: turn.transcriptId,
        turnSource: turn.source,
        transcriptStatus,
        normalizedText: text,
      }));
    dispatch({
      type: 'PATCH_TRANSCRIPT',
      id: turn.transcriptId,
      patch: {
        text,
        isFinal: true,
      },
    });
    if (turn.source === 'local_barge_in' && transcriptStatus === 'final' && isMeaningfulTranscriptText(text)) {
      triggerV2PronunciationAssessment(turn, text);
      console.log('[V2_PCM][realtime] v2_commit_released_after_echo_check', JSON.stringify({
        roundId: turn.roundId,
        transcript: text,
      }));
      sendCommitAndCreateResponseRef.current?.(turn, 'local_barge_in_echo_checked');
    } else if (turn.source === 'local_barge_in' && transcriptStatus !== 'final') {
      console.log('[V2_PCM][realtime] v2_commit_create_response_skipped_reason', JSON.stringify({
        roundId: turn.roundId,
        source: turn.source,
        reason: `barge_in_transcript_${transcriptStatus}`,
      }));
      updateReportTurn(turn.roundId, {
        commitStatus: 'skipped',
      }, 'v2_report_turn_transcript_attached');
    } else if (transcriptStatus === 'final' && isMeaningfulTranscriptText(text)) {
      triggerV2PronunciationAssessment(turn, text);
    } else {
      triggerV2PronunciationAssessment(turn, text);
    }
  }, [triggerV2PronunciationAssessment, updateReportTurn]);

  const triggerRtasrFinish = useCallback((turn: UserTurnRecord) => {
    if (!turn.rtasrClient || turn.rtasrFinishStarted || turn.rtasrState === 'finished') {
      return;
    }
    turn.rtasrFinishStarted = true;
    void turn.rtasrClient
      .finish()
      .then((transcript) => {
        turn.rtasrState = 'finished';
        handleRtasrResult(turn, transcript);
      })
      .catch((error) => {
        turn.rtasrState = 'failed';
        const message = normalizeError(error, 'rtasr_finish_failed');
        console.log('[V2_PCM][rtasr] finish:error', turn.roundId, message);
        updateReportTurn(turn.roundId, {
          transcriptStatus: 'error',
          rtasrError: message,
        }, 'v2_report_turn_transcript_attached');
        dispatch({
          type: 'PATCH_TRANSCRIPT',
          id: turn.transcriptId,
          patch: {
            text: '',
            isFinal: true,
          },
        });
      });
  }, [handleRtasrResult, updateReportTurn]);

  const startRtasrConnectInBackground = useCallback((turn: UserTurnRecord) => {
    const rtasrClient = new XfyunRtasrStreamingClient(turn.roundId);
    turn.rtasrClient = rtasrClient;
    turn.rtasrState = 'connecting';
    void rtasrClient
      .connect()
      .then(() => {
        turn.rtasrState = 'connected';
        flushRtasrBufferedAudio(turn);
        if (turn.stopRequestedAt != null) {
          triggerRtasrFinish(turn);
        }
      })
      .catch((error) => {
        turn.rtasrState = 'failed';
        const message = normalizeError(error, 'rtasr_connect_failed');
        console.log('[V2_PCM][rtasr] connect:error', turn.roundId, message);
        updateReportTurn(turn.roundId, {
          transcriptStatus: 'error',
          rtasrError: message,
        }, 'v2_report_turn_transcript_attached');
      });
  }, [flushRtasrBufferedAudio, triggerRtasrFinish, updateReportTurn]);

  const ensureUserTurnStarted = useCallback((
    source: 'realtime_vad' | 'local_vad' | 'local_barge_in',
    metrics?: {
      level?: number;
      rms?: number;
      peak?: number;
    },
  ) => {
    if (stateRef.current.isMicMuted || (assistantAudioActiveRef.current && source !== 'local_barge_in')) {
      console.log('[V2_PCM][turn] v2_user_turn_blocked_reason', JSON.stringify({
        source,
        assistantAudioActive: assistantAudioActiveRef.current,
        isMicMuted: stateRef.current.isMicMuted,
      }));
      return currentUserTurnRef.current;
    }
    if (currentUserTurnRef.current) {
      return currentUserTurnRef.current;
    }
    roundIdRef.current += 1;
    const transcriptId = createTranscriptId('user');
    const turn: UserTurnRecord = {
      roundId: roundIdRef.current,
      transcriptId,
      assistantReplyId: null,
      source,
      responseRequested: false,
      silenceChunkCount: 0,
      startedAt: Date.now(),
      stopRequestedAt: null,
      chunks24k: [...pendingPcm24kRef.current],
      chunks16k: [...pendingPcm16kRef.current],
      pendingRtasrChunks16k: [...pendingPcm16kRef.current],
      rtasrClient: null,
      rtasrState: 'idle',
      rtasrFinishStarted: false,
      transcriptText: '',
      transcriptReady: false,
      userAudio: null,
      durationMs: null,
      lastVoiceAt: Date.now(),
      totalAudioChunks16k: pendingPcm16kRef.current.length,
      totalAudioBytes16k: sumChunkBytes(pendingPcm16kRef.current),
      rtasrSentChunks: 0,
      rtasrSentBytes: 0,
      finalizePending: false,
      finalizeSource: null,
      finalizeGraceDeadlineAt: null,
      forceStopTimeout: null,
      silenceStopTimeout: null,
      postRollTimeout: null,
      postRollPending: false,
      postRollStartedAt: null,
      postRollChunks24k: 0,
      preRollChunks24k: pendingPcm24kRef.current.length,
      preRollChunks16k: pendingPcm16kRef.current.length,
      pronunciationAssessmentStarted: false,
    };
    currentUserTurnRef.current = turn;
    completedTurnsRef.current.push(turn);
    createReportTurn(turn);
    turn.forceStopTimeout = setTimeout(() => {
      if (currentUserTurnRef.current?.roundId !== turn.roundId || turn.stopRequestedAt != null) return;
      console.log('[V2_PCM][turn] v2_user_segment_force_stop_timeout', JSON.stringify({
        roundId: turn.roundId,
        source: turn.source,
        timeoutMs: USER_TURN_MAX_MS,
      }));
      finalizeUserTurnRef.current?.('local_vad', undefined, 'max_turn_timeout');
    }, USER_TURN_MAX_MS);
    turn.silenceStopTimeout = setTimeout(() => {
      if (currentUserTurnRef.current?.roundId !== turn.roundId || turn.stopRequestedAt != null) return;
      console.log('[V2_PCM][turn] v2_user_segment_silence_stop', JSON.stringify({
        roundId: turn.roundId,
        source: turn.source,
        silenceMs: USER_TURN_LAST_VOICE_STOP_MS,
      }));
      finalizeUserTurnRef.current?.('local_vad', undefined, 'last_voice_timeout');
    }, USER_TURN_LAST_VOICE_STOP_MS);
    dispatch({
      type: 'UPSERT_TRANSCRIPT',
      item: {
        id: transcriptId,
        role: 'user',
        text: '',
        isFinal: false,
        timestamp: Date.now(),
      },
    });
    startRtasrConnectInBackground(turn);
    dispatch({ type: 'SET_STAGE_STATE', stage: 'listening' });
    dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'user_speaking' });
    console.log('[V2_PCM][turn] v2_user_segment_start', JSON.stringify({
      roundId: turn.roundId,
      source,
      bufferedChunks24k: turn.chunks24k.length,
      bufferedChunks16k: turn.pendingRtasrChunks16k.length,
      bufferedBytes16k: turn.totalAudioBytes16k,
      preRollChunks24k: turn.preRollChunks24k,
      preRollChunks16k: turn.preRollChunks16k,
      rms: metrics?.rms != null ? Math.round(metrics.rms) : null,
      peak: metrics?.peak != null ? Math.round(metrics.peak) : null,
      level: metrics?.level != null ? Math.round(metrics.level) : null,
    }));
    if (source === 'local_barge_in') {
      console.log('[V2_PCM][turn] v2_barge_in_prebuffer_attached', JSON.stringify({
        roundId: turn.roundId,
        prebuffer24kChunks: turn.chunks24k.length,
        prebuffer16kChunks: turn.pendingRtasrChunks16k.length,
      }));
    } else {
      console.log('[V2_PCM][turn] v2_turn_pre_roll_attached', JSON.stringify({
        roundId: turn.roundId,
        source,
        preRollChunks24k: turn.preRollChunks24k,
        preRollChunks16k: turn.preRollChunks16k,
        preRoll24kBytes: sumChunkBytes(turn.chunks24k),
        preRoll16kBytes: sumChunkBytes(turn.chunks16k),
      }));
    }
    return turn;
  }, [createReportTurn, startRtasrConnectInBackground]);

  const sendCommitAndCreateResponse = useCallback((
    turn: UserTurnRecord,
    source: string,
  ) => {
    if (turn.responseRequested) {
      console.log('[V2_PCM][turn] v2_turn_finalize_once_guard_hit', JSON.stringify({
        roundId: turn.roundId,
        source,
      }));
      return;
    }
    console.log('[V2_PCM][realtime] v2_commit_create_response_start', JSON.stringify({
      source,
      roundId: turn.roundId,
      hasClient: Boolean(clientRef.current),
      inputAudioBytes: turn.chunks24k.reduce((sum, chunk) => sum + chunk.byteLength, 0),
      connectionStatusRef: stateRef.current.connectionStatus,
    }));
    const committed = clientRef.current?.commitAndCreateResponse(turn.roundId) ?? false;
    if (committed) {
      turn.responseRequested = true;
      updateReportTurn(turn.roundId, { commitStatus: 'sent' }, 'v2_report_turn_user_audio_attached');
    } else {
      updateReportTurn(turn.roundId, { commitStatus: clientRef.current ? 'failed' : 'skipped' }, 'v2_report_turn_user_audio_attached');
      console.log('[V2_PCM][realtime] v2_commit_create_response_skipped_reason', JSON.stringify({
        source,
        roundId: turn.roundId,
        reason: clientRef.current ? 'commit_failed' : 'missing_client',
      }));
    }
    console.log('[V2_PCM][realtime] v2_commit_create_response_sent', JSON.stringify({
      source,
      roundId: turn.roundId,
      committed,
    }));
  }, [updateReportTurn]);

  sendCommitAndCreateResponseRef.current = sendCommitAndCreateResponse;

  const finalizeUserTurn = useCallback((
    source: 'realtime_vad' | 'local_vad',
    metrics?: {
      level?: number;
      rms?: number;
      peak?: number;
    },
    stopReason: string = source,
  ) => {
    const turn = currentUserTurnRef.current;
    if (!turn) {
      console.log('[V2_PCM][turn] v2_user_segment_stop_missing_turn', JSON.stringify({ source }));
      dispatch({ type: 'SET_STAGE_STATE', stage: 'thinking' });
      dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'thinking' });
      return null;
    }
    const now = Date.now();
    const shouldPostRoll =
      turn.source === 'local_vad' &&
      source === 'local_vad' &&
      !turn.postRollPending &&
      stopReason !== 'post_roll_complete';
    if (shouldPostRoll) {
      turn.postRollPending = true;
      turn.postRollStartedAt = now;
      console.log('[V2_PCM][turn] v2_turn_post_roll_started', JSON.stringify({
        roundId: turn.roundId,
        postRollMs: USER_TURN_POST_ROLL_MS,
        silenceChunks: turn.silenceChunkCount,
        silenceMs: LOCAL_VAD_SILENCE_MS,
        stopReason,
      }));
      turn.postRollTimeout = setTimeout(() => {
        turn.postRollTimeout = null;
        console.log('[V2_PCM][turn] v2_turn_post_roll_attached', JSON.stringify({
          roundId: turn.roundId,
          postRollMs: USER_TURN_POST_ROLL_MS,
          chunks24k: turn.chunks24k.length,
          chunks16k: turn.chunks16k.length,
          postRollChunks24k: turn.postRollChunks24k,
          audio16kBytes: turn.totalAudioBytes16k,
        }));
        void finalizeUserTurn(source, metrics, 'post_roll_complete');
      }, USER_TURN_POST_ROLL_MS);
      return turn;
    }
    if (turn.stopRequestedAt != null && !turn.finalizePending) {
      return turn;
    }
    if (turn.stopRequestedAt == null) {
      turn.stopRequestedAt = now;
    }
    clearTurnStopTimers(turn);
    turn.finalizePending = true;
    turn.finalizeSource = source;
    if (turn.finalizeGraceDeadlineAt == null) {
      turn.finalizeGraceDeadlineAt = now + MIN_USER_TURN_GRACE_MS;
    }
    turn.durationMs = Math.max(0, now - turn.startedAt);
    const hasMinAudio =
      turn.totalAudioChunks16k >= MIN_USER_TURN_16K_CHUNKS ||
      turn.durationMs >= MIN_USER_TURN_MS;
    if (!hasMinAudio && now < turn.finalizeGraceDeadlineAt) {
      clearFinalizeTurnTimeout();
      console.log('[V2_PCM][turn] v2_turn_stop_delayed_for_min_audio', JSON.stringify({
        roundId: turn.roundId,
        source,
        totalAudioChunks16k: turn.totalAudioChunks16k,
        totalAudioBytes16k: turn.totalAudioBytes16k,
        durationMs: turn.durationMs,
        graceRemainingMs: Math.max(0, turn.finalizeGraceDeadlineAt - now),
      }));
      finalizeTurnTimeoutRef.current = setTimeout(() => {
        finalizeTurnTimeoutRef.current = null;
        void finalizeUserTurn(source, metrics);
      }, Math.max(80, turn.finalizeGraceDeadlineAt - now));
      return turn;
    }
    clearFinalizeTurnTimeout();
    if (!hasMinAudio) {
      console.log('[V2_PCM][turn] v2_turn_too_short_skip_response', JSON.stringify({
        roundId: turn.roundId,
        source,
        totalAudioChunks16k: turn.totalAudioChunks16k,
        totalAudioBytes16k: turn.totalAudioBytes16k,
        durationMs: turn.durationMs,
      }));
      updateReportTurn(turn.roundId, {
        transcriptStatus: 'too_short',
        commitStatus: 'skipped',
      }, 'v2_report_turn_user_audio_attached');
    } else {
      console.log('[V2_PCM][turn] v2_turn_min_audio_reached', JSON.stringify({
        roundId: turn.roundId,
        source,
        totalAudioChunks16k: turn.totalAudioChunks16k,
        totalAudioBytes16k: turn.totalAudioBytes16k,
        durationMs: turn.durationMs,
      }));
    }
    console.log('[V2_PCM][turn] v2_user_segment_stop', JSON.stringify({
      roundId: turn.roundId,
      source,
      turnSource: turn.source,
      durationMs: turn.durationMs,
      pcmBytes: turn.chunks24k.reduce((sum, chunk) => sum + chunk.byteLength, 0),
      pcmChunks: turn.chunks24k.length,
      rms: metrics?.rms != null ? Math.round(metrics.rms) : null,
      peak: metrics?.peak != null ? Math.round(metrics.peak) : null,
      level: metrics?.level != null ? Math.round(metrics.level) : null,
    }));
    console.log('[V2_PCM][turn] v2_user_segment_stop_reason', JSON.stringify({
      roundId: turn.roundId,
      source,
      turnSource: turn.source,
      reason: stopReason,
    }));
    console.log('[V2_PCM][turn] v2_turn_audio_summary_on_stop', JSON.stringify({
      roundId: turn.roundId,
      source,
      turnSource: turn.source,
      durationMs: turn.durationMs,
      chunks24k: turn.chunks24k.length,
      chunks16k: turn.chunks16k.length,
      audio24kBytes: sumChunkBytes(turn.chunks24k),
      audio16kBytes: turn.totalAudioBytes16k,
      preRollChunks: turn.preRollChunks24k,
      voicedChunks: Math.max(0, turn.chunks24k.length - turn.preRollChunks24k - turn.postRollChunks24k),
      postRollChunks: turn.postRollChunks24k,
      stopReason,
      silenceChunks: turn.silenceChunkCount,
      silenceMs: turn.silenceChunkCount * PCM_CHUNK_MS,
    }));
    const merged24k = mergeUint8Arrays(turn.chunks24k);
    updateReportTurn(turn.roundId, {
      endedAt: now,
      audio24kBytes: merged24k.byteLength,
      audio16kBytes: turn.totalAudioBytes16k,
      userAudio24kBytes: merged24k.byteLength,
      userAudio16kBytes: turn.totalAudioBytes16k,
      userAudioDurationMs: turn.durationMs,
    }, 'v2_report_turn_user_audio_attached');
    if (merged24k.byteLength > 0) {
      const wav24k = createWavBytes(merged24k, PCM_SAMPLE_RATE, PCM_CHANNELS);
      void writeBase64AudioToCacheFile(encodeBase64(wav24k), 'wav')
        .then((uri) => {
          turn.userAudio = {
            uri,
            durationMs: turn.durationMs,
            size: wav24k.byteLength,
            mimeType: 'audio/wav',
          };
        })
        .catch((error) => {
          console.log('[V2_PCM][audio] save:user:error', normalizeError(error, 'save_turn_audio_failed'));
        });
    }
    if (turn.rtasrState === 'connected') {
      flushRtasrBufferedAudio(turn);
      console.log('[V2_PCM][rtasr] v2_rtasr_audio_summary_before_end_frame', JSON.stringify({
        roundId: turn.roundId,
        durationMs: turn.durationMs,
        chunks16k: turn.chunks16k.length,
        audio16kBytes: turn.totalAudioBytes16k,
        rtasrSentChunks: turn.rtasrSentChunks,
        rtasrSentBytes: turn.rtasrSentBytes,
        pendingRtasrChunks16k: turn.pendingRtasrChunks16k.length,
        stopReason,
      }));
      console.log('[V2_PCM][rtasr] v2_rtasr_end_frame_send_start', JSON.stringify({
        roundId: turn.roundId,
        source,
      }));
      console.log('[V2_PCM][rtasr] v2_rtasr_start_after_user', JSON.stringify({
        roundId: turn.roundId,
        source,
      }));
      triggerRtasrFinish(turn);
    } else if (turn.rtasrState === 'idle' || turn.rtasrState === 'connecting') {
      console.log('[V2_PCM][rtasr] v2_rtasr_waiting_after_user', JSON.stringify({
        roundId: turn.roundId,
        source,
        state: turn.rtasrState,
      }));
    } else {
      console.log('[V2_PCM][rtasr] v2_rtasr_empty_reason', JSON.stringify({
        roundId: turn.roundId,
        source,
        reason: `rtasr_state_${turn.rtasrState}`,
      }));
    }
    if (hasMinAudio && turn.source === 'local_barge_in') {
      console.log('[V2_PCM][realtime] v2_commit_deferred_for_barge_in_echo_check', JSON.stringify({
        roundId: turn.roundId,
        source: turn.source,
        totalAudioChunks16k: turn.totalAudioChunks16k,
        totalAudioBytes16k: turn.totalAudioBytes16k,
      }));
    } else if (hasMinAudio) {
      sendCommitAndCreateResponse(turn, source);
    }
    currentUserTurnRef.current = null;
    pendingPcm24kRef.current = [];
    pendingPcm16kRef.current = [];
    dispatch({ type: 'SET_STAGE_STATE', stage: 'thinking' });
    dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'thinking' });
    return turn;
  }, [clearFinalizeTurnTimeout, clearTurnStopTimers, flushRtasrBufferedAudio, sendCommitAndCreateResponse, triggerRtasrFinish, updateReportTurn]);

  finalizeUserTurnRef.current = finalizeUserTurn;

  const syncProgress = useCallback(async (nextTurnCount: number) => {
    if (!session || !stateRef.current.sessionId) return;
    if (progressSyncRef.current.lastSyncedTurnCount >= nextTurnCount) return;
    try {
      await updateSpeakingSessionProgress(session, stateRef.current.sessionId, nextTurnCount);
      progressSyncRef.current.lastSyncedTurnCount = nextTurnCount;
    } catch (error) {
      console.log('[V2_PCM][session] progress:error', normalizeError(error, 'progress_sync_failed'));
    }
  }, [session]);

  const upsertAiTranscript = useCallback((id: string, text: string, isFinal: boolean) => {
    dispatch({
      type: isFinal ? 'UPSERT_TRANSCRIPT' : 'PATCH_TRANSCRIPT',
      ...(isFinal
        ? {
            item: {
              id,
              role: 'ai',
              text,
              isFinal,
              timestamp: stateRef.current.transcript.find((entry) => entry.id === id)?.timestamp ?? Date.now(),
            },
          }
        : {
            id,
            patch: {
              text,
              isFinal,
            },
          }),
    } as any);
  }, []);

  const playAssistantAudio = useCallback(
    async ({
      audioBase64,
      text,
      isInitialGreeting,
    }: {
      audioBase64: string;
      text: string;
      isInitialGreeting: boolean;
    }) => {
      if (!ttsPlaybackRef.current) {
        ttsPlaybackRef.current = new SpeakingTtsPlayback();
      }
      console.log('[V2_PCM][audio] v2_assistant_audio_play_requested', JSON.stringify({
        textLength: text.length,
        isInitialGreeting,
        audioBytes: decodeBase64(audioBase64).byteLength,
      }));
      const audioUri = await writeBase64AudioToCacheFile(audioBase64, 'wav');
      console.log('[V2_PCM][audio] v2_assistant_audio_file_written', JSON.stringify({
        uri: audioUri,
        isInitialGreeting,
      }));
      await ttsPlaybackRef.current.playUri(
        audioUri,
        text,
        (event) => {
          if (event.type === 'start') {
            console.log('[V2_PCM][audio] v2_assistant_audio_play_start', JSON.stringify({
              isInitialGreeting,
              textLength: text.length,
            }));
            assistantAudioActiveRef.current = true;
            currentAssistantPlaybackTextRef.current = text;
            assistantBargeInConsecutiveChunksRef.current = 0;
            assistantEchoGuardRef.current = {
              playbackStartedAt: Date.now(),
              assistantText: text,
              baselineRmsSum: 0,
              baselinePeakMax: 0,
              baselineChunks: 0,
              baselineReady: false,
              echoBaselineRms: 0,
              echoBaselinePeak: 0,
              candidateChunks24k: [],
              candidateChunks16k: [],
            };
            dispatch({ type: 'SET_STAGE_STATE', stage: 'speaking' });
            dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'ai_speaking' });
            if (timingRef.current.firstAssistantAudioStartedMs == null) {
              recordTimingSinceStart('firstAssistantAudioStartedMs');
              if (timingRef.current.totalMs == null) {
                recordTimingSinceStart('totalMs');
              }
            }
            if (isInitialGreeting) {
              console.log('[V2_PCM][runtime] v2_initial_greeting_audio_started', scenario.id);
            }
          } else {
            console.log('[V2_PCM][audio] v2_assistant_audio_play_done', JSON.stringify({
              isInitialGreeting,
              eventType: event.type,
              message: event.message ?? null,
            }));
            assistantAudioActiveRef.current = false;
            assistantBargeInConsecutiveChunksRef.current = 0;
            assistantEchoGuardRef.current = null;
            console.log('[V2_PCM][runtime] v2_assistant_audio_state_reset', JSON.stringify({
              isInitialGreeting,
              connectionStatus: stateRef.current.connectionStatus,
            }));
            setTimeout(() => {
              console.log('[V2_PCM][pcm] v2_capture_resume_after_playback_start', JSON.stringify({
                isInitialGreeting,
                connectionStatus: stateRef.current.connectionStatus,
                captureRunning: captureRunningRef.current,
              }));
              void ensureCaptureActiveAfterPlayback()
                .then((result) => {
                  console.log('[V2_PCM][pcm] v2_capture_resume_after_playback_done', JSON.stringify({
                    isInitialGreeting,
                    ...result,
                  }));
                })
                .catch((error) => {
                  console.log('[V2_PCM][pcm] v2_capture_resume_after_playback_failed', JSON.stringify({
                    isInitialGreeting,
                    message: normalizeError(error, 'capture_resume_after_playback_failed'),
                  }));
                });
            }, 150);
            if (stateRef.current.connectionStatus === 'connected') {
              dispatch({ type: 'SET_STAGE_STATE', stage: 'listening' });
              dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
              console.log('[V2_PCM][runtime] v2_stage_after_assistant_done', JSON.stringify({
                isInitialGreeting,
                stage: 'listening',
                liveStage: 'idle',
              }));
              if (isInitialGreeting) {
                console.log('[V2_PCM][runtime] v2_listening_ready_after_greeting', scenario.id);
                startUserMicDiagnosticWindow();
              }
            }
          }
        },
        {
          cleanupFileAfterPlay: true,
          skipAudioModeConfig: true,
        },
      );
    },
    [recordTimingSinceStart, scenario.id, startUserMicDiagnosticWindow],
  );

  const handleRealtimeEvent = useCallback((event: OpenAiRealtimeWsEvent) => {
    switch (event.type) {
      case 'connected':
        assistantResponseDoneRef.current = false;
        dispatch({ type: 'SET_CONNECTION_STATUS', status: 'connected' });
        dispatch({ type: 'SET_STAGE_STATE', stage: 'idle' });
        dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
        return;
      case 'session_updated':
        recordTimingSinceStart('sessionUpdatedMs');
        return;
      case 'disconnected':
        assistantResponseDoneRef.current = false;
        if (stateRef.current.connectionStatus === 'ending' || stateRef.current.connectionStatus === 'completed') {
          return;
        }
        dispatch({ type: 'SET_CONNECTION_STATUS', status: 'error' });
        dispatch({ type: 'SET_ERROR', error: createRuntimeError('transport', 'Realtime 连接已断开。') });
        return;
      case 'error':
        assistantResponseDoneRef.current = false;
        console.log('[V2_PCM][realtime] v2_realtime_error', JSON.stringify({
          message: event.message,
          rawType: event.rawType ?? null,
          nonFatal: event.nonFatal === true,
        }));
        if (
          event.nonFatal ||
          /Conversation already has an active response in progress/i.test(event.message)
        ) {
          console.log('[V2_PCM][realtime] v2_connection_kept_connected_after_nonfatal_realtime_error', JSON.stringify({
            message: event.message,
            rawType: event.rawType ?? null,
            connectionStatus: stateRef.current.connectionStatus,
          }));
          if (stateRef.current.connectionStatus !== 'connected') {
            dispatch({ type: 'SET_CONNECTION_STATUS', status: 'connected' });
          }
          return;
        }
        dispatch({ type: 'SET_CONNECTION_STATUS', status: 'error' });
        dispatch({ type: 'SET_ERROR', error: createRuntimeError('transport', event.message) });
        return;
      case 'user_speech_started': {
        console.log('[V2_PCM][realtime] v2_realtime_user_speech_started', JSON.stringify({
          connectionStatus: stateRef.current.connectionStatus,
          assistantAudioActive: assistantAudioActiveRef.current,
          isMicMuted: stateRef.current.isMicMuted,
        }));
        ensureUserTurnStarted('realtime_vad');
        return;
      }
      case 'user_speech_stopped': {
        console.log('[V2_PCM][realtime] v2_realtime_user_speech_stopped_received_in_runtime', JSON.stringify({
          hasCurrentTurn: Boolean(currentUserTurnRef.current),
        }));
        console.log('[V2_PCM][realtime] v2_realtime_user_speech_stopped', JSON.stringify({
          hasCurrentTurn: Boolean(currentUserTurnRef.current),
        }));
        finalizeUserTurn('realtime_vad', undefined, 'server_vad_speech_stopped');
        return;
      }
      case 'user_audio_committed': {
        const latestTurn = [...completedTurnsRef.current].reverse().find((item) => !item.responseRequested);
        if (latestTurn) {
          latestTurn.responseRequested = true;
        }
        console.log('[V2_PCM][realtime] v2_realtime_input_committed_received_in_runtime', JSON.stringify({
          roundId: latestTurn?.roundId ?? null,
        }));
        console.log('[V2_PCM][realtime] v2_realtime_input_committed', JSON.stringify({
          roundId: latestTurn?.roundId ?? null,
        }));
        return;
      }
      case 'assistant_response_created': {
        assistantResponseDoneRef.current = false;
        console.log('[V2_PCM][realtime] v2_realtime_response_created_after_user', JSON.stringify({
          responseId: event.responseId ?? null,
        }));
        const transcriptId = event.responseId || createTranscriptId('ai');
        activeAssistantTranscriptIdRef.current = transcriptId;
        dispatch({
          type: 'UPSERT_TRANSCRIPT',
          item: {
            id: transcriptId,
            role: 'ai',
            text: '',
            isFinal: false,
            timestamp: Date.now(),
          },
        });
        dispatch({ type: 'SET_STAGE_STATE', stage: 'speaking' });
        dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'ai_speaking' });
        return;
      }
      case 'assistant_text_delta': {
        const transcriptId = activeAssistantTranscriptIdRef.current || event.responseId || createTranscriptId('ai');
        activeAssistantTranscriptIdRef.current = transcriptId;
        const currentText =
          stateRef.current.transcript.find((entry) => entry.id === transcriptId)?.text || '';
        upsertAiTranscript(transcriptId, `${currentText}${event.textDelta}`, false);
        return;
      }
      case 'assistant_audio_delta':
        console.log('[V2_PCM][audio] v2_assistant_audio_delta_received', JSON.stringify({
          responseId: event.responseId ?? null,
          roundId: event.roundId ?? null,
          audioBytes: event.audioBytes,
          sourceType: event.sourceType ?? null,
        }));
        return;
      case 'assistant_response_done': {
        assistantResponseDoneRef.current = true;
        const text = sanitizeTranscriptText(event.assistantText);
        console.log('[V2_PCM][audio] v2_assistant_audio_done_audio_bytes', JSON.stringify({
          responseId: event.responseId ?? null,
          roundId: event.roundId ?? null,
          audioBytes: event.audioBytes,
          hasAudioBase64: Boolean(event.audioBase64),
        }));
        console.log('[V2_PCM][realtime] v2_realtime_response_done_after_user', JSON.stringify({
          responseId: event.responseId ?? null,
          roundId: event.roundId ?? null,
          audioBytes: event.audioBytes,
        }));
        const transcriptId = activeAssistantTranscriptIdRef.current || event.responseId || createTranscriptId('ai');
        activeAssistantTranscriptIdRef.current = transcriptId;
        upsertAiTranscript(transcriptId, text, true);
        const nextTurnCount = stateRef.current.turnCount + 1;
        dispatch({ type: 'SET_TURN_COUNT', turnCount: nextTurnCount });
        void syncProgress(nextTurnCount);

        const pendingTurn =
          event.roundId != null
            ? completedTurnsRef.current.find((item) => item.roundId === event.roundId)
            : [...completedTurnsRef.current].reverse().find((item) => !item.assistantReplyId);
        if (pendingTurn) {
          pendingTurn.assistantReplyId = transcriptId;
          updateReportTurn(pendingTurn.roundId, {
            aiResponseText: text,
            aiResponseAudioBytes: event.audioBytes,
          }, 'v2_report_turn_ai_response_attached');
        }

        if (event.audioBase64) {
          const isInitialGreeting = initialGreetingRequestedRef.current && !initialGreetingDoneRef.current;
          void playAssistantAudio({
            audioBase64: event.audioBase64,
            text,
            isInitialGreeting,
          }).finally(() => {
            if (isInitialGreeting) {
              initialGreetingDoneRef.current = true;
              console.log('[V2_PCM][runtime] v2_initial_greeting_done', scenario.id);
            }
          });
        } else {
          assistantAudioActiveRef.current = false;
          dispatch({ type: 'SET_STAGE_STATE', stage: 'listening' });
          dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
          if (initialGreetingRequestedRef.current && !initialGreetingDoneRef.current) {
            initialGreetingDoneRef.current = true;
            console.log('[V2_PCM][runtime] v2_initial_greeting_done', scenario.id);
            startUserMicDiagnosticWindow();
          }
        }
        return;
      }
      default:
        return;
    }
  }, [playAssistantAudio, recordTimingSinceStart, scenario.id, startRtasrConnectInBackground, syncProgress, triggerRtasrFinish, updateReportTurn, upsertAiTranscript]);

  useEffect(() => {
    void getPcmCaptureSupport()
      .then((support) => {
        if (!mountedRef.current) return;
        setCaptureSupport(support);
        dispatch({
          type: 'SET_TRANSPORT_CAPABILITY',
          ready: support.supported,
          reason: support.supported ? null : support.reason ?? 'pcm_capture_not_supported',
        });
      })
      .catch((error) => {
        if (!mountedRef.current) return;
        setCaptureSupport({
          supported: false,
          platform: 'ios',
          reason: normalizeError(error, 'pcm_capture_support_check_failed'),
        });
        dispatch({
          type: 'SET_TRANSPORT_CAPABILITY',
          ready: false,
          reason: normalizeError(error, 'pcm_capture_support_check_failed'),
        });
      });
  }, [mountedRef]);

  useEffect(() => {
    if (!session) return;
    void refreshCredits().catch((error) => {
      if (!mountedRef.current) return;
      dispatch({
        type: 'SET_ERROR',
        error: createRuntimeError('session', normalizeError(error, '加载 V2 额度失败。')),
      });
    });
  }, [mountedRef, refreshCredits, session]);

  useEffect(() => {
    const chunkSub = addPcmChunkListener((event) => {
      if (!captureRunningRef.current) {
        return;
      }
      const bytes24k = decodeBase64(event.pcmBase64);
      let bytes16k: Uint8Array;
      try {
        bytes16k = resamplePcm16(bytes24k, event.sampleRate, 16000);
      } catch (error) {
        console.log('[V2_PCM][pcm] resample:error', normalizeError(error, 'pcm_resample_failed'));
        return;
      }
      const signal = inspectPcm16Signal(bytes16k);
      let currentChunkAlreadyAttachedToTurn = false;
      let currentChunkAlreadyAppendedToRealtime = false;
      const isAfterGreeting = initialGreetingDoneRef.current;
      const phasePayload = {
        rms: Math.round(signal.rms),
        peak: Math.round(signal.peak),
        zeroRatio: Number(signal.zeroRatio.toFixed(3)),
        assistantAudioActive: assistantAudioActiveRef.current,
        initialGreetingDone: initialGreetingDoneRef.current,
        connectionStatusRef: stateRef.current.connectionStatus,
      };
      if (!isAfterGreeting && !assistantAudioActiveRef.current) {
        beforeGreetingChunksRef.current += 1;
        if (beforeGreetingChunksRef.current === 1 || beforeGreetingChunksRef.current % 25 === 0) {
          console.log('[V2_PCM][pcm] v2_pcm_before_greeting_level', JSON.stringify(phasePayload));
        }
      }
      if (assistantAudioActiveRef.current) {
        duringAssistantPlaybackChunksRef.current += 1;
        if (
          duringAssistantPlaybackChunksRef.current === 1 ||
          duringAssistantPlaybackChunksRef.current % 25 === 0
        ) {
          console.log('[V2_PCM][pcm] v2_pcm_during_assistant_playback_level', JSON.stringify(phasePayload));
        }
      }
      if (isAfterGreeting) {
        chunksAfterGreetingRef.current += 1;
        if (chunksAfterGreetingRef.current === 1 || chunksAfterGreetingRef.current % 25 === 0) {
          console.log('[V2_PCM][pcm] v2_pcm_after_greeting_alive', JSON.stringify({
            chunksAfterGreeting: chunksAfterGreetingRef.current,
            connectionStatusRef: stateRef.current.connectionStatus,
            assistantAudioActive: assistantAudioActiveRef.current,
            isMicMuted: stateRef.current.isMicMuted,
            initialGreetingDone: initialGreetingDoneRef.current,
            bytesLength: bytes24k.byteLength,
            rms: Math.round(signal.rms),
            peak: Math.round(signal.peak),
            zeroRatio: Number(signal.zeroRatio.toFixed(3)),
          }));
          console.log('[V2_PCM][pcm] v2_pcm_after_greeting_level', JSON.stringify(phasePayload));
        }
        const diagnosticWindow = userMicWindowRef.current;
        if (diagnosticWindow?.active) {
          const now = Date.now();
          diagnosticWindow.maxRms = Math.max(diagnosticWindow.maxRms, signal.rms);
          diagnosticWindow.maxPeak = Math.max(diagnosticWindow.maxPeak, signal.peak);
          diagnosticWindow.sumRms += signal.rms;
          diagnosticWindow.chunks += 1;
          if (signal.peak > 120 || signal.rms > 60) {
            diagnosticWindow.voicedLikeChunks += 1;
          }
          if (diagnosticWindow.lastLoggedAt === 0 || now - diagnosticWindow.lastLoggedAt >= 500 || now >= diagnosticWindow.endsAt) {
            diagnosticWindow.lastLoggedAt = now;
            const windowPayload = {
              elapsedMs: Math.max(0, now - diagnosticWindow.startedAt),
              chunks: diagnosticWindow.chunks,
              maxRms: Math.round(diagnosticWindow.maxRms),
              maxPeak: Math.round(diagnosticWindow.maxPeak),
              avgRms: Math.round(diagnosticWindow.sumRms / Math.max(1, diagnosticWindow.chunks)),
              voicedLikeChunks: diagnosticWindow.voicedLikeChunks,
              connectionStatus: stateRef.current.connectionStatus,
              assistantAudioActive: assistantAudioActiveRef.current,
              initialGreetingDone: initialGreetingDoneRef.current,
              isMicMuted: stateRef.current.isMicMuted,
            };
            console.log('[V2_PCM][pcm] v2_after_greeting_listening_window_tick', JSON.stringify(windowPayload));
            console.log('[V2_PCM][pcm] v2_user_mic_window_level', JSON.stringify({
              maxRms: Math.round(diagnosticWindow.maxRms),
              maxPeak: Math.round(diagnosticWindow.maxPeak),
              avgRms: Math.round(diagnosticWindow.sumRms / Math.max(1, diagnosticWindow.chunks)),
              chunks: diagnosticWindow.chunks,
              voicedLikeChunks: diagnosticWindow.voicedLikeChunks,
              thresholdStart: LOCAL_VAD_START_LEVEL,
              thresholdContinue: LOCAL_VAD_CONTINUE_LEVEL,
              stopSilenceMs: LOCAL_VAD_SILENCE_MS,
            }));
          }
          if (now >= diagnosticWindow.endsAt) {
            diagnosticWindow.active = false;
            console.log('[V2_PCM][pcm] v2_after_greeting_listening_window_done', JSON.stringify({
              elapsedMs: Math.max(0, now - diagnosticWindow.startedAt),
              chunks: diagnosticWindow.chunks,
              maxRms: Math.round(diagnosticWindow.maxRms),
              maxPeak: Math.round(diagnosticWindow.maxPeak),
              avgRms: Math.round(diagnosticWindow.sumRms / Math.max(1, diagnosticWindow.chunks)),
              voicedLikeChunks: diagnosticWindow.voicedLikeChunks,
              connectionStatus: stateRef.current.connectionStatus,
              assistantAudioActive: assistantAudioActiveRef.current,
              initialGreetingDone: initialGreetingDoneRef.current,
              isMicMuted: stateRef.current.isMicMuted,
            }));
          }
        }
      }

      if (assistantAudioActiveRef.current && stateRef.current.connectionStatus === 'connected' && !stateRef.current.isMicMuted) {
        const guard = assistantEchoGuardRef.current;
        const now = Date.now();
        const playbackMs = guard ? Math.max(0, now - guard.playbackStartedAt) : 0;
        if (guard) {
          guard.candidateChunks24k.push(bytes24k);
          guard.candidateChunks16k.push(bytes16k);
          trimChunksToWindow(guard.candidateChunks24k, ASSISTANT_BARGE_IN_PREBUFFER_MS);
          trimChunksToWindow(guard.candidateChunks16k, ASSISTANT_BARGE_IN_PREBUFFER_MS);

          if (playbackMs < ASSISTANT_ECHO_BASELINE_MS) {
            guard.baselineRmsSum += signal.rms;
            guard.baselinePeakMax = Math.max(guard.baselinePeakMax, signal.peak);
            guard.baselineChunks += 1;
            assistantBargeInConsecutiveChunksRef.current = 0;
            if (guard.baselineChunks === 1 || guard.baselineChunks % 5 === 0) {
              console.log('[V2_PCM][turn] v2_echo_guard_baseline_collecting', JSON.stringify({
                playbackMs,
                baselineChunks: guard.baselineChunks,
                rms: Math.round(signal.rms),
                peak: Math.round(signal.peak),
              }));
            }
          } else if (!guard.baselineReady) {
            guard.baselineReady = true;
            guard.echoBaselineRms = guard.baselineRmsSum / Math.max(1, guard.baselineChunks);
            guard.echoBaselinePeak = guard.baselinePeakMax;
            console.log('[V2_PCM][turn] v2_echo_guard_baseline_ready', JSON.stringify({
              playbackMs,
              baselineChunks: guard.baselineChunks,
              echoBaselineRms: Math.round(guard.echoBaselineRms),
              echoBaselinePeak: Math.round(guard.echoBaselinePeak),
            }));
          }
        }

        const echoBaselineRms = guard?.echoBaselineRms ?? 0;
        const echoBaselinePeak = guard?.echoBaselinePeak ?? 0;
        const dynamicRmsThreshold = Math.max(ASSISTANT_BARGE_IN_RMS, echoBaselineRms * ASSISTANT_ECHO_RMS_MULTIPLIER);
        const dynamicPeakThreshold = Math.max(ASSISTANT_BARGE_IN_PEAK, echoBaselinePeak * ASSISTANT_ECHO_PEAK_MULTIPLIER);
        const echoGuardReady = Boolean(guard?.baselineReady) && playbackMs >= ASSISTANT_BARGE_IN_MIN_PLAYBACK_MS;
        const rmsPass = echoGuardReady && signal.rms >= dynamicRmsThreshold;
        const peakPass = echoGuardReady && signal.peak >= dynamicPeakThreshold;
        const isBargeInCandidate =
          rmsPass ||
          peakPass;

        if (isBargeInCandidate) {
          assistantBargeInConsecutiveChunksRef.current += 1;
          console.log(`[V2_PCM][turn] ${rmsPass ? 'v2_barge_in_echo_guard_passed_by_rms' : 'v2_barge_in_echo_guard_passed_by_peak'}`, JSON.stringify({
            rms: Math.round(signal.rms),
            peak: Math.round(signal.peak),
            playbackMs,
            consecutiveChunks: assistantBargeInConsecutiveChunksRef.current,
            dynamicRmsThreshold: Math.round(dynamicRmsThreshold),
            dynamicPeakThreshold: Math.round(dynamicPeakThreshold),
            rmsPass,
            peakPass,
          }));
          console.log('[V2_PCM][turn] v2_barge_in_candidate', JSON.stringify({
            rms: Math.round(signal.rms),
            peak: Math.round(signal.peak),
            playbackMs,
            consecutiveChunks: assistantBargeInConsecutiveChunksRef.current,
            dynamicRmsThreshold: Math.round(dynamicRmsThreshold),
            dynamicPeakThreshold: Math.round(dynamicPeakThreshold),
            rmsPass,
            peakPass,
            echoBaselineRms: Math.round(echoBaselineRms),
            echoBaselinePeak: Math.round(echoBaselinePeak),
          }));
        } else {
          assistantBargeInConsecutiveChunksRef.current = 0;
          console.log('[V2_PCM][turn] v2_barge_in_rejected_echo_guard', JSON.stringify({
            reason: !echoGuardReady ? 'baseline_not_ready' : 'below_dynamic_threshold',
            rms: Math.round(signal.rms),
            peak: Math.round(signal.peak),
            playbackMs,
            dynamicRmsThreshold: Math.round(dynamicRmsThreshold),
            dynamicPeakThreshold: Math.round(dynamicPeakThreshold),
            rmsPass,
            peakPass,
            echoBaselineRms: Math.round(echoBaselineRms),
            echoBaselinePeak: Math.round(echoBaselinePeak),
          }));
        }

        if (assistantBargeInConsecutiveChunksRef.current >= ASSISTANT_BARGE_IN_MIN_CHUNKS) {
          const prebuffer24k = guard?.candidateChunks24k ? [...guard.candidateChunks24k] : [bytes24k];
          const prebuffer16k = guard?.candidateChunks16k ? [...guard.candidateChunks16k] : [bytes16k];
          console.log('[V2_PCM][turn] v2_barge_in_detected', JSON.stringify({
            rms: Math.round(signal.rms),
            peak: Math.round(signal.peak),
            consecutiveChunks: assistantBargeInConsecutiveChunksRef.current,
            assistantAudioActive: assistantAudioActiveRef.current,
            connectionStatus: stateRef.current.connectionStatus,
            dynamicRmsThreshold: Math.round(dynamicRmsThreshold),
            dynamicPeakThreshold: Math.round(dynamicPeakThreshold),
          }));
          ttsPlaybackRef.current?.stop('assistant_barge_in');
          assistantAudioActiveRef.current = false;
          assistantEchoGuardRef.current = null;
          dispatch({ type: 'SET_STAGE_STATE', stage: 'listening' });
          dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'user_speaking' });
          console.log('[V2_PCM][turn] v2_barge_in_playback_stopped', JSON.stringify({
            connectionStatus: stateRef.current.connectionStatus,
          }));
          if (assistantResponseDoneRef.current) {
            console.log('[V2_PCM][turn] v2_barge_in_skip_cancel_response_already_done', JSON.stringify({
              responseDone: true,
            }));
          } else {
            const cancelled = clientRef.current?.interrupt() ?? false;
            console.log('[V2_PCM][turn] v2_barge_in_response_cancel_sent', JSON.stringify({
              cancelled,
            }));
          }
          pendingPcm24kRef.current = prebuffer24k;
          pendingPcm16kRef.current = prebuffer16k;
          console.log('[V2_PCM][turn] v2_barge_in_prebuffer_trimmed', JSON.stringify({
            prebufferWindowMs: ASSISTANT_BARGE_IN_PREBUFFER_MS,
            prebuffer24kChunks: pendingPcm24kRef.current.length,
            prebuffer16kChunks: pendingPcm16kRef.current.length,
            prebuffer24kBytes: sumChunkBytes(pendingPcm24kRef.current),
            prebuffer16kBytes: sumChunkBytes(pendingPcm16kRef.current),
          }));
          ensureUserTurnStarted('local_barge_in', {
            level: signal.level,
            rms: signal.rms,
            peak: signal.peak,
          });
          currentChunkAlreadyAttachedToTurn = true;
          try {
            prebuffer24k.forEach((chunk) => clientRef.current?.appendInputAudio(chunk));
            currentChunkAlreadyAppendedToRealtime = true;
          } catch (error) {
            console.log('[V2_PCM][realtime] append:barge_prebuffer:error', normalizeError(error, 'append_barge_prebuffer_failed'));
          }
          assistantBargeInConsecutiveChunksRef.current = 0;
        }
      } else if (!assistantAudioActiveRef.current) {
        assistantBargeInConsecutiveChunksRef.current = 0;
        assistantEchoGuardRef.current = null;
        pendingPcm24kRef.current.push(bytes24k);
        pendingPcm16kRef.current.push(bytes16k);
        trimPendingChunks(pendingPcm24kRef.current);
        trimPendingChunks(pendingPcm16kRef.current);
      }

      const canStreamUserAudio =
        stateRef.current.connectionStatus === 'connected' &&
        !stateRef.current.isMicMuted &&
        !assistantAudioActiveRef.current;

      if (!canStreamUserAudio) {
        console.log('[V2_PCM][pcm] v2_audio_append_skipped_reason', JSON.stringify({
          connectionStatus: stateRef.current.connectionStatus,
          isMicMuted: stateRef.current.isMicMuted,
          assistantAudioActive: assistantAudioActiveRef.current,
        }));
        if (isAfterGreeting) {
          const reason =
            stateRef.current.connectionStatus !== 'connected'
              ? 'connection_not_connected'
              : stateRef.current.isMicMuted
                ? 'mic_muted'
                : 'assistant_audio_active';
          console.log('[V2_PCM][pcm] v2_audio_append_skipped_after_greeting', JSON.stringify({
            reason,
            connectionStatusRef: stateRef.current.connectionStatus,
            assistantAudioActive: assistantAudioActiveRef.current,
            isMicMuted: stateRef.current.isMicMuted,
            initialGreetingDone: initialGreetingDoneRef.current,
            rms: Math.round(signal.rms),
            peak: Math.round(signal.peak),
          }));
        }
        if (stateRef.current.connectionStatus !== 'connected' || stateRef.current.isMicMuted) {
          pendingPcm24kRef.current = [];
          pendingPcm16kRef.current = [];
        }
        return;
      }

      console.log('[V2_PCM][pcm] v2_ws_ready_for_user_audio', JSON.stringify({
        isConnected: clientRef.current?.isConnected() ?? false,
        initialGreetingDone: initialGreetingDoneRef.current,
      }));

      if (isAfterGreeting) {
        const level = signal.level || measurePcm16Level(bytes16k);
        const activeTurn = currentUserTurnRef.current;
        if (
          chunksAfterGreetingRef.current === 1 ||
          chunksAfterGreetingRef.current % 25 === 0 ||
          activeTurn?.source === 'local_vad'
        ) {
          console.log('[V2_PCM][pcm] v2_local_vad_level', JSON.stringify({
            rms: Math.round(signal.rms),
            peak: Math.round(signal.peak),
            speaking: Boolean(activeTurn?.source === 'local_vad') || level >= LOCAL_VAD_START_LEVEL,
            silenceChunks: activeTurn?.silenceChunkCount ?? 0,
            silenceMs: (activeTurn?.silenceChunkCount ?? 0) * PCM_CHUNK_MS,
            voicedChunks: activeTurn?.chunks24k.length ?? 0,
            thresholdStart: LOCAL_VAD_START_LEVEL,
            thresholdContinue: LOCAL_VAD_CONTINUE_LEVEL,
            stopSilenceMs: LOCAL_VAD_SILENCE_MS,
          }));
        }
        if (!activeTurn && level >= LOCAL_VAD_START_LEVEL) {
          ensureUserTurnStarted('local_vad', {
            level,
            rms: signal.rms,
            peak: signal.peak,
          });
        } else if (activeTurn?.source === 'local_vad') {
          const shouldCountSilence = level < LOCAL_VAD_CONTINUE_LEVEL;
          activeTurn.silenceChunkCount = shouldCountSilence ? activeTurn.silenceChunkCount + 1 : 0;
          if (
            activeTurn.chunks24k.length >= LOCAL_VAD_MIN_CHUNKS &&
            activeTurn.silenceChunkCount >= LOCAL_VAD_SILENCE_CHUNKS
          ) {
            finalizeUserTurn('local_vad', {
              level,
              rms: signal.rms,
              peak: signal.peak,
            }, 'local_vad_silence_chunks');
          }
        }
      }

      const currentTurn = currentUserTurnRef.current;
      if (currentTurn) {
        if (!currentChunkAlreadyAttachedToTurn) {
          currentTurn.chunks24k.push(bytes24k);
          currentTurn.chunks16k.push(bytes16k);
          currentTurn.totalAudioChunks16k += 1;
          currentTurn.totalAudioBytes16k += bytes16k.byteLength;
          if (currentTurn.postRollPending) {
            currentTurn.postRollChunks24k += 1;
            console.log('[V2_PCM][turn] v2_turn_post_roll_chunk_attached', JSON.stringify({
              roundId: currentTurn.roundId,
              postRollChunks24k: currentTurn.postRollChunks24k,
              chunks24k: currentTurn.chunks24k.length,
              chunks16k: currentTurn.chunks16k.length,
              audio16kBytes: currentTurn.totalAudioBytes16k,
              postRollElapsedMs: currentTurn.postRollStartedAt ? Math.max(0, Date.now() - currentTurn.postRollStartedAt) : null,
            }));
          }
        }
        console.log('[V2_PCM][turn] v2_turn_audio_chunk_received', JSON.stringify({
          roundId: currentTurn.roundId,
          chunks24k: currentTurn.chunks24k.length,
          chunks16k: currentTurn.totalAudioChunks16k,
          currentTurnExists: true,
          rtasrReady: currentTurn.rtasrState === 'connected',
          rtasrConnecting: currentTurn.rtasrState === 'connecting',
          audioBytes24k: sumChunkBytes(currentTurn.chunks24k),
          audioBytes16k: currentTurn.totalAudioBytes16k,
          rms: Math.round(signal.rms),
          peak: Math.round(signal.peak),
        }));
        if (currentChunkAlreadyAttachedToTurn) {
          console.log('[V2_PCM][turn] v2_barge_in_prebuffer_rejected_echo', JSON.stringify({
            roundId: currentTurn.roundId,
            reason: 'current_chunk_already_in_trimmed_barge_in_prebuffer',
          }));
        } else if (currentTurn.rtasrState === 'connected') {
          currentTurn.rtasrClient?.appendPcmChunk(bytes16k);
          currentTurn.rtasrSentChunks += 1;
          currentTurn.rtasrSentBytes += bytes16k.byteLength;
          console.log('[V2_PCM][rtasr] v2_turn_audio_chunk_sent_to_rtasr', JSON.stringify({
            roundId: currentTurn.roundId,
            sentChunks: currentTurn.rtasrSentChunks,
            sentBytes: currentTurn.rtasrSentBytes,
            rtasrOpen: true,
            source: 'live',
          }));
          console.log('[V2_PCM][rtasr] v2_rtasr_audio_sent', JSON.stringify({
            roundId: currentTurn.roundId,
            bytes: bytes16k.byteLength,
            source: 'live',
          }));
        } else {
          currentTurn.pendingRtasrChunks16k.push(bytes16k);
          console.log('[V2_PCM][rtasr] v2_turn_audio_chunk_buffered_waiting_rtasr', JSON.stringify({
            roundId: currentTurn.roundId,
            pending16kChunks: currentTurn.pendingRtasrChunks16k.length,
            pending16kBytes: sumChunkBytes(currentTurn.pendingRtasrChunks16k),
          }));
        }
        const shouldCountSilence = signal.level < LOCAL_VAD_CONTINUE_LEVEL;
        if (!shouldCountSilence) {
          currentTurn.lastVoiceAt = Date.now();
          if (currentTurn.silenceStopTimeout) {
            clearTimeout(currentTurn.silenceStopTimeout);
          }
          currentTurn.silenceStopTimeout = setTimeout(() => {
            if (currentUserTurnRef.current?.roundId !== currentTurn.roundId || currentTurn.stopRequestedAt != null) return;
            console.log('[V2_PCM][turn] v2_user_segment_silence_stop', JSON.stringify({
              roundId: currentTurn.roundId,
              source: currentTurn.source,
              silenceMs: USER_TURN_LAST_VOICE_STOP_MS,
              lastVoiceAgeMs: Math.max(0, Date.now() - currentTurn.lastVoiceAt),
            }));
            finalizeUserTurnRef.current?.('local_vad', {
              level: signal.level,
              rms: signal.rms,
              peak: signal.peak,
            }, 'last_voice_timeout');
          }, USER_TURN_LAST_VOICE_STOP_MS);
        }
        currentTurn.silenceChunkCount = shouldCountSilence ? currentTurn.silenceChunkCount + 1 : 0;
        const localStopReady =
          currentTurn.totalAudioChunks16k >= LOCAL_VAD_MIN_CHUNKS &&
          currentTurn.silenceChunkCount >= LOCAL_VAD_SILENCE_CHUNKS &&
          currentTurn.stopRequestedAt == null;
        if (localStopReady) {
          console.log('[V2_PCM][turn] v2_local_vad_stop_fallback_after_realtime_start', JSON.stringify({
            roundId: currentTurn.roundId,
            source: currentTurn.source,
            silenceChunks: currentTurn.silenceChunkCount,
            totalAudioChunks16k: currentTurn.totalAudioChunks16k,
          }));
          finalizeUserTurn('local_vad', {
            level: signal.level,
            rms: signal.rms,
            peak: signal.peak,
          }, 'silence_chunks');
        }
      }

      try {
        if (!currentChunkAlreadyAppendedToRealtime) {
          clientRef.current?.appendInputAudio(bytes24k);
        }
        if (isAfterGreeting) {
          appendedAfterGreetingRef.current += 1;
          if (appendedAfterGreetingRef.current === 1 || appendedAfterGreetingRef.current % 25 === 0) {
          console.log('[V2_PCM][realtime] v2_realtime_audio_append_after_greeting', JSON.stringify({
              bytesLength: bytes24k.byteLength,
              rms: Math.round(signal.rms),
              peak: Math.round(signal.peak),
              chunksSentAfterGreeting: appendedAfterGreetingRef.current,
            }));
          }
        }
      } catch (error) {
        console.log('[V2_PCM][realtime] append:error', normalizeError(error, 'append_input_audio_failed'));
      }
    });

    const statsSub = addPcmCaptureStatsListener((event) => {
      console.log('[V2_PCM][pcm] stats', JSON.stringify(event));
    });

    return () => {
      chunkSub?.remove?.();
      statsSub?.remove?.();
    };
  }, []);

  const disconnectRuntime = useCallback(async () => {
    captureRunningRef.current = false;
    assistantResponseDoneRef.current = false;
    assistantBargeInConsecutiveChunksRef.current = 0;
    assistantEchoGuardRef.current = null;
    currentAssistantPlaybackTextRef.current = '';
    beforeGreetingChunksRef.current = 0;
    duringAssistantPlaybackChunksRef.current = 0;
    chunksAfterGreetingRef.current = 0;
    appendedAfterGreetingRef.current = 0;
    userMicWindowRef.current = null;
    clearFinalizeTurnTimeout();
    try {
      await stopPcmCapture();
    } catch {
      // ignore cleanup failure
    }
    currentUserTurnRef.current?.rtasrClient?.close();
    completedTurnsRef.current.forEach((turn) => {
      clearTurnStopTimers(turn);
      turn.rtasrClient?.close();
    });
    clientRef.current?.close();
    clientRef.current = null;
    assistantAudioActiveRef.current = false;
    clearCurrentTurn();
    ttsPlaybackRef.current?.stop();
  }, [clearCurrentTurn, clearFinalizeTurnTimeout, clearTurnStopTimers]);

  const triggerInitialGreeting = useCallback(() => {
    if (!clientRef.current || !clientRef.current.isConnected()) return;
    if (initialGreetingRequestedRef.current) return;
    initialGreetingRequestedRef.current = true;
    recordTimingSinceStart('initialGreetingSentMs');
    console.log('[V2_PCM][runtime] v2_initial_greeting_create_start', scenario.id);
    clientRef.current.createResponse({
      instructions: buildOpeningInstructions(scenario),
      metadata: {
        mode: 'speaking_v2_pcm',
        turn: 'opening',
        scenarioId: scenario.id,
      },
    });
    console.log('[V2_PCM][runtime] v2_initial_greeting_create_sent', scenario.id);
  }, [recordTimingSinceStart, scenario]);

  const clearError = useCallback(() => {
    dispatch({ type: 'SET_ERROR', error: null });
    if (stateRef.current.connectionStatus === 'error' && !stateRef.current.sessionId) {
      dispatch({ type: 'SET_CONNECTION_STATUS', status: 'idle' });
    }
  }, []);

  const endCall = useCallback(
    async (status: 'completed' | 'aborted' = 'completed') => {
      dispatch({ type: 'SET_CONNECTION_STATUS', status: 'ending' });
      dispatch({ type: 'SET_STAGE_STATE', stage: 'idle' });
      dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
      resetDurationTicker();

      await disconnectRuntime();

      const reviewPayload = await buildReviewPayload({
        session,
        scenario,
        transcript: stateRef.current.transcript,
        turnCount: stateRef.current.turnCount,
        timing: timingRef.current,
        reportTurns: [...reportTurnsRef.current.values()],
      });

      const currentSessionId = stateRef.current.sessionId;
      if (session && currentSessionId) {
        try {
          await completeSpeakingSession(session, currentSessionId, {
            status,
            transcriptJson: stateRef.current.transcript.map((item) => ({
              id: item.id,
              role: item.role === 'ai' ? 'assistant' : 'user',
              text: item.text,
              isFinal: item.isFinal,
              timestamp: item.timestamp,
            })),
            scoreJson: reviewPayload,
          });
        } catch (error) {
          dispatch({
            type: 'SET_PENDING_COMPLETION',
            status,
            payload: reviewPayload,
            failed: true,
          });
          dispatch({
            type: 'SET_ERROR',
            error: createRuntimeError('complete', normalizeError(error, '结束实时通话失败。')),
          });
          dispatch({ type: 'SET_CONNECTION_STATUS', status: 'error' });
          return;
        }
      }

      dispatch({ type: 'SET_REVIEW_PAYLOAD', payload: reviewPayload });
      dispatch({
        type: 'SET_PENDING_COMPLETION',
        status: null,
        payload: null,
        failed: false,
      });
      dispatch({ type: 'SET_SESSION_ID', sessionId: null });
      dispatch({ type: 'SET_CONNECTION_STATUS', status: 'completed' });
      dispatch({ type: 'SET_STAGE_STATE', stage: 'idle' });
      dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
      activeAssistantTranscriptIdRef.current = null;
      initialGreetingRequestedRef.current = false;
      initialGreetingDoneRef.current = false;
      callStartedAtRef.current = null;
      connectionStartedAtRef.current = null;
      progressSyncRef.current.lastSyncedTurnCount = 0;
    },
    [disconnectRuntime, resetDurationTicker, scenario, session],
  );

  const retryComplete = useCallback(async () => {
    const sessionId = stateRef.current.sessionId;
    const status = stateRef.current.pendingCompletionStatus;
    const reviewPayload = stateRef.current.pendingCompletionPayload;
    if (!session || !sessionId || !status || !reviewPayload) {
      return;
    }

    dispatch({ type: 'SET_ERROR', error: null });
    dispatch({ type: 'SET_CONNECTION_STATUS', status: 'ending' });
    try {
      await completeSpeakingSession(session, sessionId, {
        status,
        transcriptJson: stateRef.current.transcript,
        scoreJson: reviewPayload,
      });
      dispatch({ type: 'SET_REVIEW_PAYLOAD', payload: reviewPayload });
      dispatch({
        type: 'SET_PENDING_COMPLETION',
        status: null,
        payload: null,
        failed: false,
      });
      dispatch({ type: 'SET_SESSION_ID', sessionId: null });
      dispatch({ type: 'SET_CONNECTION_STATUS', status: 'completed' });
    } catch (error) {
      dispatch({
        type: 'SET_ERROR',
        error: createRuntimeError('complete', normalizeError(error, '结束实时通话失败。')),
      });
      dispatch({ type: 'SET_CONNECTION_STATUS', status: 'error' });
    }
  }, [session]);

  const startCall = useCallback(async () => {
    if (!session) {
      dispatch({ type: 'SET_ERROR', error: createRuntimeError('session', '请先登录后再开始 V2 通话。') });
      return;
    }
    if (stateRef.current.connectionStatus === 'starting' || stateRef.current.connectionStatus === 'connecting') {
      return;
    }
    if (captureSupport && !captureSupport.supported) {
      dispatch({ type: 'SET_CONNECTION_STATUS', status: 'error' });
      dispatch({
        type: 'SET_ERROR',
        error: createRuntimeError('transport', captureSupport.reason || '当前设备无法启动 PCM 采集。'),
      });
      return;
    }

    await disconnectRuntime().catch(() => undefined);
    dispatch({ type: 'RESET' });
    dispatch({ type: 'SET_ERROR', error: null });
    dispatch({ type: 'SET_CONNECTION_STATUS', status: 'starting' });
    dispatch({ type: 'SET_STAGE_STATE', stage: 'idle' });
    dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
    dispatch({ type: 'SET_REVIEW_PAYLOAD', payload: null });

    timingRef.current = createEmptyTiming();
    connectionStartedAtRef.current = Date.now();
    callStartedAtRef.current = null;
    initialGreetingRequestedRef.current = false;
    initialGreetingDoneRef.current = false;
    assistantResponseDoneRef.current = false;
    assistantBargeInConsecutiveChunksRef.current = 0;
    assistantEchoGuardRef.current = null;
    currentAssistantPlaybackTextRef.current = '';
    beforeGreetingChunksRef.current = 0;
    duringAssistantPlaybackChunksRef.current = 0;
    chunksAfterGreetingRef.current = 0;
    appendedAfterGreetingRef.current = 0;
    userMicWindowRef.current = null;
    completedTurnsRef.current = [];
    reportTurnsRef.current = new Map();
    clearCurrentTurn();
    roundIdRef.current = 0;
    progressSyncRef.current.lastSyncedTurnCount = 0;
    beginTimingStep('session');
    console.log('[V2_PCM][runtime] startCall:start', scenario.id);

    try {
      const sessionResponse = await createSpeakingSession(session, {
        scenarioId: scenario.id,
        mode: scenario.id === 'free-chat' ? 'free_chat' : 'scenario',
      });
      recordTimingDuration('sessionMs', 'session');
      dispatch({ type: 'SET_SESSION_ID', sessionId: sessionResponse.sessionId });

      const client = new OpenAiRealtimeWsClient({
        session,
        scenario,
        onEvent: handleRealtimeEvent,
        turnDetection: {
          type: 'server_vad',
          threshold: 0.72,
          silence_duration_ms: 900,
          prefix_padding_ms: 260,
          create_response: false,
          interrupt_response: false,
        },
      });
      clientRef.current = client;

      dispatch({ type: 'SET_CONNECTION_STATUS', status: 'connecting' });
      await client.connect();
      recordTimingSinceStart('sessionUpdateSentMs');

      beginTimingStep('pcm_start');
      const startResult = await startPcmCapture({
        sampleRate: PCM_SAMPLE_RATE,
        channels: PCM_CHANNELS,
        chunkMs: PCM_CHUNK_MS,
      });
      if (!startResult.ok) {
        throw new Error(startResult.reason || 'pcm_capture_start_failed');
      }
      recordTimingDuration('micPermissionMs', 'pcm_start');
      captureRunningRef.current = true;
      callStartedAtRef.current = Date.now();
      startDurationTicker();

      dispatch({ type: 'SET_CONNECTION_STATUS', status: 'connected' });
      dispatch({ type: 'SET_STAGE_STATE', stage: 'idle' });
      dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
      triggerInitialGreeting();
    } catch (error) {
      await disconnectRuntime().catch(() => undefined);
      dispatch({ type: 'SET_CONNECTION_STATUS', status: 'error' });
      dispatch({
        type: 'SET_ERROR',
        error: createRuntimeError('transport', normalizeError(error, '启动 V2-PCM 失败。')),
      });
    }
  }, [beginTimingStep, captureSupport, clearCurrentTurn, disconnectRuntime, handleRealtimeEvent, recordTimingDuration, recordTimingSinceStart, scenario, session, startDurationTicker, triggerInitialGreeting]);

  const toggleMute = useCallback(() => {
    dispatch({ type: 'SET_MIC_MUTED', muted: !stateRef.current.isMicMuted });
  }, []);

  const toggleSpeaker = useCallback(() => {
    dispatch({ type: 'SET_SPEAKER_ON', enabled: !stateRef.current.isSpeakerOn });
  }, []);

  const interruptAssistant = useCallback(() => {
    if (!assistantAudioActiveRef.current) {
      dispatch({ type: 'SET_STAGE_STATE', stage: 'listening' });
      dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'user_speaking' });
      return;
    }
    ttsPlaybackRef.current?.stop('assistant_interrupted');
    assistantAudioActiveRef.current = false;
    if (!assistantResponseDoneRef.current) {
      clientRef.current?.interrupt();
    }
    dispatch({ type: 'SET_STAGE_STATE', stage: 'listening' });
    dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'user_speaking' });
  }, []);

  useEffect(() => {
    if (state.callDurationSec < MAX_CALL_DURATION_SEC) return;
    if (!state.sessionId) return;
    dispatch({
      type: 'SET_ERROR',
      error: createRuntimeError('call', '本次 V2 通话已达到 8 分钟上限，系统将自动结束。'),
    });
    void endCall('completed');
  }, [endCall, state.callDurationSec, state.sessionId]);

  useEffect(() => {
    return () => {
      resetDurationTicker();
      void disconnectRuntime();
      ttsPlaybackRef.current?.remove();
    };
  }, [disconnectRuntime, resetDurationTicker]);

  const statusTitle = useMemo(() => {
    if (state.error) return '连接异常';
    if (state.connectionStatus === 'ending') return '正在整理本次表现';
    if (state.connectionStatus === 'starting' || state.connectionStatus === 'connecting' || state.connectionStatus === 'reconnecting') {
      return '正在连接';
    }
    if (state.connectionStatus === 'connected' && initialGreetingRequestedRef.current && !initialGreetingDoneRef.current && !assistantAudioActiveRef.current) {
      return 'AI 正在准备';
    }
    if (state.liveStageState === 'thinking') return 'AI 正在回应';
    if (state.liveStageState === 'ai_speaking' || assistantAudioActiveRef.current) return 'AI 正在回应';
    if (state.connectionStatus === 'connected' && state.turnCount > 0) return '继续说';
    if (state.connectionStatus === 'connected') return '我在听';
    return '准备好了';
  }, [state.connectionStatus, state.error, state.liveStageState, state.turnCount]);

  const statusSubtitle = useMemo(() => {
    if (state.error) return state.error.message;
    if (state.connectionStatus === 'ending') return '正在生成评分、纠音和复盘';
    if (state.connectionStatus === 'starting' || state.connectionStatus === 'connecting' || state.connectionStatus === 'reconnecting') {
      return '正在准备你的 AI 练习伙伴';
    }
    if (state.connectionStatus === 'connected' && initialGreetingRequestedRef.current && !initialGreetingDoneRef.current && !assistantAudioActiveRef.current) {
      return '马上开始本轮对话';
    }
    if (state.liveStageState === 'thinking') return '听完后继续接着说';
    if (state.liveStageState === 'ai_speaking' || assistantAudioActiveRef.current) return '听完后继续接着说';
    if (state.connectionStatus === 'connected' && state.turnCount > 0) return '继续说，我在听';
    if (state.connectionStatus === 'connected') return '你可以自然开口说英语';
    return '点击麦克风或直接开始练习';
  }, [state.connectionStatus, state.error, state.liveStageState, state.turnCount]);

  const reportStatus = useMemo(() => {
    if (state.connectionStatus === 'ending') return 'generating';
    if (state.reviewPayload) return 'ready';
    if (state.pendingCompletionStatus && state.completionFailed) return 'failed';
    return 'idle';
  }, [state.completionFailed, state.connectionStatus, state.pendingCompletionStatus, state.reviewPayload]);

  return {
    state,
    captureSupport,
    stageLabel: statusTitle,
    connectionStatus: state.connectionStatus,
    stageState: state.liveStageState,
    statusTitle,
    statusSubtitle,
    isConnecting: state.connectionStatus === 'starting' || state.connectionStatus === 'connecting' || state.connectionStatus === 'reconnecting',
    isConnected: state.connectionStatus === 'connected',
    isListening: state.connectionStatus === 'connected' && (state.liveStageState === 'idle' || state.liveStageState === 'user_speaking'),
    isAssistantSpeaking: state.liveStageState === 'ai_speaking' || assistantAudioActiveRef.current,
    isEnding: state.connectionStatus === 'ending',
    error: state.error,
    callDurationSec: state.callDurationSec,
    remainingDurationSec: state.remainingDurationSec,
    turnCount: state.turnCount,
    reviewPayload: state.reviewPayload,
    reportStatus,
    startCall,
    endCall,
    retryComplete,
    clearError,
    toggleMute,
    toggleSpeaker,
    interruptAssistant,
    refreshCredits,
  };
}
