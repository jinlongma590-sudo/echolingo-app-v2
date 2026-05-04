export type SpeakingStage =
  | 'idle'
  | 'starting'
  | 'ready'
  | 'recording'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'scoring'
  | 'ending'
  | 'completed'
  | 'error';

export type SpeakingScoreStage = 'idle' | 'scoring' | 'done' | 'error';

export type SpeakingMessageTranscriptStatus =
  | 'pending_transcript'
  | 'transcript_ready'
  | 'transcript_failed';

export type SpeakingMessageTranscriptSource =
  | 'pending'
  | 'openai_realtime'
  | 'xfyun_rtasr'
  | 'mock'
  | 'fallback';

export type SpeakingErrorScope =
  | 'session'
  | 'permission'
  | 'recording'
  | 'transcribing'
  | 'chat'
  | 'tts'
  | 'score'
  | 'complete'
  | 'unknown';

export interface SpeakingRuntimeError {
  scope: SpeakingErrorScope;
  message: string;
  recoverable: boolean;
}

export interface SpeakingCorrection {
  type: 'error' | 'ok' | 'tip';
  original: string;
  fixed?: string;
  reason?: string;
}

export interface SpeakingMessage {
  id: string;
  role: 'ai' | 'user';
  text: string;
  translation?: string;
  hint?: string;
  correction?: SpeakingCorrection;
  timestamp: number;
  isPending?: boolean;
  isStreaming?: boolean;
  transcriptStatus?: SpeakingMessageTranscriptStatus;
  transcriptSource?: SpeakingMessageTranscriptSource;
}

export interface SpeakingTranscriptItem {
  role: 'ai' | 'user';
  text: string;
  translation?: string;
  hint?: string;
}

export interface SpeakingRecordingResult {
  uri: string;
  mimeType: string;
  fileName: string;
  durationMs?: number | null;
  size?: number | null;
}

export interface SpeakingRecorderCapability {
  available: boolean;
  provider: 'expo-audio' | 'expo-av' | 'pcm-capture' | 'none';
  reason?: string;
}

export interface SpeakingTurnSummary {
  latestScoreOverall: number | null;
  averageScoreOverall: number | null;
  scoreCount: number;
}
