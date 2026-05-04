import type { XfyunPronunciationDebug } from '@/types/pcmDualStream';
import type { XfyunPronunciationAssessment } from '@/types/xfyunSpeakingAssessment';

export type SpeakingV2ConnectionStatus =
  | 'idle'
  | 'starting'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'ending'
  | 'completed'
  | 'error';

export type SpeakingV2StageState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'interrupted';

export interface SpeakingV2TranscriptItem {
  id: string;
  role: 'user' | 'ai';
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export interface SpeakingV2MetricScore {
  value: number | null;
  reason?: string | null;
  source: 'score_api' | 'derived_from_score' | 'realtime_transcript' | 'unavailable';
}

export interface SpeakingV2ReplayCorrection {
  fixed: string | null;
  note: string | null;
  source: 'score_api' | 'unavailable';
}

export interface SpeakingV2ReplayItem {
  id: string;
  role: 'user' | 'ai';
  text: string;
  correction?: SpeakingV2ReplayCorrection | null;
  unavailableReason?: string | null;
}

export interface SpeakingV2ReportTurn {
  roundId: number;
  source: 'realtime_vad' | 'local_vad' | 'local_barge_in';
  startedAt: number;
  endedAt: number | null;
  audio24kBytes: number;
  audio16kBytes: number;
  userAudio16kBytes?: number;
  userAudio24kBytes?: number;
  userAudioDurationMs?: number;
  userTranscript: string;
  transcriptStatus: 'pending' | 'final' | 'empty' | 'error' | 'too_short' | 'echo_rejected';
  rtasrError: string | null;
  pronunciationStatus?: 'idle' | 'pending' | 'ready' | 'error' | 'unavailable';
  pronunciation?: XfyunPronunciationAssessment | null;
  pronunciationDebug?: XfyunPronunciationDebug | null;
  aiResponseText: string;
  aiResponseAudioBytes: number;
  commitStatus: 'pending' | 'sent' | 'skipped' | 'failed';
  reportReady: boolean;
}

export interface SpeakingV2ReviewTiming {
  totalMs: number | null;
  sessionMs: number | null;
  tokenMs: number | null;
  micPermissionMs: number | null;
  peerCreateMs: number | null;
  offerCreateMs: number | null;
  callsMs: number | null;
  remoteAnswerSetMs: number | null;
  dataChannelOpenMs: number | null;
  sessionUpdateSentMs: number | null;
  sessionUpdatedMs: number | null;
  initialGreetingSentMs: number | null;
  firstAssistantAudioStartedMs: number | null;
}

export interface SpeakingV2RealtimeSessionResponse {
  sessionId: string;
  status: 'active';
  mode: 'scenario' | 'free_chat';
}

export interface SpeakingV2RealtimeTokenResponse {
  clientSecret: string;
  expiresAt?: string;
  model?: string;
  voice?: string;
}

export interface SpeakingV2RealtimeCallRequest {
  ephemeralKey: string;
  sdp: string;
}

export interface SpeakingV2RealtimeCallResponse {
  answerSdp: string;
  contentType: string;
  status: number;
}

export interface SpeakingV2ReviewPayload {
  reviewVersion: 'v2';
  scenarioId: string;
  scenarioName: string;
  userTurnCount: number;
  aiTurnCount: number;
  totalTurns: number;
  interruptCount: number;
  userTranscriptSummary: string;
  aiTranscriptSummary: string;
  metrics: {
    overall: SpeakingV2MetricScore;
    fluency: SpeakingV2MetricScore;
    grammar: SpeakingV2MetricScore;
    taskCompletion?: SpeakingV2MetricScore;
    naturalness?: SpeakingV2MetricScore;
    pronunciation?: SpeakingV2MetricScore;
  };
  aiCoachFeedback: string;
  replayItems: SpeakingV2ReplayItem[];
  userTranscriptAvailable: boolean;
  timing: SpeakingV2ReviewTiming;
  note: string;
  missingCapabilities?: string[];
  turns?: SpeakingV2ReportTurn[];
}

export interface SpeakingV2RuntimeError {
  scope: 'session' | 'token' | 'transport' | 'call' | 'complete' | 'unknown';
  message: string;
}

export interface SpeakingV2State {
  connectionStatus: SpeakingV2ConnectionStatus;
  stageState: SpeakingV2StageState;
  sessionId: string | null;
  transcript: SpeakingV2TranscriptItem[];
  currentAiText: string;
  currentUserTranscriptInterim: string;
  currentUserTranscriptFinal: string;
  turnCount: number;
  reviewPayload: SpeakingV2ReviewPayload | null;
  error: SpeakingV2RuntimeError | null;
  credits: number | null;
  isMicMuted: boolean;
  isSpeakerOn: boolean;
  callDurationSec: number;
  remainingDurationSec: number;
  transportReady: boolean;
  transportReason: string | null;
}

export type SpeakingV2TransportEvent =
  | { type: 'connected' }
  | { type: 'peer_created' }
  | { type: 'local_audio_ready' }
  | { type: 'remote_audio_track_received' }
  | { type: 'local_offer_created'; offerLength: number }
  | { type: 'calls_started'; offerLength: number }
  | { type: 'calls_completed'; answerLength: number }
  | { type: 'remote_answer_set'; answerLength: number }
  | { type: 'datachannel_open' }
  | {
      type: 'session_update_sent';
      keys: string[];
      hasSessionType: boolean;
      hasInstructions: boolean;
      hasAudio: boolean;
      hasAudioInputTranscription: boolean;
      hasLegacyInputAudioTranscription: boolean;
      hasLegacyModalities: boolean;
    }
  | { type: 'session_updated' }
  | { type: 'disconnected' }
  | { type: 'error'; message: string }
  | { type: 'user_speech_started' }
  | { type: 'user_speech_stopped' }
  | { type: 'user_audio_committed'; itemId?: string }
  | { type: 'user_turn_pending'; itemId: string; startedAt: number }
  | { type: 'user_transcript_delta'; text: string }
  | { type: 'user_transcript_final'; text: string }
  | { type: 'user_transcript_done'; itemId: string; text: string; completedAt: number }
  | { type: 'ai_response_created'; id: string }
  | { type: 'ai_response_delta'; id: string; text: string }
  | { type: 'ai_response_transcript_done'; id: string; text: string }
  | { type: 'ai_response_done'; id?: string; text?: string }
  | { type: 'assistant_audio_started'; id?: string }
  | { type: 'assistant_audio_stopped'; id?: string }
  | { type: 'output_audio_cleared'; id?: string }
  | { type: 'conversation_item_truncated'; itemId?: string }
  | { type: 'interrupted' };
