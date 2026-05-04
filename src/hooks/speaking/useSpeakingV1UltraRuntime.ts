import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';

import type { Scenario } from '@/data/scenarios';
import {
  SpeakingApiError,
  completeSpeakingSession,
  createSpeakingRealtimeCall,
  createSpeakingRealtimeSession,
  fetchSpeakingCredits,
  getSpeakingRealtimeToken,
  updateSpeakingSessionProgress,
} from '@/services/api/speakingPractice';
import {
  applySpeakingRealtimeAudioRoute,
  resetSpeakingRealtimeAudioRoute,
} from '@/services/audio/speakingRealtimeAudioRoute';
import {
  ENABLE_NATIVE_AUDIO_TAP,
  getUltraNativeSpeechCaptureSupport,
  startUltraNativeSpeechCaptureTurn,
  stopUltraNativeSpeechCaptureTurn,
} from '@/services/audio/ultraNativeSpeechCapture';
import { getUltraSpeechAudioSourceForTurn } from '@/services/audio/ultraSpeechAudioSource';
import { createSpeakingRecorder } from '@/services/audio/recording';
import type { SpeakingRecorderController } from '@/services/audio/recording';
import { type SpeakingRealtimeResponseRequest, SpeakingRealtimeClient } from '@/services/realtime/speakingRealtimeClient';
import type { StoredSession } from '@/types/auth';
import type {
  SpeakingCredits,
  SpeakingScoreResult,
} from '@/services/api/speakingPractice';
import type {
  SpeakingMessage,
  SpeakingRecorderCapability,
  SpeakingRuntimeError,
  SpeakingScoreStage,
  SpeakingStage,
  SpeakingTranscriptItem,
  SpeakingTurnSummary,
} from '@/types/speaking';
import type { SpeakingV2RealtimeTokenResponse, SpeakingV2TransportEvent } from '@/types/speakingV2';
import type {
  SpeakingV1UltraConnectionStatus,
  SpeakingV1UltraMessage,
  SpeakingV1UltraRuntimeError,
  SpeakingV1UltraState,
  SpeakingV1UltraTranscriptSource,
} from '@/types/speakingV1Ultra';

interface SpeakingV1UltraRuntimeInternalState {
  runtimeState: SpeakingV1UltraState;
  connectionStatus: SpeakingV1UltraConnectionStatus;
  sessionId: string | null;
  messages: SpeakingV1UltraMessage[];
  partialUserTranscript: string;
  error: SpeakingV1UltraRuntimeError | null;
  isMicHot: boolean;
  model: string | null;
  voice: string | null;
  turnCount: number;
  transportReady: boolean;
  transportReason: string | null;
}

const INITIAL_STATE: SpeakingV1UltraRuntimeInternalState = {
  runtimeState: 'initializing',
  connectionStatus: 'idle',
  sessionId: null,
  messages: [],
  partialUserTranscript: '',
  error: null,
  isMicHot: false,
  model: null,
  voice: null,
  turnCount: 0,
  transportReady: true,
  transportReason: null,
};

const ENABLE_ULTRA_LOCAL_RECORDING_PROBE = false;
const ENABLE_XFYUN_ANALYSIS_MOCK = __DEV__;
const ENABLE_XFYUN_TRANSCRIPT_MOCK_FOR_USER_BUBBLE = false;
const ULTRA_LOCAL_RECORDING_PROBE_PREFIX = '[ULTRA_LOCAL_RECORDING_PROBE]';
const USER_RECOGNIZING_TEXT = '正在识别…';
const USER_FALLBACK_TEXT = '已发送语音';

type UltraLocalRecordingProbeFailureReason =
  | 'recorder_unavailable'
  | 'permission_denied'
  | 'recorder_start_failed'
  | 'stop_no_uri'
  | 'file_missing'
  | 'file_zero_size'
  | 'recorder_stop_failed'
  | 'audio_session_conflict'
  | 'unknown';

type UltraLocalRecordingProbeResult =
  | {
      roundId: number;
      success: true;
      uri: string;
      exists: boolean;
      size: number | null;
      durationMs: number | null;
      mimeType: string;
      fileName: string;
      webrtcStillResponded: boolean;
    }
  | {
      roundId: number;
      success: false;
      reason: UltraLocalRecordingProbeFailureReason;
      message: string;
      uri?: string | null;
      exists?: boolean;
      size?: number | null;
      durationMs?: number | null;
      mimeType?: string | null;
      fileName?: string | null;
      webrtcStillResponded?: boolean;
    };

type UltraLocalRecordingProbeState = {
  roundId: number | null;
  status: 'idle' | 'starting' | 'recording' | 'stopping' | 'stopped' | 'failed';
  stopRequested: boolean;
  permissionStatus: string | null;
  result: UltraLocalRecordingProbeResult | null;
};

function createMessageId(prefix: 'user' | 'ai') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function summarizeDebugText(text: string, maxLength = 500) {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function logLocalRecordingProbe(step: string, details?: Record<string, unknown>) {
  if (!ENABLE_ULTRA_LOCAL_RECORDING_PROBE) {
    return;
  }
  console.log(`${ULTRA_LOCAL_RECORDING_PROBE_PREFIX} ${step} = ${JSON.stringify(details ?? {})}`);
}

function describeRuntimeError(
  error: unknown,
  fallbackMessage: string,
  fallbackDebugLabel: string,
): { message: string; debugMessage: string } {
  if (error instanceof SpeakingApiError) {
    const raw = summarizeDebugText(error.rawMessage || error.message || fallbackDebugLabel);
    const debugMessage = [fallbackDebugLabel, error.status ? `status=${error.status}` : null, `code=${error.code}`, raw]
      .filter(Boolean)
      .join(' · ');
    return {
      message: error.message || fallbackMessage,
      debugMessage,
    };
  }

  if (error instanceof Error) {
    return {
      message: fallbackMessage,
      debugMessage: summarizeDebugText(`${fallbackDebugLabel}: ${error.message}`),
    };
  }

  return {
    message: fallbackMessage,
    debugMessage: summarizeDebugText(`${fallbackDebugLabel}: ${String(error ?? 'unknown_error')}`),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNonFatalRealtimeConfigError(message: string) {
  return (
    message.includes("Missing required parameter: 'session.type'") ||
    message.includes('input_audio_transcription') ||
    message.includes('session.update')
  );
}

function buildUltraSystemPrompt(scenario: Scenario) {
  return [
    scenario.systemPrompt,
    'Important rules for V1 Ultra turn-based speaking practice:',
    `Stay strictly inside the scenario "${scenario.name}".`,
    `You are ${scenario.aiName}, acting as ${scenario.aiRole}.`,
    'Act like a real conversation partner in this scenario, not a teacher giving long explanations.',
    'Keep every spoken reply short, natural, and easy to follow.',
    'Ask only one short follow-up question at a time.',
    'Do not give long lists, markdown, or long grammar lectures.',
    'Wait for the learner to finish each answer before continuing.',
    'If the learner is unclear, ask one short clarification question instead of changing topics.',
    'Use beginner-friendly spoken English.',
  ].join(' ');
}

function buildOpeningResponseRequest(scenario: Scenario): SpeakingRealtimeResponseRequest {
  return {
    instructions: [
      'Start the scenario now.',
      `You are a ${scenario.aiRole} in the "${scenario.name}" scenario.`,
      `Open with a short spoken line very close to: "${scenario.openingLine}".`,
      'Keep it under two short sentences.',
      'Sound warm and natural.',
    ].join(' '),
    metadata: {
      mode: 'v1_ultra_poc',
      turn: 'opening',
      scenarioId: scenario.id,
    },
  };
}

function buildTranscriptJson(messages: SpeakingV1UltraMessage[]) {
  return messages
    .filter((item) => item.text.trim().length > 0)
    .map((item) => ({
      id: item.id,
      role: item.role === 'ai' ? 'assistant' : 'user',
      text: item.text,
      timestamp: item.timestamp,
      roundId: item.roundId,
      isFinal: !item.isStreaming,
      source: 'realtime',
    }));
}

function buildScoreJson(params: {
  scenario: Scenario;
  turnCount: number;
  model: string | null;
  voice: string | null;
}) {
  return {
    mode: 'v1_ultra_poc',
    scoreStatus: 'not_implemented',
    scenarioId: params.scenario.id,
    turns: params.turnCount,
    transport: {
      model: params.model,
      voice: params.voice,
    },
  };
}

export function useSpeakingV1UltraRuntime({
  session,
  scenario,
}: {
  session: StoredSession | null;
  scenario: Scenario;
}) {
  const [state, setState] = useState<SpeakingV1UltraRuntimeInternalState>(() => INITIAL_STATE);
  const [credits, setCredits] = useState<SpeakingCredits | null>(null);
  const [creditsLoading, setCreditsLoading] = useState(false);
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);
  const [consumedCredits, setConsumedCredits] = useState(0);
  const stateRef = useRef(state);
  const clientRef = useRef<SpeakingRealtimeClient | null>(null);
  const localRecordingProbeRecorderRef = useRef<SpeakingRecorderController | null>(
    ENABLE_ULTRA_LOCAL_RECORDING_PROBE ? createSpeakingRecorder() : null,
  );
  const mountedRef = useRef(true);
  const sessionStartedAtRef = useRef<number | null>(null);
  const userStoppedAtRef = useRef<number | null>(null);
  const currentAiMessageIdRef = useRef<string | null>(null);
  const aiTextBufferRef = useRef('');
  const openingRequestedRef = useRef(false);
  const openingCompletedRef = useRef(false);
  const pendingUserTurnRef = useRef(false);
  const currentRoundIdRef = useRef(1);
  const noSpeechTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressSyncRef = useRef({
    inFlight: false,
    queuedTurnCount: null as number | null,
    lastSyncedTurnCount: 0,
  });
  const firstUserDeltaLoggedRoundRef = useRef<number | null>(null);
  const firstAssistantDeltaLoggedMessageIdRef = useRef<string | null>(null);
  const assistantAudioLoggedMessageIdRef = useRef<string | null>(null);
  const currentUserMessageIdRef = useRef<string | null>(null);
  const awaitingUserTranscriptRef = useRef(false);
  const nativeAudioTapTurnRef = useRef<{
    turnId: string | null;
    roundId: number | null;
    stopRequested: boolean;
  }>({
    turnId: null,
    roundId: null,
    stopRequested: false,
  });
  const assistantResponseCreatedAtRef = useRef<number | null>(null);
  const assistantFirstDeltaAtRef = useRef<number | null>(null);
  const assistantAudioStartedAtRef = useRef<number | null>(null);
  const assistantResponseDoneRef = useRef(false);
  const assistantAudioPlayingRef = useRef(false);
  const assistantDoneFallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentAssistantResponseIdRef = useRef<string | null>(null);
  const currentAssistantRoundIdRef = useRef<number>(0);
  const assistantResponseRoundIdMapRef = useRef<Map<string, number>>(new Map());
  const completedAssistantResponseIdsRef = useRef<Set<string>>(new Set());
  const localRecordingProbeStateRef = useRef<UltraLocalRecordingProbeState>({
    roundId: null,
    status: 'idle',
    stopRequested: false,
    permissionStatus: null,
    result: null,
  });
  const sessionStartPromiseRef = useRef<Promise<void> | null>(null);
  const endingRef = useRef(false);
  const sessionCreateStartedAtRef = useRef<number | null>(null);
  const sessionCreateDoneAtRef = useRef<number | null>(null);
  const tokenFetchStartedAtRef = useRef<number | null>(null);
  const tokenFetchDoneAtRef = useRef<number | null>(null);
  const webrtcConnectStartedAtRef = useRef<number | null>(null);
  const localOfferCreatedAtRef = useRef<number | null>(null);
  const callRequestStartedAtRef = useRef<number | null>(null);
  const callResponseAtRef = useRef<number | null>(null);
  const remoteAnswerSetAtRef = useRef<number | null>(null);
  const dataChannelOpenAtRef = useRef<number | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const patchState = useCallback((patch: Partial<SpeakingV1UltraRuntimeInternalState>) => {
    if (!mountedRef.current) return;
    stateRef.current = {
      ...stateRef.current,
      ...patch,
    };
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const logPerf = useCallback(
    (
      step: string,
      details?: Record<string, string | number | boolean | null | undefined>,
    ) => {
      const now = Date.now();
      const payload = {
        timestamp: new Date(now).toISOString(),
        step,
        elapsedMsFromSessionStart: sessionStartedAtRef.current ? now - sessionStartedAtRef.current : null,
        elapsedMsFromUserStop: userStoppedAtRef.current ? now - userStoppedAtRef.current : null,
        currentState: stateRef.current.runtimeState,
        roundId: currentRoundIdRef.current,
        ...details,
      };
      console.log(`[V1_ULTRA_PERF] ${JSON.stringify(payload)}`);
    },
    [],
  );

  const logDebug = useCallback((step: string, details?: Record<string, unknown>) => {
    console.log(`[V1_ULTRA_DEBUG] ${step} = ${JSON.stringify(details ?? {})}`);
  }, []);

  const logTransportDebug = useCallback((step: string, details?: Record<string, unknown>) => {
    console.log(`[V1_ULTRA_TRANSPORT_DEBUG] ${step} = ${JSON.stringify(details ?? {})}`);
  }, []);

  const logError = useCallback((step: string, details?: Record<string, unknown>) => {
    console.log(`[V1_ULTRA_ERROR] ${step} = ${JSON.stringify(details ?? {})}`);
  }, []);

  const logTranscript = useCallback((step: string, details?: Record<string, unknown>) => {
    console.log(`[V1_TRANSCRIPT] ${step} = ${JSON.stringify(details ?? {})}`);
  }, []);

  const logXfyun = useCallback((step: string, details?: Record<string, unknown>) => {
    console.log(`[V1_XFYUN] ${step} = ${JSON.stringify(details ?? {})}`);
  }, []);

  const logNativeAudioTap = useCallback((step: string, details?: Record<string, unknown>) => {
    console.log(`[NATIVE_AUDIO_TAP] ${step} = ${JSON.stringify(details ?? {})}`);
  }, []);

  const clearNoSpeechTimeout = useCallback(() => {
    if (noSpeechTimeoutRef.current) {
      clearTimeout(noSpeechTimeoutRef.current);
      noSpeechTimeoutRef.current = null;
    }
  }, []);

  const clearAssistantDoneFallbackTimeout = useCallback(() => {
    if (assistantDoneFallbackTimeoutRef.current) {
      clearTimeout(assistantDoneFallbackTimeoutRef.current);
      assistantDoneFallbackTimeoutRef.current = null;
    }
  }, []);

  const buildNativeTapTurnId = useCallback((roundId: number) => `ultra_round_${roundId}`, []);

  const summarizeLocalRecordingProbeResult = useCallback((roundId?: number | null) => {
    const probe = localRecordingProbeStateRef.current;
    if (!probe.result) {
      return {
        roundId: roundId ?? probe.roundId,
        success: null,
        status: probe.status,
      };
    }
    if (roundId != null && probe.result.roundId !== roundId) {
      return {
        roundId,
        success: null,
        status: probe.status,
      };
    }
    return probe.result;
  }, []);

  const markLocalRecordingProbeWebrtcResponded = useCallback((roundId?: number | null) => {
    if (roundId == null) return;
    const probe = localRecordingProbeStateRef.current;
    if (!probe.result || probe.result.roundId !== roundId) {
      return;
    }
    probe.result = {
      ...probe.result,
      webrtcStillResponded: true,
    };
  }, []);

  const waitForProbeFile = useCallback(async (uri: string) => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const info = await FileSystem.getInfoAsync(uri);
      const size = 'size' in info && typeof info.size === 'number' ? info.size : null;
      logLocalRecordingProbe('file_info_attempt', {
        attempt,
        uri,
        exists: info.exists,
        size,
      });
      if (info.exists && (size == null || size > 0)) {
        return {
          exists: info.exists,
          size,
        };
      }
      if (attempt < 3) {
        await sleep(160);
      }
    }

    const finalInfo = await FileSystem.getInfoAsync(uri);
    return {
      exists: finalInfo.exists,
      size: 'size' in finalInfo && typeof finalInfo.size === 'number' ? finalInfo.size : null,
    };
  }, []);

  const resolveAssistantResponseContext = useCallback((responseId?: string | null) => {
    const resolvedResponseId = responseId || currentAssistantResponseIdRef.current;
    const mappedRoundId =
      (resolvedResponseId ? assistantResponseRoundIdMapRef.current.get(resolvedResponseId) : null) ??
      currentAssistantRoundIdRef.current ??
      currentRoundIdRef.current;
    return {
      resolvedResponseId,
      mappedRoundId,
    };
  }, []);

  const startLocalRecordingProbe = useCallback(async (roundId: number) => {
    if (!ENABLE_ULTRA_LOCAL_RECORDING_PROBE) {
      return;
    }

    const recorder = localRecordingProbeRecorderRef.current;
    const probe = localRecordingProbeStateRef.current;
    const webrtcState = {
      connectionStatus: stateRef.current.connectionStatus,
      transportConnected: clientRef.current?.isConnected ?? false,
      dataChannelOpen: clientRef.current?.isDataChannelOpen ?? false,
    };

    logLocalRecordingProbe('probe_enabled', {
      enabled: true,
      roundId,
    });
    logLocalRecordingProbe('start_requested', {
      roundId,
      webrtc_state: webrtcState,
      runtime_state: stateRef.current.runtimeState,
      mic_enabled: !(clientRef.current?.isMicMuted ?? true),
      localTrackEnabled: clientRef.current?.localAudioTrackEnabled ?? null,
      probeStatus: probe.status,
    });

    if (!recorder) {
      probe.roundId = roundId;
      probe.status = 'failed';
      probe.stopRequested = false;
      probe.result = {
        roundId,
        success: false,
        reason: 'recorder_unavailable',
        message: 'local recorder unavailable',
        webrtcStillResponded: false,
      };
      logLocalRecordingProbe('recorder_start_failed', {
        roundId,
        reason: 'recorder_unavailable',
      });
      logLocalRecordingProbe('final_result', probe.result);
      return;
    }

    if (probe.status === 'recording' && probe.roundId === roundId) {
      return;
    }

    probe.roundId = roundId;
    probe.status = 'starting';
    probe.stopRequested = false;
    probe.result = null;
    logLocalRecordingProbe('recorder_start_before', {
      roundId,
      provider: recorder.capability.provider,
    });

    try {
      const permission = await recorder.requestPermissions();
      probe.permissionStatus = permission.granted ? 'granted' : permission.canAskAgain ? 'denied_can_ask_again' : 'denied';
      logLocalRecordingProbe('permission_status', {
        roundId,
        granted: permission.granted,
        canAskAgain: permission.canAskAgain ?? null,
        status: probe.permissionStatus,
      });
      if (!permission.granted) {
        probe.status = 'failed';
        probe.result = {
          roundId,
          success: false,
          reason: 'permission_denied',
          message: 'recording permission denied',
          webrtcStillResponded: false,
        };
        logLocalRecordingProbe('recorder_start_failed', probe.result);
        logLocalRecordingProbe('final_result', probe.result);
        return;
      }

      await recorder.start();
      probe.status = 'recording';
      logLocalRecordingProbe('recorder_start_success', {
        roundId,
        provider: recorder.capability.provider,
      });
    } catch (error) {
      probe.status = 'failed';
      probe.result = {
        roundId,
        success: false,
        reason: 'recorder_start_failed',
        message: normalizeError(error, 'recorder start failed'),
        webrtcStillResponded: false,
      };
      logLocalRecordingProbe('recorder_start_failed', {
        roundId,
        message: normalizeError(error, 'recorder start failed'),
      });
      logLocalRecordingProbe('final_result', probe.result);
    }
  }, []);

  const stopLocalRecordingProbe = useCallback(async (reason: 'manual' | 'speech_stopped' | 'cleanup' | 'error') => {
    if (!ENABLE_ULTRA_LOCAL_RECORDING_PROBE) {
      return;
    }

    const recorder = localRecordingProbeRecorderRef.current;
    const probe = localRecordingProbeStateRef.current;
    const roundId = probe.roundId ?? currentRoundIdRef.current;

    logLocalRecordingProbe('stop_requested', {
      roundId,
      stop_reason: reason,
      probeStatus: probe.status,
      alreadyRequested: probe.stopRequested,
    });

    if (!recorder) {
      return;
    }

    if (probe.stopRequested || (probe.status !== 'recording' && probe.status !== 'starting')) {
      return;
    }

    probe.stopRequested = true;
    probe.status = 'stopping';
    logLocalRecordingProbe('recorder_stop_before', {
      roundId,
      stop_reason: reason,
    });

    try {
      const result = await recorder.stop();
      logLocalRecordingProbe('recorder_stop_success', {
        roundId,
        hasResult: !!result,
      });

      if (!result?.uri) {
        probe.status = 'failed';
        probe.result = {
          roundId,
          success: false,
          reason: 'stop_no_uri',
          message: 'stop finished without uri',
          webrtcStillResponded: false,
        };
        logLocalRecordingProbe('final_result', probe.result);
        return;
      }

      const fileInfo = await waitForProbeFile(result.uri);
      const exists = !!fileInfo.exists;
      const size = fileInfo.size ?? result.size ?? null;
      const success = exists && (size == null || size > 0);
      const finalResult: UltraLocalRecordingProbeResult = success
        ? {
            roundId,
            success: true,
            uri: result.uri,
            exists,
            size,
            durationMs: result.durationMs ?? null,
            mimeType: result.mimeType,
            fileName: result.fileName,
            webrtcStillResponded: false,
          }
        : {
            roundId,
            success: false,
            reason: exists ? 'file_zero_size' : 'file_missing',
            message: exists ? 'recorded file size is zero' : 'recorded file missing',
            uri: result.uri,
            exists,
            size,
            durationMs: result.durationMs ?? null,
            mimeType: result.mimeType,
            fileName: result.fileName,
            webrtcStillResponded: false,
          };

      probe.status = success ? 'stopped' : 'failed';
      probe.result = finalResult;
      logLocalRecordingProbe('uri', {
        roundId,
        uri: result.uri,
      });
      logLocalRecordingProbe('durationMs', {
        roundId,
        durationMs: result.durationMs ?? null,
      });
      logLocalRecordingProbe('fileName', {
        roundId,
        fileName: result.fileName,
      });
      logLocalRecordingProbe('mimeType', {
        roundId,
        mimeType: result.mimeType,
      });
      logLocalRecordingProbe('exists', {
        roundId,
        exists,
      });
      logLocalRecordingProbe('size', {
        roundId,
        size,
      });
      logLocalRecordingProbe('final_result', finalResult);
    } catch (error) {
      const message = normalizeError(error, 'recorder stop failed');
      probe.status = 'failed';
      probe.result = {
        roundId,
        success: false,
        reason: message.includes('audio session') ? 'audio_session_conflict' : 'recorder_stop_failed',
        message,
        webrtcStillResponded: false,
      };
      logLocalRecordingProbe('recorder_stop_failed', {
        roundId,
        message,
      });
      logLocalRecordingProbe('final_result', probe.result);
    }
  }, [waitForProbeFile]);

  const cleanupLocalRecordingProbe = useCallback(async () => {
    if (!ENABLE_ULTRA_LOCAL_RECORDING_PROBE) {
      return;
    }
    await localRecordingProbeRecorderRef.current?.cleanup().catch(() => undefined);
  }, []);

  const refreshCredits = useCallback(async () => {
    if (!session) return null;
    setCreditsLoading(true);
    try {
      const nextCredits = await fetchSpeakingCredits(session);
      if (!mountedRef.current) return nextCredits;
      setCredits(nextCredits);
      return nextCredits;
    } catch (error) {
      const described = describeRuntimeError(error, '加载口语额度失败。', 'credits failed');
      logError('credits_failed', {
        message: described.message,
        debugMessage: described.debugMessage,
      });
      return null;
    } finally {
      if (mountedRef.current) {
        setCreditsLoading(false);
      }
    }
  }, [logError, session]);

  const disconnectTransport = useCallback(async () => {
    clearNoSpeechTimeout();
    clearAssistantDoneFallbackTimeout();
    if (!clientRef.current) return;
    clientRef.current.setEventHandler(null);
    await clientRef.current.disconnect().catch(() => undefined);
  }, [clearAssistantDoneFallbackTimeout, clearNoSpeechTimeout]);

  const resetAudioRoute = useCallback(async () => {
    await resetSpeakingRealtimeAudioRoute().catch(() => undefined);
  }, []);

  const updateMessages = useCallback(
    (updater: (messages: SpeakingV1UltraMessage[]) => SpeakingV1UltraMessage[]) => {
      if (!mountedRef.current) return;
      setState((prev) => {
        const nextMessages = updater(prev.messages);
        const nextState = { ...prev, messages: nextMessages };
        stateRef.current = nextState;
        return nextState;
      });
    },
    [],
  );

  const upsertMessage = useCallback(
    (message: SpeakingV1UltraMessage) => {
      updateMessages((messages) => {
        const index = messages.findIndex((item) => item.id === message.id);
        if (index === -1) {
          return [...messages, message];
        }
        const next = [...messages];
        next[index] = {
          ...next[index],
          ...message,
        };
        return next;
      });
    },
    [updateMessages],
  );

  const patchMessage = useCallback(
    (messageId: string, patch: Partial<SpeakingV1UltraMessage>) => {
      updateMessages((messages) =>
        messages.map((item) => (item.id === messageId ? { ...item, ...patch } : item)),
      );
    },
    [updateMessages],
  );

  const removeMessage = useCallback(
    (messageId: string) => {
      updateMessages((messages) => messages.filter((item) => item.id !== messageId));
    },
    [updateMessages],
  );

  const findMessageById = useCallback((messageId: string | null | undefined) => {
    if (!messageId) return null;
    return stateRef.current.messages.find((item) => item.id === messageId) ?? null;
  }, []);

  const applyUserTranscriptToRound = useCallback(
    ({
      roundId,
      messageId,
      transcript,
      source,
      isFinal,
      reason,
    }: {
      roundId: number;
      messageId?: string | null;
      transcript: string;
      source: SpeakingV1UltraTranscriptSource;
      isFinal: boolean;
      reason?: string | null;
    }) => {
      if (source === 'mock' && !ENABLE_XFYUN_TRANSCRIPT_MOCK_FOR_USER_BUBBLE) {
        logXfyun('mock_transcript_skipped_for_user_bubble', {
          roundId,
          reason: reason ?? 'mock_transcript_disabled_for_formal_v1',
        });
        return currentUserMessageIdRef.current;
      }

      const resolvedMessageId = messageId || currentUserMessageIdRef.current || createMessageId('user');
      const previousMessage = findMessageById(resolvedMessageId);
      const nextText = transcript.trim() || (isFinal ? USER_FALLBACK_TEXT : USER_RECOGNIZING_TEXT);
      const nextStatus = !isFinal
        ? 'pending_transcript'
        : source === 'fallback'
          ? 'transcript_failed'
          : 'transcript_ready';
      const payload: SpeakingV1UltraMessage = {
        id: resolvedMessageId,
        role: 'user',
        text: nextText,
        timestamp: previousMessage?.timestamp ?? Date.now(),
        roundId,
        isStreaming: false,
        transcriptStatus: nextStatus,
        transcriptSource: source,
      };

      if (!previousMessage) {
        logTranscript('user_message_created', {
          roundId,
          messageId: resolvedMessageId,
          initialText: nextText,
          status: nextStatus,
        });
      }

      logTranscript('apply_user_transcript', {
        roundId,
        messageId: resolvedMessageId,
        source,
        isFinal,
        transcriptPreview: nextText.slice(0, 80),
        replacedPreviousText: previousMessage?.text ?? null,
      });

      upsertMessage(payload);
      currentUserMessageIdRef.current = resolvedMessageId;

      if (previousMessage && previousMessage.text !== nextText) {
        logTranscript('user_message_replaced', {
          roundId,
          messageId: resolvedMessageId,
          from: previousMessage.text,
          to: nextText,
          source,
        });
      }

      if (source === 'fallback') {
        logTranscript('fallback_user_message_used', {
          roundId,
          messageId: resolvedMessageId,
          reason: reason ?? 'fallback_transcript_applied',
        });
      }

      if (source === 'xfyun_rtasr' && isFinal) {
        logXfyun('transcript_synced_to_user_bubble', {
          roundId,
          messageId: resolvedMessageId,
          transcriptPreview: nextText.slice(0, 80),
        });
      }

      return resolvedMessageId;
    },
    [findMessageById, logTranscript, logXfyun, upsertMessage],
  );

  const clearPendingUserMessage = useCallback(
    (reason: string) => {
      const messageId = currentUserMessageIdRef.current;
      const message = findMessageById(messageId);
      if (!message || message.role !== 'user' || message.transcriptStatus !== 'pending_transcript') {
        return;
      }
      removeMessage(message.id);
      currentUserMessageIdRef.current = null;
      logTranscript('pending_user_message_cleared', {
        roundId: message.roundId,
        messageId: message.id,
        reason,
      });
    },
    [findMessageById, logTranscript, removeMessage],
  );

  const logXfyunFeatureStateForTurn = useCallback(
    async (roundId: number) => {
      const audioSource = await getUltraSpeechAudioSourceForTurn(buildNativeTapTurnId(roundId));
      const canUseApi = audioSource.type === 'native_tap' || audioSource.type === 'uploaded_file';
      const mode = canUseApi ? 'api' : ENABLE_XFYUN_ANALYSIS_MOCK ? 'mock' : 'disabled';
      const transcriptSource = canUseApi ? 'xfyun_rtasr' : 'fallback';
      const analysisSource = canUseApi ? 'api' : ENABLE_XFYUN_ANALYSIS_MOCK ? 'mock' : 'disabled';

      logXfyun('feature_state', {
        enabled: mode !== 'disabled',
        mode,
        audioSource,
        transcriptSource,
        analysisSource,
        canUpdateUserBubble: canUseApi,
      });

      if (!canUseApi) {
        logXfyun('user_audio_source_missing', {
          roundId,
          reason:
            audioSource.type === 'none'
              ? audioSource.reason
              : 'formal_v1_requires_native_tap_or_uploaded_file_audio_source',
          consequence: 'cannot_call_rtasr_or_ise',
        });
      }

      if (analysisSource === 'mock') {
        logXfyun('mock_analysis_used', {
          roundId,
          reason: 'dev_mock_analysis_enabled_without_real_audio_source',
        });
      }
    },
    [buildNativeTapTurnId, logXfyun],
  );

  const startNativeAudioTapForRound = useCallback(
    async (roundId: number) => {
      if (!ENABLE_NATIVE_AUDIO_TAP) {
        logNativeAudioTap('disabled', {
          reason: 'protect_realtime_audio_playback',
        });
        nativeAudioTapTurnRef.current = {
          turnId: null,
          roundId: null,
          stopRequested: false,
        };
        return;
      }

      const turnId = buildNativeTapTurnId(roundId);
      nativeAudioTapTurnRef.current = {
        turnId,
        roundId,
        stopRequested: false,
      };

      const support = await getUltraNativeSpeechCaptureSupport().catch((error) => ({
        supported: false,
        platform: 'ios' as const,
        reason: normalizeError(error, 'support_check_failed'),
      }));
      logNativeAudioTap('support_check', support);

      logNativeAudioTap('start_requested', {
        turnId,
        roundId,
      });

      if (!support.supported) {
        logNativeAudioTap('start_failed', {
          turnId,
          roundId,
          reason: support.reason ?? 'native_tap_not_supported',
        });
        return;
      }

      try {
        const result = await startUltraNativeSpeechCaptureTurn(turnId);
        if (!result.ok) {
          logNativeAudioTap('start_failed', {
            turnId,
            roundId,
            reason: 'native_start_returned_not_ok',
          });
          return;
        }
        logNativeAudioTap('start_success', {
          turnId,
          roundId,
        });
      } catch (error) {
        logNativeAudioTap('start_failed', {
          turnId,
          roundId,
          reason: normalizeError(error, 'native_start_failed'),
        });
      }
    },
    [buildNativeTapTurnId, logNativeAudioTap],
  );

  const stopNativeAudioTapForActiveRound = useCallback(
    async (reason: 'manual' | 'speech_stopped' | 'cleanup') => {
      const activeTurn = nativeAudioTapTurnRef.current;
      if (!activeTurn.turnId || activeTurn.roundId == null || activeTurn.stopRequested) {
        return;
      }

      nativeAudioTapTurnRef.current = {
        ...activeTurn,
        stopRequested: true,
      };

      logNativeAudioTap('stop_requested', {
        turnId: activeTurn.turnId,
        roundId: activeTurn.roundId,
        reason,
      });

      try {
        const result = await stopUltraNativeSpeechCaptureTurn(activeTurn.turnId);
        if (!result.ok || !result.uri) {
          logNativeAudioTap('stop_failed', {
            turnId: activeTurn.turnId,
            roundId: activeTurn.roundId,
            reason: result.reason ?? 'missing_uri',
          });
          return;
        }

        logNativeAudioTap('stop_success', {
          turnId: activeTurn.turnId,
          roundId: activeTurn.roundId,
          uri: result.uri,
          durationMs: result.durationMs ?? null,
          size: result.size ?? null,
          sampleRate: result.sampleRate ?? null,
          channels: result.channels ?? null,
        });

        const audioSource = await getUltraSpeechAudioSourceForTurn(activeTurn.turnId);
        if (audioSource.type !== 'none') {
          logXfyun('audio_source_ready', {
            roundId: activeTurn.roundId,
            type: audioSource.type,
            uri: 'uri' in audioSource ? audioSource.uri ?? null : null,
            durationMs: 'durationMs' in audioSource ? audioSource.durationMs ?? null : null,
            size: 'size' in audioSource ? audioSource.size ?? null : null,
          });
          logXfyun('feature_state', {
            enabled: true,
            mode: 'api',
            audioSource,
            transcriptSource: 'xfyun_rtasr',
            analysisSource: 'api',
            canUpdateUserBubble: true,
          });
        }
      } catch (error) {
        logNativeAudioTap('stop_failed', {
          turnId: activeTurn.turnId,
          roundId: activeTurn.roundId,
          reason: normalizeError(error, 'native_stop_failed'),
        });
      } finally {
        nativeAudioTapTurnRef.current = {
          turnId: null,
          roundId: null,
          stopRequested: false,
        };
      }
    },
    [logNativeAudioTap, logXfyun],
  );

  const syncProgress = useCallback(
    async (turnCount: number) => {
      if (!session || !stateRef.current.sessionId || turnCount <= 0) {
        return;
      }

      const tracker = progressSyncRef.current;
      if (turnCount <= tracker.lastSyncedTurnCount) {
        return;
      }

      if (tracker.inFlight) {
        tracker.queuedTurnCount = Math.max(tracker.queuedTurnCount ?? 0, turnCount);
        return;
      }

      tracker.inFlight = true;
      let targetTurnCount = turnCount;

      try {
        while (targetTurnCount > tracker.lastSyncedTurnCount) {
          const progress = await updateSpeakingSessionProgress(
            session,
            stateRef.current.sessionId,
            targetTurnCount,
          );
          if (mountedRef.current) {
            setConsumedCredits(progress.consumedCredits);
            const nextBalanceCredits = progress.balanceCreditsAfter;
            if (typeof nextBalanceCredits === 'number') {
              setCredits((prev) =>
                prev
                  ? {
                      ...prev,
                      balanceCredits: nextBalanceCredits,
                    }
                  : prev,
              );
            }
          }
          tracker.lastSyncedTurnCount = Math.max(
            tracker.lastSyncedTurnCount,
            progress.turnCount,
            targetTurnCount,
          );

          const queuedTurnCount = tracker.queuedTurnCount;
          if (!queuedTurnCount || queuedTurnCount <= tracker.lastSyncedTurnCount) {
            tracker.queuedTurnCount = null;
            return;
          }

          targetTurnCount = queuedTurnCount;
          tracker.queuedTurnCount = null;
        }
      } catch (error) {
        console.log('[V1_ULTRA] progress:error', normalizeError(error, '同步进度失败'));
      } finally {
        tracker.inFlight = false;
      }
    },
    [session],
  );

  const requestOpeningResponse = useCallback(async () => {
    if (!clientRef.current || openingRequestedRef.current) {
      return;
    }

    const request = buildOpeningResponseRequest(scenario);
    logDebug('opening_request_start', {
      hasDataChannelOpen: clientRef.current.isDataChannelOpen,
      payloadKeys: Object.keys(request),
      responseKeys: [
        request.instructions ? 'instructions' : null,
        request.metadata ? 'metadata' : null,
      ].filter(Boolean),
    });

    openingRequestedRef.current = true;
    clientRef.current.muteMic();
    patchState({
      runtimeState: 'assistantThinking',
      isMicHot: false,
      error: null,
    });

    let lastError: unknown = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        clientRef.current.requestResponse(request);
        logDebug('opening_request_sent', {
          attempt: attempt + 1,
          hasDataChannelOpen: clientRef.current.isDataChannelOpen,
          payloadKeys: ['type', 'response'],
          responseKeys: [
            request.instructions ? 'instructions' : null,
            request.metadata ? 'metadata' : null,
          ].filter(Boolean),
        });
        return;
      } catch (error) {
        lastError = error;
        logTransportDebug('opening_request_retry', {
          attempt: attempt + 1,
          hasDataChannelOpen: clientRef.current.isDataChannelOpen,
          message: normalizeError(error, 'opening_request_failed'),
        });
        await sleep(180);
      }
    }

    const described = describeRuntimeError(lastError, '发送开场指令失败。', 'opening failed');
    logError('opening_request_failed', {
      message: described.message,
      debugMessage: described.debugMessage,
    });
    patchState({
      runtimeState: 'error',
      connectionStatus: 'error',
      error: { scope: 'opening', message: described.message, debugMessage: described.debugMessage },
    });
  }, [logDebug, logError, logTransportDebug, patchState, scenario]);

  const buildCompletePayload = useCallback(
    (status: 'completed' | 'aborted') => ({
      status,
      transcriptJson: buildTranscriptJson(stateRef.current.messages),
      scoreJson: buildScoreJson({
        scenario,
        turnCount: stateRef.current.turnCount,
        model: stateRef.current.model,
        voice: stateRef.current.voice,
      }),
    }),
    [scenario],
  );

  const closeSessionRecord = useCallback(
    async (status: 'completed' | 'aborted') => {
      if (!session || !stateRef.current.sessionId) {
        return;
      }

      try {
        await completeSpeakingSession(session, stateRef.current.sessionId, buildCompletePayload(status));
      } catch (error) {
        throw new Error(normalizeError(error, '结束 Ultra 会话失败。'));
      }
    },
    [buildCompletePayload, session],
  );

  const closeSessionRecordById = useCallback(
    async (sessionId: string, status: 'completed' | 'aborted') => {
      if (!session) {
        return;
      }

      try {
        await completeSpeakingSession(session, sessionId, buildCompletePayload(status));
      } catch (error) {
        console.log('[V1_ULTRA] complete-by-id:error', normalizeError(error, '补偿结束会话失败'));
      }
    },
    [buildCompletePayload, session],
  );

  const bestEffortAbortExistingSession = useCallback(async () => {
    const activeSessionId = stateRef.current.sessionId;
    if (!session || !activeSessionId) {
      return;
    }

    try {
      await completeSpeakingSession(session, activeSessionId, buildCompletePayload('aborted'));
    } catch (error) {
      console.log('[V1_ULTRA] abort-session:error', normalizeError(error, '放弃旧会话失败'));
    }
  }, [buildCompletePayload, session]);

  const finalizeAssistantTurnIfComplete = useCallback(
    (params?: {
      responseId?: string | null;
      reason?: 'audio_stopped' | 'response_done_fallback' | 'response_done';
    }) => {
    if (!assistantResponseDoneRef.current) {
      return;
    }

    if (assistantAudioPlayingRef.current) {
      return;
    }

    clearAssistantDoneFallbackTimeout();
    const { resolvedResponseId, mappedRoundId } = resolveAssistantResponseContext(params?.responseId);

    if (
      resolvedResponseId &&
      completedAssistantResponseIdsRef.current.has(resolvedResponseId)
    ) {
      if (params?.reason === 'audio_stopped') {
        logTransportDebug('assistant_audio_stopped_late', {
          responseId: resolvedResponseId,
          mappedRoundId,
          currentRoundId: currentRoundIdRef.current,
          ignoredDuplicate: true,
        });
      }
      return;
    }

    if (!openingCompletedRef.current) {
      openingCompletedRef.current = true;
      patchState({
        runtimeState: 'waitingUser',
        isMicHot: false,
        error: null,
      });
      if (resolvedResponseId) {
        completedAssistantResponseIdsRef.current.add(resolvedResponseId);
        if (currentAssistantResponseIdRef.current === resolvedResponseId) {
          currentAssistantResponseIdRef.current = null;
        }
      }
      return;
    }

    if (pendingUserTurnRef.current) {
      const nextTurnCount = stateRef.current.turnCount + 1;
      pendingUserTurnRef.current = false;
      awaitingUserTranscriptRef.current = false;
      const finalizedAt = Date.now();
      patchState({
        runtimeState: 'waitingUser',
        isMicHot: false,
        turnCount: nextTurnCount,
        error: null,
      });
      logPerf('ultra_round_done', {
        summary: `turn_${mappedRoundId}`,
        roundId: mappedRoundId,
        turnCount: nextTurnCount,
        userStopToAssistantFirstDeltaMs:
          userStoppedAtRef.current && assistantFirstDeltaAtRef.current
            ? assistantFirstDeltaAtRef.current - userStoppedAtRef.current
            : null,
        userStopToAssistantAudioStartedMs:
          userStoppedAtRef.current && assistantAudioStartedAtRef.current
            ? assistantAudioStartedAtRef.current - userStoppedAtRef.current
            : null,
        assistantTotalMs:
          assistantResponseCreatedAtRef.current != null
            ? finalizedAt - assistantResponseCreatedAtRef.current
            : null,
      });
      logLocalRecordingProbe('ultra_round_done_probe_summary', {
        roundId: mappedRoundId,
        probe: summarizeLocalRecordingProbeResult(mappedRoundId),
      });
      void syncProgress(nextTurnCount);
      currentRoundIdRef.current = Math.max(currentRoundIdRef.current, mappedRoundId + 1);
      currentUserMessageIdRef.current = null;
      if (resolvedResponseId) {
        completedAssistantResponseIdsRef.current.add(resolvedResponseId);
        if (currentAssistantResponseIdRef.current === resolvedResponseId) {
          currentAssistantResponseIdRef.current = null;
        }
      }
      return;
    }

    patchState({
      runtimeState: 'waitingUser',
      isMicHot: false,
      error: null,
    });
    if (resolvedResponseId) {
      completedAssistantResponseIdsRef.current.add(resolvedResponseId);
      if (currentAssistantResponseIdRef.current === resolvedResponseId) {
        currentAssistantResponseIdRef.current = null;
      }
    }
  }, [
    clearAssistantDoneFallbackTimeout,
    logPerf,
    logTransportDebug,
    patchState,
    resolveAssistantResponseContext,
    summarizeLocalRecordingProbeResult,
    syncProgress,
  ]);

  const handleTransportEvent = useCallback(
    (event: SpeakingV2TransportEvent) => {
      switch (event.type) {
        case 'connected':
          logTransportDebug('webrtc_connected_event', {
            hasDataChannelOpen: clientRef.current?.isDataChannelOpen ?? false,
          });
          patchState({
            connectionStatus: 'connected',
            runtimeState: 'ready',
            error: null,
          });
          logPerf('ultra_webrtc_connected', {
            summary: 'peer_connected',
            webrtcOfferMs:
              webrtcConnectStartedAtRef.current && localOfferCreatedAtRef.current
                ? localOfferCreatedAtRef.current - webrtcConnectStartedAtRef.current
                : null,
            callsSdpMs:
              callRequestStartedAtRef.current && callResponseAtRef.current
                ? callResponseAtRef.current - callRequestStartedAtRef.current
                : null,
            remoteAnswerSetMs:
              callResponseAtRef.current && remoteAnswerSetAtRef.current
                ? remoteAnswerSetAtRef.current - callResponseAtRef.current
                : null,
          });
          if (clientRef.current?.isDataChannelOpen) {
            void requestOpeningResponse();
          }
          return;
        case 'local_offer_created':
          localOfferCreatedAtRef.current = Date.now();
          logPerf('ultra_webrtc_local_offer_created', {
            summary: 'local_offer_created',
            offerLength: event.offerLength,
            webrtcOfferMs:
              webrtcConnectStartedAtRef.current && localOfferCreatedAtRef.current
                ? localOfferCreatedAtRef.current - webrtcConnectStartedAtRef.current
                : null,
          });
          return;
        case 'remote_answer_set':
          remoteAnswerSetAtRef.current = Date.now();
          logPerf('ultra_webrtc_remote_answer_set', {
            summary: 'remote_answer_set',
            answerLength: event.answerLength,
            remoteAnswerSetMs:
              callResponseAtRef.current && remoteAnswerSetAtRef.current
                ? remoteAnswerSetAtRef.current - callResponseAtRef.current
                : null,
          });
          return;
        case 'datachannel_open':
          dataChannelOpenAtRef.current = Date.now();
          logTransportDebug('datachannel_open_event', {
            connectionStatus: stateRef.current.connectionStatus,
            runtimeState: stateRef.current.runtimeState,
          });
          logDebug('input_transcription_disabled', {
            reason: 'current_realtime_session_schema_rejects_input_audio_transcription',
          });
          patchState({
            error: null,
          });
          logPerf('datachannel_open', {
            summary: 'datachannel_open',
            datachannelOpenMs:
              webrtcConnectStartedAtRef.current && dataChannelOpenAtRef.current
                ? dataChannelOpenAtRef.current - webrtcConnectStartedAtRef.current
                : null,
          });
          if (!openingRequestedRef.current) {
            void requestOpeningResponse();
          }
          return;
        case 'disconnected':
          clearNoSpeechTimeout();
          if (endingRef.current || stateRef.current.connectionStatus === 'completed') {
            return;
          }
          patchState({
            connectionStatus: 'disconnected',
            runtimeState: 'error',
            isMicHot: false,
            error: {
              scope: 'transport',
              message: 'Realtime 连接已断开，请重试连接。',
              debugMessage: 'transport disconnected before session completed',
            },
          });
          return;
        case 'error':
          clearNoSpeechTimeout();
          logError('transport_event_error', {
            message: event.message,
          });
          if (isNonFatalRealtimeConfigError(event.message)) {
            logDebug('non_fatal_realtime_config_error', {
              message: summarizeDebugText(event.message),
            });
            patchState({
              error: null,
            });
            return;
          }
          patchState({
            connectionStatus: 'error',
            runtimeState: 'error',
            isMicHot: false,
            error: {
              scope: 'transport',
              message: '口语服务异常，请稍后再试。',
              debugMessage: summarizeDebugText(event.message),
            },
          });
          return;
        case 'user_speech_started':
          clearNoSpeechTimeout();
          awaitingUserTranscriptRef.current = false;
          applyUserTranscriptToRound({
            roundId: currentRoundIdRef.current,
            transcript: USER_RECOGNIZING_TEXT,
            source: 'pending',
            isFinal: false,
            reason: 'user_speech_started',
          });
          logPerf('user_speech_started', { summary: 'speech_started' });
          logLocalRecordingProbe('user_speech_started_probe_state', {
            roundId: localRecordingProbeStateRef.current.roundId,
            status: localRecordingProbeStateRef.current.status,
            result: localRecordingProbeStateRef.current.result,
          });
          patchState({
            runtimeState: 'userSpeaking',
            error: null,
          });
          return;
        case 'user_speech_stopped':
          userStoppedAtRef.current = Date.now();
          awaitingUserTranscriptRef.current = true;
          applyUserTranscriptToRound({
            roundId: currentRoundIdRef.current,
            transcript: USER_RECOGNIZING_TEXT,
            source: 'pending',
            isFinal: false,
            reason: 'user_speech_stopped_awaiting_final_transcript',
          });
          logPerf('user_speech_stopped', { summary: 'speech_stopped' });
          logLocalRecordingProbe('user_speech_stopped_probe_state', {
            roundId: localRecordingProbeStateRef.current.roundId,
            status: localRecordingProbeStateRef.current.status,
            result: localRecordingProbeStateRef.current.result,
          });
          void stopNativeAudioTapForActiveRound('speech_stopped');
          void logXfyunFeatureStateForTurn(currentRoundIdRef.current);
          void stopLocalRecordingProbe('speech_stopped');
          clientRef.current?.muteMic();
          patchState({
            runtimeState: 'assistantThinking',
            isMicHot: false,
          });
          return;
        case 'user_audio_committed':
          logTransportDebug('user_audio_committed', {
            roundId: currentRoundIdRef.current,
          });
          return;
        case 'user_transcript_delta':
          if (firstUserDeltaLoggedRoundRef.current !== currentRoundIdRef.current) {
            firstUserDeltaLoggedRoundRef.current = currentRoundIdRef.current;
            logPerf('user_transcript_first_delta', {
              summary: event.text.trim().slice(0, 60),
              textLength: event.text.length,
            });
          }
          patchState({
            partialUserTranscript: event.text,
            runtimeState: 'userSpeaking',
          });
          return;
        case 'user_transcript_final': {
          const text = event.text.trim();
          if (!text) {
            applyUserTranscriptToRound({
              roundId: currentRoundIdRef.current,
              transcript: USER_FALLBACK_TEXT,
              source: 'fallback',
              isFinal: true,
              reason: 'user_transcript_final_empty',
            });
            awaitingUserTranscriptRef.current = false;
            patchState({
              partialUserTranscript: '',
              runtimeState: 'waitingUser',
              isMicHot: false,
              error: {
                scope: 'transport',
                message: '这一轮没有识别到有效语音，请再试一次。',
                debugMessage: 'user_transcript_final returned empty text',
              },
            });
            return;
          }

          const roundId = currentRoundIdRef.current;
          pendingUserTurnRef.current = true;
          awaitingUserTranscriptRef.current = false;
          logPerf('user_transcript_final', {
            summary: text.slice(0, 80),
            textLength: text.length,
          });
          applyUserTranscriptToRound({
            roundId,
            transcript: text,
            source: 'openai_realtime',
            isFinal: true,
            reason: 'openai_realtime_user_transcript_final',
          });
          patchState({
            partialUserTranscript: '',
            runtimeState: 'assistantThinking',
            isMicHot: false,
            error: null,
          });
          return;
        }
        case 'ai_response_created': {
          if (awaitingUserTranscriptRef.current) {
            pendingUserTurnRef.current = true;
            logPerf('user_transcript_missing', {
              summary: `round_${currentRoundIdRef.current}`,
              reason: 'assistant_response_created_before_user_transcript_final',
            });
            applyUserTranscriptToRound({
              roundId: currentRoundIdRef.current,
              transcript: USER_FALLBACK_TEXT,
              source: 'fallback',
              isFinal: true,
              reason: 'assistant_response_created_before_user_transcript_final',
            });
            awaitingUserTranscriptRef.current = false;
          }
          currentAiMessageIdRef.current = event.id || createMessageId('ai');
          currentAssistantResponseIdRef.current = currentAiMessageIdRef.current;
          currentAssistantRoundIdRef.current = openingCompletedRef.current ? currentRoundIdRef.current : 0;
          assistantResponseRoundIdMapRef.current.set(
            currentAiMessageIdRef.current,
            currentAssistantRoundIdRef.current,
          );
          logTransportDebug('assistant_response_round_map', {
            responseId: currentAiMessageIdRef.current,
            roundId: currentAssistantRoundIdRef.current,
            opening: currentAssistantRoundIdRef.current === 0,
          });
          aiTextBufferRef.current = '';
          firstAssistantDeltaLoggedMessageIdRef.current = null;
          assistantAudioLoggedMessageIdRef.current = null;
          assistantResponseCreatedAtRef.current = Date.now();
          assistantFirstDeltaAtRef.current = null;
          assistantAudioStartedAtRef.current = null;
          assistantResponseDoneRef.current = false;
          assistantAudioPlayingRef.current = false;
          logPerf('assistant_response_created', {
            summary: event.id,
            roundId: currentAssistantRoundIdRef.current,
          });
          upsertMessage({
            id: currentAiMessageIdRef.current,
            role: 'ai',
            text: '',
            timestamp: Date.now(),
            roundId: currentAssistantRoundIdRef.current,
            isStreaming: true,
          });
          patchState({
            runtimeState: 'assistantStreaming',
            isMicHot: false,
            error: null,
          });
          clearAssistantDoneFallbackTimeout();
          return;
        }
        case 'ai_response_delta': {
          const messageId = currentAiMessageIdRef.current || event.id || createMessageId('ai');
          currentAiMessageIdRef.current = messageId;
          aiTextBufferRef.current = `${aiTextBufferRef.current}${event.text}`;
          if (firstAssistantDeltaLoggedMessageIdRef.current !== messageId) {
            firstAssistantDeltaLoggedMessageIdRef.current = messageId;
            assistantFirstDeltaAtRef.current = Date.now();
            const mappedRoundId = resolveAssistantResponseContext(messageId).mappedRoundId;
            markLocalRecordingProbeWebrtcResponded(mappedRoundId);
            logPerf('assistant_first_delta', {
              summary: event.text.trim().slice(0, 60),
              textLength: event.text.length,
              firstDeltaAfterDatachannelMs:
                dataChannelOpenAtRef.current && assistantFirstDeltaAtRef.current
                  ? assistantFirstDeltaAtRef.current - dataChannelOpenAtRef.current
                  : null,
            });
            logLocalRecordingProbe('assistant_first_delta_probe_summary', {
              roundId: mappedRoundId,
              probe: summarizeLocalRecordingProbeResult(mappedRoundId),
            });
          }
          patchMessage(messageId, {
            text: aiTextBufferRef.current,
            isStreaming: true,
          });
          patchState({
            runtimeState: 'assistantStreaming',
            error: null,
          });
          return;
        }
        case 'ai_response_transcript_done': {
          const messageId = currentAiMessageIdRef.current || event.id || createMessageId('ai');
          currentAiMessageIdRef.current = messageId;
          if (event.text.trim()) {
            aiTextBufferRef.current = event.text.trim();
            patchMessage(messageId, {
              text: event.text.trim(),
              isStreaming: true,
            });
          }
          return;
        }
        case 'assistant_audio_started': {
          const messageId = event.id || currentAiMessageIdRef.current || 'unknown';
          const mappedRoundId = resolveAssistantResponseContext(messageId).mappedRoundId;
          if (assistantAudioLoggedMessageIdRef.current !== messageId) {
            assistantAudioLoggedMessageIdRef.current = messageId;
            assistantAudioStartedAtRef.current = Date.now();
            markLocalRecordingProbeWebrtcResponded(mappedRoundId);
            logPerf('assistant_audio_started', {
              summary: messageId,
              roundId: mappedRoundId,
            });
            logLocalRecordingProbe('assistant_audio_started_probe_summary', {
              roundId: mappedRoundId,
              probe: summarizeLocalRecordingProbeResult(mappedRoundId),
            });
          }
          assistantAudioPlayingRef.current = true;
          clearAssistantDoneFallbackTimeout();
          patchState({
            runtimeState: 'assistantSpeaking',
            error: null,
          });
          return;
        }
        case 'assistant_audio_stopped':
          if (event.id && completedAssistantResponseIdsRef.current.has(event.id)) {
            const { mappedRoundId } = resolveAssistantResponseContext(event.id);
            logTransportDebug('assistant_audio_stopped_late', {
              responseId: event.id,
              mappedRoundId,
              currentRoundId: currentRoundIdRef.current,
              ignoredDuplicate: true,
            });
            return;
          }
          assistantAudioPlayingRef.current = false;
          logTransportDebug('output_audio_buffer.stopped', {
            roundId: resolveAssistantResponseContext(event.id).mappedRoundId,
            responseId: event.id ?? null,
          });
          clearAssistantDoneFallbackTimeout();
          finalizeAssistantTurnIfComplete({
            responseId: event.id,
            reason: 'audio_stopped',
          });
          return;
        case 'ai_response_done': {
          const messageId = currentAiMessageIdRef.current || event.id;
          if (messageId) {
            patchMessage(messageId, { isStreaming: false });
          }
          assistantResponseDoneRef.current = true;
          logPerf('assistant_response_done', {
            summary: messageId ?? 'unknown',
            roundId: resolveAssistantResponseContext(messageId).mappedRoundId,
          });
          clearAssistantDoneFallbackTimeout();
          assistantDoneFallbackTimeoutRef.current = setTimeout(() => {
            if (assistantResponseDoneRef.current && assistantAudioPlayingRef.current) {
              assistantAudioPlayingRef.current = false;
              const { resolvedResponseId, mappedRoundId } = resolveAssistantResponseContext(messageId);
              logTransportDebug('assistant_audio_stopped_fallback', {
                responseId: resolvedResponseId,
                mappedRoundId,
                delayMs: 800,
                reason: 'response_done_without_output_audio_buffer_stopped',
              });
              finalizeAssistantTurnIfComplete({
                responseId: resolvedResponseId,
                reason: 'response_done_fallback',
              });
            }
          }, 800);
          patchState({
            error: null,
          });
          finalizeAssistantTurnIfComplete({
            responseId: messageId,
            reason: 'response_done',
          });
          return;
        }
        case 'interrupted':
          console.log('[V1_ULTRA] interrupted');
          return;
        default:
          return;
      }
    },
    [
      applyUserTranscriptToRound,
      clearAssistantDoneFallbackTimeout,
      clearNoSpeechTimeout,
      finalizeAssistantTurnIfComplete,
      logDebug,
      logError,
      logPerf,
      logTransportDebug,
      logXfyunFeatureStateForTurn,
      markLocalRecordingProbeWebrtcResponded,
      patchMessage,
      patchState,
      requestOpeningResponse,
      resolveAssistantResponseContext,
      stopNativeAudioTapForActiveRound,
      stopLocalRecordingProbe,
      summarizeLocalRecordingProbeResult,
    ],
  );

  const startSession = useCallback(async () => {
    if (!session) {
      logError('realtime_session_failed', {
        stage: 'session_guard',
        message: 'missing_session',
      });
      patchState({
        runtimeState: 'error',
        connectionStatus: 'error',
        error: {
          scope: 'session',
          message: '请先登录后再启动 V1 Ultra PoC。',
          debugMessage: 'session missing on app side',
        },
      });
      return;
    }

    if (sessionStartPromiseRef.current) {
      return sessionStartPromiseRef.current;
    }

    const runner = (async () => {
      endingRef.current = false;
      sessionStartedAtRef.current = Date.now();
      userStoppedAtRef.current = null;
      currentAiMessageIdRef.current = null;
      aiTextBufferRef.current = '';
      openingRequestedRef.current = false;
      openingCompletedRef.current = false;
      pendingUserTurnRef.current = false;
      currentRoundIdRef.current = 1;
      firstUserDeltaLoggedRoundRef.current = null;
      firstAssistantDeltaLoggedMessageIdRef.current = null;
      assistantAudioLoggedMessageIdRef.current = null;
      currentUserMessageIdRef.current = null;
      awaitingUserTranscriptRef.current = false;
      assistantResponseCreatedAtRef.current = null;
      assistantFirstDeltaAtRef.current = null;
      assistantAudioStartedAtRef.current = null;
      assistantResponseDoneRef.current = false;
      assistantAudioPlayingRef.current = false;
      clearAssistantDoneFallbackTimeout();
      currentAssistantResponseIdRef.current = null;
      currentAssistantRoundIdRef.current = 0;
      assistantResponseRoundIdMapRef.current.clear();
      completedAssistantResponseIdsRef.current.clear();
      sessionCreateStartedAtRef.current = null;
      sessionCreateDoneAtRef.current = null;
      tokenFetchStartedAtRef.current = null;
      tokenFetchDoneAtRef.current = null;
      webrtcConnectStartedAtRef.current = null;
      localOfferCreatedAtRef.current = null;
      callRequestStartedAtRef.current = null;
      callResponseAtRef.current = null;
      remoteAnswerSetAtRef.current = null;
      dataChannelOpenAtRef.current = null;
      nativeAudioTapTurnRef.current = {
        turnId: null,
        roundId: null,
        stopRequested: false,
      };
      progressSyncRef.current = {
        inFlight: false,
        queuedTurnCount: null,
        lastSyncedTurnCount: 0,
      };

      await disconnectTransport();
      await resetAudioRoute();
      await bestEffortAbortExistingSession();

      if (!clientRef.current) {
        clientRef.current = new SpeakingRealtimeClient();
      }

      const client = clientRef.current;
      patchState({
        ...INITIAL_STATE,
        runtimeState: 'initializing',
        connectionStatus: 'starting',
        transportReady: client.capability.available,
        transportReason: client.capability.reason,
      });
      setSessionStartedAt(null);
      setConsumedCredits(0);
      logPerf('ultra_session_start', { summary: scenario.id });
      logDebug('realtime_session_start', {
        scenarioId: scenario.id,
        mode: 'scenario',
      });
      logDebug('realtime_token_start', {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
      });

      if (!client.capability.available) {
        logError('webrtc_connect_failed', {
          stage: 'capability',
          message: client.capability.reason || 'realtime_transport_unavailable',
        });
        patchState({
          runtimeState: 'error',
          connectionStatus: 'error',
          transportReady: false,
          transportReason: client.capability.reason,
          error: {
            scope: 'transport',
            message: client.capability.reason || '当前设备不支持 Realtime 通话。',
            debugMessage: client.capability.reason || 'realtime transport unavailable',
          },
        });
        return;
      }

      let sessionResponse: Awaited<ReturnType<typeof createSpeakingRealtimeSession>> | null = null;
      let tokenResponse: SpeakingV2RealtimeTokenResponse | null = null;
      sessionCreateStartedAtRef.current = Date.now();
      tokenFetchStartedAtRef.current = Date.now();

      const [sessionResult, tokenResult] = await Promise.allSettled([
        createSpeakingRealtimeSession(session, {
          scenarioId: scenario.id,
          mode: 'scenario',
        }).finally(() => {
          sessionCreateDoneAtRef.current = Date.now();
        }),
        getSpeakingRealtimeToken(session, {
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          aiName: scenario.aiName,
          aiRole: scenario.aiRole,
          systemPrompt: buildUltraSystemPrompt(scenario),
        }).finally(() => {
          tokenFetchDoneAtRef.current = Date.now();
        }),
      ]);

      if (sessionResult.status === 'fulfilled') {
        sessionResponse = sessionResult.value;
        logDebug('realtime_session_success', {
          sessionId: sessionResponse.sessionId,
          hasSessionId: !!sessionResponse.sessionId,
          mode: sessionResponse.mode,
          status: sessionResponse.status,
        });
      } else {
        const described = describeRuntimeError(
          sessionResult.reason,
          '创建 Ultra Realtime 会话失败。',
          'session failed',
        );
        logError('realtime_session_failed', {
          message: described.message,
          debugMessage: described.debugMessage,
        });
      }

      if (tokenResult.status === 'fulfilled') {
        tokenResponse = tokenResult.value;
        logDebug('realtime_token_success', {
          hasClientSecret: !!tokenResponse.clientSecret,
          model: tokenResponse.model ?? null,
          voice: tokenResponse.voice ?? null,
        });
      } else {
        const described = describeRuntimeError(
          tokenResult.reason,
          '获取 Realtime token 失败。',
          'token failed',
        );
        logError('realtime_token_failed', {
          message: described.message,
          debugMessage: described.debugMessage,
        });
      }

      if (!sessionResponse || !tokenResponse) {
        if (sessionResponse?.sessionId) {
          await closeSessionRecordById(sessionResponse.sessionId, 'aborted');
        }
        const failedScope =
          sessionResult.status === 'rejected' ? 'session' : tokenResult.status === 'rejected' ? 'token' : 'unknown';
        const startError =
          failedScope === 'session'
            ? sessionResult.status === 'rejected'
              ? sessionResult.reason
              : new Error('创建 Ultra Realtime 会话失败。')
            : failedScope === 'token'
              ? tokenResult.status === 'rejected'
                ? tokenResult.reason
                : new Error('获取 Realtime token 失败。')
              : new Error('创建 Ultra Realtime 会话失败。');
        const described = describeRuntimeError(
          startError,
          failedScope === 'token' ? '获取 Realtime token 失败。' : '创建 Ultra Realtime 会话失败。',
          `${failedScope} failed`,
        );
        patchState({
          runtimeState: 'error',
          connectionStatus: 'error',
          error: {
            scope: failedScope === 'session' ? 'session' : 'token',
            message: described.message,
            debugMessage: described.debugMessage,
          },
        });
        return;
      }

      patchState({
        sessionId: sessionResponse.sessionId,
        connectionStatus: 'connecting',
        model: tokenResponse.model ?? null,
        voice: tokenResponse.voice ?? null,
      });
      setSessionStartedAt(new Date().toISOString());
      logPerf('ultra_session_ready', {
        summary: sessionResponse.sessionId,
        model: tokenResponse.model ?? null,
        voice: tokenResponse.voice ?? null,
        sessionCreateMs:
          sessionCreateStartedAtRef.current && sessionCreateDoneAtRef.current
            ? sessionCreateDoneAtRef.current - sessionCreateStartedAtRef.current
            : null,
        tokenFetchMs:
          tokenFetchStartedAtRef.current && tokenFetchDoneAtRef.current
            ? tokenFetchDoneAtRef.current - tokenFetchStartedAtRef.current
            : null,
        sessionReadyTotalMs:
          sessionStartedAtRef.current && sessionCreateDoneAtRef.current && tokenFetchDoneAtRef.current
            ? Math.max(sessionCreateDoneAtRef.current, tokenFetchDoneAtRef.current) - sessionStartedAtRef.current
            : null,
      });
      logPerf('ultra_webrtc_connect_start', { summary: tokenResponse.model ?? 'unknown-model' });
      webrtcConnectStartedAtRef.current = Date.now();

      client.setEventHandler(handleTransportEvent);

      try {
        logTransportDebug('webrtc_connect_start', {
          sessionId: sessionResponse.sessionId,
          model: tokenResponse.model ?? null,
          voice: tokenResponse.voice ?? null,
        });
        await applySpeakingRealtimeAudioRoute(true);
        await client.connect({
          ephemeralKey: tokenResponse.clientSecret,
          model: tokenResponse.model,
          createCall: async (offerSdp) => {
            callRequestStartedAtRef.current = Date.now();
            logTransportDebug('webrtc_call_request_start', {
              offerLength: offerSdp.length,
            });
            try {
              const call = await createSpeakingRealtimeCall({
                ephemeralKey: tokenResponse.clientSecret,
                sdp: offerSdp,
              });
              callResponseAtRef.current = Date.now();
              logTransportDebug('webrtc_call_response_success', {
                status: call.status,
                contentType: call.contentType,
                answerLength: call.answerSdp.length,
              });
              logPerf('ultra_webrtc_call_response', {
                summary: 'sdp_exchange_done',
                callsSdpMs:
                  callRequestStartedAtRef.current && callResponseAtRef.current
                    ? callResponseAtRef.current - callRequestStartedAtRef.current
                    : null,
              });
              return { answerSdp: call.answerSdp };
            } catch (error) {
              const described = describeRuntimeError(error, 'SDP 交换失败。', 'calls failed');
              logError('webrtc_call_response_failed', {
                message: described.message,
                debugMessage: described.debugMessage,
              });
              throw error;
            }
          },
          onEvent: handleTransportEvent,
        });
        client.muteMic();
        void refreshCredits();
      } catch (error) {
        await closeSessionRecordById(sessionResponse.sessionId, 'aborted');
        const described = describeRuntimeError(error, '建立 Ultra Realtime 连接失败。', 'transport failed');
        logError('webrtc_connect_failed', {
          message: described.message,
          debugMessage: described.debugMessage,
        });
        patchState({
          runtimeState: 'error',
          connectionStatus: 'error',
          isMicHot: false,
          error: {
            scope: error instanceof SpeakingApiError ? 'calls' : 'transport',
            message: error instanceof SpeakingApiError ? '口语服务异常，请稍后再试。' : described.message,
            debugMessage: described.debugMessage,
          },
        });
      }
    })();

    sessionStartPromiseRef.current = runner;

    try {
      await runner;
    } finally {
      sessionStartPromiseRef.current = null;
    }
  }, [
    bestEffortAbortExistingSession,
    closeSessionRecordById,
    clearAssistantDoneFallbackTimeout,
    disconnectTransport,
    handleTransportEvent,
    logDebug,
    logError,
    logTransportDebug,
    patchState,
    refreshCredits,
    resetAudioRoute,
    scenario,
    session,
    logPerf,
  ]);

  const startUserTurn = useCallback(() => {
    if (!clientRef.current) return;
    if (stateRef.current.connectionStatus !== 'connected') return;
    if (stateRef.current.runtimeState !== 'waitingUser' && stateRef.current.runtimeState !== 'ready') return;

    try {
      clearNoSpeechTimeout();
      applyUserTranscriptToRound({
        roundId: currentRoundIdRef.current,
        transcript: USER_RECOGNIZING_TEXT,
        source: 'pending',
        isFinal: false,
        reason: 'user_turn_started',
      });
      clientRef.current.unmuteMic();
      patchState({
        runtimeState: 'userSpeaking',
        isMicHot: true,
        partialUserTranscript: '',
        error: null,
      });
      void startLocalRecordingProbe(currentRoundIdRef.current);
      void startNativeAudioTapForRound(currentRoundIdRef.current);
      noSpeechTimeoutRef.current = setTimeout(() => {
        clientRef.current?.muteMic();
        void stopLocalRecordingProbe('error');
        clearPendingUserMessage('no_speech_timeout');
        patchState({
          runtimeState: 'waitingUser',
          isMicHot: false,
          error: {
            scope: 'permission',
            message: '这一轮暂时没有听到内容，请点击麦克风后重新说一句。',
          },
        });
      }, 12000);
    } catch (error) {
      clearPendingUserMessage('start_user_turn_failed');
      patchState({
        runtimeState: 'error',
        connectionStatus: 'error',
        error: {
          scope: 'transport',
          message: normalizeError(error, '打开麦克风失败。'),
        },
      });
    }
  }, [
    applyUserTranscriptToRound,
    clearNoSpeechTimeout,
    clearPendingUserMessage,
    patchState,
    startNativeAudioTapForRound,
    startLocalRecordingProbe,
    stopLocalRecordingProbe,
  ]);

  const stopUserTurn = useCallback(() => {
    if (!clientRef.current) return;
    clientRef.current.muteMic();
    clearNoSpeechTimeout();
    void stopNativeAudioTapForActiveRound('manual');
    void stopLocalRecordingProbe('manual');
    patchState({
      isMicHot: false,
      runtimeState: 'assistantThinking',
    });
  }, [clearNoSpeechTimeout, patchState, stopLocalRecordingProbe, stopNativeAudioTapForActiveRound]);

  const endSession = useCallback(
    async (status: 'completed' | 'aborted' = 'completed') => {
      if (endingRef.current) {
        return;
      }

      endingRef.current = true;
      clearNoSpeechTimeout();
      clearAssistantDoneFallbackTimeout();
      await stopNativeAudioTapForActiveRound('cleanup');
      await stopLocalRecordingProbe('cleanup');
      await cleanupLocalRecordingProbe();
      patchState({
        isMicHot: false,
      });

      await disconnectTransport();
      await resetAudioRoute();

      try {
        await closeSessionRecord(status);
        await refreshCredits().catch(() => undefined);
        patchState({
          runtimeState: 'completed',
          connectionStatus: 'completed',
          error: null,
          sessionId: null,
          partialUserTranscript: '',
        });
      } catch (error) {
        patchState({
          runtimeState: 'error',
          connectionStatus: 'error',
          error: {
            scope: 'complete',
            message: normalizeError(error, '结束 Ultra 会话失败。'),
          },
        });
      } finally {
        endingRef.current = false;
      }
    },
    [
      clearAssistantDoneFallbackTimeout,
      clearNoSpeechTimeout,
      closeSessionRecord,
      cleanupLocalRecordingProbe,
      disconnectTransport,
      patchState,
      refreshCredits,
      resetAudioRoute,
      stopLocalRecordingProbe,
      stopNativeAudioTapForActiveRound,
    ],
  );

  const retryConnection = useCallback(async () => {
    await endSession('aborted');
    await startSession();
  }, [endSession, startSession]);

  const clearError = useCallback(() => {
    patchState({ error: null });
  }, [patchState]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void stopLocalRecordingProbe('cleanup');
      void cleanupLocalRecordingProbe();
      void disconnectTransport();
      void resetAudioRoute();
    };
  }, [cleanupLocalRecordingProbe, disconnectTransport, resetAudioRoute, stopLocalRecordingProbe]);

  useEffect(() => {
    if (!session) {
      patchState({
        ...INITIAL_STATE,
        runtimeState: 'error',
        connectionStatus: 'error',
        error: { scope: 'session', message: '请先登录后再体验 Ultra PoC。' },
      });
      return;
    }

    void startSession();
  }, [patchState, session, startSession]);

  useEffect(() => {
    if (session) {
      void refreshCredits();
    }
  }, [refreshCredits, session]);

  return useMemo(
    () => ({
      runtimeState: state.runtimeState,
      connectionStatus: state.connectionStatus,
      sessionId: state.sessionId,
      messages: state.messages,
      partialUserTranscript: state.partialUserTranscript,
      error: state.error,
      isMicHot: state.isMicHot,
      turnCount: state.turnCount,
      model: state.model,
      voice: state.voice,
      transportReady: state.transportReady,
      transportReason: state.transportReason,
      canStartTurn:
        state.connectionStatus === 'connected' &&
        state.runtimeState === 'waitingUser' &&
        !state.isMicHot,
      isBusy:
        state.connectionStatus === 'starting' ||
        state.connectionStatus === 'connecting' ||
        state.runtimeState === 'assistantThinking',
      credits,
      creditsLoading,
      sessionStartedAt,
      consumedCredits,
      startUserTurn,
      stopUserTurn,
      startSession,
      refreshCredits,
      retryConnection,
      endSession,
      clearError,
    }),
    [
      clearError,
      consumedCredits,
      credits,
      creditsLoading,
      endSession,
      refreshCredits,
      retryConnection,
      sessionStartedAt,
      startSession,
      startUserTurn,
      state,
      stopUserTurn,
    ],
  );
}

function mapUltraStateToV1Stage(runtimeState: SpeakingV1UltraState): SpeakingStage {
  switch (runtimeState) {
    case 'initializing':
      return 'starting';
    case 'ready':
    case 'waitingUser':
      return 'ready';
    case 'userSpeaking':
      return 'recording';
    case 'assistantThinking':
      return 'thinking';
    case 'assistantStreaming':
    case 'assistantSpeaking':
      return 'speaking';
    case 'completed':
      return 'completed';
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}

function mapUltraErrorToV1Error(error: SpeakingV1UltraRuntimeError | null): SpeakingRuntimeError | null {
  if (!error) return null;

  const scopeMap: Record<SpeakingV1UltraRuntimeError['scope'], SpeakingRuntimeError['scope']> = {
    session: 'session',
    token: 'session',
    calls: 'chat',
    opening: 'chat',
    transport: 'chat',
    permission: 'permission',
    complete: 'complete',
    unknown: 'unknown',
  };

  return {
    scope: scopeMap[error.scope] ?? 'unknown',
    message: error.debugMessage ? `${error.message}\n${error.debugMessage}` : error.message,
    recoverable: true,
  };
}

export function useSpeakingV1UltraAsV1Runtime({
  session,
  scenario,
}: {
  session: StoredSession | null;
  scenario: Scenario;
}) {
  const ultra = useSpeakingV1UltraRuntime({
    session,
    scenario,
  });
  const [draft, setDraft] = useState('');
  const [hintErrorVisible, setHintErrorVisible] = useState(false);

  const stage = mapUltraStateToV1Stage(ultra.runtimeState);
  const messages = useMemo<SpeakingMessage[]>(
    () =>
      ultra.messages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        timestamp: message.timestamp,
        isStreaming: message.isStreaming,
        transcriptStatus: message.transcriptStatus,
        transcriptSource: message.transcriptSource,
      })),
    [ultra.messages],
  );

  const playbackText = useMemo(() => {
    if (ultra.runtimeState !== 'assistantSpeaking' && ultra.runtimeState !== 'assistantStreaming') {
      return null;
    }
    const latestAiMessage = [...ultra.messages].reverse().find((item) => item.role === 'ai' && item.text.trim());
    return latestAiMessage?.text ?? null;
  }, [ultra.messages, ultra.runtimeState]);

  const runtimeError = useMemo(() => {
    if (hintErrorVisible) {
      return {
        scope: 'session' as const,
        message: '提示/翻译/重听待接入',
        recoverable: true,
      };
    }
    return mapUltraErrorToV1Error(ultra.error);
  }, [hintErrorVisible, ultra.error]);

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
      latestScoreOverall: null,
      averageScoreOverall: null,
      scoreCount: 0,
    }),
    [],
  );

  const pendingTranscriptText = useMemo(() => {
    if (ultra.partialUserTranscript.trim()) {
      return ultra.partialUserTranscript;
    }
    if (ultra.runtimeState === 'userSpeaking') {
      return '正在聆听…';
    }
    return '';
  }, [ultra.partialUserTranscript, ultra.runtimeState]);

  const recorderCapability = useMemo<SpeakingRecorderCapability>(
    () => ({
      available: ultra.transportReady,
      provider: ultra.transportReady ? 'expo-audio' : 'none',
      reason: ultra.transportReason ?? undefined,
    }),
    [ultra.transportReady, ultra.transportReason],
  );

  const clearError = useCallback(() => {
    setHintErrorVisible(false);
    ultra.clearError();
  }, [ultra]);

  const replayAiMessage = useCallback(async () => {
    setHintErrorVisible(true);
  }, []);

  const submitTurnText = useCallback(
    async (rawText: string) => {
      setDraft(rawText);
      if (ultra.canStartTurn) {
        ultra.startUserTurn();
      }
    },
    [ultra],
  );

  return {
    credits: ultra.credits,
    creditsLoading: ultra.creditsLoading,
    stage,
    scoreStage: 'idle' as SpeakingScoreStage,
    runtimeError,
    messages,
    draft,
    pendingTranscriptText,
    sessionId: ultra.sessionId,
    sessionStartedAt: ultra.sessionStartedAt,
    turnCount: ultra.turnCount,
    consumedCredits: ultra.consumedCredits,
    latestScore: null as SpeakingScoreResult | null,
    scoreHistory: [] as SpeakingScoreResult[],
    streamingAiMessageId:
      [...messages].reverse().find((message) => message.role === 'ai' && message.isStreaming)?.id ?? null,
    playbackText,
    transcriptItems,
    turnSummary,
    recorderCapability,
    setDraft,
    clearError,
    refreshCredits: ultra.refreshCredits,
    ensureSession: ultra.startSession,
    submitTurnText,
    startRecording: async () => {
      ultra.startUserTurn();
    },
    stopRecording: async () => {
      ultra.stopUserTurn();
    },
    endSession: ultra.endSession,
    replayAiMessage,
  };
}
