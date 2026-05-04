import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import type { Scenario } from '@/data/scenarios';
import type { StoredSession } from '@/types/auth';
import type {
  SpeakingCredits,
  SpeakingScoreResult,
  SpeakingSessionProgressResponse,
} from '@/services/api/speakingPractice';
import {
  completeSpeakingSession,
  createSpeakingSession,
  fetchSpeakingCredits,
  scoreSpeakingMessage,
  streamSpeakingChatMessage,
  transcribeSpeakingAudio,
  updateSpeakingSessionProgress,
} from '@/services/api/speakingPractice';
import { createSpeakingRecorder } from '@/services/audio/recording';
import { createSentencePipeline, SentenceSplitter } from '@/services/audio/sentencePipeline';
import { SpeakingTtsPlayback } from '@/services/audio/ttsPlayback';
import type {
  SpeakingMessage,
  SpeakingRecorderCapability,
  SpeakingRecordingResult,
  SpeakingRuntimeError,
  SpeakingScoreStage,
  SpeakingStage,
  SpeakingTranscriptItem,
  SpeakingTurnSummary,
} from '@/types/speaking';

function createMessageId(prefix: 'ai' | 'user') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function buildFinalScore(scores: SpeakingScoreResult[]) {
  if (scores.length === 0) return null;
  const totals = scores.reduce(
    (acc, item) => ({
      fluency: acc.fluency + item.fluency,
      accuracy: acc.accuracy + item.accuracy,
      vocabulary: acc.vocabulary + item.vocabulary,
      overall: acc.overall + item.overall,
    }),
    { fluency: 0, accuracy: 0, vocabulary: 0, overall: 0 },
  );
  const last = scores[scores.length - 1];
  return {
    fluency: Math.round(totals.fluency / scores.length),
    accuracy: Math.round(totals.accuracy / scores.length),
    vocabulary: Math.round(totals.vocabulary / scores.length),
    overall: Math.round(totals.overall / scores.length),
    suggestion: last.suggestion,
  };
}

function normalizeError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isActiveStage(stage: SpeakingStage) {
  return stage !== 'idle' && stage !== 'completed';
}

function debugLog(key: string, value: unknown) {
  let normalized: string;
  if (typeof value === 'string') {
    normalized = value;
  } else {
    try {
      normalized = JSON.stringify(value);
    } catch {
      normalized = String(value);
    }
  }
  console.log(`[V1_RECORDING_DEBUG] ${key} = ${normalized}`);
}

type PerfStep =
  | 'record_stop_start'
  | 'record_stop_done'
  | 'transcribe_start'
  | 'transcribe_done'
  | 'score_start'
  | 'score_done'
  | 'chat_start'
  | 'chat_first_chunk'
  | 'chat_done'
  | 'tts_start'
  | 'tts_done'
  | 'audio_play_start'
  | 'round_total_done';

type PerfRound = {
  roundId: string;
  startedAt: number;
  audioSize: number | null;
  transcriptLength: number | null;
  scoreStartedAt?: number;
  scoreDoneAt?: number;
  chatStartedAt?: number;
  chatFirstChunkAt?: number;
  chatDoneAt?: number;
  ttsStartedAt?: number;
  ttsDoneAt?: number;
  audioPlayStartedAt?: number;
  summaryLogged?: boolean;
};

function perfLog(step: PerfStep, payload: Record<string, unknown>) {
  console.log(`[V1_PERF] ${step} = ${JSON.stringify(payload)}`);
}

export function useSpeakingV1Runtime({
  session,
  scenario,
}: {
  session: StoredSession | null;
  scenario: Scenario;
}) {
  const recorderRef = useRef(createSpeakingRecorder());
  const ttsRef = useRef(new SpeakingTtsPlayback());
  const chatAbortRef = useRef<AbortController | null>(null);
  const sentencePipelineRef = useRef<ReturnType<typeof createSentencePipeline> | null>(null);
  const mountedRef = useRef(true);
  const sessionIdRef = useRef<string | null>(null);
  const stageRef = useRef<SpeakingStage>('idle');
  const messagesRef = useRef<SpeakingMessage[]>([]);
  const scoreHistoryRef = useRef<SpeakingScoreResult[]>([]);
  const turnCountRef = useRef(0);
  const perfRoundRef = useRef<PerfRound | null>(null);

  const [credits, setCredits] = useState<SpeakingCredits | null>(null);
  const [creditsLoading, setCreditsLoading] = useState(false);
  const [stage, setStage] = useState<SpeakingStage>('idle');
  const [scoreStage, setScoreStage] = useState<SpeakingScoreStage>('idle');
  const [runtimeError, setRuntimeError] = useState<SpeakingRuntimeError | null>(null);
  const [messages, setMessages] = useState<SpeakingMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [pendingTranscriptText, setPendingTranscriptText] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);
  const [turnCount, setTurnCount] = useState(0);
  const [consumedCredits, setConsumedCredits] = useState(0);
  const [latestScore, setLatestScore] = useState<SpeakingScoreResult | null>(null);
  const [scoreHistory, setScoreHistory] = useState<SpeakingScoreResult[]>([]);
  const [streamingAiMessageId, setStreamingAiMessageId] = useState<string | null>(null);
  const [playbackText, setPlaybackText] = useState<string | null>(null);

  const appendMessage = useCallback((message: SpeakingMessage) => {
    setMessages((prev) => {
      const next = [...prev, message];
      messagesRef.current = next;
      return next;
    });
  }, []);

  const patchMessage = useCallback((id: string, patch: Partial<SpeakingMessage>) => {
    setMessages((prev) => {
      const next = prev.map((message) => (message.id === id ? { ...message, ...patch } : message));
      messagesRef.current = next;
      return next;
    });
  }, []);

  const refreshCredits = useCallback(async () => {
    if (!session) return;
    setCreditsLoading(true);
    try {
      const nextCredits = await fetchSpeakingCredits(session);
      if (!mountedRef.current) return;
      setCredits(nextCredits);
    } catch (error) {
      if (!mountedRef.current) return;
      setRuntimeError({
        scope: 'session',
        message: normalizeError(error, '加载口语额度失败'),
        recoverable: true,
      });
    } finally {
      if (mountedRef.current) setCreditsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    turnCountRef.current = turnCount;
  }, [turnCount]);

  useEffect(() => {
    scoreHistoryRef.current = scoreHistory;
  }, [scoreHistory]);

  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  useEffect(() => {
    if (session) {
      void refreshCredits();
    }
  }, [refreshCredits, session]);

  useEffect(() => {
    setStage('idle');
    setScoreStage('idle');
    setRuntimeError(null);
    setMessages([]);
    setDraft('');
    setPendingTranscriptText('');
    setSessionId(null);
    sessionIdRef.current = null;
    setSessionStartedAt(null);
    setTurnCount(0);
    setConsumedCredits(0);
    setLatestScore(null);
    setScoreHistory([]);
    setStreamingAiMessageId(null);
    setPlaybackText(null);
    chatAbortRef.current?.abort();
    sentencePipelineRef.current?.cancel();
    recorderRef.current.cleanup().catch(() => undefined);
  }, [scenario.id]);

  const markPerfStep = useCallback(
    (
      step: PerfStep,
      options?: {
        stepStartedAt?: number;
        extra?: Record<string, unknown>;
      },
    ) => {
      const round = perfRoundRef.current;
      if (!round) return;
      const now = Date.now();
      perfLog(step, {
        roundId: round.roundId,
        timestamp: new Date(now).toISOString(),
        step,
        elapsedMsFromRoundStart: now - round.startedAt,
        stepDurationMs:
          typeof options?.stepStartedAt === 'number' ? now - options.stepStartedAt : null,
        transcriptLength: round.transcriptLength,
        audioSize: round.audioSize,
        ...(options?.extra ?? {}),
      });
    },
    [],
  );

  const logPerfSummary = useCallback(
    (trigger: 'chat_done' | 'audio_play_start' | 'on_all_done') => {
      const round = perfRoundRef.current;
      if (!round || round.summaryLogged) return;
      if (trigger === 'chat_done' && round.ttsStartedAt) {
        return;
      }

      round.summaryLogged = true;
      markPerfStep('round_total_done', {
        extra: {
          trigger,
          summary: {
            transcribeMs:
              typeof round.chatStartedAt === 'number'
                ? round.chatStartedAt - round.startedAt
                : null,
            scoreMs:
              typeof round.scoreStartedAt === 'number' && typeof round.scoreDoneAt === 'number'
                ? round.scoreDoneAt - round.scoreStartedAt
                : null,
            chatFirstChunkMs:
              typeof round.chatFirstChunkAt === 'number'
                ? round.chatFirstChunkAt - round.startedAt
                : null,
            chatTotalMs:
              typeof round.chatDoneAt === 'number' && typeof round.chatStartedAt === 'number'
                ? round.chatDoneAt - round.chatStartedAt
                : null,
            ttsMs:
              typeof round.ttsStartedAt === 'number' && typeof round.ttsDoneAt === 'number'
                ? round.ttsDoneAt - round.ttsStartedAt
                : null,
            totalMs:
              typeof round.audioPlayStartedAt === 'number'
                ? round.audioPlayStartedAt - round.startedAt
                : typeof round.chatDoneAt === 'number'
                  ? round.chatDoneAt - round.startedAt
                  : null,
          },
        },
      });
    },
    [markPerfStep],
  );

  const updateProgressAfterTurn = useCallback(
    async (activeSessionId: string, nextTurnCount: number) => {
      if (!session) return null;
      try {
        const progress = await updateSpeakingSessionProgress(session, activeSessionId, nextTurnCount);
        if (!mountedRef.current) return progress;
        setConsumedCredits(progress.consumedCredits);
        setTurnCount(progress.turnCount);
        setCredits((prev) =>
          prev
            ? {
                ...prev,
                balanceCredits:
                  typeof progress.balanceCreditsAfter === 'number'
                    ? progress.balanceCreditsAfter
                    : prev.balanceCredits,
                consumedCreditsTotal:
                  prev.consumedCreditsTotal + Math.max(progress.creditsDeductedThisCall ?? 0, 0),
              }
            : prev,
        );
        return progress;
      } catch (error) {
        if (!mountedRef.current) return null;
        setRuntimeError({
          scope: 'session',
          message: normalizeError(error, '同步练习进度失败'),
          recoverable: true,
        });
        return null;
      }
    },
    [session],
  );

  const ensureSession = useCallback(async () => {
    if (!session) throw new Error('未登录');
    if (sessionIdRef.current) return sessionIdRef.current;

    setStage('starting');
    setRuntimeError(null);

    const created = await createSpeakingSession(session, {
      scenarioId: scenario.id,
      mode: scenario.id === 'free-chat' ? 'free_chat' : 'scenario',
    });

    if (!mountedRef.current) return created.sessionId;

    const openingMessage: SpeakingMessage = {
      id: createMessageId('ai'),
      role: 'ai',
      text: scenario.openingLine,
      translation: scenario.openingTranslation,
      timestamp: Date.now(),
    };

    setSessionId(created.sessionId);
    sessionIdRef.current = created.sessionId;
    setSessionStartedAt(new Date().toISOString());
    setMessages([openingMessage]);
    messagesRef.current = [openingMessage];
    setStage('ready');

    try {
      setPlaybackText(openingMessage.text);
      setStage('speaking');
      const uri = await ttsRef.current.synthesize(session, openingMessage.text);
      await ttsRef.current.playUri(uri, openingMessage.text);
    } catch (error) {
      if (mountedRef.current) {
        setRuntimeError({
          scope: 'tts',
          message: normalizeError(error, '开场语音播放失败'),
          recoverable: true,
        });
      }
    } finally {
      if (mountedRef.current) {
        setPlaybackText(null);
        setStage('ready');
      }
    }

    return created.sessionId;
  }, [scenario.id, scenario.openingLine, scenario.openingTranslation, session]);

  const runScore = useCallback(
    async (userText: string, userMessageId: string) => {
      if (!session) return;
      const scoreStartedAt = Date.now();
      if (perfRoundRef.current) {
        perfRoundRef.current.scoreStartedAt = scoreStartedAt;
      }
      markPerfStep('score_start', {
        stepStartedAt: scoreStartedAt,
        extra: {
          textLength: userText.length,
        },
      });
      setScoreStage('scoring');
      try {
        const score = await scoreSpeakingMessage(session, {
          userText,
          scenarioId: scenario.id,
        });
        if (perfRoundRef.current) {
          perfRoundRef.current.scoreDoneAt = Date.now();
        }
        markPerfStep('score_done', {
          stepStartedAt: scoreStartedAt,
          extra: {
            textLength: userText.length,
            overall: score.overall,
          },
        });
        if (!mountedRef.current) return;
        setLatestScore(score);
        setScoreHistory((prev) => {
          const next = [...prev, score];
          scoreHistoryRef.current = next;
          return next;
        });
        if (score.correction) {
          patchMessage(userMessageId, { correction: score.correction });
        }
        setScoreStage('done');
      } catch (error) {
        markPerfStep('score_done', {
          stepStartedAt: scoreStartedAt,
          extra: {
            textLength: userText.length,
            failed: true,
            message: normalizeError(error, '评分失败，本轮对话会继续。'),
          },
        });
        if (!mountedRef.current) return;
        setScoreStage('error');
        setRuntimeError({
          scope: 'score',
          message: normalizeError(error, '评分失败，本轮对话会继续。'),
          recoverable: true,
        });
      }
    },
    [patchMessage, scenario.id, session],
  );

  const submitTurnText = useCallback(
    async (rawText: string) => {
      const trimmed = rawText.trim();
      if (!trimmed || !session) return;

      const activeSessionId = await ensureSession();
      if (!activeSessionId || !mountedRef.current) return;

      chatAbortRef.current?.abort();
      sentencePipelineRef.current?.cancel();

      setRuntimeError(null);
      setPendingTranscriptText('');
      setDraft('');

      const userMessageId = createMessageId('user');
      const userMessage: SpeakingMessage = {
        id: userMessageId,
        role: 'user',
        text: trimmed,
        timestamp: Date.now(),
      };
      const historyBase = [...messagesRef.current, userMessage];
      appendMessage(userMessage);

      const nextTurnCount = turnCountRef.current + 1;
      setTurnCount(nextTurnCount);

      const history = historyBase.map<SpeakingTranscriptItem>((message) => ({
        role: message.role,
        text: message.text,
        translation: message.translation,
        hint: message.hint,
      }));

      void updateProgressAfterTurn(activeSessionId, nextTurnCount).then((progress: SpeakingSessionProgressResponse | null) => {
        if (!progress || !mountedRef.current) return;
        if (progress.status !== 'active') {
          void endSession(progress.status === 'completed' ? 'completed' : 'aborted');
        }
      });

      void runScore(trimmed, userMessageId);

      const pendingAiMessageId = createMessageId('ai');
      setStreamingAiMessageId(pendingAiMessageId);
      appendMessage({
        id: pendingAiMessageId,
        role: 'ai',
        text: '...',
        timestamp: Date.now(),
        isPending: true,
        isStreaming: true,
      });

      setStage('thinking');

      const splitter = new SentenceSplitter();
      const abortController = new AbortController();
      chatAbortRef.current = abortController;

      let aiText = '';
      let translation: string | undefined;
      let hint: string | undefined;

      sentencePipelineRef.current = createSentencePipeline({
        synthesize: async (sentence) => {
          const ttsStartedAt = Date.now();
          const round = perfRoundRef.current;
          if (round && typeof round.ttsStartedAt !== 'number') {
            round.ttsStartedAt = ttsStartedAt;
            markPerfStep('tts_start', {
              stepStartedAt: ttsStartedAt,
              extra: {
                sentenceLength: sentence.length,
              },
            });
          }

          const uri = await ttsRef.current.synthesize(session, sentence);

          if (round && typeof round.ttsDoneAt !== 'number') {
            round.ttsDoneAt = Date.now();
            markPerfStep('tts_done', {
              stepStartedAt: ttsStartedAt,
              extra: {
                sentenceLength: sentence.length,
              },
            });
          }

          return uri;
        },
        playAudio: async (uri, sentence) => {
          const result = await ttsRef.current.playUri(uri, sentence, (event) => {
            if (!mountedRef.current) return;
            if (event.type === 'start') {
              const round = perfRoundRef.current;
              if (round && typeof round.audioPlayStartedAt !== 'number') {
                round.audioPlayStartedAt = Date.now();
                markPerfStep('audio_play_start', {
                  extra: {
                    sentenceLength: sentence.length,
                  },
                });
                logPerfSummary('audio_play_start');
              }
              setPlaybackText(sentence);
              setStage('speaking');
            }
            if (event.type === 'end') {
              setPlaybackText(null);
            }
          });
          if (mountedRef.current && result === 'failed') {
            setRuntimeError({
              scope: 'tts',
              message: '句级 TTS 播放失败，已跳过当前句继续对话。',
              recoverable: true,
            });
          }
          return result;
        },
        onAllDone: () => {
          logPerfSummary('on_all_done');
          if (!mountedRef.current) return;
          setPlaybackText(null);
          if (stageRef.current !== 'ending' && stageRef.current !== 'completed') {
            setStage('ready');
          }
        },
      });

      try {
        const chatStartedAt = Date.now();
        if (perfRoundRef.current) {
          perfRoundRef.current.chatStartedAt = chatStartedAt;
        }
        markPerfStep('chat_start', {
          stepStartedAt: chatStartedAt,
          extra: {
            messageLength: trimmed.length,
            historyCount: history.length,
          },
        });
        for await (const event of streamSpeakingChatMessage(
          session,
          {
            message: trimmed,
            history: history.map((item) => ({
              role: item.role === 'ai' ? 'assistant' : 'user',
              content: item.text,
            })),
            scenarioId: scenario.id,
          },
          abortController.signal,
        )) {
          if (!mountedRef.current) return;

          if (event.type === 'delta') {
            const round = perfRoundRef.current;
            if (round && typeof round.chatFirstChunkAt !== 'number') {
              round.chatFirstChunkAt = Date.now();
              markPerfStep('chat_first_chunk', {
                stepStartedAt: round.chatStartedAt,
                extra: {
                  chunkLength: event.text.length,
                },
              });
            }
            aiText += event.text;
            patchMessage(pendingAiMessageId, {
              text: aiText,
              isPending: false,
              isStreaming: true,
            });

            const sentences = splitter.push(event.text);
            for (const sentence of sentences) {
              sentencePipelineRef.current?.addSentence(sentence);
            }
          } else if (event.type === 'meta') {
            translation = event.translation;
            hint = event.hint;
          } else if (event.type === 'error') {
            throw new Error(event.message);
          } else if (event.type === 'done') {
            break;
          }
        }

        splitter.flush().forEach((sentence) => sentencePipelineRef.current?.addSentence(sentence));
        sentencePipelineRef.current?.finish();
        if (perfRoundRef.current) {
          perfRoundRef.current.chatDoneAt = Date.now();
        }
        markPerfStep('chat_done', {
          stepStartedAt: chatStartedAt,
          extra: {
            replyLength: aiText.length,
          },
        });
        logPerfSummary('chat_done');

        patchMessage(pendingAiMessageId, {
          text: aiText || '...',
          translation,
          hint,
          isPending: false,
          isStreaming: false,
        });
        setStreamingAiMessageId(null);
        if (!playbackText) {
          setStage('ready');
        }
      } catch (error) {
        if (perfRoundRef.current && typeof perfRoundRef.current.chatDoneAt !== 'number') {
          perfRoundRef.current.chatDoneAt = Date.now();
        }
        markPerfStep('chat_done', {
          extra: {
            failed: true,
            replyLength: aiText.length,
            message: normalizeError(error, 'AI 回复流中断，请重试本轮对话。'),
          },
        });
        logPerfSummary('chat_done');
        sentencePipelineRef.current?.cancel();
        if (!mountedRef.current) return;
        setStreamingAiMessageId(null);
        patchMessage(pendingAiMessageId, {
          text: aiText || 'AI 回复中断',
          translation,
          hint,
          isPending: false,
          isStreaming: false,
        });
        setStage('error');
        setRuntimeError({
          scope: 'chat',
          message: normalizeError(error, 'AI 回复流中断，请重试本轮对话。'),
          recoverable: true,
        });
      }
    },
    [appendMessage, ensureSession, patchMessage, playbackText, runScore, scenario.id, session, updateProgressAfterTurn],
  );

  const startRecording = useCallback(async () => {
    if (!session) {
      setRuntimeError({
        scope: 'session',
        message: '请先登录后再录音。',
        recoverable: false,
      });
      return;
    }

    debugLog('runtime_start_recording_request', {
      platform: Platform.OS,
      isDev: typeof __DEV__ === 'boolean' ? __DEV__ : null,
      stage: stageRef.current,
      timestamp: new Date().toISOString(),
    });

    await ensureSession();

    const permissions = await recorderRef.current.requestPermissions();
    debugLog('runtime_permission_result', {
      platform: Platform.OS,
      granted: permissions.granted,
      canAskAgain: permissions.canAskAgain ?? null,
    });
    if (!permissions.granted) {
      setStage('error');
      setRuntimeError({
        scope: 'permission',
        message: recorderRef.current.capability.available
          ? '麦克风权限被拒绝，请在系统设置里开启后重试。'
          : recorderRef.current.capability.reason || '当前构建未接通真机录音能力。',
        recoverable: true,
      });
      return;
    }

    try {
      setRuntimeError(null);
      setStage('recording');
      await recorderRef.current.start();
      debugLog('runtime_recording_started', {
        platform: Platform.OS,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      debugLog('runtime_recording_start_error', {
        platform: Platform.OS,
        message: normalizeError(error, '开始录音失败'),
      });
      setStage('error');
      setRuntimeError({
        scope: 'recording',
        message: normalizeError(error, '开始录音失败'),
        recoverable: true,
      });
    }
  }, [ensureSession, session]);

  const stopRecording = useCallback(async () => {
    if (!session) return;

    debugLog('runtime_stop_recording_request', {
      platform: Platform.OS,
      stage: stageRef.current,
      timestamp: new Date().toISOString(),
    });

    setStage('transcribing');
    perfRoundRef.current = {
      roundId: `round-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      startedAt: Date.now(),
      audioSize: null,
      transcriptLength: null,
    };
    const recordStopStartedAt = perfRoundRef.current.startedAt;
    markPerfStep('record_stop_start', {
      stepStartedAt: recordStopStartedAt,
      extra: {
        scenarioId: scenario.id,
      },
    });

    let recordingResult: SpeakingRecordingResult | null = null;
    try {
      recordingResult = await recorderRef.current.stop();
      if (perfRoundRef.current) {
        perfRoundRef.current.audioSize = recordingResult?.size ?? null;
      }
      markPerfStep('record_stop_done', {
        stepStartedAt: recordStopStartedAt,
        extra: {
          durationMs: recordingResult?.durationMs ?? null,
          fileSize: recordingResult?.size ?? null,
        },
      });
      debugLog('runtime_recording_stop_result', {
        platform: Platform.OS,
        timestamp: new Date().toISOString(),
        uri: recordingResult?.uri ?? null,
        isFileUri: typeof recordingResult?.uri === 'string' ? recordingResult.uri.startsWith('file://') : false,
        durationMs: recordingResult?.durationMs ?? null,
        size: recordingResult?.size ?? null,
        mimeType: recordingResult?.mimeType ?? null,
        fileName: recordingResult?.fileName ?? null,
      });

      if (!recordingResult?.uri) {
        debugLog('runtime_recording_error_reason', 'missing_valid_recording_result');
        setStage('error');
        setRuntimeError({
          scope: 'recording',
          message: '没有拿到有效录音文件，请重试。',
          recoverable: true,
        });
        return;
      }

      if (typeof recordingResult.durationMs === 'number' && recordingResult.durationMs < 1000) {
        debugLog('runtime_recording_error_reason', 'recording_too_short');
        setStage('error');
        setRuntimeError({
          scope: 'recording',
          message: '录音时间太短，请至少说 1 秒。',
          recoverable: true,
        });
        return;
      }
    } catch (error) {
      debugLog('runtime_recording_stop_error', {
        platform: Platform.OS,
        message: normalizeError(error, '停止录音失败'),
      });
      setStage('error');
      setRuntimeError({
        scope: 'recording',
        message: normalizeError(error, '停止录音失败，请重试。'),
        recoverable: true,
      });
      return;
    }

    try {
      const transcribeStartedAt = Date.now();
      markPerfStep('transcribe_start', {
        stepStartedAt: transcribeStartedAt,
        extra: {
          audioSize: recordingResult.size ?? null,
          durationMs: recordingResult.durationMs ?? null,
        },
      });
      debugLog('runtime_transcribe_before', {
        platform: Platform.OS,
        uri: recordingResult.uri,
        isFileUri: recordingResult.uri.startsWith('file://'),
        durationMs: recordingResult.durationMs ?? null,
        size: recordingResult.size ?? null,
        mimeType: recordingResult.mimeType,
        fileName: recordingResult.fileName,
      });

      const transcript = await transcribeSpeakingAudio(session, {
        uri: recordingResult.uri,
        fileName: recordingResult.fileName,
        mimeType: recordingResult.mimeType,
      });
      if (perfRoundRef.current) {
        perfRoundRef.current.transcriptLength = transcript.text?.trim()?.length ?? 0;
      }
      markPerfStep('transcribe_done', {
        stepStartedAt: transcribeStartedAt,
        extra: {
          textLength: transcript.text?.trim()?.length ?? 0,
        },
      });

      if (!transcript.text?.trim()) {
        setStage('error');
        setRuntimeError({
          scope: 'transcribing',
          message: '没有识别到有效语音，请再录一次。',
          recoverable: true,
        });
        return;
      }

      setPendingTranscriptText(transcript.text.trim());
      await submitTurnText(transcript.text.trim());
    } catch (error) {
      debugLog('runtime_transcribe_error', {
        platform: Platform.OS,
        message: normalizeError(error, '语音转写失败，请稍后再试。'),
      });
      setStage('error');
      setRuntimeError({
        scope: 'transcribing',
        message: normalizeError(error, '语音转写失败，请稍后再试。'),
        recoverable: true,
      });
    }
  }, [session, submitTurnText]);

  const endSession = useCallback(
    async (status: 'completed' | 'aborted' = 'completed') => {
      if (!session || !sessionIdRef.current) {
        setStage(status === 'completed' ? 'completed' : 'idle');
        return;
      }

      chatAbortRef.current?.abort();
      sentencePipelineRef.current?.cancel();
      setStage('ending');

      try {
        await completeSpeakingSession(session, sessionIdRef.current, {
          status,
          transcriptJson: messagesRef.current.map((message) => ({
            role: message.role,
            text: message.text,
            translation: message.translation,
            hint: message.hint,
          })),
          scoreJson: buildFinalScore(scoreHistoryRef.current),
        });

        if (!mountedRef.current) return;
        setStage('completed');
        setSessionId(null);
        sessionIdRef.current = null;
        await refreshCredits();
      } catch (error) {
        if (!mountedRef.current) return;
        setStage('error');
        setRuntimeError({
          scope: 'complete',
          message: normalizeError(error, '结束练习失败'),
          recoverable: true,
        });
      }
    },
    [refreshCredits, session],
  );

  const replayAiMessage = useCallback(
    async (messageId?: string) => {
      if (!session) return;
      if (stageRef.current === 'recording' || stageRef.current === 'transcribing' || stageRef.current === 'ending') {
        return;
      }

      const source =
        messageId != null
          ? messagesRef.current.find((message) => message.id === messageId && message.role === 'ai')
          : [...messagesRef.current].reverse().find((message) => message.role === 'ai');

      if (!source?.text?.trim() || source.text === '...') return;

      try {
        setRuntimeError(null);
        setPlaybackText(source.text);
        setStage('speaking');
        const uri = await ttsRef.current.synthesize(session, source.text);
        const result = await ttsRef.current.playUri(uri, source.text, (event) => {
          if (!mountedRef.current) return;
          if (event.type === 'start') {
            setPlaybackText(source.text);
            setStage('speaking');
          }
          if (event.type === 'end') {
            setPlaybackText(null);
          }
        });

        if (mountedRef.current && result === 'failed') {
          setRuntimeError({
            scope: 'tts',
            message: '重听当前回复失败，请稍后再试。',
            recoverable: true,
          });
        }
      } catch (error) {
        if (!mountedRef.current) return;
        setRuntimeError({
          scope: 'tts',
          message: normalizeError(error, '重听当前回复失败，请稍后再试。'),
          recoverable: true,
        });
      } finally {
        if (!mountedRef.current) return;
        setPlaybackText(null);
        if (!['ending', 'completed'].includes(stageRef.current)) {
          setStage(sessionIdRef.current ? 'ready' : 'idle');
        }
      }
    },
    [session],
  );

  useEffect(() => {
    return () => {
      chatAbortRef.current?.abort();
      sentencePipelineRef.current?.cancel();
      recorderRef.current.cleanup().catch(() => undefined);
      ttsRef.current.remove();
      if (session && sessionIdRef.current && isActiveStage(stageRef.current)) {
        void completeSpeakingSession(session, sessionIdRef.current, {
          status: 'aborted',
          transcriptJson: messagesRef.current.map((message) => ({
            role: message.role,
            text: message.text,
            translation: message.translation,
            hint: message.hint,
          })),
          scoreJson: buildFinalScore(scoreHistoryRef.current),
        }).catch(() => undefined);
      }
    };
  }, [session]);

  const transcriptItems = useMemo<SpeakingTranscriptItem[]>(
    () =>
      messages.map((message) => ({
        role: message.role,
        text: message.text,
        translation: message.translation,
        hint: message.hint,
      })),
    [messages],
  );

  const turnSummary = useMemo<SpeakingTurnSummary>(
    () => ({
      latestScoreOverall: latestScore?.overall ?? null,
      averageScoreOverall:
        scoreHistory.length > 0
          ? Math.round(scoreHistory.reduce((sum, item) => sum + item.overall, 0) / scoreHistory.length)
          : null,
      scoreCount: scoreHistory.length,
    }),
    [latestScore, scoreHistory],
  );

  return {
    credits,
    creditsLoading,
    stage,
    scoreStage,
    runtimeError,
    messages,
    draft,
    pendingTranscriptText,
    sessionId,
    sessionStartedAt,
    turnCount,
    consumedCredits,
    latestScore,
    scoreHistory,
    streamingAiMessageId,
    playbackText,
    transcriptItems,
    turnSummary,
    recorderCapability: recorderRef.current.capability as SpeakingRecorderCapability,
    setDraft,
    clearError: () => {
      setRuntimeError(null);
      if (stage === 'error') {
        setStage(sessionIdRef.current ? 'ready' : 'idle');
      }
    },
    refreshCredits,
    ensureSession,
    submitTurnText,
    startRecording,
    stopRecording,
    endSession,
    replayAiMessage,
  };
}
