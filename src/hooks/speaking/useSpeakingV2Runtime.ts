import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { AppState } from 'react-native';

import type { Scenario } from '@/data/scenarios';
import type { CoachProfile } from '@/data/coachProfiles';
import {
  completeSpeakingSession,
  createSpeakingRealtimeCall,
  createSpeakingRealtimeSession,
  fetchSpeakingCredits,
  getSpeakingRealtimeToken,
  scoreSpeakingMessage,
  updateSpeakingSessionProgress,
} from '@/services/api/speakingPractice';
import {
  applySpeakingRealtimeAudioRoute,
  resetSpeakingRealtimeAudioRoute,
} from '@/services/audio/speakingRealtimeAudioRoute';
import { SpeakingRealtimeClient } from '@/services/realtime/speakingRealtimeClient';
import { pickCoachSfxCue } from '@/services/audio/coachSfx';
import type { StoredSession } from '@/types/auth';
import type {
  SpeakingV2MetricScore,
  SpeakingV2ReplayItem,
  SpeakingV2ReviewPayload,
  SpeakingV2ReviewTiming,
  SpeakingV2RuntimeError,
  SpeakingV2TranscriptItem,
  SpeakingV2TransportEvent,
} from '@/types/speakingV2';

import { initialSpeakingV2State, speakingV2Reducer } from './speakingV2Reducer';

const MAX_CALL_DURATION_SEC = 8 * 60;

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

function createUnavailableMetric(reason: string): SpeakingV2MetricScore {
  return {
    value: null,
    reason,
    source: 'unavailable',
  };
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function averageScore(values: Array<number | null | undefined>) {
  const numeric = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!numeric.length) return null;
  return clampScore(numeric.reduce((sum, value) => sum + value, 0) / numeric.length);
}

function sanitizeTranscriptText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[.!?,;:]+/, '')
    .trim();
}

function isMeaningfulTranscriptText(text: string): boolean {
  if (!text) return false;
  if (!/[A-Za-z0-9]/.test(text)) return false;
  if (/^(undefined|null|n\/a)$/i.test(text)) return false;
  return true;
}

function isReasonableAiReportText(text: string): boolean {
  if (!isMeaningfulTranscriptText(text)) return false;
  if (/!\.|\.!|\?,|,\?|\.{3,}|!{2,}|\?{2,}/.test(text)) return false;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount < 2 && text.length < 10) return false;
  return true;
}

function deriveGrammarMetricFromScore(score: {
  overall: number;
  accuracy?: number;
  vocabulary: number;
  errors?: Array<unknown>;
  correction?: { type?: 'error' | 'ok' | 'tip' };
}): number {
  const errorPenalty = Math.min(18, (score.errors?.length ?? 0) * 6);
  const correctionPenalty = score.correction?.type === 'error' ? 8 : score.correction?.type === 'tip' ? 4 : 0;
  return clampScore(score.overall * 0.38 + (score.accuracy ?? score.overall) * 0.4 + score.vocabulary * 0.22 - errorPenalty - correctionPenalty);
}

function deriveTaskCompletionMetricFromScore(score: {
  overall: number;
  accuracy: number;
  vocabulary: number;
}): number {
  return clampScore(score.overall * 0.52 + score.accuracy * 0.24 + score.vocabulary * 0.24);
}

function deriveNaturalnessMetricFromScore(score: {
  fluency: number;
  accuracy: number;
  vocabulary: number;
  correction?: { type?: 'error' | 'ok' | 'tip' };
}): number {
  const correctionPenalty = score.correction?.type === 'error' ? 8 : score.correction?.type === 'tip' ? 3 : 0;
  return clampScore(score.fluency * 0.45 + score.vocabulary * 0.35 + score.accuracy * 0.2 - correctionPenalty);
}

type V2ConversationTurn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  responseId?: string;
  itemId?: string;
  startedAt?: number;
  completedAt?: number;
  source:
    | 'user_turn_pending'
    | 'user_transcript_done'
    | 'user_transcript_final'
    | 'assistant_delta_accumulator'
    | 'assistant_transcript_done'
    | 'assistant_response_done_fallback';
};

type V2AssistantTranscriptAccumulator = {
  responseId: string;
  text: string;
  startedAt: number;
  completedAt?: number;
  transcriptDoneReceived: boolean;
  finalized: boolean;
};

function isCompleteSentenceLike(text: string): boolean {
  return /[.!?。！？]$/.test(text.trim());
}

function isSuspiciousShortAssistantText(text: string): boolean {
  const normalized = sanitizeTranscriptText(text);
  return normalized.length > 0 && normalized.length < 8 && !isCompleteSentenceLike(normalized);
}

function getReportDedupeText(text: string): string {
  return sanitizeTranscriptText(text).toLowerCase();
}

function finalizeReportTurns(turns: V2ConversationTurn[]): V2ConversationTurn[] {
  console.log('[V2][runtime] v2_realtime_report_turns_before_finalize', JSON.stringify({
    count: turns.length,
    userTurns: turns.filter((turn) => turn.role === 'user').length,
    assistantTurns: turns.filter((turn) => turn.role === 'assistant').length,
  }));

  const deduped: V2ConversationTurn[] = [];
  const seenUserKeys = new Set<string>();
  const seenAssistantKeys = new Set<string>();

  for (const turn of [...turns].sort((a, b) => (a.completedAt ?? a.startedAt ?? 0) - (b.completedAt ?? b.startedAt ?? 0))) {
    const text = sanitizeTranscriptText(turn.text);
    if (!text) continue;
    if (turn.role === 'user') {
      const key = turn.itemId ? `user:${turn.itemId}` : `user:text:${getReportDedupeText(text)}`;
      if (seenUserKeys.has(key)) continue;
      seenUserKeys.add(key);
      deduped.push({ ...turn, text });
      continue;
    }

    const key = turn.responseId ? `assistant:${turn.responseId}` : `assistant:text:${getReportDedupeText(text)}`;
    if (seenAssistantKeys.has(key)) continue;
    seenAssistantKeys.add(key);
    deduped.push({ ...turn, text });
  }

  console.log('[V2][runtime] v2_realtime_report_turns_after_dedupe', JSON.stringify({
    count: deduped.length,
    userTurns: deduped.filter((turn) => turn.role === 'user').length,
    assistantTurns: deduped.filter((turn) => turn.role === 'assistant').length,
  }));

  const assistantTurns = deduped.filter((turn) => turn.role === 'assistant');
  const hasNonShortAssistant = assistantTurns.some((turn) => !isSuspiciousShortAssistantText(turn.text));
  const filtered = deduped.filter((turn) => {
    if (turn.role !== 'assistant') return true;
    const suspicious = isSuspiciousShortAssistantText(turn.text);
    if (suspicious) {
      console.log('[V2][runtime] v2_realtime_report_ai_turn_suspicious_short', JSON.stringify({
        responseId: turn.responseId ?? null,
        id: turn.id,
        text: turn.text,
        kept: !hasNonShortAssistant,
      }));
    }
    return !suspicious || !hasNonShortAssistant;
  });

  const sorted = filtered.sort((a, b) => (a.completedAt ?? a.startedAt ?? 0) - (b.completedAt ?? b.startedAt ?? 0));
  console.log('[V2][runtime] v2_realtime_report_turns_sorted', JSON.stringify({
    count: sorted.length,
    roles: sorted.map((turn) => turn.role),
  }));
  return sorted;
}

function buildTranscriptJsonFromTurns(
  turns: V2ConversationTurn[],
  transcript: SpeakingV2TranscriptItem[],
) {
  const transcriptMap = new Map<string, SpeakingV2TranscriptItem>();
  for (const turn of turns) {
    const text = sanitizeTranscriptText(turn.text);
    if (!text) continue;
    transcriptMap.set(turn.id, {
      id: turn.id,
      role: turn.role === 'assistant' ? 'ai' : 'user',
      text,
      isFinal: true,
      timestamp: turn.completedAt ?? turn.startedAt ?? Date.now(),
    });
  }
  for (const item of transcript) {
    const text = sanitizeTranscriptText(item.text);
    if (!text) continue;
    if (!transcriptMap.has(item.id)) {
      transcriptMap.set(item.id, {
        ...item,
        text,
      });
    }
  }
  return [...transcriptMap.values()].sort((a, b) => a.timestamp - b.timestamp).map((item) => ({
    id: item.id,
    role: item.role === 'ai' ? 'assistant' : 'user',
    text: item.text,
    isFinal: item.isFinal,
    timestamp: item.timestamp,
  }));
}

function buildV2SessionInstructions(scenario: Scenario, coachProfile: CoachProfile): string {
  return [
    scenario.systemPrompt,
    'Important rules for EchoLingo Speaking V2 realtime voice conversation:',
    `Stay strictly inside the scenario "${scenario.name}".`,
    `You are ${scenario.aiName}, acting as ${scenario.aiRole}.`,
    'Always reply in English only.',
    'Keep replies short, natural, and conversational.',
    'Ask one simple follow-up question at a time.',
    'Do not switch topics unless the learner clearly does so.',
    'If the learner is unclear, ask one short clarification question instead of giving a lecture.',
    'Start the conversation naturally when requested.',
    `Coach profile: ${coachProfile.name}.`,
    `Coach accent hint: ${coachProfile.accentHint}.`,
    `Coach profanity level: ${coachProfile.profanityLevel}.`,
    coachProfile.instructions,
  ].join(' ');
}

function buildV2OpeningResponseRequest(scenario: Scenario) {
  return {
    instructions: [
      'Start the scenario now.',
      `You are ${scenario.aiName}, the ${scenario.aiRole}.`,
      `Open with a short spoken line very close to: "${scenario.openingLine}".`,
      'Keep it warm, natural, and under two short sentences.',
    ].join(' '),
    metadata: {
      mode: 'speaking_v2_realtime',
      turn: 'opening',
      scenarioId: scenario.id,
    },
  };
}

function buildV2InputTranscriptionPrompt(scenario: Scenario) {
  return [
    `The speaker is practicing English in the EchoLingo scenario "${scenario.name}".`,
    `Scenario opening line: "${scenario.openingLine}".`,
    `Scenario goal: ${scenario.description}.`,
    'Transcribe only the English words the user says.',
    'Do not translate.',
    'Do not force the transcript into a cafe, coffee ordering, or any unrelated scenario.',
    'If the audio is unclear, keep the closest English transcription.',
  ].join(' ');
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

async function buildReviewPayload(params: {
  session: StoredSession | null;
  scenario: Scenario;
  transcript: SpeakingV2TranscriptItem[];
  conversationTurns: V2ConversationTurn[];
  turnCount: number;
  interruptCount: number;
  transportReady: boolean;
  timing: SpeakingV2ReviewTiming;
}): Promise<SpeakingV2ReviewPayload> {
  const { scenario, session, transcript, conversationTurns, turnCount, interruptCount, transportReady, timing } = params;
  const mergedTranscriptMap = new Map<string, SpeakingV2TranscriptItem>();

  for (const turn of conversationTurns) {
    const text = sanitizeTranscriptText(turn.text);
    if (!text) continue;
    mergedTranscriptMap.set(turn.id, {
      id: turn.id,
      role: turn.role === 'assistant' ? 'ai' : 'user',
      text,
      isFinal: true,
      timestamp: turn.completedAt ?? turn.startedAt ?? Date.now(),
    });
  }

  const hasConversationUserTurn = [...mergedTranscriptMap.values()].some((item) => item.role === 'user');
  for (const item of transcript) {
    const text = sanitizeTranscriptText(item.text);
    if (!text) continue;
    if (mergedTranscriptMap.has(item.id)) continue;
    if (!hasConversationUserTurn || item.role !== 'user') {
      mergedTranscriptMap.set(item.id, {
        ...item,
        text,
      });
    }
  }

  const cleanedTranscript = [...mergedTranscriptMap.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((item) => ({
      ...item,
      text: sanitizeTranscriptText(item.text),
    }))
    .filter((item) =>
      item.role === 'ai' ? isReasonableAiReportText(item.text) : isMeaningfulTranscriptText(item.text),
    );
  const userTurns = cleanedTranscript.filter((item) => item.role === 'user');
  const aiTurns = cleanedTranscript.filter((item) => item.role === 'ai');
  const totalTurns = turnCount > 0 ? turnCount : Math.max(userTurns.length, aiTurns.length);

  const replayItems: SpeakingV2ReplayItem[] = cleanedTranscript.map((item) => ({
    id: item.id,
    role: item.role,
    text: item.text,
  }));

  if (!session || userTurns.length === 0) {
    if (userTurns.length === 0) {
      console.log('[V2][runtime] v2_realtime_report_missing_user_turns', JSON.stringify({
        transcriptCount: transcript.length,
        conversationTurnCount: conversationTurns.length,
        transportReady,
      }));
    }
    console.log('[V2][runtime] v2_realtime_report_missing_turn', JSON.stringify({
      hasSession: Boolean(session),
      transportReady,
      transcriptCount: cleanedTranscript.length,
      userTurnCount: userTurns.length,
      aiTurnCount: aiTurns.length,
    }));
    return {
      reviewVersion: 'v2',
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      userTurnCount: userTurns.length,
      aiTurnCount: aiTurns.length,
      totalTurns,
      interruptCount,
      userTranscriptSummary:
        userTurns.map((item) => item.text).join(' ').slice(0, 320) || '本轮用户发言较少。',
      aiTranscriptSummary:
        aiTurns.map((item) => item.text).join(' ').slice(0, 320) || '本轮未记录到 AI 回应文本。',
      metrics: {
        overall: createUnavailableMetric('本轮表达内容较少，建议再练一轮获得更完整反馈。'),
        fluency: createUnavailableMetric('本轮表达内容较少，建议补充完整句表达。'),
        grammar: createUnavailableMetric('本轮表达内容较少，建议继续完成一轮对话。'),
        taskCompletion: createUnavailableMetric('本轮任务信息较少，建议再完成一轮场景练习。'),
        naturalness: createUnavailableMetric('本轮表达内容较少，建议继续练习自然表达。'),
      },
      aiCoachFeedback: '根据本轮对话表现，建议下一轮用完整句表达核心需求，并补充一到两个细节。',
      replayItems,
      userTranscriptAvailable: false,
      timing,
      note: '根据本轮对话表现，为你整理了表达反馈。',
    };
  }

  const userScores = await Promise.all(
    userTurns.map(async (item, index) => {
      const assistantPreviousMessage = [...cleanedTranscript]
        .slice(0, cleanedTranscript.findIndex((entry) => entry.id === item.id))
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
        console.log('[V2][runtime] review:score-turn:ok', index, item.text.slice(0, 48));
        return { itemId: item.id, result };
      } catch (error) {
        console.log('[V2][runtime] review:score-turn:error', index, normalizeError(error, 'score_turn_failed'));
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
    console.log('[V2][runtime] review:score-aggregate:ok');
  } catch (error) {
    console.log('[V2][runtime] review:score-aggregate:error', normalizeError(error, 'score_aggregate_failed'));
  }

  const perTurnScoreMap = new Map(userScores.map((entry) => [entry.itemId, entry.result]));
  const overallValue = aggregateScore?.overall ?? averageScore(userScores.map((entry) => entry.result?.overall));
  const fluencyValue = aggregateScore?.fluency ?? averageScore(userScores.map((entry) => entry.result?.fluency));
  const grammarValue =
    aggregateScore ? deriveGrammarMetricFromScore(aggregateScore) : averageScore(userScores.map((entry) => entry.result && deriveGrammarMetricFromScore(entry.result)));
  const taskCompletionValue =
    aggregateScore
      ? deriveTaskCompletionMetricFromScore(aggregateScore)
      : averageScore(userScores.map((entry) => entry.result && deriveTaskCompletionMetricFromScore(entry.result)));
  const naturalnessValue =
    aggregateScore
      ? deriveNaturalnessMetricFromScore(aggregateScore)
      : averageScore(userScores.map((entry) => entry.result && deriveNaturalnessMetricFromScore(entry.result)));

  const enrichedReplayItems = replayItems.map((item) => {
    if (item.role !== 'user') {
      return item;
    }
    const score = perTurnScoreMap.get(item.id);
    if (!score) {
      return {
        ...item,
        correction: {
          fixed: null,
          note: null,
          source: 'unavailable' as const,
        },
      };
    }
    return {
      ...item,
      correction: {
        fixed: score.correction?.fixed?.trim() || null,
        note: score.correction?.reason?.trim() || score.suggestion?.trim() || null,
        source: 'score_api' as const,
      },
    };
  });

  return {
    reviewVersion: 'v2',
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    userTurnCount: userTurns.length,
    aiTurnCount: aiTurns.length,
    totalTurns,
    interruptCount,
    userTranscriptSummary: userTurns.map((item) => item.text).join(' ').slice(0, 320) || '本次未记录到用户发言文本。',
    aiTranscriptSummary: aiTurns.map((item) => item.text).join(' ').slice(0, 320) || '本次未记录到 AI 回应文本。',
      metrics: {
      overall:
        overallValue !== null
          ? { value: overallValue, source: aggregateScore ? 'score_api' : 'derived_from_score' }
          : createUnavailableMetric('本轮总体反馈生成不完整，建议继续练习一轮。'),
      fluency:
        fluencyValue !== null
          ? {
              value: fluencyValue,
              source: aggregateScore ? 'score_api' : 'derived_from_score',
            }
          : createUnavailableMetric('本轮流畅度反馈生成不完整。'),
      grammar:
        grammarValue !== null
          ? { value: grammarValue, source: 'derived_from_score' }
          : createUnavailableMetric('本轮语法反馈生成不完整。'),
      taskCompletion:
        taskCompletionValue !== null
          ? { value: taskCompletionValue, source: aggregateScore ? 'score_api' : 'derived_from_score' }
          : createUnavailableMetric('本轮任务完成度反馈生成不完整。'),
      naturalness:
        naturalnessValue !== null
          ? { value: naturalnessValue, source: aggregateScore ? 'score_api' : 'derived_from_score' }
          : createUnavailableMetric('本轮自然表达反馈生成不完整。'),
    },
    aiCoachFeedback:
      aggregateScore?.suggestion?.trim() ||
      aggregateScore?.correction?.reason?.trim() ||
      '这次表达已经完成沟通目标，可以继续加强完整句和细节表达。',
    replayItems: enrichedReplayItems,
    userTranscriptAvailable: true,
    timing,
    note: '根据本轮对话表现，为你整理了表达反馈。',
  };
}

export function useSpeakingV2Runtime({
  coachProfile,
  session,
  scenario,
}: {
  coachProfile: CoachProfile;
  session: StoredSession | null;
  scenario: Scenario;
}) {
  const [state, dispatch] = useReducer(speakingV2Reducer, initialSpeakingV2State);
  const stateRef = useRef(state);
  const clientRef = useRef<SpeakingRealtimeClient | null>(null);
  const callStartedAtRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const aiCurrentTranscriptIdRef = useRef<string | null>(null);
  const currentUserTranscriptIdRef = useRef<string | null>(null);
  const interruptCountRef = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const reconnectPromiseRef = useRef<Promise<void> | null>(null);
  const connectionStartedAtRef = useRef<number | null>(null);
  const connectionTimingRef = useRef<SpeakingV2ReviewTiming>(createEmptyTiming());
  const connectionStepStartRef = useRef<Record<string, number>>({});
  const assistantAudioActiveRef = useRef(false);
  const initialGreetingRequestedRef = useRef(false);
  const initialGreetingCompletedRef = useRef(false);
  const initialGreetingAudioStartedRef = useRef(false);
  const sessionUpdatedFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callGenerationRef = useRef(0);
  const conversationTurnsRef = useRef<V2ConversationTurn[]>([]);
  const assistantTranscriptAccumulatorsRef = useRef<Map<string, V2AssistantTranscriptAccumulator>>(new Map());
  const finalizedAssistantResponseIdsRef = useRef<Set<string>>(new Set());
  const reportFinalizedRef = useRef(false);
  const cachedFinalTurnsRef = useRef<V2ConversationTurn[] | null>(null);
  const cachedReviewPayloadRef = useRef<SpeakingV2ReviewPayload | null>(null);
  const cachedTranscriptJsonRef = useRef<ReturnType<typeof buildTranscriptJsonFromTurns> | null>(null);
  const progressSyncRef = useRef({
    inFlight: false,
    queuedTurnCount: null as number | null,
    lastSyncedTurnCount: 0,
  });
  const handleTransportEventRef = useRef<(event: SpeakingV2TransportEvent) => void>(() => undefined);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const resetDurationTicker = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startDurationTicker = useCallback(() => {
    resetDurationTicker();
    intervalRef.current = setInterval(() => {
      const startedAt = callStartedAtRef.current;
      if (!startedAt) return;
      const durationSec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      const remainingDurationSec = Math.max(0, MAX_CALL_DURATION_SEC - durationSec);
      dispatch({ type: 'SET_CALL_DURATION', durationSec, remainingDurationSec });
    }, 1000);
  }, [resetDurationTicker]);

  const refreshCredits = useCallback(async () => {
    if (!session) return null;
    const credits = await fetchSpeakingCredits(session);
    dispatch({ type: 'SET_CREDITS', credits: credits.balanceCredits });
    return credits.balanceCredits;
  }, [session]);

  const forwardTransportEvent = useCallback((event: SpeakingV2TransportEvent) => {
    handleTransportEventRef.current(event);
  }, []);

  const resetConnectionTiming = useCallback(() => {
    connectionStartedAtRef.current = null;
    connectionTimingRef.current = createEmptyTiming();
    connectionStepStartRef.current = {};
  }, []);

  const upsertConversationTurn = useCallback((turn: V2ConversationTurn) => {
    const normalizedText = sanitizeTranscriptText(turn.text);
    if (!normalizedText) {
      if (turn.role === 'user') {
        console.log('[V2][runtime] v2_realtime_user_transcript_empty', JSON.stringify({
          id: turn.id,
        }));
      }
      return;
    }

    const index = conversationTurnsRef.current.findIndex((item) => item.id === turn.id);
    const nextTurn = {
      ...turn,
      text: normalizedText,
      completedAt: turn.completedAt ?? Date.now(),
    };
    if (index >= 0) {
      const existing = conversationTurnsRef.current[index];
      if (existing.role === turn.role && sanitizeTranscriptText(existing.text) === normalizedText) {
        if (turn.role === 'user') {
          console.log('[V2][runtime] v2_realtime_turn_user_duplicate_skipped', JSON.stringify({
            id: turn.id,
            textLength: normalizedText.length,
          }));
        } else {
          console.log('[V2][runtime] v2_realtime_assistant_turn_duplicate_skipped', JSON.stringify({
            id: turn.id,
            responseId: turn.responseId ?? null,
            textLength: normalizedText.length,
          }));
        }
        return;
      }
      conversationTurnsRef.current = conversationTurnsRef.current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...nextTurn } : item,
      );
    } else {
      conversationTurnsRef.current = [...conversationTurnsRef.current, nextTurn];
    }

    console.log(
      `[V2][runtime] ${turn.role === 'user' ? 'v2_realtime_turn_user_added' : 'v2_realtime_turn_assistant_added'}`,
      JSON.stringify({
        id: turn.id,
        responseId: turn.responseId ?? null,
        itemId: turn.itemId ?? null,
        textLength: normalizedText.length,
        turnCount: conversationTurnsRef.current.length,
      }),
    );
  }, []);

  const ensurePendingUserTurn = useCallback((input: { itemId: string; startedAt?: number }) => {
    const itemId = input.itemId.trim();
    if (!itemId) return;
    const existing = conversationTurnsRef.current.find((item) => item.id === itemId);
    if (existing) return;
    conversationTurnsRef.current = [
      ...conversationTurnsRef.current,
      {
        id: itemId,
        itemId,
        role: 'user',
        text: '',
        startedAt: input.startedAt ?? Date.now(),
        source: 'user_turn_pending',
      },
    ];
    console.log('[V2][runtime] v2_realtime_turn_user_pending_added', JSON.stringify({
      itemId,
      turnCount: conversationTurnsRef.current.length,
    }));
  }, []);

  const getAssistantAccumulator = useCallback((responseId: string): V2AssistantTranscriptAccumulator => {
    const existing = assistantTranscriptAccumulatorsRef.current.get(responseId);
    if (existing) return existing;
    const next: V2AssistantTranscriptAccumulator = {
      responseId,
      text: '',
      startedAt: Date.now(),
      transcriptDoneReceived: false,
      finalized: false,
    };
    assistantTranscriptAccumulatorsRef.current.set(responseId, next);
    return next;
  }, []);

  const finalizeAssistantTranscript = useCallback(
    (
      responseId: string,
      source: 'transcript_done' | 'response_done_fallback',
      fallbackText?: string,
    ) => {
      const accumulator = getAssistantAccumulator(responseId);
      if (finalizedAssistantResponseIdsRef.current.has(responseId)) {
        console.log('[V2][runtime] v2_realtime_assistant_turn_duplicate_skipped', JSON.stringify({
          responseId,
          source,
          reason: 'finalized_response_id_seen',
        }));
        return;
      }
      if (accumulator.finalized) {
        console.log('[V2][runtime] v2_realtime_assistant_turn_duplicate_skipped', JSON.stringify({
          responseId,
          source,
        }));
        return;
      }

      if (source === 'response_done_fallback' && accumulator.transcriptDoneReceived) {
        console.log('[V2][runtime] v2_realtime_assistant_response_done_duplicate_skipped', JSON.stringify({
          responseId,
          source,
          reason: 'transcript_done_already_received',
        }));
        return;
      }

      const finalText = sanitizeTranscriptText(fallbackText || accumulator.text);
      if (!finalText) {
        console.log('[V2][runtime] v2_realtime_assistant_turn_ignored_partial', JSON.stringify({
          responseId,
          source,
          reason: 'empty_final_text',
        }));
        return;
      }
      if (isSuspiciousShortAssistantText(finalText)) {
        console.log('[V2][runtime] v2_realtime_assistant_turn_ignored_partial', JSON.stringify({
          responseId,
          source,
          finalTextLength: finalText.length,
          text: finalText,
        }));
        return;
      }

      accumulator.finalized = true;
      finalizedAssistantResponseIdsRef.current.add(responseId);
      accumulator.completedAt = Date.now();
      console.log('[V2][runtime] v2_realtime_assistant_transcript_finalized', JSON.stringify({
        responseId,
        finalTextLength: finalText.length,
        source: source === 'transcript_done' ? 'transcript_done' : 'response_done_fallback',
      }));
      const sfxCue = pickCoachSfxCue(coachProfile.sfxProfile, finalText);
      if (sfxCue) {
        console.log('[V2][runtime] coach_sfx_cue_ready', JSON.stringify({
          coachId: coachProfile.id,
          sfxProfile: coachProfile.sfxProfile,
          cue: sfxCue,
        }));
      }
      console.log('[V2][runtime] v2_realtime_assistant_turn_mapping_summary', JSON.stringify({
        responseId,
        accumulatedLength: sanitizeTranscriptText(accumulator.text).length,
        finalTextLength: finalText.length,
        transcriptDoneReceived: accumulator.transcriptDoneReceived,
      }));
      upsertConversationTurn({
        id: responseId,
        responseId,
        role: 'assistant',
        text: finalText,
        startedAt: accumulator.startedAt,
        completedAt: accumulator.completedAt,
        source: source === 'transcript_done' ? 'assistant_transcript_done' : 'assistant_response_done_fallback',
      });
    },
    [coachProfile.id, coachProfile.sfxProfile, getAssistantAccumulator, upsertConversationTurn],
  );

  const beginTimingStep = useCallback((step: string) => {
    connectionStepStartRef.current[step] = Date.now();
  }, []);

  const recordTimingDuration = useCallback((key: keyof SpeakingV2ReviewTiming, step: string, label: string) => {
    const startedAt = connectionStepStartRef.current[step];
    if (!startedAt || connectionTimingRef.current[key] !== null) {
      return connectionTimingRef.current[key];
    }
    const elapsed = Date.now() - startedAt;
    connectionTimingRef.current = {
      ...connectionTimingRef.current,
      [key]: elapsed,
    };
    console.log('[V2][runtime] timing', label, `${elapsed}ms`);
    return elapsed;
  }, []);

  const recordTimingSinceStart = useCallback((key: keyof SpeakingV2ReviewTiming, label: string) => {
    const startedAt = connectionStartedAtRef.current;
    if (!startedAt || connectionTimingRef.current[key] !== null) {
      return connectionTimingRef.current[key];
    }
    const elapsed = Date.now() - startedAt;
    connectionTimingRef.current = {
      ...connectionTimingRef.current,
      [key]: elapsed,
    };
    console.log('[V2][runtime] timing', label, `${elapsed}ms`);
    return elapsed;
  }, []);

  const triggerInitialGreeting = useCallback(() => {
    if (!clientRef.current?.isDataChannelOpen) return;
    if (initialGreetingRequestedRef.current) return;
    initialGreetingRequestedRef.current = true;
    console.log('[V2][runtime] v2_initial_greeting_create_start', scenario.id);
    recordTimingSinceStart('initialGreetingSentMs', 'initial_greeting_sent');
    clientRef.current.requestResponse(buildV2OpeningResponseRequest(scenario));
    console.log('[V2][runtime] v2_initial_greeting_create_sent', scenario.id);
  }, [recordTimingSinceStart, scenario]);

  const syncSpeakerRoute = useCallback(
    async (speakerOn: boolean, options?: { surfaceError?: boolean }) => {
      try {
        if (speakerOn) {
          console.log('[V2][runtime] v2_audio_route_speaker_requested');
        }
        await applySpeakingRealtimeAudioRoute(speakerOn);
        return true;
      } catch (error) {
        const message = normalizeError(error, '切换通话扬声器失败。');
        console.log('[V2][runtime] speaker:error', message);
        if (options?.surfaceError !== false) {
          dispatch({ type: 'SET_ERROR', error: createRuntimeError('transport', message) });
        }
        return false;
      }
    },
    [],
  );

  const resetSpeakerRoute = useCallback(async () => {
    try {
      await resetSpeakingRealtimeAudioRoute();
    } catch (error) {
      console.log('[V2][runtime] speaker:reset-error', normalizeError(error, '重置通话音频路由失败。'));
    }
  }, []);

  const syncProgress = useCallback(
    async (nextTurnCount: number, reason: 'ai_response_done' | 'end_call') => {
      if (!session) return null;

      const sessionId = stateRef.current.sessionId;
      if (!sessionId || nextTurnCount <= 0) {
        return null;
      }

      const tracker = progressSyncRef.current;
      if (nextTurnCount <= tracker.lastSyncedTurnCount) {
        return null;
      }

      if (tracker.inFlight) {
        tracker.queuedTurnCount = Math.max(tracker.queuedTurnCount ?? 0, nextTurnCount);
        return null;
      }

      tracker.inFlight = true;
      let targetTurnCount = nextTurnCount;

      try {
        while (targetTurnCount > tracker.lastSyncedTurnCount) {
          console.log('[V2][runtime] progress:sync', reason, targetTurnCount);
          const progress = await updateSpeakingSessionProgress(session, sessionId, targetTurnCount);
          tracker.lastSyncedTurnCount = Math.max(tracker.lastSyncedTurnCount, progress.turnCount, targetTurnCount);
          dispatch({ type: 'SET_TURN_COUNT', turnCount: progress.turnCount });

          if (typeof progress.balanceCreditsAfter === 'number') {
            dispatch({ type: 'SET_CREDITS', credits: progress.balanceCreditsAfter });
          }

          const queuedTurnCount = tracker.queuedTurnCount;
          if (!queuedTurnCount || queuedTurnCount <= tracker.lastSyncedTurnCount) {
            tracker.queuedTurnCount = null;
            return progress;
          }

          targetTurnCount = queuedTurnCount;
          tracker.queuedTurnCount = null;
        }
      } catch (error) {
        console.log('[V2][runtime] progress:error', reason, normalizeError(error, '同步 V2 会中进度失败。'));
        return null;
      } finally {
        tracker.inFlight = false;
      }

      return null;
    },
    [session],
  );

  const fetchRealtimeToken = useCallback(async () => {
    if (!session) {
      throw new Error('请先登录后再启动 V2 realtime token。');
    }

    return getSpeakingRealtimeToken(session, {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      aiName: scenario.aiName,
      aiRole: scenario.aiRole,
      systemPrompt: scenario.systemPrompt,
    });
  }, [scenario.aiName, scenario.aiRole, scenario.id, scenario.name, scenario.systemPrompt, session]);

  const connectTransportWithToken = useCallback(
    async (tokenResponse: Awaited<ReturnType<typeof getSpeakingRealtimeToken>>, callGeneration: number) => {
      const isActiveCall = () => callGenerationRef.current === callGeneration;
      if (!isActiveCall()) {
        console.log('[V2][runtime] startCall:stale_connect_skipped', callGeneration);
        return false;
      }
      if (!clientRef.current) {
        clientRef.current = new SpeakingRealtimeClient();
      }

      const client = clientRef.current;
      client.setEventHandler(forwardTransportEvent);

      await syncSpeakerRoute(stateRef.current.isSpeakerOn, { surfaceError: false });
      if (!isActiveCall()) {
        console.log('[V2][runtime] startCall:stale_before_transport_connect', callGeneration);
        return false;
      }

      await client.connect({
        ephemeralKey: tokenResponse.clientSecret,
        model: tokenResponse.model,
        voice: tokenResponse.voice,
        sessionInstructions: buildV2SessionInstructions(scenario, coachProfile),
        inputTranscriptionPrompt: buildV2InputTranscriptionPrompt(scenario),
        createCall: async (offerSdp) => {
          if (!isActiveCall()) {
            throw new Error('stale_v2_call_generation');
          }
          console.log('[V2][runtime] calls:start', offerSdp.length);
          const callResponse = await createSpeakingRealtimeCall({
            ephemeralKey: tokenResponse.clientSecret,
            sdp: offerSdp,
          });
          if (!isActiveCall()) {
            console.log('[V2][runtime] calls:stale_response_ignored', callGeneration);
            throw new Error('stale_v2_call_generation');
          }
          console.log('[V2][runtime] calls:ok', callResponse.answerSdp.length);
          return { answerSdp: callResponse.answerSdp };
        },
        onEvent: forwardTransportEvent,
      });
      if (!isActiveCall()) {
        console.log('[V2][runtime] startCall:stale_after_transport_connect', callGeneration);
        return false;
      }

      if (stateRef.current.isMicMuted) {
        client.muteMic();
      } else {
        client.unmuteMic();
      }
      return true;
    },
    [coachProfile, forwardTransportEvent, scenario, syncSpeakerRoute],
  );

  const attemptReconnect = useCallback(
    async (reason: string) => {
      if (!session || !stateRef.current.sessionId) {
        return;
      }

      if (reconnectPromiseRef.current) {
        return reconnectPromiseRef.current;
      }

      if (reconnectAttemptRef.current >= 1) {
        resetDurationTicker();
        callStartedAtRef.current = null;
        dispatch({ type: 'SET_CONNECTION_STATUS', status: 'error' });
        dispatch({ type: 'SET_STAGE_STATE', stage: 'idle' });
        dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
        dispatch({
          type: 'SET_ERROR',
          error: createRuntimeError('transport', '实时连接重连失败，请重新开始本次通话。'),
        });
        return;
      }

      reconnectAttemptRef.current += 1;
      dispatch({ type: 'SET_CONNECTION_STATUS', status: 'reconnecting' });
      dispatch({ type: 'SET_STAGE_STATE', stage: 'idle' });
      dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
      dispatch({ type: 'SET_ERROR', error: null });
      console.log('[V2][runtime] reconnect:start', reason, reconnectAttemptRef.current);

      const reconnectPromise = (async () => {
        try {
          const tokenResponse = await fetchRealtimeToken();
          await connectTransportWithToken(tokenResponse, callGenerationRef.current);
          reconnectAttemptRef.current = 0;
          dispatch({ type: 'SET_CONNECTION_STATUS', status: 'connected' });
          dispatch({ type: 'SET_STAGE_STATE', stage: 'listening' });
          dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
          dispatch({ type: 'SET_ERROR', error: null });
          console.log('[V2][runtime] reconnect:ok');
        } catch (error) {
          const message = normalizeError(error, '实时连接重连失败。');
          console.log('[V2][runtime] reconnect:error', message);
          resetDurationTicker();
          callStartedAtRef.current = null;
          dispatch({ type: 'SET_CONNECTION_STATUS', status: 'error' });
          dispatch({ type: 'SET_STAGE_STATE', stage: 'idle' });
          dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
          dispatch({
            type: 'SET_ERROR',
            error: createRuntimeError('transport', message),
          });
        } finally {
          reconnectPromiseRef.current = null;
        }
      })();

      reconnectPromiseRef.current = reconnectPromise;
      return reconnectPromise;
    },
    [connectTransportWithToken, fetchRealtimeToken, resetDurationTicker, session],
  );

  const clearError = useCallback(() => {
    dispatch({ type: 'SET_ERROR', error: null });
    if (stateRef.current.pendingCompletionStatus) {
      return;
    }
    if (stateRef.current.connectionStatus === 'error') {
      dispatch({
        type: 'SET_CONNECTION_STATUS',
        status: clientRef.current?.isConnected ? 'connected' : 'idle',
      });
    }
  }, []);

  const disconnectClient = useCallback(async () => {
    assistantAudioActiveRef.current = false;
    if (!clientRef.current) return;
    clientRef.current.setEventHandler(null);
    await clientRef.current.disconnect();
  }, []);

  const finalizeCompletedCall = useCallback(
    async (
      sessionId: string,
      status: 'completed' | 'aborted',
      reviewPayload: SpeakingV2ReviewPayload,
    ) => {
      if (!session) {
        throw new Error('请先登录后再结束 V2 通话。');
      }

      await completeSpeakingSession(session, sessionId, {
        status,
        transcriptJson: cachedTranscriptJsonRef.current ?? buildTranscriptJsonFromTurns(cachedFinalTurnsRef.current ?? [], stateRef.current.transcript),
        scoreJson: reviewPayload,
      });
      await refreshCredits().catch(() => undefined);
    },
    [refreshCredits, session],
  );

  const endCall = useCallback(
    async (status: 'completed' | 'aborted' = 'completed') => {
      if (!session) return;
      console.log('[V2][runtime] endCall:start', status);
      callGenerationRef.current += 1;
      reconnectAttemptRef.current = 0;
      reconnectPromiseRef.current = null;
      dispatch({ type: 'SET_CONNECTION_STATUS', status: 'ending' });
      dispatch({ type: 'SET_STAGE_STATE', stage: 'idle' });
      dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
      dispatch({ type: 'SET_ERROR', error: null });

      resetDurationTicker();
      await disconnectClient().catch(() => undefined);
      await resetSpeakerRoute();

      const sessionId = stateRef.current.sessionId;
      let reviewPayload = cachedReviewPayloadRef.current;
      if (reportFinalizedRef.current && reviewPayload) {
        console.log('[V2][runtime] v2_realtime_report_finalize_skipped_already_finalized', JSON.stringify({
          userTurns: reviewPayload.userTurnCount,
          aiTurns: reviewPayload.aiTurnCount,
        }));
      } else {
        reportFinalizedRef.current = true;
        const finalTurns = finalizeReportTurns(conversationTurnsRef.current);
        cachedFinalTurnsRef.current = finalTurns;
        cachedTranscriptJsonRef.current = buildTranscriptJsonFromTurns(finalTurns, stateRef.current.transcript);
        console.log('[V2][runtime] v2_realtime_report_finalize_once', JSON.stringify({
          finalTurns: finalTurns.length,
          userTurns: finalTurns.filter((turn) => turn.role === 'user').length,
          assistantTurns: finalTurns.filter((turn) => turn.role === 'assistant').length,
        }));
        reviewPayload = await buildReviewPayload({
          session,
          scenario,
          transcript: stateRef.current.transcript,
          conversationTurns: finalTurns,
          turnCount: stateRef.current.turnCount,
          interruptCount: interruptCountRef.current,
          transportReady: stateRef.current.transportReady,
          timing: connectionTimingRef.current,
        });
        cachedReviewPayloadRef.current = reviewPayload;
      }
      console.log('[V2][runtime] v2_realtime_report_ready', JSON.stringify({
        userTurns: reviewPayload.userTurnCount,
        aiTurns: reviewPayload.aiTurnCount,
        totalTurns: reviewPayload.totalTurns,
        conversationTurns: cachedFinalTurnsRef.current?.length ?? conversationTurnsRef.current.length,
      }));

      aiCurrentTranscriptIdRef.current = null;
      callStartedAtRef.current = null;
      assistantAudioActiveRef.current = false;
      initialGreetingRequestedRef.current = false;
      initialGreetingCompletedRef.current = false;
      initialGreetingAudioStartedRef.current = false;
      currentUserTranscriptIdRef.current = null;
      conversationTurnsRef.current = [];
      assistantTranscriptAccumulatorsRef.current.clear();
      if (sessionUpdatedFallbackTimerRef.current) {
        clearTimeout(sessionUpdatedFallbackTimerRef.current);
        sessionUpdatedFallbackTimerRef.current = null;
      }
      resetConnectionTiming();

      if (!sessionId) {
        dispatch({
          type: 'SET_PENDING_COMPLETION',
          status,
          payload: reviewPayload,
          failed: true,
        });
        dispatch({
          type: 'SET_ERROR',
          error: createRuntimeError('complete', '缺少会话 ID，无法完成本次通话结束写回。'),
        });
        dispatch({ type: 'SET_CONNECTION_STATUS', status: 'error' });
        dispatch({ type: 'SET_STAGE_STATE', stage: 'idle' });
        dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
        return;
      }

      dispatch({
        type: 'SET_PENDING_COMPLETION',
        status,
        payload: reviewPayload,
        failed: false,
      });

      try {
        await syncProgress(stateRef.current.turnCount, 'end_call');
        await finalizeCompletedCall(sessionId, status, reviewPayload);
        console.log('[V2][runtime] complete:ok', sessionId);
        console.log('[V2][runtime] endCall:done', reviewPayload.totalTurns);

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
        interruptCountRef.current = 0;
        progressSyncRef.current = {
          inFlight: false,
          queuedTurnCount: null,
          lastSyncedTurnCount: 0,
        };
      } catch (error) {
        const message = normalizeError(error, '结束实时通话失败。');
        console.log('[V2][runtime] complete:error', message);
        dispatch({
          type: 'SET_PENDING_COMPLETION',
          status,
          payload: reviewPayload,
          failed: true,
        });
        dispatch({
          type: 'SET_ERROR',
          error: createRuntimeError('complete', message),
        });
        dispatch({ type: 'SET_CONNECTION_STATUS', status: 'error' });
        dispatch({ type: 'SET_STAGE_STATE', stage: 'idle' });
        dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
      }
    },
    [disconnectClient, finalizeCompletedCall, resetConnectionTiming, resetDurationTicker, resetSpeakerRoute, scenario, session, syncProgress],
  );

  const retryComplete = useCallback(async () => {
    const sessionId = stateRef.current.sessionId;
    const status = stateRef.current.pendingCompletionStatus;
    const reviewPayload = stateRef.current.pendingCompletionPayload;

    if (!sessionId || !status || !reviewPayload) {
      return;
    }

    dispatch({ type: 'SET_ERROR', error: null });
    dispatch({ type: 'SET_CONNECTION_STATUS', status: 'ending' });
    dispatch({ type: 'SET_STAGE_STATE', stage: 'idle' });
    dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });

    try {
      await finalizeCompletedCall(sessionId, status, reviewPayload);
      console.log('[V2][runtime] complete:retry-ok', sessionId);
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
      interruptCountRef.current = 0;
    } catch (error) {
      const message = normalizeError(error, '结束实时通话失败。');
      console.log('[V2][runtime] complete:retry-error', message);
      dispatch({
        type: 'SET_PENDING_COMPLETION',
        status,
        payload: reviewPayload,
        failed: true,
      });
      dispatch({
        type: 'SET_ERROR',
        error: createRuntimeError('complete', message),
      });
      dispatch({ type: 'SET_CONNECTION_STATUS', status: 'error' });
      dispatch({ type: 'SET_STAGE_STATE', stage: 'idle' });
      dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
    }
  }, [finalizeCompletedCall]);

  const handleTransportEvent = useCallback((event: SpeakingV2TransportEvent) => {
    console.log('[V2][runtime] transport:event', event.type);
    switch (event.type) {
      case 'peer_created':
        recordTimingSinceStart('peerCreateMs', 'peer_created');
        return;
      case 'local_audio_ready':
        recordTimingDuration('micPermissionMs', 'mic', 'local_audio_ready');
        return;
      case 'remote_audio_track_received':
        void syncSpeakerRoute(true, { surfaceError: false });
        return;
      case 'local_offer_created':
        recordTimingSinceStart('offerCreateMs', 'offer_created');
        return;
      case 'calls_started':
        beginTimingStep('calls');
        console.log('[V2][runtime] calls:start', event.offerLength);
        return;
      case 'calls_completed':
        recordTimingDuration('callsMs', 'calls', 'calls_completed');
        return;
      case 'remote_answer_set':
        recordTimingSinceStart('remoteAnswerSetMs', 'remote_answer_set');
        return;
      case 'datachannel_open':
        recordTimingSinceStart('dataChannelOpenMs', 'datachannel_open');
        if (sessionUpdatedFallbackTimerRef.current) {
          clearTimeout(sessionUpdatedFallbackTimerRef.current);
        }
        sessionUpdatedFallbackTimerRef.current = setTimeout(() => {
          triggerInitialGreeting();
        }, 350);
        return;
      case 'session_update_sent':
        recordTimingSinceStart('sessionUpdateSentMs', 'session_update_sent');
        return;
      case 'session_updated':
        recordTimingSinceStart('sessionUpdatedMs', 'session_updated');
        triggerInitialGreeting();
        return;
      case 'connected':
        reconnectAttemptRef.current = 0;
        dispatch({ type: 'SET_CONNECTION_STATUS', status: 'connected' });
        dispatch({ type: 'SET_STAGE_STATE', stage: 'listening' });
        dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
        return;
      case 'disconnected':
        if (stateRef.current.connectionStatus === 'ending' || !stateRef.current.sessionId) {
          resetDurationTicker();
          callStartedAtRef.current = null;
          dispatch({ type: 'SET_CONNECTION_STATUS', status: 'completed' });
          dispatch({ type: 'SET_STAGE_STATE', stage: 'idle' });
          dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
          return;
        }

        dispatch({ type: 'SET_CONNECTION_STATUS', status: 'reconnecting' });
        dispatch({ type: 'SET_STAGE_STATE', stage: 'idle' });
        dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
        dispatch({ type: 'SET_ERROR', error: null });
        void attemptReconnect('transport_disconnected');
        return;
      case 'error':
        resetDurationTicker();
        callStartedAtRef.current = null;
        dispatch({ type: 'SET_CONNECTION_STATUS', status: 'error' });
        dispatch({ type: 'SET_STAGE_STATE', stage: 'idle' });
        dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
        dispatch({ type: 'SET_ERROR', error: createRuntimeError('transport', event.message) });
        return;
      case 'user_speech_started':
        if (assistantAudioActiveRef.current) {
          interruptCountRef.current += 1;
          assistantAudioActiveRef.current = false;
          console.log('[V2][runtime] v2_realtime_interruption_detected', scenario.id);
        }
        currentUserTranscriptIdRef.current = createTranscriptId('user');
        dispatch({
          type: 'UPSERT_TRANSCRIPT',
          item: {
            id: currentUserTranscriptIdRef.current,
            role: 'user',
            text: '',
            isFinal: false,
            timestamp: Date.now(),
          },
        });
        dispatch({ type: 'SET_CURRENT_USER_INTERIM', text: '' });
        dispatch({ type: 'SET_CURRENT_USER_FINAL', text: '' });
        dispatch({ type: 'SET_STAGE_STATE', stage: 'listening' });
        dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'user_speaking' });
        return;
      case 'user_speech_stopped':
        dispatch({ type: 'SET_STAGE_STATE', stage: 'thinking' });
        dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'thinking' });
        return;
      case 'user_audio_committed':
        if (event.itemId) {
          ensurePendingUserTurn({ itemId: event.itemId, startedAt: Date.now() });
        }
        return;
      case 'user_turn_pending':
        ensurePendingUserTurn({ itemId: event.itemId, startedAt: event.startedAt });
        currentUserTranscriptIdRef.current = event.itemId;
        dispatch({
          type: 'UPSERT_TRANSCRIPT',
          item: {
            id: event.itemId,
            role: 'user',
            text: '',
            isFinal: false,
            timestamp: event.startedAt,
          },
        });
        return;
      case 'user_transcript_delta':
        dispatch({ type: 'SET_CURRENT_USER_INTERIM', text: event.text });
        if (currentUserTranscriptIdRef.current) {
          dispatch({
            type: 'PATCH_TRANSCRIPT',
            id: currentUserTranscriptIdRef.current,
            patch: { text: event.text, isFinal: false },
          });
        }
        dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'user_speaking' });
        return;
      case 'user_transcript_final': {
        const text = event.text.trim();
        const id = currentUserTranscriptIdRef.current || createTranscriptId('user');
        currentUserTranscriptIdRef.current = id;
        dispatch({ type: 'SET_CURRENT_USER_INTERIM', text: '' });
        dispatch({ type: 'SET_CURRENT_USER_FINAL', text });
        dispatch({
          type: 'UPSERT_TRANSCRIPT',
          item: {
            id,
            role: 'user',
            text,
            isFinal: true,
            timestamp: stateRef.current.transcript.find((entry) => entry.id === id)?.timestamp ?? Date.now(),
          },
        });
        upsertConversationTurn({
          id,
          itemId: id,
          role: 'user',
          text,
          startedAt: stateRef.current.transcript.find((entry) => entry.id === id)?.timestamp ?? Date.now(),
          completedAt: Date.now(),
          source: 'user_transcript_final',
        });
        return;
      }
      case 'user_transcript_done': {
        const text = event.text.trim();
        const id = event.itemId || currentUserTranscriptIdRef.current || createTranscriptId('user');
        if (!text) {
          console.log('[V2][runtime] v2_realtime_user_transcript_empty', JSON.stringify({
            itemId: id,
          }));
          return;
        }
        currentUserTranscriptIdRef.current = id;
        dispatch({ type: 'SET_CURRENT_USER_INTERIM', text: '' });
        dispatch({ type: 'SET_CURRENT_USER_FINAL', text });
        dispatch({
          type: 'UPSERT_TRANSCRIPT',
          item: {
            id,
            role: 'user',
            text,
            isFinal: true,
            timestamp: stateRef.current.transcript.find((entry) => entry.id === id)?.timestamp ?? event.completedAt,
          },
        });
        upsertConversationTurn({
          id,
          itemId: id,
          role: 'user',
          text,
          startedAt: stateRef.current.transcript.find((entry) => entry.id === id)?.timestamp ?? event.completedAt,
          completedAt: event.completedAt,
          source: 'user_transcript_done',
        });
        return;
      }
      case 'ai_response_created': {
        aiCurrentTranscriptIdRef.current = event.id;
        getAssistantAccumulator(aiCurrentTranscriptIdRef.current);
        dispatch({ type: 'SET_STAGE_STATE', stage: 'speaking' });
        dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'ai_speaking' });
        dispatch({ type: 'SET_CURRENT_AI_TEXT', text: '' });
        dispatch({
          type: 'UPSERT_TRANSCRIPT',
          item: {
            id: aiCurrentTranscriptIdRef.current,
            role: 'ai',
            text: '',
            isFinal: false,
            timestamp: Date.now(),
          },
        });
        return;
      }
      case 'ai_response_delta': {
        const transcriptId = event.id || aiCurrentTranscriptIdRef.current;
        if (!transcriptId) {
          console.log('[V2][runtime] v2_realtime_assistant_turn_rejected_missing_response_id', JSON.stringify({
            eventType: 'ai_response_delta',
            deltaLength: event.text.length,
          }));
          return;
        }
        aiCurrentTranscriptIdRef.current = transcriptId;
        const accumulator = getAssistantAccumulator(transcriptId);
        accumulator.text = `${accumulator.text}${event.text}`;
        const nextText = accumulator.text;
        console.log('[V2][runtime] v2_realtime_assistant_transcript_delta_accumulated', JSON.stringify({
          responseId: transcriptId,
          deltaLength: event.text.length,
          accumulatedLength: sanitizeTranscriptText(nextText).length,
        }));
        dispatch({ type: 'SET_CURRENT_AI_TEXT', text: nextText });
        dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'ai_speaking' });
        dispatch({
          type: 'PATCH_TRANSCRIPT',
          id: transcriptId,
          patch: { text: nextText, isFinal: false },
        });
        return;
      }
      case 'ai_response_transcript_done': {
        const transcriptId = event.id || aiCurrentTranscriptIdRef.current;
        if (!transcriptId) {
          console.log('[V2][runtime] v2_realtime_assistant_turn_rejected_missing_response_id', JSON.stringify({
            eventType: 'ai_response_transcript_done',
            textLength: event.text.length,
          }));
          return;
        }
        aiCurrentTranscriptIdRef.current = transcriptId;
        const text = sanitizeTranscriptText(event.text);
        const accumulator = getAssistantAccumulator(transcriptId);
        accumulator.transcriptDoneReceived = true;
        if (text) {
          accumulator.text = text;
        }
        console.log('[V2][runtime] v2_realtime_assistant_transcript_done_received', JSON.stringify({
          responseId: transcriptId,
          finalTextLength: text.length,
          accumulatedLength: sanitizeTranscriptText(accumulator.text).length,
        }));
        if (text) {
          dispatch({ type: 'SET_CURRENT_AI_TEXT', text });
          dispatch({
            type: 'UPSERT_TRANSCRIPT',
            item: {
              id: transcriptId,
              role: 'ai',
              text,
              isFinal: false,
              timestamp: stateRef.current.transcript.find((entry) => entry.id === transcriptId)?.timestamp ?? Date.now(),
            },
          });
          finalizeAssistantTranscript(transcriptId, 'transcript_done', text);
        }
        return;
      }
      case 'ai_response_done':
        if (initialGreetingRequestedRef.current && !initialGreetingCompletedRef.current) {
          initialGreetingCompletedRef.current = true;
          console.log('[V2][runtime] v2_initial_greeting_done', scenario.id);
        }
        assistantAudioActiveRef.current = false;
        currentUserTranscriptIdRef.current = null;
        {
          const responseId = event.id || aiCurrentTranscriptIdRef.current;
          if (!responseId) {
            console.log('[V2][runtime] v2_realtime_response_done_missing_response_id', JSON.stringify({
              hasText: Boolean(event.text?.trim()),
              textLength: event.text?.length ?? 0,
            }));
          } else {
            finalizeAssistantTranscript(responseId, 'response_done_fallback', event.text);
          }
        }
        if (aiCurrentTranscriptIdRef.current) {
          const nextTurnCount = stateRef.current.turnCount + 1;
          dispatch({
            type: 'PATCH_TRANSCRIPT',
            id: aiCurrentTranscriptIdRef.current,
            patch: { isFinal: true },
          });
          dispatch({ type: 'SET_TURN_COUNT', turnCount: nextTurnCount });
          void syncProgress(nextTurnCount, 'ai_response_done');
        }
        dispatch({ type: 'SET_STAGE_STATE', stage: 'listening' });
        dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
        return;
      case 'assistant_audio_started':
        assistantAudioActiveRef.current = true;
        void syncSpeakerRoute(true, { surfaceError: false });
        console.log('[V2][runtime] v2_assistant_audio_started', event.id ?? 'unknown');
        if (!initialGreetingAudioStartedRef.current) {
          initialGreetingAudioStartedRef.current = true;
          recordTimingSinceStart('firstAssistantAudioStartedMs', 'first_assistant_audio_started');
          if (connectionTimingRef.current.totalMs === null) {
            recordTimingSinceStart('totalMs', 'call_ready_total');
          }
          console.log('[V2][runtime] v2_initial_greeting_audio_started', scenario.id);
        }
        return;
      case 'assistant_audio_stopped':
        assistantAudioActiveRef.current = false;
        console.log('[V2][runtime] v2_assistant_audio_stopped', event.id ?? 'unknown');
        return;
      case 'output_audio_cleared':
        console.log('[V2][runtime] v2_output_audio_cleared', event.id ?? 'unknown');
        return;
      case 'conversation_item_truncated':
        console.log('[V2][runtime] v2_conversation_item_truncated', event.itemId ?? 'unknown');
        return;
      case 'interrupted':
        assistantAudioActiveRef.current = false;
        dispatch({ type: 'SET_STAGE_STATE', stage: 'interrupted' });
        dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'user_speaking' });
        return;
      default:
        return;
    }
  }, [attemptReconnect, beginTimingStep, ensurePendingUserTurn, recordTimingDuration, recordTimingSinceStart, resetDurationTicker, scenario.id, syncProgress, syncSpeakerRoute, triggerInitialGreeting]);

  useEffect(() => {
    handleTransportEventRef.current = handleTransportEvent;
  }, [handleTransportEvent]);

  const startCall = useCallback(async () => {
    if (!session) {
      dispatch({ type: 'SET_ERROR', error: createRuntimeError('session', '请先登录后再开始 V2 通话。') });
      return;
    }
    if (
      stateRef.current.connectionStatus === 'starting' ||
      stateRef.current.connectionStatus === 'connecting' ||
      stateRef.current.connectionStatus === 'reconnecting'
    ) {
      return;
    }

    const callGeneration = callGenerationRef.current + 1;
    callGenerationRef.current = callGeneration;
    console.log('[V2][runtime] startCall:generation', JSON.stringify({
      scenarioId: scenario.id,
      callGeneration,
    }));

    await disconnectClient().catch(() => undefined);

    if (callGenerationRef.current !== callGeneration) {
      console.log('[V2][runtime] startCall:stale_after_pre_disconnect', callGeneration);
      return;
    }

    dispatch({ type: 'RESET' });
    dispatch({ type: 'SET_ERROR', error: null });
    dispatch({ type: 'SET_CONNECTION_STATUS', status: 'starting' });
    dispatch({ type: 'SET_STAGE_STATE', stage: 'idle' });
    dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
    aiCurrentTranscriptIdRef.current = null;
    currentUserTranscriptIdRef.current = null;
    interruptCountRef.current = 0;
    reconnectAttemptRef.current = 0;
    reconnectPromiseRef.current = null;
    resetConnectionTiming();
    connectionStartedAtRef.current = Date.now();
    connectionTimingRef.current = createEmptyTiming();
    assistantAudioActiveRef.current = false;
    initialGreetingRequestedRef.current = false;
    initialGreetingCompletedRef.current = false;
    initialGreetingAudioStartedRef.current = false;
    conversationTurnsRef.current = [];
    assistantTranscriptAccumulatorsRef.current.clear();
    finalizedAssistantResponseIdsRef.current.clear();
    reportFinalizedRef.current = false;
    cachedFinalTurnsRef.current = null;
    cachedReviewPayloadRef.current = null;
    cachedTranscriptJsonRef.current = null;
    if (sessionUpdatedFallbackTimerRef.current) {
      clearTimeout(sessionUpdatedFallbackTimerRef.current);
      sessionUpdatedFallbackTimerRef.current = null;
    }
    progressSyncRef.current = {
      inFlight: false,
      queuedTurnCount: null,
      lastSyncedTurnCount: 0,
    };
    console.log('[V2][runtime] startCall:start', scenario.id);

    if (!clientRef.current) {
      clientRef.current = new SpeakingRealtimeClient();
    }
    const client = clientRef.current;
    dispatch({
      type: 'SET_TRANSPORT_CAPABILITY',
      ready: client.capability.available,
      reason: client.capability.reason,
    });

    if (!client.capability.available) {
      dispatch({ type: 'SET_CONNECTION_STATUS', status: 'error' });
      dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
      dispatch({
        type: 'SET_ERROR',
        error: createRuntimeError('transport', client.capability.reason || '当前设备无法启动 realtime transport。'),
      });
      return;
    }

    let sessionResponse: Awaited<ReturnType<typeof createSpeakingRealtimeSession>> | null = null;
    let tokenResponse: Awaited<ReturnType<typeof getSpeakingRealtimeToken>> | null = null;
    beginTimingStep('session');
    beginTimingStep('token');
    beginTimingStep('mic');
    const micWarmupPromise = client.prepareLocalAudio().catch((error) => {
      console.log('[V2][runtime] mic:error', normalizeError(error, 'prepare_local_audio_failed'));
      throw error;
    });

    try {
      const [nextSessionResponse, nextTokenResponse] = await Promise.all([
        createSpeakingRealtimeSession(session, {
            scenarioId: scenario.id,
            mode: scenario.id === 'free-chat' ? 'free_chat' : 'scenario',
          }),
        fetchRealtimeToken(),
        micWarmupPromise,
      ]);
      sessionResponse = nextSessionResponse;
      tokenResponse = nextTokenResponse;
      if (callGenerationRef.current !== callGeneration) {
        console.log('[V2][runtime] startCall:stale_session_token_ignored', callGeneration);
        return;
      }
      recordTimingDuration('sessionMs', 'session', 'session_ok');
      recordTimingDuration('tokenMs', 'token', 'token_ok');
      recordTimingDuration('micPermissionMs', 'mic', 'mic_permission_ok');
      console.log('[V2][runtime] session:ok', sessionResponse.sessionId);
      console.log('[V2][runtime] token:ok', tokenResponse.model ?? 'unknown-model');
    } catch (error) {
      if (callGenerationRef.current !== callGeneration) {
        console.log('[V2][runtime] startCall:stale_session_error_ignored', callGeneration);
        return;
      }
      console.log('[V2][runtime] session-or-token:error', normalizeError(error, '创建 V2 会话或 token 失败。'));
      dispatch({ type: 'SET_CONNECTION_STATUS', status: 'error' });
      dispatch({ type: 'SET_STAGE_STATE', stage: 'idle' });
      dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
      dispatch({
        type: 'SET_ERROR',
        error: createRuntimeError('session', normalizeError(error, '创建 V2 会话或 token 失败。')),
      });
      return;
    }

    if (!sessionResponse || !tokenResponse) {
      if (callGenerationRef.current !== callGeneration) return;
      dispatch({ type: 'SET_CONNECTION_STATUS', status: 'error' });
      dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
      dispatch({ type: 'SET_ERROR', error: createRuntimeError('session', 'V2 会话启动返回为空。') });
      return;
    }

    dispatch({ type: 'SET_SESSION_ID', sessionId: sessionResponse.sessionId });
    dispatch({ type: 'SET_CONNECTION_STATUS', status: 'connecting' });
    client.setEventHandler(forwardTransportEvent);

    callStartedAtRef.current = Date.now();
    startDurationTicker();

    try {
      const connected = await connectTransportWithToken(tokenResponse, callGeneration);
      if (!connected || callGenerationRef.current !== callGeneration) {
        console.log('[V2][runtime] startCall:stale_transport_result_ignored', callGeneration);
        return;
      }

      dispatch({ type: 'SET_CONNECTION_STATUS', status: 'connected' });
      dispatch({ type: 'SET_STAGE_STATE', stage: 'listening' });
      dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
      console.log('[V2][runtime] startCall:connected');
    } catch (error) {
      if (callGenerationRef.current !== callGeneration) {
        console.log('[V2][runtime] startCall:stale_transport_error_ignored', callGeneration);
        return;
      }
      console.log('[V2][runtime] transport:error', normalizeError(error, '启动 V2 realtime transport 失败。'));
      resetDurationTicker();
      callStartedAtRef.current = null;
      await resetSpeakerRoute();
      dispatch({ type: 'SET_CALL_DURATION', durationSec: 0, remainingDurationSec: MAX_CALL_DURATION_SEC });
      dispatch({ type: 'SET_CONNECTION_STATUS', status: 'error' });
      dispatch({ type: 'SET_STAGE_STATE', stage: 'idle' });
      dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'idle' });
      dispatch({
        type: 'SET_ERROR',
        error: createRuntimeError('transport', normalizeError(error, '启动 V2 realtime transport 失败。')),
      });
    }
  }, [
    beginTimingStep,
    connectTransportWithToken,
    disconnectClient,
    fetchRealtimeToken,
    forwardTransportEvent,
    recordTimingDuration,
    resetConnectionTiming,
    resetDurationTicker,
    resetSpeakerRoute,
    scenario.id,
    session,
    startDurationTicker,
  ]);

  const toggleMute = useCallback(() => {
    if (!clientRef.current) return;
    const nextMuted = !stateRef.current.isMicMuted;
    if (nextMuted) {
      clientRef.current.muteMic();
    } else {
      clientRef.current.unmuteMic();
    }
    dispatch({ type: 'SET_MIC_MUTED', muted: nextMuted });
  }, []);

  const toggleSpeaker = useCallback(() => {
    const next = !stateRef.current.isSpeakerOn;
    void (async () => {
      const applied = await syncSpeakerRoute(next);
      if (!applied) {
        return;
      }
      dispatch({ type: 'SET_SPEAKER_ON', enabled: next });
    })();
  }, [syncSpeakerRoute]);

  const interruptAssistant = useCallback(() => {
    if (!clientRef.current) return;
    interruptCountRef.current += 1;
    dispatch({ type: 'SET_CURRENT_USER_INTERIM', text: '' });
    dispatch({ type: 'SET_CURRENT_USER_FINAL', text: '' });
    clientRef.current.interrupt();
    dispatch({ type: 'SET_STAGE_STATE', stage: 'interrupted' });
    dispatch({ type: 'SET_LIVE_STAGE_STATE', liveStage: 'user_speaking' });
  }, []);

  useEffect(() => {
    if (!session) return;
    void refreshCredits().catch((error) => {
      dispatch({
        type: 'SET_ERROR',
        error: createRuntimeError('session', normalizeError(error, '加载 V2 额度失败。')),
      });
    });
  }, [refreshCredits, session]);

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
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        console.log('[V2][runtime] app_state_cleanup_requested', nextState);
        callGenerationRef.current += 1;
        assistantAudioActiveRef.current = false;
        reconnectAttemptRef.current = 0;
        reconnectPromiseRef.current = null;
        if (sessionUpdatedFallbackTimerRef.current) {
          clearTimeout(sessionUpdatedFallbackTimerRef.current);
          sessionUpdatedFallbackTimerRef.current = null;
        }
        resetDurationTicker();
        void disconnectClient();
        void resetSpeakerRoute();
      }
    });
    return () => {
      subscription.remove();
    };
  }, [disconnectClient, resetDurationTicker, resetSpeakerRoute]);

  useEffect(() => {
    return () => {
      callGenerationRef.current += 1;
      assistantAudioActiveRef.current = false;
      reconnectAttemptRef.current = 0;
      reconnectPromiseRef.current = null;
      resetDurationTicker();
      if (sessionUpdatedFallbackTimerRef.current) {
        clearTimeout(sessionUpdatedFallbackTimerRef.current);
        sessionUpdatedFallbackTimerRef.current = null;
      }
      void disconnectClient();
      void resetSpeakerRoute();
    };
  }, [disconnectClient, resetDurationTicker, resetSpeakerRoute]);

  const stageLabel = useMemo(() => {
    switch (state.liveStageState) {
      case 'user_speaking':
        return '正在听你说';
      case 'thinking':
        return 'AI 正在思考';
      case 'ai_speaking':
        return 'AI 正在回答';
      default:
        return '等待开始';
    }
  }, [state.liveStageState]);

  const statusTitle = useMemo(() => {
    if (state.error) return '连接异常';
    if (state.connectionStatus === 'ending') return '正在整理本次表现';
    if (state.connectionStatus === 'starting' || state.connectionStatus === 'connecting' || state.connectionStatus === 'reconnecting') {
      return '正在连接';
    }
    if (state.liveStageState === 'thinking') return 'AI 正在回应';
    if (state.liveStageState === 'ai_speaking' || assistantAudioActiveRef.current) return 'AI 正在回应';
    if (state.connectionStatus === 'connected' && state.turnCount > 0) return '继续说';
    if (state.connectionStatus === 'connected') return '我在听';
    return '准备好了';
  }, [state.connectionStatus, state.error, state.liveStageState, state.turnCount]);

  const statusSubtitle = useMemo(() => {
    if (state.error) return state.error.message;
    if (state.connectionStatus === 'ending') return '正在生成本轮口语表现报告';
    if (state.connectionStatus === 'starting' || state.connectionStatus === 'connecting' || state.connectionStatus === 'reconnecting') {
      return '正在准备你的 AI 练习伙伴';
    }
    if (state.liveStageState === 'thinking') return '听完后继续接着说';
    if (state.liveStageState === 'ai_speaking' || assistantAudioActiveRef.current) return '你可以自然插话或继续接着说';
    if (state.connectionStatus === 'connected' && state.turnCount > 0) return '继续说，我在听';
    if (state.connectionStatus === 'connected') return '你可以自然开口说英语';
    return '点击开始，进入实时口语陪练';
  }, [state.connectionStatus, state.error, state.liveStageState, state.turnCount]);

  return {
    state,
    stageLabel,
    statusTitle,
    statusSubtitle,
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
