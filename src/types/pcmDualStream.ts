import type { SpeakingRecorderCapability, SpeakingRuntimeError } from '@/types/speaking';
import type {
  SpeakingExpressionStylesState,
  SpeakingExpressionEvaluation,
  SpeakingRoundAnalysis,
  XfyunPronunciationAssessment,
} from '@/types/xfyunSpeakingAssessment';

export type PcmCaptureSupport = {
  supported: boolean;
  platform: string;
  reason?: string;
};

export type PcmChunkEvent = {
  sequence: number;
  sampleRate: number;
  channels: number;
  chunkMs: number;
  bytes: number;
  pcmBase64: string;
};

export type PcmCaptureStatsEvent = {
  elapsedMs: number;
  chunksEmitted: number;
  bytesEmitted: number;
  sampleRate: number;
  channels: number;
  chunkMs: number;
};

export type PcmCaptureStartResult = {
  ok: boolean;
  sampleRate: number;
  channels: number;
  chunkMs: number;
  format: 'pcm16';
  reason?: string;
};

export type PcmCaptureStopResult = {
  ok: boolean;
  capturedBytes: number;
  sampleRate: number;
  channels: number;
  chunkMs: number;
  format: 'pcm16';
  durationMs: number;
  reason?: string;
};

export type OpenAiRealtimeTokenPayload = {
  clientSecret: string;
  model?: string;
  voice?: string;
  expiresAt?: string;
};

export type OpenAiRealtimeWsEvent =
  | { type: 'connected' }
  | { type: 'disconnected' }
  | { type: 'session_updated' }
  | { type: 'user_speech_started' }
  | { type: 'user_speech_stopped' }
  | { type: 'user_audio_committed' }
  | { type: 'assistant_response_created'; responseId?: string | null }
  | {
      type: 'assistant_text_delta';
      textDelta: string;
      roundId?: number | null;
      responseId?: string | null;
      sourceType?: string | null;
    }
  | {
      type: 'assistant_audio_delta';
      audioBytes: number;
      roundId?: number | null;
      responseId?: string | null;
      sourceType?: string | null;
    }
  | {
      type: 'assistant_response_done';
      roundId?: number | null;
      responseId?: string | null;
      assistantText: string;
      audioBytes: number;
      audioBase64?: string | null;
      audioSampleRate?: number;
      audioMimeType?: string | null;
      sourceType?: string | null;
    }
  | { type: 'error'; message: string; rawType?: string | null; nonFatal?: boolean };

export type XfyunRtasrTranscript = {
  text: string;
  rawTextBeforeNormalize: string;
  normalizedText: string;
  mergeStrategy: string;
  cumulativeDetected?: boolean;
  selectedSegment?: string | null;
  segmentTexts?: string[];
  segmentCount: number;
  partialCount: number;
  finalLikeCount: number;
  firstResultMs: number | null;
  finalTranscriptMs: number | null;
  errorMessage?: string | null;
  closeReason?: string | null;
};

export type XfyunPronunciationDebug = {
  started: boolean;
  skipped: boolean;
  skipReason?: string;
  durationMs?: number | null;
  timeoutMs?: number;
  errorCode?: string;
  errorMessage?: string;
  referenceTextUsed?: string | null;
  wordsCount?: number;
  category?: string;
  language?: string;
};

export type PcmDualUserAudio = {
  uri: string;
  durationMs: number | null;
  size: number | null;
  mimeType: 'audio/wav';
};

export type UserTurnAssessment = {
  roundId: number;
  transcript: string;
  userAudio: PcmDualUserAudio | null;
  pronunciation: XfyunPronunciationAssessment | null;
  pronunciationDebug: XfyunPronunciationDebug | null;
  expression: SpeakingExpressionEvaluation;
  expressionStyles?: SpeakingExpressionStylesState | null;
  skipped?: {
    reason: 'invalid_transcript' | 'chinese_help_turn' | 'web_api_unreachable';
    rawTranscript: string;
  } | null;
};

export type PcmDualUserMessage = {
  id: string;
  role: 'user';
  roundId: number;
  text: string;
  timestamp: number;
  localAudioUri?: string | null;
  userAudio?: PcmDualUserAudio | null;
  recordingDurationMs?: number | null;
  audioSize?: number | null;
  transcriptStatus: 'listening' | 'recognizing' | 'ready' | 'rejected' | 'failed' | 'unavailable';
  transcriptSource: 'xfyun_rtasr' | 'fallback' | 'text_input';
  pronunciation: XfyunPronunciationAssessment | null;
  pronunciationDebug: XfyunPronunciationDebug | null;
  analysis: SpeakingRoundAnalysis | null;
  turnAssessment: UserTurnAssessment | null;
  analysisStatus: 'pending' | 'ready' | 'failed';
};

export type PcmDualAssistantMessage = {
  id: string;
  role: 'assistant';
  roundId: number;
  text: string;
  timestamp: number;
  audioBase64?: string | null;
  audioUrl?: string | null;
  audioMimeType?: string | null;
  audioFileUri?: string | null;
  replyStatus: 'pending' | 'ready' | 'failed';
};

export type PcmDualConversationMessage = PcmDualUserMessage | PcmDualAssistantMessage;

export type PcmDualRuntimeStage =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'recognizing'
  | 'thinking'
  | 'playing'
  | 'error';

export type PcmDualRuntimeValue = {
  enabled: boolean;
  stage: PcmDualRuntimeStage;
  messages: PcmDualConversationMessage[];
  error: SpeakingRuntimeError | null;
  recorderCapability: SpeakingRecorderCapability;
  captureSupport: PcmCaptureSupport | null;
  creditsLoading: boolean;
  credits: {
    balanceCredits: number;
  } | null;
  sessionId: string | null;
  playbackText: string | null;
  currentRoundId: number;
  playbackMessageId: string | null;
  clearError: () => void;
  endSession: (status?: 'completed' | 'aborted') => Promise<void>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  sendTextMessage: (text: string) => Promise<void>;
  replayAssistantAudio: (messageId: string) => Promise<void>;
  replayUserAudio: (messageId: string) => Promise<void>;
  playBetterExpression: (messageId: string) => Promise<void>;
  playReferenceText: (input: {
    messageId: string;
    roundId: number;
    text: string;
    accent: 'us' | 'uk';
    purpose?: 'reference' | 'expression_ai_read';
  }) => Promise<void>;
  loopPracticeText: (input: {
    messageId: string;
    roundId: number;
    text: string;
    times?: number;
    gapMs?: number;
  }) => Promise<void>;
  requestRepeatRound: (input: { messageId: string; roundId: number }) => Promise<void>;
};
