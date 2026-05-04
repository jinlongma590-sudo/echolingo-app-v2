export type SpeakingV1UltraState =
  | 'initializing'
  | 'ready'
  | 'assistantSpeaking'
  | 'waitingUser'
  | 'userSpeaking'
  | 'assistantThinking'
  | 'assistantStreaming'
  | 'error'
  | 'completed';

export type SpeakingV1UltraConnectionStatus =
  | 'idle'
  | 'starting'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'completed';

export type SpeakingV1UltraTranscriptStatus =
  | 'pending_transcript'
  | 'transcript_ready'
  | 'transcript_failed';

export type SpeakingV1UltraTranscriptSource =
  | 'pending'
  | 'openai_realtime'
  | 'xfyun_rtasr'
  | 'mock'
  | 'fallback';

export interface SpeakingV1UltraMessage {
  id: string;
  role: 'ai' | 'user';
  text: string;
  timestamp: number;
  roundId: number;
  isStreaming?: boolean;
  transcriptStatus?: SpeakingV1UltraTranscriptStatus;
  transcriptSource?: SpeakingV1UltraTranscriptSource;
}

export interface SpeakingV1UltraTranscriptItem {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  timestamp: number;
  roundId: number;
  isFinal: boolean;
  source: 'realtime';
}

export interface SpeakingV1UltraRuntimeError {
  scope: 'session' | 'token' | 'calls' | 'opening' | 'transport' | 'permission' | 'complete' | 'unknown';
  message: string;
  debugMessage?: string;
}
