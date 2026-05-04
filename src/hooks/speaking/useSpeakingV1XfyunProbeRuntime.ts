import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  XFYUN_PROBE_FINAL_TRANSCRIPT,
  XFYUN_PROBE_PARTIAL_TEXT,
  XFYUN_PROBE_SCENARIO,
  createMockSpeakingRoundAnalysis,
} from '@/services/speaking/xfyunProbeMockData';
import type { SpeakingRoundAnalysis } from '@/types/xfyunSpeakingAssessment';

const LOG_PREFIX = '[V1_XFYUN_PROBE]';

type ProbeRuntimeState = 'ready' | 'recognizing' | 'analyzing';

export interface ProbeSpeakingMessage {
  id: string;
  role: 'ai' | 'user';
  text: string;
  timestamp: number;
  isStreaming?: boolean;
  roundId?: number;
}

function logProbe(step: string, details?: Record<string, unknown>) {
  console.log(`${LOG_PREFIX} ${step} = ${JSON.stringify(details ?? {})}`);
}

function createMessageId(prefix: 'ai' | 'user') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function useSpeakingV1XfyunProbeRuntime() {
  const [messages, setMessages] = useState<ProbeSpeakingMessage[]>(() => [
    {
      id: createMessageId('ai'),
      role: 'ai',
      text: XFYUN_PROBE_SCENARIO.aiOpening,
      timestamp: Date.now(),
    },
  ]);
  const [runtimeState, setRuntimeState] = useState<ProbeRuntimeState>('ready');
  const [activeRoundId, setActiveRoundId] = useState<number | null>(null);
  const [roundAnalysisMap, setRoundAnalysisMap] = useState<Record<number, SpeakingRoundAnalysis>>({});
  const [pronunciationPanelRoundId, setPronunciationPanelRoundId] = useState<number | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const nextRoundIdRef = useRef(1);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current = [];
  }, []);

  const schedule = useCallback((delayMs: number, fn: () => void) => {
    const timer = setTimeout(fn, delayMs);
    timersRef.current.push(timer);
  }, []);

  const updateMessageText = useCallback((messageId: string, text: string, isStreaming: boolean) => {
    setMessages((current) =>
      current.map((message) => (message.id === messageId ? { ...message, text, isStreaming } : message)),
    );
  }, []);

  const startMockTurn = useCallback(() => {
    if (runtimeState !== 'ready') return;

    const roundId = nextRoundIdRef.current++;
    const startedAt = Date.now();
    const userMessageId = createMessageId('user');

    setActiveRoundId(roundId);
    setRuntimeState('recognizing');
    setMessages((current) => [
      ...current,
      {
        id: userMessageId,
        role: 'user',
        text: '正在识别…',
        timestamp: startedAt,
        isStreaming: true,
        roundId,
      },
    ]);

    logProbe('mock_user_speech_started', { roundId });

    schedule(300, () => {
      updateMessageText(userMessageId, XFYUN_PROBE_PARTIAL_TEXT, true);
      logProbe('mock_rtasr_partial', {
        roundId,
        latencyMs: Date.now() - startedAt,
        text: XFYUN_PROBE_PARTIAL_TEXT,
      });
    });

    schedule(800, () => {
      updateMessageText(userMessageId, XFYUN_PROBE_FINAL_TRANSCRIPT.text, false);
      setRuntimeState('analyzing');
      setRoundAnalysisMap((current) => ({
        ...current,
        [roundId]: { ...createMockSpeakingRoundAnalysis({ roundId }), assessment: null, optimizedSentence: null, explanationZh: null },
      }));
      logProbe('mock_rtasr_final', {
        roundId,
        latencyMs: Date.now() - startedAt,
        text: XFYUN_PROBE_FINAL_TRANSCRIPT.text,
      });
    });

    schedule(1200, () => {
      const nextAnalysis = createMockSpeakingRoundAnalysis({ roundId });
      setRoundAnalysisMap((current) => ({
        ...current,
        [roundId]: {
          ...nextAnalysis,
          optimizedSentence: current[roundId]?.optimizedSentence ?? null,
          explanationZh: current[roundId]?.explanationZh ?? null,
        },
      }));
      logProbe('mock_ise_score_ready', {
        roundId,
        wordCount: nextAnalysis.assessment?.words.length ?? 0,
        overallScore: nextAnalysis.assessment?.overallScore ?? null,
      });
    });

    schedule(1700, () => {
      const completedAnalysis = createMockSpeakingRoundAnalysis({ roundId });
      setRoundAnalysisMap((current) => ({
        ...current,
        [roundId]: completedAnalysis,
      }));
      setRuntimeState('ready');
      setActiveRoundId(null);
      logProbe('mock_llm_suggestion_ready', {
        roundId,
        optimizedSentence: completedAnalysis.optimizedSentence,
      });
    });
  }, [runtimeState, schedule, updateMessageText]);

  const resetProbe = useCallback(() => {
    clearTimers();
    setRuntimeState('ready');
    setActiveRoundId(null);
    setRoundAnalysisMap({});
    setPronunciationPanelRoundId(null);
    nextRoundIdRef.current = 1;
    setMessages([
      {
        id: createMessageId('ai'),
        role: 'ai',
        text: XFYUN_PROBE_SCENARIO.aiOpening,
        timestamp: Date.now(),
      },
    ]);
  }, [clearTimers]);

  const openPronunciationPanel = useCallback((roundId: number) => {
    setPronunciationPanelRoundId(roundId);
    logProbe('pronunciation_panel_opened', { roundId });
  }, []);

  const closePronunciationPanel = useCallback(() => {
    setPronunciationPanelRoundId(null);
  }, []);

  useEffect(() => {
    logProbe('probe_page_loaded', { scenarioId: XFYUN_PROBE_SCENARIO.id });
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  const selectedAnalysis = pronunciationPanelRoundId != null ? roundAnalysisMap[pronunciationPanelRoundId] ?? null : null;

  return useMemo(
    () => ({
      scenario: XFYUN_PROBE_SCENARIO,
      messages,
      runtimeState,
      isBusy: runtimeState !== 'ready',
      activeRoundId,
      roundAnalysisMap,
      selectedAnalysis,
      pronunciationPanelVisible: pronunciationPanelRoundId != null,
      startMockTurn,
      resetProbe,
      openPronunciationPanel,
      closePronunciationPanel,
    }),
    [
      activeRoundId,
      closePronunciationPanel,
      messages,
      openPronunciationPanel,
      pronunciationPanelRoundId,
      resetProbe,
      roundAnalysisMap,
      runtimeState,
      selectedAnalysis,
      startMockTurn,
    ],
  );
}
