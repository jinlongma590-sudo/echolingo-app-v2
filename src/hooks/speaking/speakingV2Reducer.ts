import type {
  SpeakingV2ConnectionStatus,
  SpeakingV2ReviewPayload,
  SpeakingV2RuntimeError,
  SpeakingV2StageState,
  SpeakingV2State,
  SpeakingV2TranscriptItem,
} from '@/types/speakingV2';

export type SpeakingV2LiveStageState =
  | 'idle'
  | 'user_speaking'
  | 'thinking'
  | 'ai_speaking';

export type SpeakingV2EndStatus = 'completed' | 'aborted';

export type ExtendedSpeakingV2State = SpeakingV2State & {
  liveStageState: SpeakingV2LiveStageState;
  pendingCompletionStatus: SpeakingV2EndStatus | null;
  pendingCompletionPayload: SpeakingV2ReviewPayload | null;
  completionFailed: boolean;
};

export type SpeakingV2Action =
  | { type: 'RESET' }
  | { type: 'SET_CONNECTION_STATUS'; status: SpeakingV2ConnectionStatus }
  | { type: 'SET_STAGE_STATE'; stage: SpeakingV2StageState }
  | { type: 'SET_LIVE_STAGE_STATE'; liveStage: SpeakingV2LiveStageState }
  | { type: 'SET_SESSION_ID'; sessionId: string | null }
  | { type: 'SET_CREDITS'; credits: number | null }
  | { type: 'SET_ERROR'; error: SpeakingV2RuntimeError | null }
  | { type: 'SET_MIC_MUTED'; muted: boolean }
  | { type: 'SET_SPEAKER_ON'; enabled: boolean }
  | { type: 'SET_CALL_DURATION'; durationSec: number; remainingDurationSec: number }
  | { type: 'SET_TURN_COUNT'; turnCount: number }
  | { type: 'SET_TRANSPORT_CAPABILITY'; ready: boolean; reason: string | null }
  | { type: 'SET_CURRENT_AI_TEXT'; text: string }
  | { type: 'SET_CURRENT_USER_INTERIM'; text: string }
  | { type: 'SET_CURRENT_USER_FINAL'; text: string }
  | { type: 'UPSERT_TRANSCRIPT'; item: SpeakingV2TranscriptItem }
  | { type: 'PATCH_TRANSCRIPT'; id: string; patch: Partial<SpeakingV2TranscriptItem> }
  | { type: 'CLEAR_TRANSCRIPT' }
  | {
      type: 'SET_PENDING_COMPLETION';
      status: SpeakingV2EndStatus | null;
      payload: SpeakingV2ReviewPayload | null;
      failed: boolean;
    }
  | { type: 'SET_REVIEW_PAYLOAD'; payload: SpeakingV2ReviewPayload | null };

const MAX_CALL_DURATION_SEC = 8 * 60;

export const initialSpeakingV2State: ExtendedSpeakingV2State = {
  connectionStatus: 'idle',
  stageState: 'idle',
  liveStageState: 'idle',
  sessionId: null,
  transcript: [],
  currentAiText: '',
  currentUserTranscriptInterim: '',
  currentUserTranscriptFinal: '',
  turnCount: 0,
  reviewPayload: null,
  error: null,
  credits: null,
  isMicMuted: false,
  isSpeakerOn: true,
  callDurationSec: 0,
  remainingDurationSec: MAX_CALL_DURATION_SEC,
  transportReady: false,
  transportReason: null,
  pendingCompletionStatus: null,
  pendingCompletionPayload: null,
  completionFailed: false,
};

function upsertTranscript(
  transcript: SpeakingV2TranscriptItem[],
  item: SpeakingV2TranscriptItem,
): SpeakingV2TranscriptItem[] {
  const index = transcript.findIndex((entry) => entry.id === item.id);
  if (index === -1) {
    return [...transcript, item];
  }
  const next = [...transcript];
  next[index] = {
    ...next[index],
    ...item,
  };
  return next;
}

function patchTranscript(
  transcript: SpeakingV2TranscriptItem[],
  id: string,
  patch: Partial<SpeakingV2TranscriptItem>,
): SpeakingV2TranscriptItem[] {
  const index = transcript.findIndex((entry) => entry.id === id);
  if (index === -1) return transcript;
  const next = [...transcript];
  next[index] = {
    ...next[index],
    ...patch,
  };
  return next;
}

export function speakingV2Reducer(
  state: ExtendedSpeakingV2State,
  action: SpeakingV2Action,
): ExtendedSpeakingV2State {
  switch (action.type) {
    case 'RESET':
      return {
        ...initialSpeakingV2State,
        credits: state.credits,
        transportReady: state.transportReady,
        transportReason: state.transportReason,
      };
    case 'SET_CONNECTION_STATUS':
      return {
        ...state,
        connectionStatus: action.status,
      };
    case 'SET_STAGE_STATE':
      return {
        ...state,
        stageState: action.stage,
      };
    case 'SET_LIVE_STAGE_STATE':
      return {
        ...state,
        liveStageState: action.liveStage,
      };
    case 'SET_SESSION_ID':
      return {
        ...state,
        sessionId: action.sessionId,
      };
    case 'SET_CREDITS':
      return {
        ...state,
        credits: action.credits,
      };
    case 'SET_ERROR':
      return {
        ...state,
        error: action.error,
      };
    case 'SET_MIC_MUTED':
      return {
        ...state,
        isMicMuted: action.muted,
      };
    case 'SET_SPEAKER_ON':
      return {
        ...state,
        isSpeakerOn: action.enabled,
      };
    case 'SET_CALL_DURATION':
      return {
        ...state,
        callDurationSec: action.durationSec,
        remainingDurationSec: action.remainingDurationSec,
      };
    case 'SET_TURN_COUNT':
      return {
        ...state,
        turnCount: action.turnCount,
      };
    case 'SET_TRANSPORT_CAPABILITY':
      return {
        ...state,
        transportReady: action.ready,
        transportReason: action.reason,
      };
    case 'SET_CURRENT_AI_TEXT':
      return {
        ...state,
        currentAiText: action.text,
      };
    case 'SET_CURRENT_USER_INTERIM':
      return {
        ...state,
        currentUserTranscriptInterim: action.text,
      };
    case 'SET_CURRENT_USER_FINAL':
      return {
        ...state,
        currentUserTranscriptFinal: action.text,
      };
    case 'UPSERT_TRANSCRIPT':
      return {
        ...state,
        transcript: upsertTranscript(state.transcript, action.item),
      };
    case 'PATCH_TRANSCRIPT':
      return {
        ...state,
        transcript: patchTranscript(state.transcript, action.id, action.patch),
      };
    case 'CLEAR_TRANSCRIPT':
      return {
        ...state,
        transcript: [],
        currentAiText: '',
        currentUserTranscriptInterim: '',
        currentUserTranscriptFinal: '',
      };
    case 'SET_PENDING_COMPLETION':
      return {
        ...state,
        pendingCompletionStatus: action.status,
        pendingCompletionPayload: action.payload,
        completionFailed: action.failed,
      };
    case 'SET_REVIEW_PAYLOAD':
      return {
        ...state,
        reviewPayload: action.payload,
      };
    default:
      return state;
  }
}
