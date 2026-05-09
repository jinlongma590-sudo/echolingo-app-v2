import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { RoastCallOrb, type RoastCallOrbState } from '@/components/roast/RoastCallOrb';
import { ROAST_STREAM_TEST_TEXT, buildRoastGreetingProdUrl, buildRoastTtsHlsTestUrl, buildRoastTtsStreamTestUrl, createRoastReply, createRoastTextTurnStream, createRoastTurnStreamV2, createRoastTurnStreamV3, fetchRoastTtsAudio, fetchRoastTtsStream, startRoastTurnStreamV2, startRoastTurnStreamV3, transcribeRoastAudio, translateRoastText } from '@/services/api/roastCall';
import type { RoastLanguageIntent, RoastReply, RoastReplyMode, RoastTextTurnStream, RoastTurnStreamV3Handlers } from '@/services/api/roastCall';
import { connectRoastTurnWs } from '@/services/api/roastTurnWsClient';
import type { RoastTurnWsClient } from '@/services/api/roastTurnWsClient';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import { useEntitlementGuard } from '@/hooks/useEntitlementGuard';
import { SPEAKING_RECORDER_CONFIGS, createSpeakingRecorder } from '@/services/audio/recording';
import type { SpeakingRecorderConfigId } from '@/services/audio/recording';
import type { SpeakingRecorderController } from '@/services/audio/recording';
import { getRoastChunkStreamState, playRoastChunkStreamUrl, setRoastWebRtcManualAudioEnabled, stopRoastChunkStreamPlayer, subscribeChunkStreamEvents } from '@/services/audio/roastChunkStreamNativePlayer';
import type { RoastChunkStreamEvent, RoastChunkStreamState } from '@/services/audio/roastChunkStreamNativePlayer';
import { isRoastNativeStreamPlayerAvailable, playRoastNativeStreamUrl } from '@/services/audio/roastStreamNativePlayer';
import {
  playRoastMp3Fallback,
  playRoastReactionSfx,
  playRoastRemoteStreamUrl,
  playRoastTtsStreamIfSupported,
  stopRoastAudioQueue,
} from '@/services/audio/streamingAudioQueue';
import { startRoastRealtimeAsr } from '@/services/realtime/roastRealtimeAsrClient';
import type { RoastRealtimeAsrController, RoastRealtimeAsrEvent, RoastRealtimeAsrMode } from '@/services/realtime/roastRealtimeAsrClient';
import { analyzeRoastAsrTranscript, previewRoastAsrTranscript } from '@/services/roast/roastAsrSanity';
import type { RoastAsrSanityReason } from '@/services/roast/roastAsrSanity';
import { useAppTheme } from '@/theme/AppThemeProvider';

type RoastCallState =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'waitingRepeat'
  | 'error';

type PersistentCallState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'paused'
  | 'ended'
  | 'error';

type PersistentTurnState =
  | 'none'
  | 'greeting'
  | 'waitingFinal'
  | 'rejected'
  | 'responding'
  | 'playing'
  | 'completed'
  | 'error';

type RoastTurnTransport = 'ndjson_v3' | 'ws_v4';

const ROAST_USE_WS_V4_IN_DEV = true;
// Release transport is controlled by EXPO_PUBLIC_ROAST_TURN_TRANSPORT.
// Default (unset) → ndjson_v3 to keep production behavior conservative until
// the WSS production server is verified. Set to 'ws_v4' in .env.production
// (or EAS build env) to opt into ws_v4 for Release. Failure auto-falls back
// to ndjson_v3 via the existing wsReady guard.
const ROAST_TURN_TRANSPORT_OVERRIDE = (() => {
  const raw = process.env.EXPO_PUBLIC_ROAST_TURN_TRANSPORT?.trim().toLowerCase();
  return raw === 'ws_v4' || raw === 'ndjson_v3' ? (raw as RoastTurnTransport) : null;
})();
const ROAST_PERSISTENT_TURN_TRANSPORT: RoastTurnTransport =
  ROAST_TURN_TRANSPORT_OVERRIDE
    ?? (__DEV__ && ROAST_USE_WS_V4_IN_DEV ? 'ws_v4' : 'ndjson_v3');
const ROAST_CALL_PRIMARY_BUTTON_HEIGHT = 58;
const ROAST_CALL_SECONDARY_BUTTON_MIN_HEIGHT = 34;
const ROAST_CALL_CONTROLS_PADDING_TOP = 16;
const ROAST_CALL_CONTROLS_GAP = 12;
const ROAST_CALL_CONTROLS_MIN_BOTTOM_PADDING = 36;
const ROAST_CALL_CONTROLS_SAFE_AREA_EXTRA = 20;
const ROAST_CALL_SCROLL_BOTTOM_BREATHING_ROOM = 40;
const ROAST_CALL_TABLET_PORTRAIT_MAX_WIDTH = 760;
const ROAST_CALL_TABLET_LANDSCAPE_MAX_WIDTH = 860;
const ROAST_ASR_AI_PLAYBACK_COOLDOWN_MS = 250;
const ROAST_ASR_AI_ECHO_GUARD_MS = 3000;
const ROAST_IOS_IPAD_DETACH_AUDIO_SENDER_DURING_TTS = false;
const ROAST_IOS_IPAD_TTS_TEMP_PLAYBACK_SESSION_EXPERIMENT = true;
const ROAST_IOS_IPAD_TTS_FAST_TURN_SETTLE_EXPERIMENT = true;
const ROAST_IPAD_TTS_PLAYBACK_FIX_ENV_NAME = 'EXPO_PUBLIC_ROAST_IPAD_TTS_PLAYBACK_FIX';
const ROAST_IPAD_TTS_PLAYBACK_FIX_ENABLED = isTruthyPublicEnvFlag(
  process.env.EXPO_PUBLIC_ROAST_IPAD_TTS_PLAYBACK_FIX,
);

function isTruthyPublicEnvFlag(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function isRoastIpadDetachAudioSenderExperimentEnabled() {
  const globalToggle = (globalThis as typeof globalThis & {
    __ROAST_IOS_IPAD_DETACH_AUDIO_SENDER_DURING_TTS?: boolean;
  }).__ROAST_IOS_IPAD_DETACH_AUDIO_SENDER_DURING_TTS;
  return __DEV__ && (ROAST_IOS_IPAD_DETACH_AUDIO_SENDER_DURING_TTS || globalToggle === true);
}

function isRoastIpadTtsTempPlaybackSessionExperimentEnabled() {
  const globalToggle = (globalThis as typeof globalThis & {
    __ROAST_IOS_IPAD_TTS_TEMP_PLAYBACK_SESSION_EXPERIMENT?: boolean;
  }).__ROAST_IOS_IPAD_TTS_TEMP_PLAYBACK_SESSION_EXPERIMENT;
  return ROAST_IPAD_TTS_PLAYBACK_FIX_ENABLED
    || (__DEV__ && (ROAST_IOS_IPAD_TTS_TEMP_PLAYBACK_SESSION_EXPERIMENT || globalToggle === true));
}

function isRoastIpadTtsFastTurnSettleExperimentEnabled() {
  const globalToggle = (globalThis as typeof globalThis & {
    __ROAST_IOS_IPAD_TTS_FAST_TURN_SETTLE_EXPERIMENT?: boolean;
  }).__ROAST_IOS_IPAD_TTS_FAST_TURN_SETTLE_EXPERIMENT;
  return ROAST_IPAD_TTS_PLAYBACK_FIX_ENABLED
    || (__DEV__ && (ROAST_IOS_IPAD_TTS_FAST_TURN_SETTLE_EXPERIMENT || globalToggle === true));
}

type RoastEndCallOptions = {
  reason: string;
  source: string;
  requestId?: string | null;
  expectedSessionId?: string | null;
  explicit?: boolean;
  stackHint: string;
};

type PerfMarks = {
  t0StopRecording?: number;
  tSfxRequested?: number;
  tSfxDone?: number;
  t1AsrDone?: number;
  t2RespondDone?: number;
  t3TtsRequest?: number;
  t4TtsReady?: number;
  t5PlaybackStart?: number;
};

type RealtimeAsrLabState = {
  status: 'idle' | 'connecting' | 'listening' | 'waitingFinal' | 'completed' | 'stopped' | 'error';
  requestId: string | null;
  asrMode: RoastRealtimeAsrMode;
  tokenMs?: number;
  connectMs?: number;
  sessionConnectedMs?: number;
  sessionUpdatedMs?: number;
  speechStartedMs?: number;
  speechStoppedMs?: number;
  firstPartialMs?: number;
  finalMs?: number;
  stoppedToFirstDeltaMs?: number;
  stoppedToFinalMs?: number;
  partialText: string;
  finalText: string;
  eventCount: number;
  remoteTrackPresent: boolean;
  unexpectedVoice: boolean;
  error: string | null;
};

type RealtimeRoastTurnState = {
  state:
    | 'idle'
    | 'connectingAsr'
    | 'listening'
    | 'waitingFinal'
    | 'thinking'
    | 'speaking'
    | 'completed'
    | 'asrRejected'
    | 'stopped'
    | 'error';
  requestId: string | null;
  nativeStreamRequestId?: string | null;
  asrRawText: string;
  eventCount: number;
  t0?: number;
  asrConnectedMs?: number;
  speechStartedMs?: number;
  speechStoppedMs?: number;
  firstDeltaMs?: number;
  asrFinalMs?: number;
  turnRequestMs?: number;
  turnResponseMs?: number;
  audioRequestStartMs?: number;
  firstNetworkChunkMs?: number;
  firstPacketParsedMs?: number;
  audioQueueStartedMs?: number;
  playbackEndedMs?: number;
  stoppedToFinalMs?: number;
  finalToTurnResponseMs?: number;
  turnResponseToAudioQueueStartedMs?: number;
  stoppedToAudioQueueStartedMs?: number;
  clickToAudioQueueStartedMs?: number;
  stoppedToPlaybackEndedMs?: number;
  asrQualityCheckedMs?: number;
  asrQualityOk: boolean | null;
  asrQualityReason?: RoastAsrQualityReason | null;
  asrSanityReason?: RoastAsrSanityReason | null;
  asrSanityMatchedPhrase?: string | null;
  rejectedText?: string;
  retryHint?: string;
  enteredTurnStream: boolean;
  enteredAudioQueue: boolean;
  reply: RoastReply | null;
  turnMetrics?: Record<string, number | string | boolean | null | undefined>;
  remoteTrackPresent: boolean;
  unexpectedVoice: boolean;
  staleEventCount: number;
  error: string | null;
};

type RoastCallTurnHistory = {
  id: string;
  createdAt: number;
  asrRawText: string;
  asrQualityOk: boolean;
  asrQualityReason?: RoastAsrQualityReason | null;
  mode: RoastReplyMode | 'rejected' | 'error' | 'stopped';
  spokenText: string;
  correction: {
    hasCorrection: boolean;
    wrong: string;
    right: string;
    reason: string;
  };
  nextPrompt: string;
  timings: {
    stoppedToFinalMs?: number;
    finalToTurnMs?: number;
    turnToAudioStartMs?: number;
    stoppedToAudioStartMs?: number;
    playbackEndedMs?: number;
  };
  status: 'completed' | 'rejected' | 'error' | 'stopped';
};

type RoastTranslationCacheEntry = {
  status: 'loading' | 'success' | 'error';
  translationZh?: string;
  error?: string;
};

const FIXED_TEST_TEXT = 'I very like this app.';
const ROAST_CALL_GREETING_TEXT = "Yo, what's up bro? Say anything in English. I'll roast it and fix it.";
const ENABLE_ROAST_STREAM_PLAYBACK = false;

type RoastAsrQualityReason =
  | 'empty'
  | 'too_short'
  | 'single_noise_token'
  | 'contextual_short_reply'
  | 'low_confidence_phrase'
  | 'hangul_misrecognition'
  | 'kana_misrecognition'
  | 'non_english_chinese_noise'
  | 'mixed_chinese_english'
  | 'chinese_help'
  | 'noise'
  | RoastAsrSanityReason;

type RoastAsrQualityResult = {
  ok: boolean;
  reason?: RoastAsrQualityReason;
  normalizedText: string;
};

type RoastAsrQualityContext = {
  hasConversationHistory?: boolean;
  previousAssistantText?: string;
};

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function createRealtimeAsrRequestId() {
  return `asr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function createRealtimeRoastTurnRequestId() {
  return `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function delta(from?: number, to?: number) {
  if (typeof from !== 'number' || typeof to !== 'number') return '--';
  return `${Math.max(0, Math.round(to - from))}ms`;
}

function elapsedSince(start?: number) {
  if (typeof start !== 'number') return undefined;
  return Math.max(0, Math.round(now() - start));
}

function safeDiff(to?: number, from?: number) {
  if (typeof to !== 'number' || typeof from !== 'number') return undefined;
  const value = Math.round(to - from);
  return value >= 0 ? value : undefined;
}

function statusLabel(state: RoastCallState) {
  switch (state) {
    case 'recording':
      return 'Listening';
    case 'transcribing':
      return 'Transcribing';
    case 'thinking':
      return 'Cooking the roast';
    case 'speaking':
      return 'LA Bro speaking';
    case 'waitingRepeat':
      return 'Run it back';
    case 'error':
      return 'Needs attention';
    default:
      return 'Ready';
  }
}

function realtimeRoastButtonLabel(state: RealtimeRoastTurnState['state']) {
  switch (state) {
    case 'connectingAsr':
      return 'Connecting...';
    case 'listening':
    case 'waitingFinal':
      return 'Listening...';
    case 'thinking':
      return 'Thinking...';
    case 'speaking':
      return 'Speaking...';
    case 'asrRejected':
    case 'error':
      return 'Try Again';
    default:
      return 'Tap to Speak';
  }
}

function realtimeRoastStatusLabel(state: RealtimeRoastTurnState['state']) {
  switch (state) {
    case 'connectingAsr':
      return 'Connecting';
    case 'listening':
      return 'Listening';
    case 'waitingFinal':
      return 'Catching your English';
    case 'thinking':
      return 'Cooking a reply';
    case 'speaking':
      return 'LA Bro speaking';
    case 'completed':
      return 'Ready for the next turn';
    case 'asrRejected':
      return 'Say it again';
    case 'stopped':
      return 'Stopped';
    case 'error':
      return 'Needs attention';
    default:
      return 'Ready';
  }
}

function persistentCallButtonLabel(state: PersistentCallState) {
  switch (state) {
    case 'connecting':
      return 'Connecting...';
    case 'listening':
      return 'Just speak';
    case 'processing':
      return 'Thinking...';
    case 'speaking':
      return 'LA Bro talking...';
    case 'paused':
      return 'Resume Call';
    case 'ended':
    case 'error':
      return 'Start Again';
    default:
      return 'Start Call';
  }
}

function persistentCallStatusLabel(state: PersistentCallState, turnState: PersistentTurnState) {
  if (turnState === 'greeting') return 'LA Bro is starting...';
  if (turnState === 'rejected') return "Didn't catch that. Say it again.";
  switch (state) {
    case 'connecting':
      return 'Connecting to LA Bro...';
    case 'listening':
      return 'Listening — just speak';
    case 'processing':
      return 'Thinking...';
    case 'speaking':
      return 'LA Bro is talking...';
    case 'paused':
      return 'Paused';
    case 'ended':
      return 'Ended';
    case 'error':
      return 'Needs attention';
    default:
      return 'Ready';
  }
}

function persistentCallSubLabel(state: PersistentCallState, turnState: PersistentTurnState) {
  if (turnState === 'greeting') return 'Opening the call. You can stop him, then just speak.';
  if (turnState === 'rejected') return "I didn't catch that clearly. Say it again.";
  switch (state) {
    case 'listening':
      return 'Call connected. Say your next sentence — no tapping needed.';
    case 'processing':
      return 'Cooking the reply.';
    case 'speaking':
      return 'Wait, or tap Stop AI.';
    case 'connecting':
      return 'After Start Call, just speak naturally. No need to tap each turn.';
    case 'ended':
      return 'Call ended. Start again when ready.';
    default:
      return 'Ready to roast your English.';
  }
}

function roastCallOrbState(
  state: RoastCallState,
  callState: PersistentCallState,
  turnState: PersistentTurnState,
): RoastCallOrbState {
  if (state === 'error' || callState === 'error' || turnState === 'error') return 'error';
  if (turnState === 'rejected') return 'rejected';
  if (turnState === 'greeting') return 'greeting';
  if (callState === 'speaking' || turnState === 'playing' || state === 'speaking') return 'speaking';
  if (callState === 'processing' || turnState === 'responding' || state === 'thinking' || state === 'transcribing') return 'processing';
  if (callState === 'connecting') return 'connecting';
  if (callState === 'listening' || turnState === 'waitingFinal' || state === 'recording') return 'listening';
  if (callState === 'ended') return 'ended';
  return 'idle';
}

function roastModeLabel(mode?: string | null) {
  switch (mode) {
    case 'correction':
      return 'Quick Fix';
    case 'mixed':
      return 'Chat + Fix';
    case 'conversation':
      return 'Conversation';
    default:
      return 'Chat';
  }
}

function roastReactionLabel(reaction?: string | null) {
  switch (reaction) {
    case 'laugh_crazy':
      return 'Playful';
    case 'laugh_mocking':
      return 'Teasing';
    case 'no_way':
      return 'No way';
    case 'bruh':
      return 'Bruh';
    case 'none':
    case undefined:
    case null:
      return 'Normal';
    default:
      return String(reaction).replace(/_/g, ' ');
  }
}

function roastNextActionLabel(nextAction?: string | null) {
  switch (nextAction) {
    case 'repeat':
      return 'Repeat';
    case 'continue':
      return 'Keep going';
    default:
      return 'Keep going';
  }
}

function debugTransportStatusLabel(inFlight: boolean, state: RoastCallState, status?: string | null) {
  if (!inFlight) return null;
  if (status?.includes('turn-stream')) return 'Testing Reply Stream';
  if (status?.includes('chunk')) return 'Testing Chunk Stream';
  if (state === 'speaking') return 'Playing Test Voice';
  if (state === 'thinking') return 'Testing Stream Reply';
  return 'Running Debug Test';
}

function debugTransportSubLabel(inFlight: boolean, status?: string | null) {
  if (!inFlight) return null;
  return status || 'Debug transport test is running. Do not tap Start Call.';
}

function getAsrQualityIssue(text: string) {
  const normalized = text.trim().toLowerCase().replace(/[^\w\s']/g, '').replace(/\s+/g, ' ');
  if (normalized.length < 5) {
    return `ASR too short: "${text || '(empty)'}"`;
  }
  if (['you', 'yeah', 'um', 'uh', 'hmm', 'mm', 'mmm', 'okay', 'ok', 'sap', 'app'].includes(normalized)) {
    return `ASR low confidence: "${text}"`;
  }
  return null;
}

function looksLikePromptForShortReply(text?: string) {
  if (!text) return false;
  const normalized = text.toLowerCase();
  return /(\?|what|which|pick|choose|talk about|work on|practice|wanna|want to|tell me|say more|first)/.test(normalized);
}

function isContextualShortReply(token: string) {
  return new Set([
    'speaking',
    'listening',
    'grammar',
    'work',
    'job',
    'pronunciation',
    'vocabulary',
    'slang',
    'conversation',
    'interview',
    'meeting',
    'presentation',
    'email',
    'travel',
    'school',
    'study',
    'english',
    'pressure',
    'business',
  ]).has(token);
}

function countMatches(text: string, pattern: RegExp) {
  return (text.match(pattern) ?? []).length;
}

function normalizeLanguageIntentText(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectLanguageIntent(text: string): RoastLanguageIntent {
  const normalized = normalizeLanguageIntentText(text);
  const raw = text.trim();
  const userSpokeChinese = /[\u3400-\u9FFF]/u.test(raw);
  const userSpokeEnglish = /[A-Za-z]/.test(raw);

  const chineseAssistByChinese =
    /(说中文|用中文|中文解释|你能说中文吗|你会说中文吗|我听不懂|我不会说|我不知道怎么说|用中文告诉我|帮我翻译|翻译|这个用英语怎么说|这句话怎么说|怎么说|中文可以吗)/.test(raw);
  if (chineseAssistByChinese) {
    return {
      wantsChineseExplanation: true,
      wantsTranslationHelp: /(翻译|怎么说|用英语怎么说|我不知道怎么说|我不会说)/.test(raw),
      userSpokeChinese,
      userSpokeEnglish,
      likelyAsrMisheardChineseRequest: false,
      reason: 'zh_request_chinese',
    };
  }

  const benignChineseMention =
    /\b(i speak chinese|chinese is hard|i am learning chinese|i'm learning chinese|learning chinese|my chinese)\b/.test(normalized);
  if (benignChineseMention) {
    return {
      wantsChineseExplanation: false,
      wantsTranslationHelp: false,
      userSpokeChinese,
      userSpokeEnglish,
      likelyAsrMisheardChineseRequest: false,
      reason: 'benign_chinese_mention',
    };
  }

  const directEnglishRequest =
    /\b(can you speak chinese|use chinese|explain in chinese|tell me in chinese|say it in chinese|chinese please|help me in chinese|can you teach me in chinese|teach me in chinese)\b/.test(normalized) ||
    /\b(i don't understand|i dont understand|i don't know how to say it|i dont know how to say it|how do i say this in english|translate this)\b/.test(normalized);
  if (directEnglishRequest) {
    return {
      wantsChineseExplanation: true,
      wantsTranslationHelp: /\b(how do i say|translate|don't know how to say|dont know how to say)\b/.test(normalized),
      userSpokeChinese,
      userSpokeEnglish,
      likelyAsrMisheardChineseRequest: false,
      reason: 'zh_request_english',
    };
  }

  const asrTolerantRequest = [
    'you say chinese',
    'you speak chinese',
    'say chinese',
    'use chinese',
    'chinese',
    'teach me chinese',
  ].includes(normalized);
  if (asrTolerantRequest) {
    return {
      wantsChineseExplanation: true,
      wantsTranslationHelp: false,
      userSpokeChinese,
      userSpokeEnglish,
      likelyAsrMisheardChineseRequest: true,
      reason: 'zh_request_asr_tolerant',
    };
  }

  return {
    wantsChineseExplanation: userSpokeChinese,
    wantsTranslationHelp: userSpokeChinese,
    userSpokeChinese,
    userSpokeEnglish,
    likelyAsrMisheardChineseRequest: false,
    reason: userSpokeChinese ? 'user_spoke_chinese' : '',
  };
}

function detectRoastTranscriptLanguage(text: string) {
  const chineseCount = countMatches(text, /[\u3400-\u9FFF]/gu);
  const latinCount = countMatches(text, /[A-Za-z]/g);
  if (chineseCount > 0 && latinCount > 0) return 'Mixed';
  if (chineseCount > 0) return 'Chinese';
  return 'English';
}

function isLanguageMisrecognitionReason(reason?: string | null) {
  return reason === 'hangul_misrecognition' || reason === 'kana_misrecognition' || reason === 'non_english_chinese_noise';
}

function evaluateRoastAsrQuality(text: string, context: RoastAsrQualityContext = {}): RoastAsrQualityResult {
  const normalizedText = text.trim().replace(/\s+/g, ' ');
  const normalizedLower = normalizedText.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, '').replace(/\s+/g, ' ').trim();
  if (!normalizedText) {
    return { ok: false, reason: 'empty', normalizedText };
  }

  const hangulChars = countMatches(normalizedText, /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/gu);
  const kanaChars = countMatches(normalizedText, /[\u3040-\u30FF]/gu);
  const chineseChars = countMatches(normalizedText, /[\u3400-\u9FFF]/gu);
  const latinChars = countMatches(normalizedText, /[A-Za-z]/g);
  const letterChars = countMatches(normalizedText, /\p{L}/gu);
  if (hangulChars > 0 && hangulChars >= Math.max(2, Math.ceil(letterChars * 0.35))) {
    return { ok: false, reason: 'hangul_misrecognition', normalizedText };
  }
  if (kanaChars > 0 && kanaChars >= Math.max(2, Math.ceil(letterChars * 0.35))) {
    return { ok: false, reason: 'kana_misrecognition', normalizedText };
  }
  if (letterChars > 0 && latinChars === 0 && chineseChars === 0) {
    return { ok: false, reason: 'non_english_chinese_noise', normalizedText };
  }
  if (chineseChars > 0) {
    return { ok: true, reason: latinChars > 0 ? 'mixed_chinese_english' : 'chinese_help', normalizedText };
  }

  const hasLetters = /\p{L}/u.test(normalizedText);
  const alphaNumericChars = (normalizedText.match(/[\p{L}\p{N}]/gu) ?? []).length;
  const visibleChars = (normalizedText.match(/\S/gu) ?? []).length;
  if (!hasLetters || (visibleChars > 0 && alphaNumericChars / visibleChars < 0.45)) {
    return { ok: false, reason: 'noise', normalizedText };
  }

  const lowConfidencePhrases = new Set([
    'you',
    'yeah',
    'um',
    'uh',
    'mm',
    'hmm',
    'mmm',
    'ok',
    'okay',
    'sap',
    'app',
    'this app',
  ]);
  if (lowConfidencePhrases.has(normalizedLower)) {
    return { ok: false, reason: 'low_confidence_phrase', normalizedText };
  }
  if (normalizedLower.length <= 2) {
    return { ok: false, reason: 'too_short', normalizedText };
  }

  const tokens = normalizedLower.split(' ').filter(Boolean);
  if (['chinese', 'say chinese', 'use chinese', 'you say chinese', 'you speak chinese', 'teach me chinese', 'teach me in chinese'].includes(normalizedLower)) {
    return { ok: true, reason: 'chinese_help', normalizedText };
  }
  const meaningfulSingleTokenAllowlist = new Set(['why', 'what', 'how', 'really', 'yes', 'no', 'hello', 'hi', 'hey']);
  if (
    tokens.length === 1
    && context.hasConversationHistory
    && looksLikePromptForShortReply(context.previousAssistantText)
    && isContextualShortReply(tokens[0])
  ) {
    return { ok: true, reason: 'contextual_short_reply', normalizedText };
  }
  if (tokens.length === 1 && !meaningfulSingleTokenAllowlist.has(tokens[0])) {
    return { ok: false, reason: 'single_noise_token', normalizedText };
  }

  const alphaTokens = tokens.filter((token) => /^[\p{L}']+$/u.test(token));
  if (tokens.length >= 2 && alphaTokens.length < Math.ceil(tokens.length * 0.55)) {
    return { ok: false, reason: 'noise', normalizedText };
  }

  return { ok: true, normalizedText };
}

export function RoastCallScreen() {
  const { theme } = useAppTheme();
  const safeAreaInsets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const appSession = useAppSession();
  const { guardAiPracticeAccess, refresh: refreshEntitlements } = useEntitlementGuard();
  const recorderRef = useRef<SpeakingRecorderController | null>(null);
  const realtimeAsrRef = useRef<RoastRealtimeAsrController | null>(null);
  const realtimeAsrActiveRequestIdRef = useRef<string | null>(null);
  const realtimeAsrStartedAtRef = useRef<number | null>(null);
  const realtimeAsrStatusRef = useRef<RealtimeAsrLabState['status']>('idle');
  const realtimeRoastTurnAsrRef = useRef<RoastRealtimeAsrController | null>(null);
  const persistentAsrRef = useRef<RoastRealtimeAsrController | null>(null);
  const persistentTurnWsRef = useRef<RoastTurnWsClient | null>(null);
  const persistentTurnWsReadyRef = useRef(false);
  const persistentTurnWsReadyMsRef = useRef<number | null>(null);
  const persistentTurnWsConnectedAtMsRef = useRef<number | null>(null);
  const persistentActiveTurnAbortRef = useRef<(() => void) | null>(null);
  const persistentSessionIdRef = useRef<string | null>(null);
  const activeCallRunIdRef = useRef<string | null>(null);
  const activeCallAbortControllerRef = useRef<AbortController | null>(null);
  const callRunSeqRef = useRef(0);
  const screenMountedRef = useRef(true);
  const persistentCallStartedAtRef = useRef<number | null>(null);
  const persistentCallStateRef = useRef<PersistentCallState>('idle');
  const persistentTurnStateRef = useRef<PersistentTurnState>('none');
  const roastTtsWarmupStartedRef = useRef(false);
  const greetingInFlightRef = useRef(false);
  const greetingSessionIdRef = useRef<string | null>(null);
  const greetingCandidateNativeRequestIdRef = useRef<string | null>(null);
  const greetingNativeRequestIdRef = useRef<string | null>(null);
  const greetingPlaybackUrlPathRef = useRef<string | null>(null);
  const greetingPlaybackWaiterRef = useRef<{
    sessionId: string;
    nativeRequestId: string | null;
    resolve: (event: RoastChunkStreamEvent) => void;
    reject: (error: Error) => void;
  } | null>(null);
  const persistentCurrentTurnRef = useRef<{
    turnId: string | null;
    turnStartedAt?: number;
    speechStartedMs?: number;
    speechStoppedMs?: number;
    firstDeltaMs?: number;
    partialText: string;
  }>({ turnId: null, partialText: '' });
  const isAiSpeakingRef = useRef(false);
  const aiPlaybackGateUntilRef = useRef(0);
  const aiPlaybackEchoGuardUntilRef = useRef(0);
  const lastAiPlaybackTextRef = useRef('');
  const ignoredWhileBusyRef = useRef(0);
  const ignoredAiPlaybackRef = useRef(0);
  const roastTurnsRef = useRef<RoastCallTurnHistory[]>([]);
  const realtimeRoastTurnActiveRequestIdRef = useRef<string | null>(null);
  const realtimeRoastTurnStartedAtRef = useRef<number | null>(null);
  const realtimeRoastTurnNativeStreamRequestIdRef = useRef<string | null>(null);
  const realtimeRoastTurnStateRef = useRef<RealtimeRoastTurnState['state']>('idle');
  const stopRealtimeRoastTurnRef = useRef<() => Promise<void>>(async () => undefined);
  const stopPersistentCallRef = useRef<(options?: Partial<RoastEndCallOptions>) => Promise<void>>(async () => undefined);
  const stopRequestedRef = useRef(false);
  const sfxMarksRef = useRef<Pick<PerfMarks, 'tSfxRequested' | 'tSfxDone'>>({});
  const [state, setState] = useState<RoastCallState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [reply, setReply] = useState<RoastReply | null>(null);
  const [perf, setPerf] = useState<PerfMarks>({});
  const [lastSfxStatus, setLastSfxStatus] = useState<string | null>(null);
  const [streamTestStatus, setStreamTestStatus] = useState<string | null>(null);
  const [chunkStreamStatus, setChunkStreamStatus] = useState<string | null>(null);
  const [chunkStreamState, setChunkStreamState] = useState<RoastChunkStreamState | null>(null);
  const [chunkStreamEventCount, setChunkStreamEventCount] = useState(0);
  const [latestChunkStreamEvent, setLatestChunkStreamEvent] = useState<RoastChunkStreamEvent | null>(null);
  const [streamTestInFlight, setStreamTestInFlight] = useState(false);
  const [recordingConfigId, setRecordingConfigId] = useState<SpeakingRecorderConfigId>('high_quality_m4a');
  const [lastAsrStatus, setLastAsrStatus] = useState<string | null>(null);
  const [realtimeAsrMode, setRealtimeAsrMode] = useState<RoastRealtimeAsrMode>('verbatim');
  const [realtimeAsr, setRealtimeAsr] = useState<RealtimeAsrLabState>({
    status: 'idle',
    requestId: null,
    asrMode: 'verbatim',
    partialText: '',
    finalText: '',
    eventCount: 0,
    remoteTrackPresent: false,
    unexpectedVoice: false,
    error: null,
  });
  const [realtimeRoastTurn, setRealtimeRoastTurn] = useState<RealtimeRoastTurnState>({
    state: 'idle',
    requestId: null,
    nativeStreamRequestId: null,
    asrRawText: '',
    eventCount: 0,
    asrQualityOk: null,
    asrQualityReason: null,
    enteredTurnStream: false,
    enteredAudioQueue: false,
    reply: null,
    remoteTrackPresent: false,
    unexpectedVoice: false,
    staleEventCount: 0,
    error: null,
  });
  const [roastTurns, setRoastTurns] = useState<RoastCallTurnHistory[]>([]);
  const [replyTranslationOpen, setReplyTranslationOpen] = useState(false);
  const [turnTranslationOpenById, setTurnTranslationOpenById] = useState<Record<string, boolean>>({});
  const [translationCache, setTranslationCache] = useState<Record<string, RoastTranslationCacheEntry>>({});
  const [debugToolsOpen, setDebugToolsOpen] = useState(false);
  const [callState, setCallState] = useState<PersistentCallState>('idle');
  const [turnState, setTurnState] = useState<PersistentTurnState>('none');
  const [persistentSessionId, setPersistentSessionId] = useState<string | null>(null);
  const [ignoredWhileBusy, setIgnoredWhileBusy] = useState(0);
  const [ignoredAiPlayback, setIgnoredAiPlayback] = useState(0);
  const selectedRecorderConfig = SPEAKING_RECORDER_CONFIGS[recordingConfigId];

  function showAssistantReplyCard(nextReply: RoastReply) {
    setReply(nextReply);
    setReplyTranslationOpen(false);
  }

  function clearAssistantReplyCard() {
    setReply(null);
    setReplyTranslationOpen(false);
  }

  function hashRoastTranslationText(text: string) {
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
    }
    return Math.abs(hash).toString(36);
  }

  function buildTranslationKey(text: string, turnId?: string | null) {
    const trimmed = text.trim();
    return turnId ? `turn:${turnId}` : `text:${hashRoastTranslationText(trimmed)}:${trimmed.length}`;
  }

  function getTranslationEntry(text: string, turnId?: string | null) {
    return translationCache[buildTranslationKey(text, turnId)];
  }

  async function requestTranslation(text: string, source: 'assistant_reply' | 'recent_turn', turnId?: string | null) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const key = buildTranslationKey(trimmed, turnId);
    const current = translationCache[key];
    if (current?.status === 'loading' || current?.status === 'success') return;

    setTranslationCache((cache) => ({
      ...cache,
      [key]: { status: 'loading' },
    }));

    try {
      const result = await translateRoastText({
        text: trimmed,
        source,
        turnId: turnId ?? undefined,
        accessToken: appSession.session?.accessToken ?? null,
      });
      const translationZh = result.translationZh?.trim();
      setTranslationCache((cache) => ({
        ...cache,
        [key]: translationZh
          ? { status: 'success', translationZh }
          : { status: 'error', error: '暂时没有可显示的翻译。' },
      }));
    } catch {
      setTranslationCache((cache) => ({
        ...cache,
        [key]: { status: 'error', error: '翻译暂时不可用，稍后再试。' },
      }));
    }
  }

  function toggleReplyTranslation() {
    if (!reply?.spokenText) return;
    if (replyTranslationOpen) {
      setReplyTranslationOpen(false);
      return;
    }
    setReplyTranslationOpen(true);
    void requestTranslation(reply.spokenText, 'assistant_reply', null);
  }

  function toggleTurnTranslation(turn: RoastCallTurnHistory) {
    setTurnTranslationOpenById((current) => ({
      ...current,
      [turn.id]: !current[turn.id],
    }));
    if (!turnTranslationOpenById[turn.id] && turn.spokenText) {
      void requestTranslation(turn.spokenText, 'recent_turn', turn.id);
    }
  }

  useEffect(() => {
    if (
      !isRoastIpadTtsTempPlaybackSessionExperimentEnabled()
      || Platform.OS !== 'ios'
      || (!__DEV__ && windowWidth < 768)
    ) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const result = await setRoastWebRtcManualAudioEnabled(true);
      if (cancelled && result) {
        await setRoastWebRtcManualAudioEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
      void setRoastWebRtcManualAudioEnabled(false);
    };
  }, []);

	  useEffect(() => {
    screenMountedRef.current = true;
    const effectSessionId = persistentSessionIdRef.current;
	    recorderRef.current = createSpeakingRecorder(recordingConfigId);
		    const unsubscribeChunkEvents = subscribeChunkStreamEvents((event) => {
	      handleGreetingChunkEvent(event);
		      handleRealtimeRoastTurnChunkEvent(event);
      setLatestChunkStreamEvent(event);
      setChunkStreamState(event);
      setChunkStreamEventCount((count) => count + 1);
      if (event.type !== 'roastChunkStream:progress') {
        console.log('[ROAST_CHUNK_STREAM_EVENT]', JSON.stringify({
          type: event.type,
          requestId: event.requestId,
          elapsedMs: event.elapsedMs ?? null,
          bytesReceived: event.bytesReceived ?? 0,
          packetsQueued: event.packetsQueued ?? 0,
          buffersQueued: event.buffersQueued ?? 0,
          bytesQueuedBeforeStart: event.bytesQueuedBeforeStart ?? null,
          firstBufferByteSize: event.firstBufferByteSize ?? null,
          firstPacketCount: event.firstPacketCount ?? null,
          audioSessionSetupMs: event.audioSessionSetupMs ?? null,
          audioQueueStartAttemptMs: event.audioQueueStartAttemptMs ?? null,
          audioQueuePrimeMs: event.audioQueuePrimeMs ?? null,
          audioQueuePrimeResult: event.audioQueuePrimeResult ?? null,
          audioQueueStartResult: event.audioQueueStartResult ?? null,
          audioQueueVolume: event.audioQueueVolume ?? null,
          status: event.status ?? null,
          error: event.error ?? null,
          audioSession: event.audioSession ?? null,
          audioSessionError: event.audioSessionError ?? null,
        }));
      }
    });
	    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
	      if (nextState !== 'active') {
          invalidateActiveCallRun('end_call_invalidate_run', 'app_state_inactive', persistentSessionIdRef.current);
	        void stopRoastChunkStreamPlayer();
	        void stopRealtimeAsrTest();
	        void stopRealtimeRoastTurnRef.current();
	        void stopPersistentCallRef.current({
            reason: 'app_state_inactive',
            source: 'app_state',
            requestId: persistentSessionIdRef.current,
            expectedSessionId: persistentSessionIdRef.current,
            stackHint: 'AppState.change:not_active',
          });
	      }
	    });
	    return () => {
      screenMountedRef.current = false;
      const cleanupSessionId = effectSessionId;
      invalidateActiveCallRun('cleanup_invalidate_run', 'effect_cleanup', cleanupSessionId);
	      void recorderRef.current?.cleanup();
	      void stopRoastAudioQueue();
	      void stopRoastChunkStreamPlayer();
	      void stopRealtimeAsrTest();
	      void stopRealtimeRoastTurnRef.current();
	      void stopPersistentCallRef.current({
          reason: 'effect_cleanup',
          source: 'useEffect_cleanup',
          requestId: cleanupSessionId,
          expectedSessionId: cleanupSessionId,
          stackHint: 'recorder_effect_cleanup',
        });
	      unsubscribeChunkEvents();
	      appStateSubscription.remove();
	    };
  }, [recordingConfigId]);

  const timingRows = useMemo(
    () => [
      ['stop → ASR', delta(perf.t0StopRecording, perf.t1AsrDone)],
      ['stop → SFX requested', delta(perf.t0StopRecording, perf.tSfxRequested)],
      ['SFX requested → play call', delta(perf.tSfxRequested, perf.tSfxDone)],
      ['ASR → respond', delta(perf.t1AsrDone, perf.t2RespondDone)],
      ['respond → TTS request', delta(perf.t2RespondDone, perf.t3TtsRequest)],
      ['TTS request → audio ready', delta(perf.t3TtsRequest, perf.t4TtsReady)],
      ['audio ready → playback', delta(perf.t4TtsReady, perf.t5PlaybackStart)],
      ['total perceived', delta(perf.t0StopRecording, perf.t5PlaybackStart)],
    ],
    [perf],
  );

  async function startRecording() {
    if (state === 'recording') return;
    setError(null);
    clearAssistantReplyCard();
    setTranscript('');
    setPerf({});
    sfxMarksRef.current = {};
    setLastSfxStatus(null);
    setLastAsrStatus(null);
    const recorder = recorderRef.current ?? createSpeakingRecorder(recordingConfigId);
    recorderRef.current = recorder;
    const permission = await recorder.requestPermissions();
    if (!permission.granted) {
      setState('error');
      setError('Microphone permission is required for Roast Call.');
      return;
    }
    try {
      await stopRoastAudioQueue();
      await recorder.start();
      stopRequestedRef.current = false;
      setState('recording');
    } catch (caught) {
      setState('error');
      setError(caught instanceof Error ? caught.message : 'Recording failed to start.');
    }
  }

  async function runTextTurn(text: string, t0 = now(), seedPerf: PerfMarks = {}) {
    setState('thinking');
    const nextPerf: PerfMarks = { ...seedPerf, t0StopRecording: t0, t1AsrDone: seedPerf.t1AsrDone ?? t0 };
    setPerf(nextPerf);
    setTranscript(text);

    const respondStarted = now();
    const roast = await createRoastReply(text, 'la_bro_roast');
    const t2 = now();
    nextPerf.t2RespondDone = t2;
    setPerf({ ...nextPerf });
    showAssistantReplyCard(roast);
    void playRoastReactionSfx(roast.reaction).then((result) => {
      setLastSfxStatus(result.played ? `reaction: ${roast.reaction}` : result.reason ?? 'reaction skipped');
    });

    setState('speaking');
    const t3 = now();
    nextPerf.t3TtsRequest = t3;
    setPerf({ ...nextPerf });
    const streamResponse = ENABLE_ROAST_STREAM_PLAYBACK
      ? await fetchRoastTtsStream(roast.spokenText).catch(() => null)
      : null;
    if (streamResponse && ENABLE_ROAST_STREAM_PLAYBACK) {
      const streamResult = await playRoastTtsStreamIfSupported(streamResponse);
      if (streamResult.supported) {
        const t5 = now();
        setPerf({ ...nextPerf, t4TtsReady: t5, t5PlaybackStart: t5 });
        setState('waitingRepeat');
        return;
      }
    }
    const audio = await fetchRoastTtsAudio(roast.spokenText);
    const t4 = now();
    nextPerf.t4TtsReady = t4;
    setPerf({ ...nextPerf });
    await playRoastMp3Fallback(audio);
    const t5 = now();
    setPerf({ ...nextPerf, t5PlaybackStart: t5 });
    setState(roast.nextAction === 'repeat' ? 'waitingRepeat' : 'idle');
    console.log('[ROAST_CALL_PERF]', JSON.stringify({
      respondMs: Math.round(t2 - respondStarted),
      ttsMs: nextPerf.t4TtsReady && nextPerf.t3TtsRequest ? Math.round(nextPerf.t4TtsReady - nextPerf.t3TtsRequest) : null,
      audioReadyToPlayMs: nextPerf.t4TtsReady ? Math.round(t5 - nextPerf.t4TtsReady) : null,
      stopToAsrMs: nextPerf.t1AsrDone && nextPerf.t0StopRecording ? Math.round(nextPerf.t1AsrDone - nextPerf.t0StopRecording) : null,
      stopToSfxRequestMs: nextPerf.tSfxRequested && nextPerf.t0StopRecording ? Math.round(nextPerf.tSfxRequested - nextPerf.t0StopRecording) : null,
      sfxRequestToDoneMs: nextPerf.tSfxRequested && nextPerf.tSfxDone ? Math.round(nextPerf.tSfxDone - nextPerf.tSfxRequested) : null,
      totalPerceivedMs: Math.round(t5 - t0),
    }));
  }

  async function runTextTurnStream(text: string, t0 = now(), seedPerf: PerfMarks = {}) {
    await stopRoastChunkStreamPlayer();
    setState('thinking');
    const nextPerf: PerfMarks = { ...seedPerf, t0StopRecording: t0, t1AsrDone: seedPerf.t1AsrDone ?? t0 };
    setPerf(nextPerf);
    setTranscript(text);
    setChunkStreamState(null);
    setLatestChunkStreamEvent(null);
    setChunkStreamEventCount(0);
    setChunkStreamStatus('turn stream: responding...');

    const turnStarted = now();
    const turn = await createRoastTextTurnStream({ text, coachId: 'la_bro_roast' });
    const t2 = now();
    nextPerf.t2RespondDone = t2;
    setPerf({ ...nextPerf });
    showAssistantReplyCard(turn.reply);
    setChunkStreamStatus(`turn stream: reply ready · respond=${turn.metrics?.respondMs ?? Math.round(t2 - turnStarted)}ms`);
    console.log('[ROAST_TEXT_TURN_STREAM] reply', JSON.stringify({
      respondMs: turn.metrics?.respondMs ?? Math.round(t2 - turnStarted),
      totalMs: turn.metrics?.totalMs ?? null,
      spokenTextLength: turn.reply.spokenText.length,
      reaction: turn.reply.reaction,
    }));

    void playRoastReactionSfx(turn.reply.reaction).then((result) => {
      setLastSfxStatus(result.played ? `reaction: ${turn.reply.reaction}` : result.reason ?? 'reaction skipped');
    });

    setState('speaking');
    const t3 = now();
    nextPerf.t3TtsRequest = t3;
    setPerf({ ...nextPerf });
    const ipadTtsSessionOptions = await buildAndLogTurnTtsNativeOptions({
      source: 'turn_text_stream',
      turnId: `text_turn_${turnStarted}`,
      url: turn.streamUrl,
    });
    const result = await playRoastChunkStreamUrl(turn.streamUrl, t0, ipadTtsSessionOptions ?? undefined);
    const stateSnapshot = result.supported ? await getRoastChunkStreamState() : result.state ?? null;
    const t5 = now();
    setChunkStreamState(stateSnapshot ?? null);
    setPerf({
      ...nextPerf,
      t4TtsReady: typeof stateSnapshot?.firstNetworkChunkMs === 'number' ? t0 + stateSnapshot.firstNetworkChunkMs : t5,
      t5PlaybackStart: typeof stateSnapshot?.audioQueueStartedMs === 'number' ? t0 + stateSnapshot.audioQueueStartedMs : t5,
    });
    console.log('[ROAST_TEXT_TURN_STREAM] playback', JSON.stringify({
      supported: result.supported,
      reason: result.reason ?? null,
      error: result.error ?? null,
      firstNetworkChunkMs: stateSnapshot?.firstNetworkChunkMs ?? null,
      firstPacketParsedMs: stateSnapshot?.firstPacketParsedMs ?? null,
      audioQueueStartedMs: stateSnapshot?.audioQueueStartedMs ?? null,
      clickToResolvedMs: 'clickToResolvedMs' in result ? result.clickToResolvedMs : null,
      totalPerceivedMs: stateSnapshot?.audioQueueStartedMs ?? Math.round(t5 - t0),
    }));

    if (!result.supported) {
      setState('error');
      setError(result.reason ?? result.error ?? 'Turn stream playback failed.');
      setChunkStreamStatus(`turn stream failed · ${result.reason ?? result.error ?? 'unknown'}`);
      return;
    }

    setChunkStreamStatus(
      `turn stream playing · first=${stateSnapshot?.firstNetworkChunkMs ?? '--'}ms · packet=${stateSnapshot?.firstPacketParsedMs ?? '--'}ms · queue=${stateSnapshot?.audioQueueStartedMs ?? '--'}ms`,
    );
    setState(turn.reply.nextAction === 'repeat' ? 'waitingRepeat' : 'idle');
  }

  async function stopRecording() {
    if (state !== 'recording' || stopRequestedRef.current) return;
    stopRequestedRef.current = true;
    const t0 = now();
    setState('transcribing');
    setPerf({ t0StopRecording: t0 });
    const tSfxRequested = now();
    sfxMarksRef.current = { tSfxRequested };
    setPerf({ t0StopRecording: t0, tSfxRequested });
    void playRoastReactionSfx('bruh').then((result) => {
      sfxMarksRef.current = {
        tSfxRequested: sfxMarksRef.current.tSfxRequested ?? result.requestedAt,
        tSfxDone: result.completedAt,
      };
      setPerf((current) => ({
        ...current,
        tSfxRequested: current.tSfxRequested ?? result.requestedAt,
        tSfxDone: result.completedAt,
      }));
      setLastSfxStatus(result.played ? 'reaction: bruh' : result.reason ?? 'reaction skipped');
    });
    try {
      const recording = await recorderRef.current?.stop();
      if (!recording?.uri) {
        throw new Error('No recording file was produced.');
      }
      const transcription = await transcribeRoastAudio({
        audioUri: recording.uri,
        fileName: recording.fileName,
        mimeType: recording.mimeType,
        fastMode: false,
      });
      const t1 = now();
      setPerf((current) => ({ ...current, t1AsrDone: t1 }));
      const asrText = transcription.text || '';
      setLastAsrStatus(
        `${recording.configId ?? recordingConfigId} · mode=${transcription.mode ?? 'fast'} · size=${recording.size ?? transcription.fileSize ?? '--'} · duration=${recording.durationMs ?? '--'}ms · asr=${transcription.durationMs ?? Math.round(t1 - t0)}ms · text="${asrText}"`,
      );
      console.log('[ROAST_ASR_RESULT]', JSON.stringify({
        configId: recording.configId ?? recordingConfigId,
        fileSize: recording.size ?? transcription.fileSize ?? null,
        durationMs: recording.durationMs ?? null,
        mimeType: recording.mimeType,
        fileName: recording.fileName,
        asrDurationMs: transcription.durationMs ?? Math.round(t1 - t0),
        service: transcription.service ?? null,
        mode: transcription.mode ?? null,
        formDataParsedMs: transcription.formDataParsedMs ?? null,
        gatewayRequestSentMs: transcription.gatewayRequestSentMs ?? null,
        gatewayResponseMs: transcription.gatewayResponseMs ?? null,
        responseTextReadMs: transcription.responseTextReadMs ?? null,
        text: asrText,
        textLength: transcription.textLength ?? asrText.length,
      }));
      const asrQualityIssue = getAsrQualityIssue(asrText);
      if (__DEV__ && asrQualityIssue) {
        setState('error');
        setError(asrQualityIssue);
        return;
      }
      await runTextTurnStream(transcription.text || FIXED_TEST_TEXT, t0, {
        t0StopRecording: t0,
        ...sfxMarksRef.current,
        t1AsrDone: t1,
      });
    } catch (caught) {
      setState('error');
      setError(caught instanceof Error ? caught.message : 'Roast Call failed.');
    } finally {
      stopRequestedRef.current = false;
    }
  }

  async function testFullTurn() {
    if (state === 'recording') return;
    setError(null);
    clearAssistantReplyCard();
    const t0 = now();
    const tSfxRequested = now();
    sfxMarksRef.current = { tSfxRequested };
    setPerf({ t0StopRecording: t0, tSfxRequested });
    void playRoastReactionSfx('bruh').then((result) => {
      sfxMarksRef.current = {
        tSfxRequested: sfxMarksRef.current.tSfxRequested ?? result.requestedAt,
        tSfxDone: result.completedAt,
      };
      setPerf((current) => ({
        ...current,
        tSfxRequested: current.tSfxRequested ?? result.requestedAt,
        tSfxDone: result.completedAt,
      }));
      setLastSfxStatus(result.played ? 'reaction: bruh' : result.reason ?? 'fixed text test');
    });
    try {
      await runTextTurn(FIXED_TEST_TEXT, t0, {
        t0StopRecording: t0,
        ...sfxMarksRef.current,
      });
    } catch (caught) {
      setState('error');
      setError(caught instanceof Error ? caught.message : 'Test turn failed.');
    }
  }

  async function testTextTurnStream() {
    if (state === 'recording' || streamTestInFlight) return;
    setError(null);
    clearAssistantReplyCard();
    setStreamTestInFlight(true);
    const t0 = now();
    const tSfxRequested = now();
    sfxMarksRef.current = { tSfxRequested };
    setPerf({ t0StopRecording: t0, tSfxRequested });
    void playRoastReactionSfx('bruh').then((result) => {
      sfxMarksRef.current = {
        tSfxRequested: sfxMarksRef.current.tSfxRequested ?? result.requestedAt,
        tSfxDone: result.completedAt,
      };
      setPerf((current) => ({
        ...current,
        tSfxRequested: current.tSfxRequested ?? result.requestedAt,
        tSfxDone: result.completedAt,
      }));
      setLastSfxStatus(result.played ? 'reaction: bruh' : result.reason ?? 'text turn stream test');
    });
    try {
      console.log('[ROAST_TEXT_TURN_STREAM] click', JSON.stringify({ textLength: FIXED_TEST_TEXT.length }));
      await runTextTurnStream(FIXED_TEST_TEXT, t0, {
        t0StopRecording: t0,
        ...sfxMarksRef.current,
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Text turn stream failed.';
      setState('error');
      setError(message);
      setChunkStreamStatus(`turn stream failed · ${message}`);
    } finally {
      setStreamTestInFlight(false);
    }
  }

  async function testTurnStreamV2() {
    if (state === 'recording' || streamTestInFlight) return;
    const text = 'I want to practice my English.';
    const t0 = now();
    let playbackPromise: Promise<void> | null = null;
    let ttsStreamReadyMs: number | null = null;
    setError(null);
    clearAssistantReplyCard();
    setTranscript(text);
    setState('thinking');
    setStreamTestInFlight(true);
    setChunkStreamState(null);
    setLatestChunkStreamEvent(null);
    setChunkStreamEventCount(0);
    setChunkStreamStatus('turn-stream-v2: waiting for spokenText...');
    try {
      await stopRoastChunkStreamPlayer();
      console.log('[ROAST_TURN_STREAM_V2] click', JSON.stringify({ textLength: text.length }));
      const result = await createRoastTurnStreamV2(
        {
          text,
          coachId: 'la_bro_roast',
          history: buildRoastConversationHistory(),
        },
        async (event) => {
          const elapsedMs = Math.round(now() - t0);
          console.log('[ROAST_TURN_STREAM_V2]', JSON.stringify({
            eventType: event.type,
            elapsedMs,
            spokenTextLength: event.type === 'spoken_text_ready' ? event.spokenText.length : event.type === 'reply_ready' ? event.reply.spokenText.length : null,
            streamUrlReady: event.type === 'tts_stream_ready',
            provider: 'provider' in event ? event.provider ?? null : null,
            model: 'model' in event ? event.model ?? null : null,
            error: event.type === 'error' ? event.error : null,
          }));

          if (event.type === 'llm_started') {
            setChunkStreamStatus(`turn-stream-v2: llm started · ${event.provider ?? '--'}`);
          } else if (event.type === 'spoken_text_ready') {
            setChunkStreamStatus(`turn-stream-v2: spokenText ready · ${event.spokenTextReadyMs ?? elapsedMs}ms`);
          } else if (event.type === 'tts_stream_ready') {
            ttsStreamReadyMs = elapsedMs;
            setState('speaking');
            setChunkStreamStatus(`turn-stream-v2: TTS stream ready · ${event.ttsStreamReadyMs ?? elapsedMs}ms`);
            const v2Options = await buildAndLogTurnTtsNativeOptions({
              source: 'turn_stream_v2',
              turnId: `turn_stream_v2_${t0}`,
              url: event.streamUrl,
            });
            playbackPromise = playRoastChunkStreamUrl(event.streamUrl, t0, v2Options ?? undefined)
              .then(async (playbackResult) => {
                const stateSnapshot = playbackResult.supported ? await getRoastChunkStreamState() : playbackResult.state ?? null;
                setChunkStreamState(stateSnapshot ?? null);
                setChunkStreamStatus(
                  playbackResult.supported
                    ? `turn-stream-v2 playing · stream=${ttsStreamReadyMs ?? '--'}ms · queue=${stateSnapshot?.audioQueueStartedMs ?? '--'}ms`
                    : `turn-stream-v2 playback failed · ${playbackResult.reason ?? playbackResult.error ?? 'unknown'}`,
                );
              })
              .catch((caught) => {
                const message = caught instanceof Error ? caught.message : 'Turn stream v2 playback failed.';
                setChunkStreamStatus(`turn-stream-v2 playback failed · ${message}`);
                setError(message);
              });
          } else if (event.type === 'reply_ready') {
            showAssistantReplyCard(event.reply);
            setChunkStreamStatus(
              `turn-stream-v2: card ready · spoken=${event.metrics?.spokenTextReadyMs ?? '--'}ms · full=${event.metrics?.fullJsonReadyMs ?? '--'}ms`,
            );
          } else if (event.type === 'error') {
            setChunkStreamStatus(`turn-stream-v2 error · ${event.error}`);
          }
        },
      );

      if (playbackPromise) {
        await playbackPromise;
      }
      console.log('[ROAST_TURN_STREAM_V2] done', JSON.stringify({
        eventCount: result.events.length,
        hasReply: Boolean(result.reply),
        hasStreamUrl: Boolean(result.streamUrl),
        spokenTextReadyMs: result.metrics?.spokenTextReadyMs ?? null,
        fullJsonReadyMs: result.metrics?.fullJsonReadyMs ?? null,
        ttsStreamReadyMs,
        totalMs: Math.round(now() - t0),
      }));
      setState('waitingRepeat');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Turn stream v2 failed.';
      setState('error');
      setError(message);
      setChunkStreamStatus(`turn-stream-v2 failed · ${message}`);
    } finally {
      setStreamTestInFlight(false);
    }
  }

  async function testTurnStreamV3() {
    if (state === 'recording' || streamTestInFlight) return;
    const text = 'I want to practice my English.';
    const t0 = now();
    let playbackPromise: Promise<void> | null = null;
    let ttsStreamReadyMs: number | null = null;
    setError(null);
    clearAssistantReplyCard();
    setTranscript(text);
    setState('thinking');
    setStreamTestInFlight(true);
    setChunkStreamState(null);
    setLatestChunkStreamEvent(null);
    setChunkStreamEventCount(0);
    setChunkStreamStatus('turn-stream-v3: waiting for spokenText...');
    try {
      await stopRoastChunkStreamPlayer();
      console.log('[ROAST_TURN_STREAM_V3] click', JSON.stringify({ textLength: text.length }));
      const result = await createRoastTurnStreamV3(
        {
          text,
          coachId: 'la_bro_roast',
          history: buildRoastConversationHistory(),
        },
        async (event) => {
          const elapsedMs = Math.round(now() - t0);
          console.log('[ROAST_TURN_STREAM_V3]', JSON.stringify({
            eventType: event.type,
            elapsedMs,
            serverElapsedMs: event.serverElapsedMs ?? null,
            clientElapsedMs: event.clientElapsedMs ?? null,
            clientMinusServerMs: event.clientMinusServerMs ?? null,
            spokenTextLength: event.type === 'spoken_text_ready' ? event.spokenText.length : event.type === 'reply_ready' ? event.reply.spokenText.length : null,
            streamUrlReady: event.type === 'tts_stream_ready',
            provider: 'provider' in event ? event.provider ?? null : null,
            model: 'model' in event ? event.model ?? null : null,
            error: event.type === 'error' ? event.error : null,
          }));

          if (event.type === 'llm_started') {
            setChunkStreamStatus(`turn-stream-v3: llm started · ${event.provider ?? '--'}`);
          } else if (event.type === 'spoken_text_ready') {
            setChunkStreamStatus(`turn-stream-v3: spokenText ready · client=${event.clientElapsedMs ?? elapsedMs}ms · delta=${event.clientMinusServerMs ?? '--'}ms`);
          } else if (event.type === 'tts_stream_ready') {
            ttsStreamReadyMs = elapsedMs;
            setState('speaking');
            setChunkStreamStatus(`turn-stream-v3: TTS stream ready · client=${event.clientElapsedMs ?? elapsedMs}ms · delta=${event.clientMinusServerMs ?? '--'}ms`);
            const v3Options = await buildAndLogTurnTtsNativeOptions({
              source: 'turn_stream_v3',
              turnId: `turn_stream_v3_${t0}`,
              url: event.streamUrl,
            });
            playbackPromise = playRoastChunkStreamUrl(event.streamUrl, t0, v3Options ?? undefined)
              .then(async (playbackResult) => {
                const stateSnapshot = playbackResult.supported ? await getRoastChunkStreamState() : playbackResult.state ?? null;
                setChunkStreamState(stateSnapshot ?? null);
                setChunkStreamStatus(
                  playbackResult.supported
                    ? `turn-stream-v3 playing · stream=${ttsStreamReadyMs ?? '--'}ms · queue=${stateSnapshot?.audioQueueStartedMs ?? '--'}ms`
                    : `turn-stream-v3 playback failed · ${playbackResult.reason ?? playbackResult.error ?? 'unknown'}`,
                );
              })
              .catch((caught) => {
                const message = caught instanceof Error ? caught.message : 'Turn stream v3 playback failed.';
                setChunkStreamStatus(`turn-stream-v3 playback failed · ${message}`);
                setError(message);
              });
          } else if (event.type === 'reply_ready') {
            showAssistantReplyCard(event.reply);
            setChunkStreamStatus(
              `turn-stream-v3: card ready · delta=${event.clientMinusServerMs ?? '--'}ms · full=${event.metrics?.fullJsonReadyMs ?? '--'}ms`,
            );
          } else if (event.type === 'error') {
            setChunkStreamStatus(`turn-stream-v3 error · ${event.error}`);
          }
        },
      );

      if (playbackPromise) {
        await playbackPromise;
      }
      console.log('[ROAST_TURN_STREAM_V3] done', JSON.stringify({
        eventCount: result.events.length,
        hasReply: Boolean(result.reply),
        hasStreamUrl: Boolean(result.streamUrl),
        spokenTextReadyMs: result.metrics?.spokenTextReadyMs ?? null,
        fullJsonReadyMs: result.metrics?.fullJsonReadyMs ?? null,
        ttsStreamReadyMs,
        totalMs: Math.round(now() - t0),
      }));
      setState('waitingRepeat');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Turn stream v3 failed.';
      setState('error');
      setError(message);
      setChunkStreamStatus(`turn-stream-v3 failed · ${message}`);
    } finally {
      setStreamTestInFlight(false);
    }
  }

  async function testStreamVoice() {
    if (state === 'recording' || streamTestInFlight) return;
    const t0 = now();
    setError(null);
    setStreamTestInFlight(true);
    setStreamTestStatus('loading GET stream...');
    try {
      const url = buildRoastTtsStreamTestUrl();
      console.log('[ROAST_STREAM_TEST] click', JSON.stringify({ textLength: ROAST_STREAM_TEST_TEXT.length }));
      const result = isRoastNativeStreamPlayerAvailable()
        ? await playRoastNativeStreamUrl(url, t0)
        : await playRoastRemoteStreamUrl(url, t0);
      console.log('[ROAST_STREAM_TEST] result', JSON.stringify({
        supported: result.supported,
        reason: result.reason ?? null,
        error: result.error ?? null,
        clickToPlayEventMs: 't3FirstPlaybackEvent' in result && result.t3FirstPlaybackEvent ? Math.round(result.t3FirstPlaybackEvent - t0) : null,
        nativePlayingMs: 'clickToNativePlayingMs' in result ? result.clickToNativePlayingMs : null,
        playerReadyMs: 'playerReadyMs' in result ? result.playerReadyMs ?? null : null,
      }));
      setStreamTestStatus(
        result.supported
          ? `stream playing · ${'clickToNativePlayingMs' in result && typeof result.clickToNativePlayingMs === 'number'
            ? result.clickToNativePlayingMs
            : 'firstPlaybackEventMs' in result
              ? result.firstPlaybackEventMs ?? '--'
              : '--'}ms`
          : `stream failed · ${result.reason ?? result.error ?? 'unknown'}`,
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Stream voice test failed.';
      setStreamTestStatus(`stream failed · ${message}`);
      setError(message);
    } finally {
      setStreamTestInFlight(false);
    }
  }

  async function testChunkStreamVoice() {
    if (state === 'recording' || streamTestInFlight) return;
    const t0 = now();
    setError(null);
    setStreamTestInFlight(true);
    setChunkStreamState(null);
    setLatestChunkStreamEvent(null);
    setChunkStreamEventCount(0);
    setChunkStreamStatus('chunk stream loading...');
    try {
      const url = buildRoastTtsStreamTestUrl();
      console.log('[ROAST_CHUNK_STREAM_TEST] click', JSON.stringify({ textLength: ROAST_STREAM_TEST_TEXT.length }));
      const result = await playRoastChunkStreamUrl(url, t0);
      const currentState = result.supported ? await getRoastChunkStreamState() : null;
      console.log('[ROAST_CHUNK_STREAM_TEST] result', JSON.stringify({
        supported: result.supported,
        reason: result.reason ?? null,
        error: result.error ?? null,
        clickToResolvedMs: 'clickToResolvedMs' in result ? result.clickToResolvedMs : null,
        state: result.state ?? currentState ?? null,
      }));
      if (result.supported) {
        const stateSnapshot = currentState ?? result.state;
        setChunkStreamState(stateSnapshot ?? null);
        setChunkStreamStatus(
          `chunk playing · first=${stateSnapshot?.firstNetworkChunkMs ?? '--'}ms · packet=${stateSnapshot?.firstPacketParsedMs ?? '--'}ms · queue=${stateSnapshot?.audioQueueStartedMs ?? '--'}ms`,
        );
      } else {
        setChunkStreamStatus(`chunk failed · ${result.reason ?? result.error ?? 'unknown'}`);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Chunk stream test failed.';
      setChunkStreamStatus(`chunk failed · ${message}`);
      setError(message);
    } finally {
      setStreamTestInFlight(false);
    }
  }

  function buildRoastTtsStreamTestLouderUrl(text = 'hello') {
    return buildRoastTtsStreamTestUrl(text).replace('/api/mobile/roast/tts-stream-test?', '/api/mobile/roast/tts-stream-test-louder?');
  }

  function safeRoastTestUrlPath(url: string) {
    try {
      const parsed = new URL(url);
      return parsed.pathname;
    } catch {
      return url.split('?')[0] || 'unknown';
    }
  }

  function logRoastPlaybackContext(input: {
    source: 'greeting' | 'turn_stream_ws_v4' | 'turn_stream_v3' | 'ab_normal' | 'ab_louder' | 'turn_text_stream';
    url: string;
    appReceivedToAudioRequestMs?: number | null;
    ttsStreamReadyToAudioRequestMs?: number | null;
  }) {
    console.log('[ROAST_PLAYBACK_CONTEXT]', JSON.stringify({
      source: input.source,
      callState: persistentCallStateRef.current,
      turnState: persistentTurnStateRef.current,
      hasActiveSessionId: Boolean(persistentSessionIdRef.current),
      activeTurnId: realtimeRoastTurnActiveRequestIdRef.current,
      activeNativeRequestId: realtimeRoastTurnNativeStreamRequestIdRef.current,
      isMicMuted: persistentAsrRef.current?.client?.isMicMuted ?? null,
      localAudioTrackEnabled: persistentAsrRef.current?.client?.localAudioTrackEnabled ?? null,
      wsReady: persistentTurnWsRef.current?.isReady?.() ?? false,
      appReceivedToAudioRequestMs: input.appReceivedToAudioRequestMs ?? null,
      ttsStreamReadyToAudioRequestMs: input.ttsStreamReadyToAudioRequestMs ?? null,
      urlPath: safeRoastTestUrlPath(input.url),
    }));
  }

  function logWebRtcAudioDetachExperiment(input: {
    phase: 'before_detach' | 'detach_done' | 'detach_failed' | 'restore_start' | 'restore_done' | 'restore_failed';
    source: 'turn_stream_ws_v4';
    hasPeerConnection?: boolean | null;
    hasAudioSender?: boolean | null;
    hadLocalAudioTrack?: boolean | null;
    localTrackEnabledBefore?: boolean | null;
    localTrackEnabledAfter?: boolean | null;
    errorMessage?: string | null;
  }) {
    console.log('[ROAST_WEBRTC_AUDIO_DETACH_EXPERIMENT]', JSON.stringify({
      phase: input.phase,
      source: input.source,
      isTablet: Platform.OS === 'ios' && windowWidth >= 768,
      callState: persistentCallStateRef.current,
      turnState: persistentTurnStateRef.current,
      hasPeerConnection: input.hasPeerConnection ?? null,
      hasAudioSender: input.hasAudioSender ?? null,
      hadLocalAudioTrack: input.hadLocalAudioTrack ?? null,
      localTrackEnabledBefore: input.localTrackEnabledBefore ?? null,
      localTrackEnabledAfter: input.localTrackEnabledAfter ?? null,
      errorMessage: input.errorMessage ?? null,
    }));
  }

  async function maybeDetachWebRtcAudioForTtsExperiment(source: 'turn_stream_ws_v4' | 'turn_stream_v3' | 'turn_text_stream') {
    if (
      !__DEV__
      || !isRoastIpadDetachAudioSenderExperimentEnabled()
      || Platform.OS !== 'ios'
      || windowWidth < 768
      || source !== 'turn_stream_ws_v4'
    ) {
      return null;
    }

    const client = persistentAsrRef.current?.client;
    logWebRtcAudioDetachExperiment({ phase: 'before_detach', source: 'turn_stream_ws_v4' });
    if (!client?.detachAudioSenderForTtsExperiment) {
      logWebRtcAudioDetachExperiment({
        phase: 'detach_failed',
        source: 'turn_stream_ws_v4',
        errorMessage: 'detach_method_unavailable',
      });
      return null;
    }

    try {
      const handle = await client.detachAudioSenderForTtsExperiment();
      logWebRtcAudioDetachExperiment({
        phase: 'detach_done',
        source: 'turn_stream_ws_v4',
        ...handle.status,
      });
      return handle;
    } catch (caught) {
      logWebRtcAudioDetachExperiment({
        phase: 'detach_failed',
        source: 'turn_stream_ws_v4',
        errorMessage: caught instanceof Error ? caught.message : 'detach_failed',
      });
      return null;
    }
  }

  async function restoreWebRtcAudioAfterTtsExperiment(handle: Awaited<ReturnType<typeof maybeDetachWebRtcAudioForTtsExperiment>>) {
    if (!handle) return;
    logWebRtcAudioDetachExperiment({ phase: 'restore_start', source: 'turn_stream_ws_v4' });
    try {
      const status = await handle.restore();
      logWebRtcAudioDetachExperiment({
        phase: 'restore_done',
        source: 'turn_stream_ws_v4',
        ...status,
      });
    } catch (caught) {
      logWebRtcAudioDetachExperiment({
        phase: 'restore_failed',
        source: 'turn_stream_ws_v4',
        errorMessage: caught instanceof Error ? caught.message : 'restore_failed',
      });
    }
  }

  type RoastTurnTtsSource =
    | 'greeting'
    | 'turn_stream_ws_v4'
    | 'turn_stream_v3'
    | 'turn_stream_v2'
    | 'turn_text_stream';

  async function maybeApplyIpadTtsSessionExperiment(input: {
    source: RoastTurnTtsSource;
    requestId: string;
  }) {
    const isIpadLayout = windowWidth >= 768;
    if (
      !isRoastIpadTtsTempPlaybackSessionExperimentEnabled()
      || Platform.OS !== 'ios'
      || (!isIpadLayout && (!__DEV__ || input.source !== 'greeting'))
    ) {
      return;
    }

    const context = {
      requestId: input.source === 'greeting'
        ? greetingNativeRequestIdRef.current
        : realtimeRoastTurnNativeStreamRequestIdRef.current,
      turnId: input.requestId,
      isMicMuted: persistentAsrRef.current?.client?.isMicMuted ?? null,
      localAudioTrackEnabled: persistentAsrRef.current?.client?.localAudioTrackEnabled ?? null,
    };
    const playbackSettleDelayMs = input.source === 'greeting'
      ? 200
      : isRoastIpadTtsFastTurnSettleExperimentEnabled()
        ? 50
        : 100;
    return {
      forceAudioSessionModeDefault: true,
      playbackSettleDelayMs,
      ...context,
    };
  }

  async function buildAndLogTurnTtsNativeOptions(input: {
    source: RoastTurnTtsSource;
    turnId: string;
    url: string;
  }) {
    const options = await maybeApplyIpadTtsSessionExperiment({
      source: input.source,
      requestId: input.turnId,
    });
    console.log('[ROAST_TTS_NATIVE_OPTIONS]', JSON.stringify({
      source: input.source,
      turnId: input.turnId,
      forceAudioSessionModeDefault: options?.forceAudioSessionModeDefault === true,
      playbackSettleDelayMs: options?.playbackSettleDelayMs ?? null,
      isFastTurnSettleExperimentEnabled: isRoastIpadTtsFastTurnSettleExperimentEnabled(),
      isIpadTtsExperimentEnabled: isRoastIpadTtsTempPlaybackSessionExperimentEnabled(),
      isIpadTtsPlaybackFixEnabled: ROAST_IPAD_TTS_PLAYBACK_FIX_ENABLED,
      ipadTtsPlaybackFixEnvName: ROAST_IPAD_TTS_PLAYBACK_FIX_ENV_NAME,
      isTablet: Platform.OS === 'ios' && windowWidth >= 768,
      isMicMuted: persistentAsrRef.current?.client?.isMicMuted ?? null,
      localAudioTrackEnabled: persistentAsrRef.current?.client?.localAudioTrackEnabled ?? null,
      urlPath: safeRoastTestUrlPath(input.url),
    }));
    return options;
  }

  async function warmupRoastTtsProvider(input: {
    reason: 'ws_ready' | 'call_connected' | 'after_greeting';
    sessionId: string;
    localRunId: string;
  }) {
    if (!__DEV__ || roastTtsWarmupStartedRef.current) return;
    roastTtsWarmupStartedRef.current = true;
    const startedAt = now();
    const endpoint = '/api/mobile/roast/tts-stream-test';
    const url = buildRoastTtsStreamTestUrl('Hi.');
    console.log('[ROAST_TTS_WARMUP]', JSON.stringify({
      phase: 'start',
      reason: input.reason,
      elapsedMs: 0,
      status: 'started',
      provider: 'elevenlabs',
      endpoint,
      sessionId: input.sessionId,
    }));
    try {
      if (!isActiveCallRun(input.localRunId, input.sessionId)) {
        throw new Error('stale_warmup');
      }
      const response = await fetch(url, { cache: 'no-store' });
      const reader = response.body?.getReader?.();
      let totalBytes = 0;
      if (reader) {
        const firstChunk = await reader.read();
        if (!firstChunk.done) {
          totalBytes += firstChunk.value.byteLength;
          console.log('[ROAST_TTS_WARMUP]', JSON.stringify({
            phase: 'first_chunk',
            reason: input.reason,
            elapsedMs: Math.round(now() - startedAt),
            status: response.status,
            provider: 'elevenlabs',
            endpoint,
            bytes: firstChunk.value.byteLength,
          }));
        }
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          totalBytes += chunk.value.byteLength;
        }
      } else {
        const bytes = await response.arrayBuffer();
        totalBytes = bytes.byteLength;
        console.log('[ROAST_TTS_WARMUP]', JSON.stringify({
          phase: 'first_chunk',
          reason: input.reason,
          elapsedMs: Math.round(now() - startedAt),
          status: response.status,
          provider: 'elevenlabs',
          endpoint,
          bytes: totalBytes,
          fallback: 'arrayBuffer',
        }));
      }
      console.log('[ROAST_TTS_WARMUP]', JSON.stringify({
        phase: 'done',
        reason: input.reason,
        elapsedMs: Math.round(now() - startedAt),
        status: response.status,
        provider: 'elevenlabs',
        endpoint,
        totalBytes,
      }));
    } catch (caught) {
      console.warn('[ROAST_TTS_WARMUP]', JSON.stringify({
        phase: 'failed',
        reason: input.reason,
        elapsedMs: Math.round(now() - startedAt),
        status: 'failed',
        provider: 'elevenlabs',
        endpoint,
        message: caught instanceof Error ? caught.message : String(caught),
      }));
    }
  }

  async function testRoastTtsAbPlayback(kind: 'normal' | 'louder') {
    if (state === 'recording' || streamTestInFlight) return;
    const t0 = now();
    const url = kind === 'normal'
      ? buildRoastTtsStreamTestUrl('hello')
      : buildRoastTtsStreamTestLouderUrl('hello');
    const urlPath = safeRoastTestUrlPath(url);
    setError(null);
    setStreamTestInFlight(true);
    setChunkStreamState(null);
    setLatestChunkStreamEvent(null);
    setChunkStreamEventCount(0);
    setChunkStreamStatus(`${kind} TTS loading...`);
    try {
      await stopRoastChunkStreamPlayer();
      logRoastPlaybackContext({
        source: kind === 'normal' ? 'ab_normal' : 'ab_louder',
        url,
      });
      const result = await playRoastChunkStreamUrl(url, t0);
      const currentState = result.supported ? await getRoastChunkStreamState() : null;
      const nativeRequestId = currentState?.requestId ?? result.state?.requestId ?? null;
      console.log('[ROAST_TTS_AB_TEST]', JSON.stringify({
        eventType: kind === 'normal' ? 'normal_start' : 'louder_start',
        nativeRequestId,
        urlPath,
      }));
      if (result.supported) {
        const stateSnapshot = currentState ?? result.state;
        setChunkStreamState(stateSnapshot ?? null);
        setChunkStreamStatus(
          `${kind} TTS playing · first=${stateSnapshot?.firstNetworkChunkMs ?? '--'}ms · queue=${stateSnapshot?.audioQueueStartedMs ?? '--'}ms`,
        );
      } else {
        setChunkStreamStatus(`${kind} TTS failed · ${result.reason ?? result.error ?? 'unknown'}`);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : `${kind} TTS test failed.`;
      setChunkStreamStatus(`${kind} TTS failed · ${message}`);
      setError(message);
    } finally {
      setStreamTestInFlight(false);
    }
  }

  async function stopChunkStreamTest() {
    const stoppedState = await stopRoastChunkStreamPlayer();
    setChunkStreamState(stoppedState ?? null);
    setChunkStreamStatus('chunk stopped');
  }

  function isRealtimeAsrRunning(status: RealtimeAsrLabState['status']) {
    return status === 'connecting' || status === 'listening' || status === 'waitingFinal';
  }

  function handleRealtimeAsrEvent(event: RoastRealtimeAsrEvent) {
    const activeRequestId = realtimeAsrActiveRequestIdRef.current;
    if (!activeRequestId || event.requestId !== activeRequestId) {
      console.log('[ROAST_REALTIME_ASR]', JSON.stringify({
        requestId: event.requestId,
        state: 'ignored_stale',
        eventType: event.type,
        elapsedMs: null,
      }));
      return;
    }

    const startedAt = realtimeAsrStartedAtRef.current ?? now();
    const elapsedMs = Math.max(0, Math.round(now() - startedAt));
    console.log('[ROAST_REALTIME_ASR]', JSON.stringify({
      requestId: event.requestId,
      state: realtimeAsrStatusRef.current,
      eventType: event.type,
      elapsedMs,
      asrMode: realtimeAsrMode,
      textLength:
        event.type === 'user_transcript_delta' || event.type === 'user_transcript_final' || event.type === 'user_transcript_done'
          ? event.text.length
          : null,
    }));

    setRealtimeAsr((current) => {
      const next: RealtimeAsrLabState = {
        ...current,
        eventCount: current.eventCount + 1,
      };

      switch (event.type) {
        case 'connected':
          next.status = 'listening';
          next.sessionConnectedMs = next.sessionConnectedMs ?? elapsedMs;
          break;
        case 'session_updated':
          next.sessionUpdatedMs = next.sessionUpdatedMs ?? elapsedMs;
          break;
        case 'user_speech_started':
          next.status = 'listening';
          next.speechStartedMs = next.speechStartedMs ?? elapsedMs;
          break;
        case 'user_speech_stopped':
          next.status = 'waitingFinal';
          next.speechStoppedMs = next.speechStoppedMs ?? elapsedMs;
          break;
        case 'user_transcript_delta':
          next.firstPartialMs = next.firstPartialMs ?? elapsedMs;
          if (typeof next.speechStoppedMs === 'number' && typeof next.stoppedToFirstDeltaMs !== 'number') {
            next.stoppedToFirstDeltaMs = Math.max(0, elapsedMs - next.speechStoppedMs);
          }
          next.partialText = `${next.partialText}${event.text}`;
          break;
        case 'user_transcript_final':
        case 'user_transcript_done':
          next.status = 'completed';
          next.finalMs = next.finalMs ?? elapsedMs;
          if (typeof next.speechStoppedMs === 'number' && typeof next.stoppedToFinalMs !== 'number') {
            next.stoppedToFinalMs = Math.max(0, elapsedMs - next.speechStoppedMs);
          }
          next.finalText = event.text;
          console.log('[ROAST_REALTIME_ASR_SUMMARY]', JSON.stringify({
            requestId: event.requestId,
            asrMode: next.asrMode,
            finalText: next.finalText,
            partialText: next.partialText,
            textLength: next.finalText.length,
            speechStartedMs: next.speechStartedMs ?? null,
            speechStoppedMs: next.speechStoppedMs ?? null,
            firstPartialMs: next.firstPartialMs ?? null,
            finalMs: next.finalMs ?? null,
            stoppedToFirstDeltaMs: next.stoppedToFirstDeltaMs ?? null,
            stoppedToFinalMs: next.stoppedToFinalMs ?? null,
            remoteTrackPresent: next.remoteTrackPresent,
            unexpectedVoice: next.unexpectedVoice,
            error: next.error,
          }));
          break;
        case 'remote_audio_track_received':
          next.remoteTrackPresent = true;
          break;
        case 'assistant_audio_started':
        case 'ai_response_created':
        case 'ai_response_delta':
        case 'ai_response_transcript_done':
        case 'ai_response_done':
          next.unexpectedVoice = true;
          break;
        case 'error':
          next.status = 'error';
          next.error = event.message;
          break;
        case 'disconnected':
          next.status = next.status === 'completed' || next.status === 'error' ? next.status : 'stopped';
          break;
        default:
          break;
      }

      realtimeAsrStatusRef.current = next.status;
      return next;
    });

    if (event.type === 'user_transcript_done' || event.type === 'user_transcript_final') {
      void stopRealtimeAsrTest({ preserveCompleted: true, requestId: event.requestId });
    }
  }

  async function testRealtimeAsr() {
    if (state === 'recording' || streamTestInFlight) return;
    if (isRealtimeAsrRunning(realtimeAsr.status)) {
      const message = 'Realtime ASR session is already running. Wait for completed or press Stop.';
      console.log('[ROAST_REALTIME_ASR]', JSON.stringify({
        requestId: realtimeAsr.requestId,
        state: realtimeAsr.status,
        eventType: 'duplicate_start_blocked',
        elapsedMs: null,
        asrMode: realtimeAsr.asrMode,
      }));
      setRealtimeAsr((current) => ({ ...current, error: message }));
      return;
    }
    if (!appSession.session) {
      setRealtimeAsr((current) => ({
        ...current,
        status: 'error',
        error: 'Sign in before testing Realtime ASR.',
      }));
      return;
    }

    await stopRealtimeAsrTest({ preserveCompleted: true });
    const requestId = createRealtimeAsrRequestId();
    realtimeAsrActiveRequestIdRef.current = requestId;
    realtimeAsrStartedAtRef.current = now();
    realtimeAsrStatusRef.current = 'connecting';
    setRealtimeAsr({
      status: 'connecting',
      requestId,
      asrMode: realtimeAsrMode,
      partialText: '',
      finalText: '',
      eventCount: 0,
      remoteTrackPresent: false,
      unexpectedVoice: false,
      error: null,
    });
    console.log('[ROAST_REALTIME_ASR]', JSON.stringify({
      requestId,
      state: 'connecting',
      eventType: 'test_start',
      elapsedMs: 0,
      asrMode: realtimeAsrMode,
    }));

    try {
      const controller = await startRoastRealtimeAsr({
        requestId,
        mode: realtimeAsrMode,
        session: appSession.session,
        onEvent: handleRealtimeAsrEvent,
      });
      if (realtimeAsrActiveRequestIdRef.current !== requestId) {
        await controller.stop().catch(() => undefined);
        return;
      }
      realtimeAsrRef.current = controller;
      setRealtimeAsr((current) => ({
        ...current,
        status: (() => {
          const status = current.status === 'connecting' ? 'listening' : current.status;
          realtimeAsrStatusRef.current = status;
          return status;
        })(),
        tokenMs: controller.tokenMs,
        connectMs: controller.connectMs,
      }));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Realtime ASR failed to start.';
      if (realtimeAsrActiveRequestIdRef.current !== requestId) return;
      realtimeAsrStatusRef.current = 'error';
      setRealtimeAsr((current) => ({
        ...current,
        status: 'error',
        error: message,
      }));
      setError(message);
    }
  }

  async function stopRealtimeAsrTest(options: { preserveCompleted?: boolean; requestId?: string } = {}) {
    const controller = realtimeAsrRef.current;
    if (options.requestId && controller?.requestId && controller.requestId !== options.requestId) {
      return;
    }
    const requestId = controller?.requestId ?? realtimeAsrActiveRequestIdRef.current;
    realtimeAsrRef.current = null;
    realtimeAsrActiveRequestIdRef.current = null;
    if (controller) {
      await controller.stop().catch(() => undefined);
    }
    realtimeAsrStartedAtRef.current = null;
    console.log('[ROAST_REALTIME_ASR]', JSON.stringify({
      requestId,
      state: options.preserveCompleted ? 'completed' : 'stopped',
      eventType: 'stop',
      elapsedMs: null,
      asrMode: realtimeAsrMode,
    }));
    setRealtimeAsr((current) => ({
      ...current,
      status: (() => {
        const status =
          options.preserveCompleted && current.status === 'completed'
            ? 'completed'
            : current.status === 'idle'
              ? 'idle'
              : current.status === 'error'
                ? 'error'
                : 'stopped';
        realtimeAsrStatusRef.current = status;
        return status;
      })(),
    }));
  }

  function isRealtimeRoastTurnRunning(value: RealtimeRoastTurnState['state']) {
    return (
      value === 'connectingAsr' ||
      value === 'listening' ||
      value === 'waitingFinal' ||
      value === 'thinking' ||
      value === 'speaking'
    );
  }

  function logRealtimeRoastTurn(payload: Record<string, unknown>) {
    console.log('[ROAST_REALTIME_TURN]', JSON.stringify(payload));
  }

  function logNativeEventBinding(payload: Record<string, unknown>) {
    console.log('[ROAST_NATIVE_EVENT_BINDING]', JSON.stringify(payload));
  }

  function getNumericMetric(metrics: RoastTextTurnStream['metrics'] | undefined, key: string) {
    const value = metrics?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  function buildSpokenTextPreviewReply(spokenText: string, mode: RoastReplyMode = 'conversation'): RoastReply {
    return {
      mode,
      reaction: 'none',
      spokenText,
      correction: {
        hasCorrection: false,
        wrong: '',
        right: '',
        reason: '',
      },
      nextPrompt: '',
      nextAction: 'continue',
    };
  }

  function buildTurnHistory(current: RealtimeRoastTurnState, status: RoastCallTurnHistory['status']): RoastCallTurnHistory {
    const hasCorrection = current.reply?.correction.hasCorrection ?? Boolean(current.reply?.correction.wrong || current.reply?.correction.right);
    return {
      id: current.requestId ?? createRealtimeRoastTurnRequestId(),
      createdAt: Date.now(),
      asrRawText: current.asrRawText,
      asrQualityOk: current.asrQualityOk ?? false,
      asrQualityReason: current.asrQualityReason ?? null,
      mode: status === 'completed' ? (current.reply?.mode ?? (hasCorrection ? 'correction' : 'conversation')) : status,
      spokenText: current.reply?.spokenText ?? '',
      correction: {
        hasCorrection,
        wrong: current.reply?.correction.wrong ?? '',
        right: current.reply?.correction.right ?? '',
        reason: current.reply?.correction.reason ?? '',
      },
      nextPrompt: current.reply?.nextPrompt ?? current.retryHint ?? '',
      timings: {
        stoppedToFinalMs: current.stoppedToFinalMs,
        finalToTurnMs: current.finalToTurnResponseMs,
        turnToAudioStartMs: current.turnResponseToAudioQueueStartedMs,
        stoppedToAudioStartMs: current.stoppedToAudioQueueStartedMs,
        playbackEndedMs: current.playbackEndedMs,
      },
      status,
    };
  }

  function appendRoastTurnHistory(turn: RoastCallTurnHistory) {
    setRoastTurns((current) => {
      const next = [turn, ...current.filter((item) => item.id !== turn.id)].slice(0, 5);
      roastTurnsRef.current = next;
      return next;
    });
  }

  function buildRoastConversationHistory() {
    const trimHistoryText = (value: string, maxLength = 240) => {
      const normalized = value.replace(/\s+/g, ' ').trim();
      return normalized.length > maxLength ? normalized.slice(0, maxLength).trim() : normalized;
    };

    return roastTurnsRef.current
      .filter((turn) => turn.status === 'completed' && turn.asrRawText && turn.spokenText)
      .slice(0, 4)
      .reverse()
      .map((turn) => ({
        user: trimHistoryText(turn.asrRawText),
        assistant: trimHistoryText(turn.spokenText),
        mode: String(turn.mode),
      }));
  }

  function setPersistentCallState(next: PersistentCallState) {
    persistentCallStateRef.current = next;
    setCallState(next);
  }

  function setPersistentTurnState(next: PersistentTurnState) {
    persistentTurnStateRef.current = next;
    setTurnState(next);
  }

  function logRoastCallState(action: string, extra: Record<string, unknown> = {}) {
    console.log('[ROAST_CALL_STATE]', JSON.stringify({
      action,
      callState: persistentCallStateRef.current,
      turnState: persistentTurnStateRef.current,
      hasActiveSession: Boolean(persistentAsrRef.current),
      activeSessionId: persistentSessionIdRef.current,
      activeTurnId: realtimeRoastTurnActiveRequestIdRef.current,
      ...extra,
    }));
  }

  function logRoastEndCallTrace(input: RoastEndCallOptions & { shouldActuallyEnd: boolean; activeSessionId?: string | null }) {
    console.log('[ROAST_END_CALL_TRACE]', JSON.stringify({
      reason: input.reason,
      source: input.source,
      requestId: input.requestId ?? null,
      activeSessionId: input.activeSessionId ?? persistentSessionIdRef.current,
      callState: persistentCallStateRef.current,
      turnState: persistentTurnStateRef.current,
      isUnmounting: input.source === 'useEffect_cleanup',
      isScreenFocused: true,
      elapsedSinceStartMs: elapsedSince(persistentCallStartedAtRef.current ?? undefined) ?? null,
      stackHint: input.stackHint,
      shouldActuallyEnd: input.shouldActuallyEnd,
    }));
  }

  function logCallLifecycleGuard(input: {
    phase: string;
    action: 'allow' | 'abort';
    localRunId?: string | null;
    requestId?: string | null;
    reason?: string | null;
  }) {
    console.log('[ROAST_CALL_LIFECYCLE_GUARD]', JSON.stringify({
      phase: input.phase,
      action: input.action,
      localRunId: input.localRunId ?? null,
      activeRunId: activeCallRunIdRef.current,
      requestId: input.requestId ?? null,
      activeSessionId: persistentSessionIdRef.current,
      callState: persistentCallStateRef.current,
      turnState: persistentTurnStateRef.current,
      reason: input.reason ?? null,
    }));
  }

  function isActiveCallRun(localRunId: string | null | undefined, sessionId: string | null | undefined) {
    return Boolean(
      localRunId
      && sessionId
      && screenMountedRef.current
      && activeCallRunIdRef.current === localRunId
      && persistentSessionIdRef.current === sessionId,
    );
  }

  function invalidateActiveCallRun(phase: string, reason: string, requestId?: string | null) {
    const localRunId = activeCallRunIdRef.current;
    if (!localRunId && !requestId) return;
    const abortController = activeCallAbortControllerRef.current;
    if (abortController && !abortController.signal.aborted) {
      console.log('[ROAST_REALTIME_CONNECT_ABORT]', JSON.stringify({
        phase: 'abort_requested',
        requestId: requestId ?? persistentSessionIdRef.current,
        reason,
      }));
      abortController.abort();
    }
    activeCallAbortControllerRef.current = null;
    logCallLifecycleGuard({
      phase,
      action: 'abort',
      localRunId,
      requestId: requestId ?? persistentSessionIdRef.current,
      reason,
    });
    activeCallRunIdRef.current = null;
  }

  function logRoastCallGuard(action: string, reason: string, extra: Record<string, unknown> = {}) {
    console.log('[ROAST_CALL_GUARD]', JSON.stringify({
      action,
      reason,
      callState: persistentCallStateRef.current,
      turnState: persistentTurnStateRef.current,
      hasActiveSession: Boolean(persistentAsrRef.current),
      activeSessionId: persistentSessionIdRef.current,
      activeTurnId: realtimeRoastTurnActiveRequestIdRef.current,
      ...extra,
    }));
  }

  function logRoastCallGreeting(eventType: string, extra: Record<string, unknown> = {}) {
    console.log('[ROAST_CALL_GREETING]', JSON.stringify({
      eventType,
      callSessionId: persistentSessionIdRef.current,
      elapsedMs: persistentCallStartedAtRef.current ? Math.round(now() - persistentCallStartedAtRef.current) : null,
      textLength: ROAST_CALL_GREETING_TEXT.length,
      ...extra,
    }));
  }

  function logGreetingNativeEventIgnored(event: RoastChunkStreamEvent, reason: string) {
    console.log('[ROAST_GREETING_NATIVE_EVENT_IGNORED]', JSON.stringify({
      type: event.type,
      reason,
      callSessionId: greetingSessionIdRef.current,
      nativeRequestId: event.requestId ?? null,
      candidateNativeRequestId: greetingCandidateNativeRequestIdRef.current,
      activeNativeRequestId: greetingNativeRequestIdRef.current,
      status: event.status ?? null,
      elapsedMs: event.elapsedMs ?? null,
    }));
  }

  function bindGreetingNativeRequestId(nativeRequestId: string | null | undefined) {
    if (!nativeRequestId) return;
    greetingNativeRequestIdRef.current = nativeRequestId;
    const waiter = greetingPlaybackWaiterRef.current;
    if (waiter) {
      waiter.nativeRequestId = nativeRequestId;
    }
  }

  function waitForGreetingPlaybackEnded(sessionId: string) {
    return new Promise<RoastChunkStreamEvent>((resolve, reject) => {
      greetingPlaybackWaiterRef.current = {
        sessionId,
        nativeRequestId: greetingNativeRequestIdRef.current,
        resolve,
        reject,
      };
    });
  }

  function rejectGreetingPlaybackWaiter(reason: string) {
    const waiter = greetingPlaybackWaiterRef.current;
    if (!waiter) return;
    greetingPlaybackWaiterRef.current = null;
    waiter.reject(new Error(reason));
  }

  function handleGreetingChunkEvent(event: RoastChunkStreamEvent) {
    if (!greetingInFlightRef.current) return;

    const nativeRequestId = event.requestId ?? null;
    const activeNativeRequestId = greetingNativeRequestIdRef.current;
    const candidateNativeRequestId = greetingCandidateNativeRequestIdRef.current;
    const waiter = greetingPlaybackWaiterRef.current;

    if (event.type === 'roastChunkStream:requestStart' && nativeRequestId && !activeNativeRequestId) {
      greetingCandidateNativeRequestIdRef.current = nativeRequestId;
      logRoastCallGreeting('greeting_tts_request', { nativeRequestId });
      console.log('[ROAST_GREETING_FORCE_PLAYBACK_START]', JSON.stringify({
        callSessionId: greetingSessionIdRef.current,
        nativeRequestId,
        forceAudioSessionModeDefault: true,
        isMicMuted: persistentAsrRef.current?.client?.isMicMuted ?? null,
        localAudioTrackEnabled: persistentAsrRef.current?.client?.localAudioTrackEnabled ?? null,
        urlPath: greetingPlaybackUrlPathRef.current,
      }));
      return;
    }

    if (!activeNativeRequestId) {
      if (nativeRequestId && candidateNativeRequestId && nativeRequestId !== candidateNativeRequestId) {
        logGreetingNativeEventIgnored(event, 'candidate_native_request_id_mismatch');
        return;
      }
      if (event.type === 'roastChunkStream:audioQueueStarted') {
        console.log('[ROAST_GREETING_PLAYBACK_STARTED]', JSON.stringify({
          callSessionId: greetingSessionIdRef.current,
          nativeRequestId,
          audioQueueStartedMs: event.audioQueueStartedMs ?? null,
        }));
        logRoastCallGreeting('greeting_audio_started', {
          nativeRequestId,
          audioQueueStartedMs: event.audioQueueStartedMs ?? null,
        });
        return;
      }
      if (event.type === 'roastChunkStream:playbackEnded' && nativeRequestId && nativeRequestId === candidateNativeRequestId && waiter) {
        bindGreetingNativeRequestId(nativeRequestId);
        console.log('[ROAST_GREETING_PLAYBACK_ENDED]', JSON.stringify({
          callSessionId: greetingSessionIdRef.current,
          nativeRequestId,
          playbackEndedMs: event.playbackEndedMs ?? null,
        }));
        if (waiter && waiter.sessionId === greetingSessionIdRef.current) {
          greetingPlaybackWaiterRef.current = null;
          waiter.resolve(event);
        }
        return;
      }
      if (event.type === 'roastChunkStream:error' && nativeRequestId && nativeRequestId === candidateNativeRequestId && waiter) {
        bindGreetingNativeRequestId(nativeRequestId);
        logRoastCallGreeting('greeting_error', {
          nativeRequestId,
          error: event.error ?? 'chunk_stream_error',
        });
        if (waiter && waiter.sessionId === greetingSessionIdRef.current) {
          greetingPlaybackWaiterRef.current = null;
          waiter.reject(new Error(event.error ?? 'greeting_playback_error'));
        }
        return;
      }
      if (
        event.type === 'roastChunkStream:stopped' ||
        event.type === 'roastChunkStream:playbackEnded' ||
        event.type === 'roastChunkStream:error' ||
        event.type === 'roastChunkStream:progress'
      ) {
        logGreetingNativeEventIgnored(event, 'waiting_for_greeting_native_request_binding');
      }
      return;
    }

    if (!nativeRequestId || nativeRequestId !== activeNativeRequestId) {
      logGreetingNativeEventIgnored(event, nativeRequestId ? 'native_request_id_mismatch' : 'missing_native_request_id');
      return;
    }

    if (event.type === 'roastChunkStream:audioQueueStarted') {
      console.log('[ROAST_GREETING_PLAYBACK_STARTED]', JSON.stringify({
        callSessionId: greetingSessionIdRef.current,
        nativeRequestId,
        audioQueueStartedMs: event.audioQueueStartedMs ?? null,
      }));
      logRoastCallGreeting('greeting_audio_started', {
        nativeRequestId,
        audioQueueStartedMs: event.audioQueueStartedMs ?? null,
      });
      return;
    }

    if (event.type === 'roastChunkStream:playbackEnded') {
      console.log('[ROAST_GREETING_PLAYBACK_ENDED]', JSON.stringify({
        callSessionId: greetingSessionIdRef.current,
        nativeRequestId,
        playbackEndedMs: event.playbackEndedMs ?? null,
      }));
      if (waiter && waiter.sessionId === greetingSessionIdRef.current) {
        greetingPlaybackWaiterRef.current = null;
        waiter.resolve(event);
      }
      return;
    }

    if (event.type === 'roastChunkStream:stopped') {
      if (waiter && waiter.sessionId === greetingSessionIdRef.current) {
        greetingPlaybackWaiterRef.current = null;
        waiter.reject(new Error('greeting_playback_stopped'));
      }
      return;
    }

    if (event.type === 'roastChunkStream:error') {
      logRoastCallGreeting('greeting_error', {
        nativeRequestId,
        error: event.error ?? 'chunk_stream_error',
      });
      if (waiter && waiter.sessionId === greetingSessionIdRef.current) {
        greetingPlaybackWaiterRef.current = null;
        waiter.reject(new Error(event.error ?? 'greeting_playback_error'));
      }
    }
  }

  function normalizeAsrEchoText(value: string) {
    return value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function markAiPlaybackAsrGate(text?: string | null, cooldownMs = ROAST_ASR_AI_PLAYBACK_COOLDOWN_MS) {
    const gateUntil = now() + cooldownMs;
    aiPlaybackGateUntilRef.current = Math.max(aiPlaybackGateUntilRef.current, gateUntil);
    if (text) {
      lastAiPlaybackTextRef.current = text;
      aiPlaybackEchoGuardUntilRef.current = Math.max(aiPlaybackEchoGuardUntilRef.current, now() + ROAST_ASR_AI_ECHO_GUARD_MS);
    }
  }

  function isAsrGatedDuringAiPlayback() {
    const gateActive = now() < aiPlaybackGateUntilRef.current;
    return (
      isAiSpeakingRef.current
      || greetingInFlightRef.current
      || persistentCallStateRef.current === 'speaking'
      || persistentTurnStateRef.current === 'greeting'
      || persistentTurnStateRef.current === 'playing'
      || gateActive
    );
  }

  function isRecentAiPlaybackEcho(text: string) {
    if (now() > aiPlaybackEchoGuardUntilRef.current) return false;
    const aiText = normalizeAsrEchoText(lastAiPlaybackTextRef.current);
    const candidate = normalizeAsrEchoText(text);
    if (aiText.length < 18 || candidate.length < 18) return false;
    if (aiText === candidate) return true;
    const shorter = aiText.length < candidate.length ? aiText : candidate;
    const longer = aiText.length < candidate.length ? candidate : aiText;
    return shorter.length >= 28 && longer.includes(shorter);
  }

  function logAsrGatedDuringAiPlayback(eventType: string, textLength: number | null = null) {
    console.log('[ROAST_ASR_GATED_DURING_AI_PLAYBACK]', JSON.stringify({
      eventType,
      turnState: persistentTurnStateRef.current,
      callState: persistentCallStateRef.current,
      textLength,
      aiSpeaking: isAiSpeakingRef.current,
    }));
  }

  function logLatencyTrace(phase: string, fields: Record<string, unknown> = {}) {
    console.log('[ROAST_LATENCY_TRACE]', JSON.stringify({
      phase,
      ...fields,
    }));
  }

  function gateAsrEventDuringAiPlayback(event: RoastRealtimeAsrEvent, requestId: string) {
    const textLength =
      event.type === 'user_transcript_delta' || event.type === 'user_transcript_final' || event.type === 'user_transcript_done'
        ? event.text.length
        : null;
    persistentCurrentTurnRef.current = { turnId: null, partialText: '' };
    ignoredAiPlaybackRef.current += 1;
    setIgnoredAiPlayback(ignoredAiPlaybackRef.current);
    logAsrGatedDuringAiPlayback(event.type, textLength);
    logRealtimeRoastTurn({
      eventType: 'ignored_ai_playback',
      requestId,
      sourceEventType: event.type,
      textLength,
    });
  }

  function isUserAsrEvent(event: RoastRealtimeAsrEvent) {
    return (
      event.type === 'user_speech_started'
      || event.type === 'user_speech_stopped'
      || event.type === 'user_transcript_delta'
      || event.type === 'user_transcript_final'
      || event.type === 'user_transcript_done'
    );
  }

  function handleRealtimeRoastTurnChunkEvent(event: RoastChunkStreamEvent) {
    const activeRequestId = realtimeRoastTurnActiveRequestIdRef.current;
    if (!activeRequestId || realtimeRoastTurnStateRef.current !== 'speaking') return;

    setRealtimeRoastTurn((current) => {
      if (current.requestId !== activeRequestId || current.state !== 'speaking') return current;
      const nativeRequestId = event.requestId ?? null;
      const currentNativeRequestId = realtimeRoastTurnNativeStreamRequestIdRef.current;
      if (currentNativeRequestId && nativeRequestId && nativeRequestId !== currentNativeRequestId) {
        logNativeEventBinding({
          eventType: event.type,
          nativeRequestId,
          activeTurnId: activeRequestId,
          activeNativeRequestId: currentNativeRequestId,
          turnState: current.state,
          callState: persistentCallStateRef.current,
          action: 'ignore_stale_native_event',
          reason: 'native_request_id_mismatch',
        });
        return { ...current, staleEventCount: current.staleEventCount + 1 };
      }

      const canBindNativeRequest =
        event.type === 'roastChunkStream:requestStart' ||
        event.type === 'roastChunkStream:firstNetworkChunk' ||
        event.type === 'roastChunkStream:firstPacketParsed' ||
        event.type === 'roastChunkStream:audioQueueStarted';
      if (!currentNativeRequestId && nativeRequestId && canBindNativeRequest) {
        realtimeRoastTurnNativeStreamRequestIdRef.current = nativeRequestId;
        logNativeEventBinding({
          eventType: event.type,
          nativeRequestId,
          activeTurnId: activeRequestId,
          activeNativeRequestId: nativeRequestId,
          turnState: current.state,
          callState: persistentCallStateRef.current,
          action: 'bind_native_request',
          reason: 'playback_start_event',
        });
      } else if (!currentNativeRequestId && nativeRequestId && event.type === 'roastChunkStream:stopped') {
        logNativeEventBinding({
          eventType: event.type,
          nativeRequestId,
          activeTurnId: activeRequestId,
          activeNativeRequestId: null,
          turnState: current.state,
          callState: persistentCallStateRef.current,
          action: 'ignore_old_stopped',
          reason: 'stopped_cannot_bind_active_turn',
        });
        return current;
      } else if (!currentNativeRequestId && nativeRequestId) {
        logNativeEventBinding({
          eventType: event.type,
          nativeRequestId,
          activeTurnId: activeRequestId,
          activeNativeRequestId: null,
          turnState: current.state,
          callState: persistentCallStateRef.current,
          action: 'ignore_stale_native_event',
          reason: 'terminal_event_before_native_binding',
        });
        return { ...current, staleEventCount: current.staleEventCount + 1 };
      } else {
        logNativeEventBinding({
          eventType: event.type,
          nativeRequestId,
          activeTurnId: activeRequestId,
          activeNativeRequestId: realtimeRoastTurnNativeStreamRequestIdRef.current,
          turnState: current.state,
          callState: persistentCallStateRef.current,
          action: 'accept_current_event',
          reason: currentNativeRequestId ? 'native_request_id_match' : 'no_native_request_id',
        });
      }

      const audioRequestStartMs = current.audioRequestStartMs ?? (
        event.type === 'roastChunkStream:requestStart' && typeof current.t0 === 'number'
          ? Math.max(0, Math.round(now() - current.t0))
          : current.audioRequestStartMs
      );
      const firstNetworkChunkMs =
        current.firstNetworkChunkMs ??
        (typeof audioRequestStartMs === 'number' && typeof event.firstNetworkChunkMs === 'number'
          ? audioRequestStartMs + event.firstNetworkChunkMs
          : undefined);
      const firstPacketParsedMs =
        current.firstPacketParsedMs ??
        (typeof audioRequestStartMs === 'number' && typeof event.firstPacketParsedMs === 'number'
          ? audioRequestStartMs + event.firstPacketParsedMs
          : undefined);
      const audioQueueStartedMs =
        current.audioQueueStartedMs ??
        (typeof audioRequestStartMs === 'number' && typeof event.audioQueueStartedMs === 'number'
          ? audioRequestStartMs + event.audioQueueStartedMs
          : undefined);
      const playbackEndedMs =
        current.playbackEndedMs ??
        (typeof audioRequestStartMs === 'number' && typeof event.playbackEndedMs === 'number'
          ? audioRequestStartMs + event.playbackEndedMs
          : undefined);
      const stoppedToAudioQueueStartedMs = safeDiff(audioQueueStartedMs, current.speechStoppedMs);
      const stoppedToPlaybackEndedMs = safeDiff(playbackEndedMs, current.speechStoppedMs);
      const turnResponseToAudioQueueStartedMs = safeDiff(audioQueueStartedMs, current.turnResponseMs);
      const appReceivedToAudioRequestMs = safeDiff(audioRequestStartMs, current.turnResponseMs);
      const audioRequestToFirstNetworkChunkMs = safeDiff(firstNetworkChunkMs, audioRequestStartMs);
      const firstNetworkChunkToFirstPacketParsedMs = safeDiff(firstPacketParsedMs, firstNetworkChunkMs);
      const firstPacketParsedToAudioQueueStartedMs = safeDiff(audioQueueStartedMs, firstPacketParsedMs);
      const playbackDurationMs = safeDiff(playbackEndedMs, audioQueueStartedMs);

      const next: RealtimeRoastTurnState = {
        ...current,
        nativeStreamRequestId: realtimeRoastTurnNativeStreamRequestIdRef.current,
        audioRequestStartMs,
        firstNetworkChunkMs,
        firstPacketParsedMs,
        audioQueueStartedMs,
        playbackEndedMs,
        stoppedToAudioQueueStartedMs,
        stoppedToPlaybackEndedMs,
        turnResponseToAudioQueueStartedMs,
      };
      if (typeof next.audioQueueStartedMs === 'number') {
        next.clickToAudioQueueStartedMs = next.audioQueueStartedMs;
      }
      if (event.type === 'roastChunkStream:playbackEnded') {
        next.state = 'completed';
        realtimeRoastTurnStateRef.current = 'completed';
        markAiPlaybackAsrGate(next.reply?.spokenText ?? lastAiPlaybackTextRef.current);
        isAiSpeakingRef.current = false;
        realtimeRoastTurnAsrRef.current?.client?.unmuteMic?.();
        persistentAsrRef.current?.client?.unmuteMic?.();
        if (persistentAsrRef.current && persistentCallStateRef.current !== 'ended') {
          setPersistentCallState('listening');
          setPersistentTurnState('completed');
          setTimeout(() => {
            if (persistentAsrRef.current && persistentCallStateRef.current === 'listening') {
              setPersistentTurnState('none');
            }
          }, 700);
        }
        appendRoastTurnHistory(buildTurnHistory(next, 'completed'));
        logNativeEventBinding({
          eventType: event.type,
          nativeRequestId,
          activeTurnId: activeRequestId,
          activeNativeRequestId: realtimeRoastTurnNativeStreamRequestIdRef.current,
          turnState: next.state,
          callState: persistentCallStateRef.current,
          action: 'complete_turn',
          reason: 'playback_ended_for_active_native_request',
        });
        logRealtimeRoastTurn({
          eventType: 'completed',
          requestId: activeRequestId,
          asrRawText: next.asrRawText,
          stoppedToFinalMs: next.stoppedToFinalMs ?? null,
          finalToTurnResponseMs: next.finalToTurnResponseMs ?? null,
          finalToTurnRequestMs: safeDiff(next.turnRequestMs, next.asrFinalMs) ?? null,
          streamRequestToSpokenTextReadyMs: safeDiff(next.turnResponseMs, next.turnRequestMs) ?? null,
          spokenTextReadyToTtsStreamReadyMs: (() => {
            const spokenTextReadyMs = getNumericMetric(next.turnMetrics, 'spokenTextReadyMs');
            const ttsStreamReadyMs = getNumericMetric(next.turnMetrics, 'ttsStreamReadyMs');
            return safeDiff(ttsStreamReadyMs ?? undefined, spokenTextReadyMs ?? undefined) ?? null;
          })(),
          ttsStreamReadyToAudioRequestMs: safeDiff(next.audioRequestStartMs, next.turnResponseMs) ?? null,
          turnRequestToAppResponseMs: safeDiff(next.turnResponseMs, next.turnRequestMs) ?? null,
          llmDurationMs: getNumericMetric(next.turnMetrics, 'llmDurationMs') ?? getNumericMetric(next.turnMetrics, 'respondMs'),
          firstTokenMs: getNumericMetric(next.turnMetrics, 'firstTokenMs'),
          spokenTextReadyMs: getNumericMetric(next.turnMetrics, 'spokenTextReadyMs'),
          replyReadyMs: getNumericMetric(next.turnMetrics, 'replyReadyMs'),
          fullJsonReadyMs: getNumericMetric(next.turnMetrics, 'fullJsonReadyMs'),
          backendTotalMs: getNumericMetric(next.turnMetrics, 'totalMs'),
          backendLlmStartMs: getNumericMetric(next.turnMetrics, 'backendLlmStartMs'),
          backendTtsStreamUrlReadyMs: getNumericMetric(next.turnMetrics, 'backendTtsStreamUrlReadyMs'),
          provider: next.turnMetrics?.provider ?? null,
          model: next.turnMetrics?.model ?? null,
          transport: next.turnMetrics?.transport ?? next.turnMetrics?.turnTransport ?? null,
          serverSpokenTextReadyMs: getNumericMetric(next.turnMetrics, 'serverSpokenTextReadyMs'),
          clientSpokenTextReadyMs: getNumericMetric(next.turnMetrics, 'clientSpokenTextReadyMs'),
          spokenTextDeltaMs: getNumericMetric(next.turnMetrics, 'spokenTextDeltaMs'),
          serverTtsStreamReadyMs: getNumericMetric(next.turnMetrics, 'serverTtsStreamReadyMs'),
          clientTtsStreamReadyMs: getNumericMetric(next.turnMetrics, 'clientTtsStreamReadyMs'),
          ttsStreamDeltaMs: getNumericMetric(next.turnMetrics, 'ttsStreamDeltaMs'),
          wsConnectedAtMs: persistentTurnWsConnectedAtMsRef.current,
          wsReadyMs: persistentTurnWsReadyMsRef.current,
          historyLength: roastTurnsRef.current.filter((item) => item.status === 'completed').slice(-6).length,
          v2Used: next.turnMetrics?.v2Used ?? null,
          fallbackUsed: next.turnMetrics?.fallbackUsed ?? Boolean(next.turnMetrics?.fallbackFrom),
          fallbackFrom: next.turnMetrics?.fallbackFrom ?? null,
          fallbackReason: next.turnMetrics?.fallbackReason ?? null,
          mode: next.reply?.mode ?? null,
          hasCorrection: next.reply?.correction.hasCorrection ?? null,
          spokenTextLength: next.reply?.spokenText.length ?? null,
          voiceSpokenTextLength: getNumericMetric(next.turnMetrics, 'voiceSpokenTextLength'),
          wasVoiceTrimmed: next.turnMetrics?.wasVoiceTrimmed ?? null,
          trimReason: next.turnMetrics?.trimReason ?? null,
          appReceivedToAudioRequestMs: appReceivedToAudioRequestMs ?? null,
          audioRequestToFirstNetworkChunkMs: audioRequestToFirstNetworkChunkMs ?? null,
          firstNetworkChunkToFirstPacketParsedMs: firstNetworkChunkToFirstPacketParsedMs ?? null,
          firstPacketParsedToAudioQueueStartedMs: firstPacketParsedToAudioQueueStartedMs ?? null,
          turnResponseToAudioQueueStartedMs: next.turnResponseToAudioQueueStartedMs ?? null,
          stoppedToAudioQueueStartedMs: next.stoppedToAudioQueueStartedMs ?? null,
          clickToAudioQueueStartedMs: next.clickToAudioQueueStartedMs ?? null,
          stoppedToPlaybackEndedMs: next.stoppedToPlaybackEndedMs ?? null,
          audioQueueStartedMs: next.audioQueueStartedMs ?? null,
          playbackEndedMs: next.playbackEndedMs ?? null,
          playbackDurationMs: playbackDurationMs ?? null,
          unexpectedVoice: next.unexpectedVoice,
          staleEventCount: next.staleEventCount,
        });
      }
      if (event.type === 'roastChunkStream:error') {
        next.state = 'error';
        next.error = event.error ?? 'AudioQueue stream failed.';
        realtimeRoastTurnStateRef.current = 'error';
        markAiPlaybackAsrGate(lastAiPlaybackTextRef.current);
        isAiSpeakingRef.current = false;
        realtimeRoastTurnAsrRef.current?.client?.unmuteMic?.();
        persistentAsrRef.current?.client?.unmuteMic?.();
        if (persistentAsrRef.current && persistentCallStateRef.current !== 'ended') {
          setPersistentCallState('listening');
          setPersistentTurnState('error');
        }
      }
      return next;
    });
  }

  async function runRealtimeRoastTurnFromFinal(requestId: string, learnerRawText: string) {
    if (realtimeRoastTurnActiveRequestIdRef.current !== requestId) return;
    const sessionIdForTurn = persistentSessionIdRef.current;
    const localRunIdForTurn = activeCallRunIdRef.current;
    if (!isActiveCallRun(localRunIdForTurn, sessionIdForTurn)) {
      logCallLifecycleGuard({
        phase: 'abort_before_playback',
        action: 'abort',
        localRunId: localRunIdForTurn,
        requestId,
        reason: 'stale_before_turn_start',
      });
      return;
    }
    const runStartedAt = now();
    const trimmed = learnerRawText.trim();
    if (isAsrGatedDuringAiPlayback() || isRecentAiPlaybackEcho(trimmed)) {
      logAsrGatedDuringAiPlayback('run_turn_from_final_blocked', trimmed.length);
      logRealtimeRoastTurn({
        eventType: 'ignored_ai_playback',
        requestId,
        sourceEventType: 'run_turn_from_final',
        textLength: trimmed.length,
      });
      persistentCurrentTurnRef.current = { turnId: null, partialText: '' };
      if (persistentAsrRef.current && persistentCallStateRef.current !== 'ended') {
        setPersistentCallState('listening');
        setPersistentTurnState('none');
      }
      return;
    }
    const history = buildRoastConversationHistory();
    const previousAssistantText = history.length > 0 ? history[history.length - 1]?.assistant : undefined;
    const languageIntent = detectLanguageIntent(trimmed);
    const baseAsrQuality = evaluateRoastAsrQuality(trimmed, {
      hasConversationHistory: history.length > 0,
      previousAssistantText,
    });
    const asrSanity = baseAsrQuality.ok ? analyzeRoastAsrTranscript(trimmed) : null;
    const asrQuality: RoastAsrQualityResult = asrSanity?.shouldReject
      ? {
        ok: false,
        reason: asrSanity.reason,
        normalizedText: asrSanity.normalizedText,
      }
      : baseAsrQuality;
    const retryHint = isLanguageMisrecognitionReason(asrQuality.reason)
      ? "I might've misheard that. Try saying it again in English, or ask me in Chinese."
      : asrSanity?.shouldReject
        ? 'I might have misheard that. Say it again slowly.'
        : "I didn't catch that clearly. Say it again.";
    if (asrSanity?.shouldReject) {
      console.log('[ROAST_ASR_SANITY_REJECT]', JSON.stringify({
        reason: asrSanity.reason,
        matchedPhrase: asrSanity.matchedPhrase ?? null,
        preview: asrSanity.preview,
      }));
    } else if (__DEV__ && asrSanity) {
      console.log('[ROAST_ASR_SANITY_PASS]', JSON.stringify({
        preview: asrSanity.preview,
      }));
    }
    const asrQualityCheckedMs = Math.round(now() - (realtimeRoastTurnStartedAtRef.current ?? now()));
    logLatencyTrace('app_asr_quality_checked', {
      turnId: requestId,
      elapsedMs: asrQualityCheckedMs,
      deltaMs: Math.round(now() - runStartedAt),
      textLength: trimmed.length,
      status: asrQuality.ok ? 'ok' : 'rejected',
      asrSanityReason: asrSanity?.shouldReject ? asrSanity.reason : null,
    });
    setTranscript(trimmed);
    setRealtimeRoastTurn((current) => current.requestId === requestId
      ? {
        ...current,
        asrRawText: trimmed,
        asrQualityCheckedMs,
        asrQualityOk: asrQuality.ok,
        asrQualityReason: asrQuality.reason ?? null,
        asrSanityReason: asrSanity?.shouldReject ? asrSanity.reason : null,
        asrSanityMatchedPhrase: asrSanity?.matchedPhrase ?? null,
        rejectedText: asrQuality.ok ? undefined : trimmed,
        retryHint: asrQuality.ok ? undefined : retryHint,
        enteredTurnStream: false,
        enteredAudioQueue: false,
      }
      : current);
    logRealtimeRoastTurn({
      eventType: 'asr_quality_checked',
      requestId,
      elapsedMs: asrQualityCheckedMs,
      asrQualityOk: asrQuality.ok,
      asrQualityReason: asrQuality.reason ?? null,
      asrSanityReason: asrSanity?.shouldReject ? asrSanity.reason : null,
      asrSanityMatchedPhrase: asrSanity?.matchedPhrase ?? null,
      textLength: trimmed.length,
      historyLength: history.length,
      languageIntent,
      enteredTurnStream: false,
      enteredAudioQueue: false,
    });
    if (!asrQuality.ok) {
      realtimeRoastTurnStateRef.current = 'asrRejected';
      setPersistentTurnState('rejected');
      setPersistentCallState(persistentAsrRef.current ? 'listening' : 'idle');
      setLastSfxStatus(retryHint);
      setState('waitingRepeat');
      void playRoastReactionSfx('bruh').then((result) => {
        setLastSfxStatus(result.played ? retryHint : retryHint);
      });
      setRealtimeRoastTurn((current) => current.requestId === requestId
        ? (() => {
          const next: RealtimeRoastTurnState = {
            ...current,
            state: 'asrRejected',
            asrQualityOk: false,
            asrQualityReason: asrQuality.reason ?? null,
            asrSanityReason: asrSanity?.shouldReject ? asrSanity.reason : null,
            asrSanityMatchedPhrase: asrSanity?.matchedPhrase ?? null,
            rejectedText: trimmed,
            retryHint,
            error: null,
          };
          appendRoastTurnHistory(buildTurnHistory(next, 'rejected'));
          return next;
        })()
        : current);
      logRealtimeRoastTurn({
        eventType: 'asr_rejected',
        requestId,
        elapsedMs: asrQualityCheckedMs,
        rejectedTextPreview: previewRoastAsrTranscript(trimmed),
        asrQualityReason: asrQuality.reason ?? null,
        asrSanityReason: asrSanity?.shouldReject ? asrSanity.reason : null,
        asrSanityMatchedPhrase: asrSanity?.matchedPhrase ?? null,
        enteredTurnStream: false,
        enteredAudioQueue: false,
      });
      setTimeout(() => {
        if (persistentAsrRef.current && persistentCallStateRef.current === 'listening') {
          setPersistentTurnState('none');
        }
      }, 900);
      return;
    }

    try {
      realtimeRoastTurnStateRef.current = 'thinking';
      setPersistentCallState(persistentCallStateRef.current === 'ended' ? 'ended' : 'processing');
      setPersistentTurnState('responding');
      setRealtimeRoastTurn((current) => current.requestId === requestId ? { ...current, state: 'thinking' } : current);
      const turnRequestMs = Math.round(now() - (realtimeRoastTurnStartedAtRef.current ?? now()));
      logLatencyTrace('app_turn_request_prepare', {
        turnId: requestId,
        elapsedMs: turnRequestMs,
        deltaMs: Math.round(now() - runStartedAt),
        textLength: trimmed.length,
        transport: ROAST_PERSISTENT_TURN_TRANSPORT,
        status: 'ok',
      });
      setRealtimeRoastTurn((current) => current.requestId === requestId ? { ...current, turnRequestMs } : current);
      const wsClient = persistentTurnWsRef.current;
      const wsReady = Boolean(wsClient?.isReady());
      const socketState = wsClient?.getSocketState?.() ?? 'none';
      let turnTransport: RoastTurnTransport = ROAST_PERSISTENT_TURN_TRANSPORT;
      let transportSelectionReason = turnTransport === 'ws_v4' ? 'ws_ready' : 'configured_ndjson_v3';
      if (turnTransport === 'ws_v4' && !wsReady) {
        turnTransport = 'ndjson_v3';
        transportSelectionReason = 'ws_not_ready';
        console.log('[ROAST_WS_CLIENT]', JSON.stringify({
          eventType: 'fallback_to_v3',
          reason: 'ws_not_ready',
          requestId,
          socketState,
        }));
      }
	      console.log('[ROAST_WS_V4_SELECTION]', JSON.stringify({
        wsReady,
        socketState,
        selectedTransport: turnTransport,
        reason: transportSelectionReason,
        hasClient: Boolean(wsClient),
	      }));
      logLatencyTrace('app_transport_selected', {
        turnId: requestId,
        elapsedMs: Math.round(now() - (realtimeRoastTurnStartedAtRef.current ?? now())),
        textLength: trimmed.length,
        transport: turnTransport,
        status: transportSelectionReason,
      });
      let turnStreamLabel = turnTransport === 'ws_v4' ? 'turn_stream_ws_v4' : 'turn_stream_v3';
      logRealtimeRoastTurn({
        eventType: 'turn_request',
        requestId,
        learnerRawText: trimmed,
        elapsedMs: turnRequestMs,
        historyLength: history.length,
        transport: turnTransport,
        turnTransport,
        languageIntent,
      });

      let streamAudioStarted = false;
      let streamPlaybackPromise: Promise<void> | null = null;
      let streamFailureReason: string | null = null;
      let fallbackUsedForTurn = false;
      let currentVoiceSpokenText: string | null = null;
      let currentVoiceWasTrimmed = false;

      const markPlaybackFailed = (message: string) => {
        if (realtimeRoastTurnActiveRequestIdRef.current !== requestId) return;
        markAiPlaybackAsrGate(lastAiPlaybackTextRef.current);
        isAiSpeakingRef.current = false;
        realtimeRoastTurnAsrRef.current?.client?.unmuteMic?.();
        persistentAsrRef.current?.client?.unmuteMic?.();
        setPersistentCallState(persistentAsrRef.current ? 'listening' : 'error');
        setPersistentTurnState('error');
        realtimeRoastTurnStateRef.current = 'error';
        setRealtimeRoastTurn((current) => current.requestId === requestId
          ? (() => {
            const next: RealtimeRoastTurnState = { ...current, state: 'error', error: message };
            appendRoastTurnHistory(buildTurnHistory(next, 'error'));
            return next;
          })()
          : current);
      };

	      const playStreamForCurrentTurn = async (streamUrl: string, source: 'turn_stream_ws_v4' | 'turn_stream_v3' | 'turn_text_stream', responseMs: number) => {
        if (!isActiveCallRun(localRunIdForTurn, sessionIdForTurn)) {
          logCallLifecycleGuard({
            phase: 'abort_before_playback',
            action: 'abort',
            localRunId: localRunIdForTurn,
            requestId,
            reason: 'stale_before_turn_playback',
          });
          return;
        }
        logCallLifecycleGuard({
          phase: 'allow_turn_playback',
          action: 'allow',
          localRunId: localRunIdForTurn,
          requestId,
          reason: source,
        });
	        realtimeRoastTurnNativeStreamRequestIdRef.current = null;
	        const audioRequestStartMs = Math.round(now() - (realtimeRoastTurnStartedAtRef.current ?? now()));
        const appReceivedToAudioRequestMs = safeDiff(audioRequestStartMs, responseMs) ?? null;
	        setRealtimeRoastTurn((current) => current.requestId === requestId ? { ...current, audioRequestStartMs, enteredAudioQueue: true } : current);
		        logRealtimeRoastTurn({
		          eventType: 'audio_request_start',
	          requestId,
	          elapsedMs: audioRequestStartMs,
	          source,
	          appReceivedToAudioRequestMs,
		          ttsStreamReadyToAudioRequestMs: source === 'turn_stream_ws_v4' || source === 'turn_stream_v3' ? 0 : null,
		        });
        logLatencyTrace('app_audio_request_start', {
          turnId: requestId,
          elapsedMs: audioRequestStartMs,
          deltaMs: safeDiff(audioRequestStartMs, responseMs) ?? null,
          transport: source,
          status: 'ok',
        });
        realtimeRoastTurnAsrRef.current?.client?.muteMic?.();
        persistentAsrRef.current?.client?.muteMic?.();
        markAiPlaybackAsrGate(currentVoiceSpokenText);
        isAiSpeakingRef.current = true;
	        setPersistentCallState('speaking');
	        setPersistentTurnState('playing');
	        realtimeRoastTurnStateRef.current = 'speaking';
        logRoastPlaybackContext({
          source,
          url: streamUrl,
          appReceivedToAudioRequestMs,
          ttsStreamReadyToAudioRequestMs: source === 'turn_stream_ws_v4' || source === 'turn_stream_v3' ? 0 : null,
        });
        const ipadTtsSessionOptions = await buildAndLogTurnTtsNativeOptions({
          source: source as RoastTurnTtsSource,
          turnId: requestId,
          url: streamUrl,
        });
        const result = await playRoastChunkStreamUrl(streamUrl, realtimeRoastTurnStartedAtRef.current ?? now(), ipadTtsSessionOptions ?? undefined);
        if (realtimeRoastTurnActiveRequestIdRef.current !== requestId) return;
        if (!result.supported) {
          markPlaybackFailed(result.reason ?? result.error ?? 'AudioQueue playback failed.');
        }
      };

      const streamHandlers: RoastTurnStreamV3Handlers = {
          onLlmStarted: (event) => {
            logRealtimeRoastTurn({
              eventType: `${turnStreamLabel}_llm_started`,
              requestId,
              elapsedMs: Math.round(now() - (realtimeRoastTurnStartedAtRef.current ?? now())),
              provider: event.provider ?? null,
              model: event.model ?? null,
              serverElapsedMs: event.serverElapsedMs ?? null,
              clientElapsedMs: event.clientElapsedMs ?? null,
              clientMinusServerMs: event.clientMinusServerMs ?? null,
              deltaMs: event.clientMinusServerMs ?? null,
              transport: turnTransport,
              turnTransport,
              wsReadyMs: persistentTurnWsReadyMsRef.current,
            });
          },
          onSpokenTextReady: (event) => {
            if (realtimeRoastTurnActiveRequestIdRef.current !== requestId || streamAudioStarted) return;
            const spokenTextReadyMs = Math.round(now() - (realtimeRoastTurnStartedAtRef.current ?? now()));
            currentVoiceSpokenText = event.voiceSpokenText || event.spokenText;
            currentVoiceWasTrimmed = Boolean(event.wasVoiceTrimmed);
            const displayedSpokenText = currentVoiceWasTrimmed ? currentVoiceSpokenText : event.spokenText;
            const previewReply = buildSpokenTextPreviewReply(displayedSpokenText, event.mode ?? 'conversation');
            showAssistantReplyCard(previewReply);
            setRealtimeRoastTurn((current) => {
              if (current.requestId !== requestId) return current;
              const nextMetrics = {
                ...(current.turnMetrics ?? {}),
                provider: event.provider ?? 'deepseek',
                model: event.model ?? 'deepseek-chat',
                firstTokenMs: event.firstTokenMs ?? null,
                spokenTextReadyMs: event.spokenTextReadyMs ?? spokenTextReadyMs,
                serverSpokenTextReadyMs: event.serverElapsedMs ?? null,
                clientSpokenTextReadyMs: event.clientElapsedMs ?? null,
                spokenTextDeltaMs: event.clientMinusServerMs ?? null,
                voiceSpokenTextLength: event.voiceSpokenTextLength ?? event.voiceSpokenText?.length ?? event.spokenText.length,
                wasVoiceTrimmed: Boolean(event.wasVoiceTrimmed),
                trimReason: event.trimReason ?? '',
                v2Used: false,
                v3Used: turnTransport === 'ndjson_v3',
                v4Used: turnTransport === 'ws_v4',
                turnTransport,
                transport: turnTransport,
                fallbackUsed: fallbackUsedForTurn,
                fallback: 'llm_stream_partial',
              };
              return {
                ...current,
                state: 'thinking',
                turnResponseMs: spokenTextReadyMs,
                finalToTurnResponseMs: safeDiff(spokenTextReadyMs, current.asrFinalMs),
                reply: previewReply,
                turnMetrics: nextMetrics,
                enteredTurnStream: true,
              };
            });
            logRealtimeRoastTurn({
              eventType: `${turnStreamLabel}_spoken_text_ready`,
              requestId,
              elapsedMs: spokenTextReadyMs,
              streamRequestToSpokenTextReadyMs: safeDiff(spokenTextReadyMs, turnRequestMs) ?? null,
              backendSpokenTextReadyMs: event.spokenTextReadyMs ?? null,
              serverSpokenTextReadyMs: event.serverElapsedMs ?? null,
              clientSpokenTextReadyMs: event.clientElapsedMs ?? null,
              spokenTextServerToClientDeltaMs: event.clientMinusServerMs ?? null,
              spokenTextDeltaMs: event.clientMinusServerMs ?? null,
              firstTokenMs: event.firstTokenMs ?? null,
              spokenTextLength: event.spokenText.length,
              voiceSpokenTextLength: event.voiceSpokenTextLength ?? event.voiceSpokenText?.length ?? null,
              cardExtraTextLength: event.cardExtraText?.length ?? 0,
              wasVoiceTrimmed: Boolean(event.wasVoiceTrimmed),
              trimReason: event.trimReason ?? null,
              mode: event.mode ?? null,
              transport: turnTransport,
              v2Used: false,
              v3Used: turnTransport === 'ndjson_v3',
              v4Used: turnTransport === 'ws_v4',
              turnTransport,
              wsReadyMs: persistentTurnWsReadyMsRef.current,
            });
            if (event.streamUrl && realtimeRoastTurnActiveRequestIdRef.current === requestId && !streamAudioStarted) {
              streamAudioStarted = true;
              const earlyTtsStartMs = Math.round(now() - (realtimeRoastTurnStartedAtRef.current ?? now()));
              const voiceSpokenTextLength = event.voiceSpokenTextLength ?? event.voiceSpokenText?.length ?? event.spokenText.length;
              console.log('[ROAST_EARLY_TTS_START]', JSON.stringify({
                turnId: requestId,
                spokenTextLength: event.spokenText.length,
                voiceSpokenTextLength,
                elapsedMs: earlyTtsStartMs,
                reason: 'spoken_text_ready_stream_url',
                transport: turnTransport,
              }));
              logLatencyTrace('app_early_tts_start', {
                turnId: requestId,
                elapsedMs: earlyTtsStartMs,
                deltaMs: safeDiff(earlyTtsStartMs, spokenTextReadyMs) ?? null,
                textLength: voiceSpokenTextLength,
                transport: turnStreamLabel,
                status: 'ok',
              });
              streamPlaybackPromise = playStreamForCurrentTurn(
                event.streamUrl,
                turnStreamLabel as 'turn_stream_ws_v4' | 'turn_stream_v3',
                spokenTextReadyMs,
              );
            }
          },
	          onTtsStreamReady: (event) => {
	            if (realtimeRoastTurnActiveRequestIdRef.current !== requestId || streamAudioStarted) return;
	            streamAudioStarted = true;
	            const ttsStreamReadyMs = Math.round(now() - (realtimeRoastTurnStartedAtRef.current ?? now()));
            let spokenTextReadyToTtsStreamReadyMs: number | null = null;
	            setRealtimeRoastTurn((current) => {
              if (current.requestId !== requestId) return current;
              const currentMetrics = current.turnMetrics ?? {};
              const clientSpokenTextReadyMs = getNumericMetric(currentMetrics, 'clientSpokenTextReadyMs');
              const serverSpokenTextReadyMs = getNumericMetric(currentMetrics, 'serverSpokenTextReadyMs');
              const spokenTextReadyMs = getNumericMetric(currentMetrics, 'spokenTextReadyMs');
              const clientTtsStreamReadyMs = typeof event.clientElapsedMs === 'number' ? event.clientElapsedMs : null;
              const serverTtsStreamReadyMs = typeof event.serverElapsedMs === 'number' ? event.serverElapsedMs : null;
              const backendTtsStreamReadyMs = typeof event.ttsStreamReadyMs === 'number' ? event.ttsStreamReadyMs : null;
              spokenTextReadyToTtsStreamReadyMs =
                safeDiff(clientTtsStreamReadyMs ?? undefined, clientSpokenTextReadyMs ?? undefined)
                ?? safeDiff(serverTtsStreamReadyMs ?? undefined, serverSpokenTextReadyMs ?? undefined)
                ?? safeDiff(backendTtsStreamReadyMs ?? ttsStreamReadyMs, spokenTextReadyMs ?? undefined)
                ?? null;
              return {
	                ...current,
	                state: 'speaking',
	                turnMetrics: {
	                  ...currentMetrics,
	                  ttsStreamReadyMs: event.ttsStreamReadyMs ?? ttsStreamReadyMs,
                    spokenTextReadyToTtsStreamReadyMs,
	                  serverTtsStreamReadyMs: event.serverElapsedMs ?? null,
	                  clientTtsStreamReadyMs: event.clientElapsedMs ?? null,
	                  ttsStreamDeltaMs: event.clientMinusServerMs ?? null,
                  voiceSpokenTextLength: event.voiceSpokenTextLength ?? null,
                  wasVoiceTrimmed: Boolean(event.wasVoiceTrimmed),
                  trimReason: event.trimReason ?? '',
                  v2Used: false,
                  v3Used: turnTransport === 'ndjson_v3',
                  v4Used: turnTransport === 'ws_v4',
                  turnTransport,
                  transport: turnTransport,
                  fallbackUsed: fallbackUsedForTurn,
	                  fallback: 'llm_stream',
	                },
	              };
            });
	            logRealtimeRoastTurn({
	              eventType: `${turnStreamLabel}_tts_stream_ready`,
	              requestId,
	              elapsedMs: ttsStreamReadyMs,
	              spokenTextReadyToTtsStreamReadyMs,
	              backendTtsStreamReadyMs: event.ttsStreamReadyMs ?? null,
              serverTtsStreamReadyMs: event.serverElapsedMs ?? null,
              clientTtsStreamReadyMs: event.clientElapsedMs ?? null,
              ttsStreamServerToClientDeltaMs: event.clientMinusServerMs ?? null,
              ttsStreamDeltaMs: event.clientMinusServerMs ?? null,
              voiceSpokenTextLength: event.voiceSpokenTextLength ?? null,
              wasVoiceTrimmed: Boolean(event.wasVoiceTrimmed),
              trimReason: event.trimReason ?? null,
              transport: turnTransport,
              v2Used: false,
              v3Used: turnTransport === 'ndjson_v3',
              v4Used: turnTransport === 'ws_v4',
              turnTransport,
              wsReadyMs: persistentTurnWsReadyMsRef.current,
            });
            streamPlaybackPromise = playStreamForCurrentTurn(event.streamUrl, turnStreamLabel as 'turn_stream_ws_v4' | 'turn_stream_v3', ttsStreamReadyMs);
          },
          onReplyReady: (event) => {
            if (realtimeRoastTurnActiveRequestIdRef.current !== requestId) return;
            const replyReadyMs = Math.round(now() - (realtimeRoastTurnStartedAtRef.current ?? now()));
            const displayedReply = currentVoiceWasTrimmed && currentVoiceSpokenText
              ? { ...event.reply, spokenText: currentVoiceSpokenText }
              : event.reply;
            showAssistantReplyCard(displayedReply);
            setRealtimeRoastTurn((current) => current.requestId === requestId
              ? {
                ...current,
                reply: displayedReply,
                state: streamAudioStarted ? 'speaking' : 'thinking',
                turnMetrics: {
                  ...(current.turnMetrics ?? {}),
                  ...(event.metrics ?? {}),
                  replyReadyMs,
                  fullJsonReadyMs: event.metrics?.fullJsonReadyMs ?? replyReadyMs,
                  v2Used: false,
                  v3Used: turnTransport === 'ndjson_v3',
                  v4Used: turnTransport === 'ws_v4',
                  turnTransport,
                  transport: turnTransport,
                  fallbackUsed: fallbackUsedForTurn,
                },
              }
              : current);
            logRealtimeRoastTurn({
              eventType: `${turnStreamLabel}_reply_ready`,
              requestId,
              elapsedMs: replyReadyMs,
              replyReadyMs,
              fullJsonReadyMs: event.metrics?.fullJsonReadyMs ?? null,
              serverReplyReadyMs: event.serverElapsedMs ?? null,
              clientReplyReadyMs: event.clientElapsedMs ?? null,
              replyServerToClientDeltaMs: event.clientMinusServerMs ?? null,
              replyDeltaMs: event.clientMinusServerMs ?? null,
              mode: event.reply.mode,
              hasCorrection: event.reply.correction.hasCorrection,
              spokenTextLength: displayedReply.spokenText.length,
              v2Used: false,
              transport: turnTransport,
              v3Used: turnTransport === 'ndjson_v3',
              v4Used: turnTransport === 'ws_v4',
              turnTransport,
            });
          },
          onError: (event) => {
            streamFailureReason = event.error || event.message || `${turnStreamLabel}_error`;
            if ((event as any).errorType === 'billing_limit' || event.error === 'billing_limit') {
              setError(event.message || 'You’ve used today’s voice practice credits.');
              void refreshEntitlements();
            }
            logRealtimeRoastTurn({
              eventType: `${turnStreamLabel}_error`,
              requestId,
              elapsedMs: Math.round(now() - (realtimeRoastTurnStartedAtRef.current ?? now())),
              error: streamFailureReason,
              v2Used: false,
              transport: turnTransport,
              v3Used: turnTransport === 'ndjson_v3',
              v4Used: turnTransport === 'ws_v4',
              turnTransport,
            });
          },
          onDone: (event) => {
            logRealtimeRoastTurn({
              eventType: `${turnStreamLabel}_done`,
              requestId,
              elapsedMs: Math.round(now() - (realtimeRoastTurnStartedAtRef.current ?? now())),
              durationMs: event.durationMs ?? null,
              v2Used: false,
              transport: turnTransport,
              v3Used: turnTransport === 'ndjson_v3',
              v4Used: turnTransport === 'ws_v4',
              turnTransport,
            });
          },
      };

      const streamInput = {
        text: trimmed,
        coachId: 'la_bro_roast',
        history,
        turnId: requestId,
        sessionId: persistentSessionIdRef.current ?? undefined,
        accessToken: appSession.session?.accessToken ?? null,
        languageIntent,
      };
      const turnStream = turnTransport === 'ws_v4'
        ? persistentTurnWsRef.current!.startTurn(streamInput, streamHandlers)
        : startRoastTurnStreamV3(streamInput, streamHandlers);
      persistentActiveTurnAbortRef.current = turnStream.abort;

      let streamResult: Awaited<ReturnType<typeof createRoastTurnStreamV2>> | Awaited<ReturnType<typeof createRoastTurnStreamV3>> | null = null;
      try {
        streamResult = await turnStream.promise;
      } catch (caught) {
        streamFailureReason = caught instanceof Error ? caught.message : `${turnStreamLabel}_failed`;
      }
      if (streamPlaybackPromise) {
        await streamPlaybackPromise;
      }
      persistentActiveTurnAbortRef.current = null;

      if (realtimeRoastTurnActiveRequestIdRef.current !== requestId) return;
      if (!streamAudioStarted && turnTransport === 'ws_v4') {
        console.log('[ROAST_WS_CLIENT]', JSON.stringify({
          eventType: 'fallback_to_v3',
          reason: streamFailureReason ?? (streamResult?.reply ? 'missing_tts_stream_ready' : 'missing_reply'),
          requestId,
        }));
        logRealtimeRoastTurn({
          eventType: 'fallback_to_v3',
          requestId,
          elapsedMs: Math.round(now() - (realtimeRoastTurnStartedAtRef.current ?? now())),
          fallbackFrom: 'turn_stream_ws_v4',
          fallbackReason: streamFailureReason ?? (streamResult?.reply ? 'missing_tts_stream_ready' : 'missing_reply'),
          fallbackUsed: true,
          transport: 'ndjson_v3',
        });
        fallbackUsedForTurn = true;
        turnTransport = 'ndjson_v3';
        turnStreamLabel = 'turn_stream_v3';
        streamFailureReason = null;
        const v3TurnStream = startRoastTurnStreamV3(streamInput, streamHandlers);
        persistentActiveTurnAbortRef.current = v3TurnStream.abort;
        try {
          streamResult = await v3TurnStream.promise;
        } catch (caught) {
          streamFailureReason = caught instanceof Error ? caught.message : `${turnStreamLabel}_failed`;
        }
        if (streamPlaybackPromise) {
          await streamPlaybackPromise;
        }
        persistentActiveTurnAbortRef.current = null;
        if (realtimeRoastTurnActiveRequestIdRef.current !== requestId) return;
      }

      if (!streamAudioStarted) {
        logRealtimeRoastTurn({
          eventType: `${turnStreamLabel}_fallback_to_legacy`,
          requestId,
          elapsedMs: Math.round(now() - (realtimeRoastTurnStartedAtRef.current ?? now())),
          fallbackFrom: turnStreamLabel,
          fallbackReason: streamFailureReason ?? (streamResult?.reply ? 'missing_tts_stream_ready' : 'missing_reply'),
          fallbackUsed: true,
          transport: turnTransport,
          turnTransport,
        });
        const legacyTurn = await createRoastTextTurnStream({
          text: trimmed,
          coachId: 'la_bro_roast',
          history,
        });
        if (realtimeRoastTurnActiveRequestIdRef.current !== requestId) return;
        const legacyResponseMs = Math.round(now() - (realtimeRoastTurnStartedAtRef.current ?? now()));
        showAssistantReplyCard(legacyTurn.reply);
        setRealtimeRoastTurn((current) => {
          if (current.requestId !== requestId) return current;
          const next: RealtimeRoastTurnState = {
            ...current,
            state: 'speaking',
            turnResponseMs: legacyResponseMs,
            finalToTurnResponseMs: safeDiff(legacyResponseMs, current.asrFinalMs),
            reply: legacyTurn.reply,
            turnMetrics: {
              ...(legacyTurn.metrics ?? {}),
              v2Used: false,
              fallbackFrom: turnStreamLabel,
              fallbackReason: streamFailureReason ?? 'missing_tts_stream_ready',
              fallbackUsed: true,
              transport: turnTransport,
              turnTransport,
            },
            enteredTurnStream: true,
          };
          realtimeRoastTurnStateRef.current = 'speaking';
          return next;
        });
        logRealtimeRoastTurn({
          eventType: 'turn_response',
          requestId,
          elapsedMs: legacyResponseMs,
          respondMs: legacyTurn.metrics?.respondMs ?? null,
          totalMs: legacyTurn.metrics?.totalMs ?? null,
          provider: legacyTurn.metrics?.provider ?? null,
          model: legacyTurn.metrics?.model ?? null,
          fallback: legacyTurn.metrics?.fallback ?? null,
          fallbackFrom: turnStreamLabel,
          fallbackReason: streamFailureReason ?? 'missing_tts_stream_ready',
          v2Used: false,
          turnTransport,
          spokenTextLength: legacyTurn.reply.spokenText.length,
          mode: legacyTurn.reply.mode,
          hasCorrection: legacyTurn.reply.correction.hasCorrection,
        });
        await playStreamForCurrentTurn(legacyTurn.streamUrl, 'turn_text_stream', legacyResponseMs);
      }
    } catch (caught) {
      if (realtimeRoastTurnActiveRequestIdRef.current !== requestId) return;
      const message = caught instanceof Error ? caught.message : 'Realtime Roast Turn failed.';
      markAiPlaybackAsrGate(lastAiPlaybackTextRef.current);
      isAiSpeakingRef.current = false;
      realtimeRoastTurnAsrRef.current?.client?.unmuteMic?.();
      persistentAsrRef.current?.client?.unmuteMic?.();
      setPersistentCallState(persistentAsrRef.current ? 'listening' : 'error');
      setPersistentTurnState('error');
      realtimeRoastTurnStateRef.current = 'error';
      setRealtimeRoastTurn((current) => current.requestId === requestId
        ? (() => {
          const next: RealtimeRoastTurnState = { ...current, state: 'error', error: message };
          appendRoastTurnHistory(buildTurnHistory(next, 'error'));
          return next;
        })()
        : current);
      setError(message);
    }
  }

  function handleRealtimeRoastTurnAsrEvent(event: RoastRealtimeAsrEvent) {
    const activeRequestId = realtimeRoastTurnActiveRequestIdRef.current;
    if (!activeRequestId || event.requestId !== activeRequestId) {
      setRealtimeRoastTurn((current) => ({ ...current, staleEventCount: current.staleEventCount + 1 }));
      logRealtimeRoastTurn({
        requestId: event.requestId,
        eventType: 'ignored_stale',
        sourceEventType: event.type,
      });
      return;
    }

    const elapsedMs = Math.max(0, Math.round(now() - (realtimeRoastTurnStartedAtRef.current ?? now())));
    logRealtimeRoastTurn({
      requestId: event.requestId,
      state: realtimeRoastTurnStateRef.current,
      eventType: event.type,
      elapsedMs,
      textLength:
        event.type === 'user_transcript_delta' || event.type === 'user_transcript_final' || event.type === 'user_transcript_done'
          ? event.text.length
          : null,
    });

    if (
      isUserAsrEvent(event)
      && (isAsrGatedDuringAiPlayback()
        || (
          (event.type === 'user_transcript_final' || event.type === 'user_transcript_done')
          && isRecentAiPlaybackEcho(event.text)
        ))
    ) {
      gateAsrEventDuringAiPlayback(event, event.requestId);
      return;
    }

    setRealtimeRoastTurn((current) => {
      if (current.requestId !== event.requestId) return current;
      const next: RealtimeRoastTurnState = {
        ...current,
        eventCount: current.eventCount + 1,
      };
      switch (event.type) {
        case 'connected':
          next.state = 'listening';
          next.asrConnectedMs = next.asrConnectedMs ?? elapsedMs;
          break;
        case 'user_speech_started':
          next.state = 'listening';
          next.speechStartedMs = next.speechStartedMs ?? elapsedMs;
          break;
        case 'user_speech_stopped':
          next.state = 'waitingFinal';
          next.speechStoppedMs = next.speechStoppedMs ?? elapsedMs;
          break;
        case 'user_transcript_delta':
          next.firstDeltaMs = next.firstDeltaMs ?? elapsedMs;
          break;
        case 'user_transcript_final':
        case 'user_transcript_done':
          next.state = 'thinking';
          next.asrFinalMs = next.asrFinalMs ?? elapsedMs;
          next.asrRawText = event.text;
          if (typeof next.speechStoppedMs === 'number') {
            next.stoppedToFinalMs = next.asrFinalMs - next.speechStoppedMs;
          }
          break;
        case 'remote_audio_track_received':
          next.remoteTrackPresent = true;
          break;
        case 'assistant_audio_started':
        case 'ai_response_created':
        case 'ai_response_delta':
        case 'ai_response_transcript_done':
        case 'ai_response_done':
          next.unexpectedVoice = true;
          break;
        case 'error':
          next.state = 'error';
          next.error = event.message;
          break;
        default:
          break;
      }
      realtimeRoastTurnStateRef.current = next.state;
      return next;
    });

    if (event.type === 'user_transcript_done' || event.type === 'user_transcript_final') {
      void stopRealtimeRoastTurnAsrOnly(event.requestId);
      void runRealtimeRoastTurnFromFinal(event.requestId, event.text);
    }
  }

  function handlePersistentAsrEvent(event: RoastRealtimeAsrEvent) {
    const sessionId = persistentSessionIdRef.current;
    if (!sessionId || event.requestId !== sessionId) {
      setRealtimeRoastTurn((current) => ({ ...current, staleEventCount: current.staleEventCount + 1 }));
      logRealtimeRoastTurn({ eventType: 'persistent_ignored_stale', requestId: event.requestId, activeSessionId: sessionId, sourceEventType: event.type });
      return;
    }

    const callStartedAt = persistentCallStartedAtRef.current ?? now();
    const elapsedMs = Math.max(0, Math.round(now() - callStartedAt));
    logRealtimeRoastTurn({
      requestId: sessionId,
      state: persistentCallStateRef.current,
      turnState: persistentTurnStateRef.current,
      eventType: `persistent_${event.type}`,
      elapsedMs,
      textLength:
        event.type === 'user_transcript_delta' || event.type === 'user_transcript_final' || event.type === 'user_transcript_done'
          ? event.text.length
          : null,
    });

    if (
      isUserAsrEvent(event)
      && (isAsrGatedDuringAiPlayback()
        || (
          (event.type === 'user_transcript_final' || event.type === 'user_transcript_done')
          && isRecentAiPlaybackEcho(event.text)
        ))
    ) {
      gateAsrEventDuringAiPlayback(event, sessionId);
      return;
    }

    switch (event.type) {
      case 'connected':
      case 'datachannel_open':
      case 'session_updated':
        if (persistentCallStateRef.current === 'connecting') {
          setPersistentCallState('listening');
        }
        break;
      case 'remote_audio_track_received':
        setRealtimeRoastTurn((current) => ({ ...current, remoteTrackPresent: true }));
        break;
      case 'assistant_audio_started':
      case 'ai_response_created':
      case 'ai_response_delta':
      case 'ai_response_transcript_done':
      case 'ai_response_done':
        setRealtimeRoastTurn((current) => ({ ...current, unexpectedVoice: true }));
        break;
      case 'user_speech_started': {
        if (isAiSpeakingRef.current) {
          ignoredAiPlaybackRef.current += 1;
          setIgnoredAiPlayback(ignoredAiPlaybackRef.current);
          logRealtimeRoastTurn({ eventType: 'ignored_ai_playback', requestId: sessionId, sourceEventType: event.type, elapsedMs });
          return;
        }
        if (persistentTurnStateRef.current !== 'none' && persistentTurnStateRef.current !== 'completed' && persistentTurnStateRef.current !== 'rejected') {
          ignoredWhileBusyRef.current += 1;
          setIgnoredWhileBusy(ignoredWhileBusyRef.current);
          logRealtimeRoastTurn({ eventType: 'ignored_while_busy', requestId: sessionId, sourceEventType: event.type, elapsedMs });
          return;
        }
        const turnWsClient = persistentTurnWsRef.current;
        if (turnWsClient) {
          turnWsClient.sendUserSpeechStarted(sessionId);
        } else {
          console.log('[ROAST_WS_CLIENT]', JSON.stringify({ eventType: 'user_speech_started_skip', reason: 'missing_ws_client', sessionId }));
        }
        const turnId = createRealtimeRoastTurnRequestId();
        const turnStartedAt = now();
        persistentCurrentTurnRef.current = {
          turnId,
          turnStartedAt,
          speechStartedMs: 0,
          partialText: '',
        };
        realtimeRoastTurnActiveRequestIdRef.current = turnId;
        realtimeRoastTurnStartedAtRef.current = turnStartedAt;
        realtimeRoastTurnNativeStreamRequestIdRef.current = null;
        realtimeRoastTurnStateRef.current = 'listening';
        setPersistentCallState('listening');
        setPersistentTurnState('waitingFinal');
        setTranscript('');
        setRealtimeRoastTurn({
          state: 'listening',
          requestId: turnId,
          nativeStreamRequestId: null,
          asrRawText: '',
          eventCount: 1,
          t0: turnStartedAt,
          speechStartedMs: 0,
          asrQualityOk: null,
          asrQualityReason: null,
          enteredTurnStream: false,
          enteredAudioQueue: false,
          reply: null,
          remoteTrackPresent: true,
          unexpectedVoice: false,
          staleEventCount: ignoredWhileBusyRef.current + ignoredAiPlaybackRef.current,
          error: null,
        });
        break;
      }
      case 'user_speech_stopped': {
        const draft = persistentCurrentTurnRef.current;
        if (!draft.turnId) return;
        const speechStoppedMs = elapsedSince(draft.turnStartedAt) ?? elapsedMs;
        draft.speechStoppedMs = speechStoppedMs;
        realtimeRoastTurnStateRef.current = 'waitingFinal';
        setPersistentTurnState('waitingFinal');
        setRealtimeRoastTurn((current) => current.requestId === draft.turnId
          ? { ...current, state: 'waitingFinal', speechStoppedMs }
          : current);
        break;
      }
      case 'user_transcript_delta': {
        const draft = persistentCurrentTurnRef.current;
        if (!draft.turnId || isAiSpeakingRef.current) {
          if (isAiSpeakingRef.current) {
            ignoredAiPlaybackRef.current += 1;
            setIgnoredAiPlayback(ignoredAiPlaybackRef.current);
          }
          return;
        }
        const firstDeltaMs = elapsedSince(draft.turnStartedAt) ?? elapsedMs;
        draft.firstDeltaMs = draft.firstDeltaMs ?? firstDeltaMs;
        draft.partialText = `${draft.partialText}${event.text}`;
        setRealtimeRoastTurn((current) => current.requestId === draft.turnId
          ? { ...current, firstDeltaMs: current.firstDeltaMs ?? firstDeltaMs }
          : current);
        break;
      }
      case 'user_transcript_final':
      case 'user_transcript_done': {
        const draft = persistentCurrentTurnRef.current;
        const turnId = draft.turnId;
        if (!turnId) return;
        if (isAiSpeakingRef.current || persistentCallStateRef.current !== 'listening') {
          const ignoredType = isAiSpeakingRef.current ? 'ignored_ai_playback' : 'ignored_while_busy';
          if (isAiSpeakingRef.current) {
            ignoredAiPlaybackRef.current += 1;
            setIgnoredAiPlayback(ignoredAiPlaybackRef.current);
          } else {
            ignoredWhileBusyRef.current += 1;
            setIgnoredWhileBusy(ignoredWhileBusyRef.current);
          }
          logRealtimeRoastTurn({ eventType: ignoredType, requestId: turnId, sourceEventType: event.type, elapsedMs });
          return;
        }
        setPersistentCallState('processing');
        setPersistentTurnState('responding');
        realtimeRoastTurnStateRef.current = 'thinking';
        const asrFinalMs = elapsedSince(draft.turnStartedAt) ?? elapsedMs;
        logLatencyTrace('app_asr_transcript_completed', {
          turnId,
          elapsedMs: asrFinalMs,
          textLength: event.text.length,
          transport: ROAST_PERSISTENT_TURN_TRANSPORT,
          status: 'ok',
        });
        setRealtimeRoastTurn((current) => {
          if (current.requestId !== turnId) return current;
          return {
            ...current,
            state: 'thinking',
            asrFinalMs,
            asrRawText: event.text,
            firstDeltaMs: current.firstDeltaMs ?? draft.firstDeltaMs,
            speechStoppedMs: current.speechStoppedMs ?? draft.speechStoppedMs,
            stoppedToFinalMs: safeDiff(asrFinalMs, draft.speechStoppedMs),
          };
        });
        void runRealtimeRoastTurnFromFinal(turnId, event.text);
        persistentCurrentTurnRef.current = { turnId: null, partialText: '' };
        break;
      }
      case 'error':
        setPersistentCallState('error');
        setPersistentTurnState('error');
        setError(event.message);
        break;
      case 'disconnected':
        if (persistentCallStateRef.current !== 'ended') {
          setPersistentCallState('ended');
          setPersistentTurnState('none');
        }
        break;
      default:
        break;
    }
  }

  function ensurePersistentTurnWs(sessionId: string, localRunId: string) {
    if (persistentTurnWsRef.current) return;
    persistentTurnWsReadyRef.current = false;
    persistentTurnWsReadyMsRef.current = null;
    persistentTurnWsConnectedAtMsRef.current = Math.round(now() - (persistentCallStartedAtRef.current ?? now()));
    try {
      const wsClient = connectRoastTurnWs({
        accessToken: appSession.session?.accessToken ?? null,
        sessionId,
      });
      persistentTurnWsRef.current = wsClient;
      logRealtimeRoastTurn({
        eventType: 'turn_stream_ws_v4_connect_start',
        requestId: sessionId,
        elapsedMs: persistentTurnWsConnectedAtMsRef.current,
        transport: 'ws_v4',
      });
      void wsClient.readyPromise.then(() => {
        if (!isActiveCallRun(localRunId, sessionId) || persistentTurnWsRef.current !== wsClient) {
          logCallLifecycleGuard({
            phase: 'abort_after_ws_ready',
            action: 'abort',
            localRunId,
            requestId: sessionId,
            reason: 'stale_ws_ready',
          });
          if (persistentTurnWsRef.current === wsClient) {
            persistentTurnWsRef.current = null;
            wsClient.close();
          }
          return;
        }
        const readyMs = Math.round(now() - (persistentCallStartedAtRef.current ?? now()));
        persistentTurnWsReadyRef.current = true;
        persistentTurnWsReadyMsRef.current = readyMs;
        logRealtimeRoastTurn({
          eventType: 'turn_stream_ws_v4_ready',
          requestId: sessionId,
          wsConnectedAtMs: persistentTurnWsConnectedAtMsRef.current,
          wsReadyMs: readyMs,
          transport: 'ws_v4',
        });
        void warmupRoastTtsProvider({ reason: 'ws_ready', sessionId, localRunId });
      }).catch((caught) => {
        if (!isActiveCallRun(localRunId, sessionId) || persistentTurnWsRef.current !== wsClient) return;
        persistentTurnWsReadyRef.current = false;
        persistentTurnWsReadyMsRef.current = null;
        const message = caught instanceof Error ? caught.message : 'Roast WebSocket failed.';
        console.log('[ROAST_WS_CLIENT]', JSON.stringify({
          eventType: 'fallback_to_v3',
          reason: 'ws_connect_failed',
          message,
          requestId: sessionId,
        }));
        logRealtimeRoastTurn({
          eventType: 'turn_stream_ws_v4_connect_failed',
          requestId: sessionId,
          elapsedMs: Math.round(now() - (persistentCallStartedAtRef.current ?? now())),
          error: message,
          transport: 'ndjson_v3',
        });
      });
    } catch (caught) {
      persistentTurnWsRef.current = null;
      persistentTurnWsReadyRef.current = false;
      persistentTurnWsReadyMsRef.current = null;
      console.log('[ROAST_WS_CLIENT]', JSON.stringify({
        eventType: 'fallback_to_v3',
        reason: 'ws_connect_throw',
        message: caught instanceof Error ? caught.message : 'unknown',
        requestId: sessionId,
      }));
    }
  }

  async function startPersistentCall() {
    const currentCallState = persistentCallStateRef.current;
    const hasActiveSession = Boolean(persistentAsrRef.current || persistentSessionIdRef.current);
    if (hasActiveSession || (currentCallState !== 'idle' && currentCallState !== 'ended' && currentCallState !== 'error')) {
      logRoastCallGuard('ignored_start_call_when_active', 'call_already_active', {
        requestedState: callState,
        currentCallState,
      });
      setLastSfxStatus('Call already active. Just speak.');
      return;
    }
    const allowed = await guardAiPracticeAccess();
    if (!allowed) {
      setError('Please sign in or add voice practice credits before starting.');
      return;
    }
    if (!appSession.session) {
      setPersistentCallState('error');
      setPersistentTurnState('error');
      setError('Sign in before starting Roast Call.');
      return;
    }

    await stopRoastChunkStreamPlayer();
    await stopRealtimeRoastTurn();
    await stopRealtimeAsrTest({ preserveCompleted: true });
    setError(null);
    clearAssistantReplyCard();
    setTranscript('');
    setChunkStreamState(null);
    setLatestChunkStreamEvent(null);
    setChunkStreamEventCount(0);
    ignoredWhileBusyRef.current = 0;
    ignoredAiPlaybackRef.current = 0;
    setIgnoredWhileBusy(0);
    setIgnoredAiPlayback(0);
    isAiSpeakingRef.current = false;
    aiPlaybackGateUntilRef.current = 0;
    aiPlaybackEchoGuardUntilRef.current = 0;
    lastAiPlaybackTextRef.current = '';

    const sessionId = `call-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const localRunId = `${sessionId}:run-${++callRunSeqRef.current}`;
    const callAbortController = new AbortController();
    activeCallRunIdRef.current = localRunId;
    activeCallAbortControllerRef.current = callAbortController;
    stopRequestedRef.current = false;
    persistentSessionIdRef.current = sessionId;
    setPersistentSessionId(sessionId);
    persistentCallStartedAtRef.current = now();
    persistentCurrentTurnRef.current = { turnId: null, partialText: '' };
    setPersistentCallState('connecting');
    setPersistentTurnState('none');
    logCallLifecycleGuard({
      phase: 'start_run_created',
      action: 'allow',
      localRunId,
      requestId: sessionId,
      reason: 'start_call',
    });
    logRealtimeRoastTurn({ eventType: 'persistent_start_call', requestId: sessionId, elapsedMs: 0 });
    logRoastCallState('start_call_requested', { requestId: sessionId });
    ensurePersistentTurnWs(sessionId, localRunId);

    try {
      const controller = await startRoastRealtimeAsr({
        requestId: sessionId,
        mode: 'verbatim',
        session: appSession.session,
        signal: callAbortController.signal,
        onEvent: handlePersistentAsrEvent,
      });
      if (!isActiveCallRun(localRunId, sessionId)) {
        logCallLifecycleGuard({
          phase: 'abort_after_calls_response',
          action: 'abort',
          localRunId,
          requestId: sessionId,
          reason: 'stale_after_asr_connect',
        });
        await controller.stop().catch(() => undefined);
        return;
      }
      persistentAsrRef.current = controller;
      logCallLifecycleGuard({
        phase: 'abort_after_peer_created',
        action: 'allow',
        localRunId,
        requestId: sessionId,
        reason: 'asr_connected',
      });
      logRoastCallState('call_connected', {
        requestId: sessionId,
        tokenMs: controller.tokenMs,
        connectMs: controller.connectMs,
      });
      logRealtimeRoastTurn({
        eventType: 'persistent_call_connected',
        requestId: sessionId,
        tokenMs: controller.tokenMs,
        connectMs: controller.connectMs,
      });
      void warmupRoastTtsProvider({ reason: 'call_connected', sessionId, localRunId });
      if (!isActiveCallRun(localRunId, sessionId)) {
        logCallLifecycleGuard({
          phase: 'abort_before_greeting',
          action: 'abort',
          localRunId,
          requestId: sessionId,
          reason: 'stale_before_greeting',
        });
        return;
      }
      void playStartCallGreeting(sessionId, localRunId);
    } catch (caught) {
      if (!isActiveCallRun(localRunId, sessionId)) return;
      invalidateActiveCallRun('end_call_invalidate_run', 'call_connect_failed', sessionId);
      const message = caught instanceof Error ? caught.message : 'Persistent Roast Call failed to start.';
      persistentAsrRef.current = null;
      persistentSessionIdRef.current = null;
      setPersistentSessionId(null);
      setPersistentCallState('error');
      setPersistentTurnState('error');
      setError(message);
      logRoastCallState('call_connect_failed', { requestId: sessionId, error: message });
    }
  }

  async function playStartCallGreeting(sessionId: string, localRunId: string) {
    if (!isActiveCallRun(localRunId, sessionId)) {
      logCallLifecycleGuard({
        phase: 'abort_before_greeting',
        action: 'abort',
        localRunId,
        requestId: sessionId,
        reason: 'stale_greeting_start',
      });
      return;
    }
    if (!persistentAsrRef.current || greetingInFlightRef.current) {
      logRoastCallGreeting('greeting_ignored_active_call', {
        callSessionId: sessionId,
        hasActiveSession: Boolean(persistentAsrRef.current),
        greetingInFlight: greetingInFlightRef.current,
      });
      return;
    }
    showAssistantReplyCard(buildSpokenTextPreviewReply(ROAST_CALL_GREETING_TEXT, 'conversation'));

    // Release used to short-circuit greeting before the production
    // greeting-stream endpoint existed. That endpoint now ships and the App
    // call site already picks the right URL (Release → buildRoastGreetingProdUrl,
    // DEV → buildRoastTtsStreamTestUrl), so Release should run the same
    // greeting playback flow as DEV.

    greetingInFlightRef.current = true;
    greetingSessionIdRef.current = sessionId;
    greetingCandidateNativeRequestIdRef.current = null;
    greetingNativeRequestIdRef.current = null;
    greetingPlaybackUrlPathRef.current = null;
    isAiSpeakingRef.current = true;
    markAiPlaybackAsrGate(ROAST_CALL_GREETING_TEXT);
    persistentAsrRef.current?.client?.muteMic?.();
    setPersistentCallState('speaking');
    setPersistentTurnState('greeting');
    logCallLifecycleGuard({
      phase: 'allow_greeting_playback',
      action: 'allow',
      localRunId,
      requestId: sessionId,
      reason: 'greeting_start',
    });
    logRoastCallGreeting('greeting_start', { callSessionId: sessionId });

	    try {
	      const url = __DEV__
        ? buildRoastTtsStreamTestUrl(ROAST_CALL_GREETING_TEXT)
        : buildRoastGreetingProdUrl(ROAST_CALL_GREETING_TEXT);
      const greetingTurnId = `${sessionId}:greeting`;
      greetingPlaybackUrlPathRef.current = safeRoastTestUrlPath(url);
      if (!isActiveCallRun(localRunId, sessionId)) {
        logCallLifecycleGuard({
          phase: 'abort_before_greeting',
          action: 'abort',
          localRunId,
          requestId: sessionId,
          reason: 'stale_before_greeting_tts_request',
        });
        return;
      }
	      logRoastCallGreeting('greeting_tts_request', { callSessionId: sessionId });
      logRoastPlaybackContext({
        source: 'greeting',
        url,
      });
      const greetingTtsNativeOptions = await buildAndLogTurnTtsNativeOptions({
        source: 'greeting',
        turnId: greetingTurnId,
        url,
      });
      if (!isActiveCallRun(localRunId, sessionId)) {
        logCallLifecycleGuard({
          phase: 'abort_before_playback',
          action: 'abort',
          localRunId,
          requestId: sessionId,
          reason: 'stale_before_greeting_playback',
        });
        return;
      }
      greetingCandidateNativeRequestIdRef.current = null;
      greetingNativeRequestIdRef.current = null;
      const playbackEndedPromise = waitForGreetingPlaybackEnded(sessionId);
	      const result = await playRoastChunkStreamUrl(url, now(), greetingTtsNativeOptions ?? undefined);
      if (!isActiveCallRun(localRunId, sessionId)) return;
      const stateSnapshot = result.supported ? await getRoastChunkStreamState() : result.state ?? null;
      bindGreetingNativeRequestId(stateSnapshot?.requestId);
      if (!result.supported) {
        rejectGreetingPlaybackWaiter('greeting_playback_failed');
        await playbackEndedPromise.catch(() => undefined);
        logRoastCallGreeting('greeting_error', {
          callSessionId: sessionId,
          nativeRequestId: stateSnapshot?.requestId ?? null,
          firstNetworkChunkMs: stateSnapshot?.firstNetworkChunkMs ?? null,
          audioQueueStartedMs: stateSnapshot?.audioQueueStartedMs ?? null,
          playbackEndedMs: stateSnapshot?.playbackEndedMs ?? null,
          error: result.reason ?? result.error ?? 'greeting_playback_failed',
        });
        return;
      }
      await playbackEndedPromise;
      if (!isActiveCallRun(localRunId, sessionId)) return;
      const finalStateSnapshot = await getRoastChunkStreamState();
      logRoastCallGreeting('greeting_playback_ended', {
        callSessionId: sessionId,
        nativeRequestId: finalStateSnapshot?.requestId ?? stateSnapshot?.requestId ?? null,
        firstNetworkChunkMs: finalStateSnapshot?.firstNetworkChunkMs ?? stateSnapshot?.firstNetworkChunkMs ?? null,
        audioQueueStartedMs: finalStateSnapshot?.audioQueueStartedMs ?? stateSnapshot?.audioQueueStartedMs ?? null,
        playbackEndedMs: finalStateSnapshot?.playbackEndedMs ?? stateSnapshot?.playbackEndedMs ?? null,
        error: null,
      });
    } catch (caught) {
      if (isActiveCallRun(localRunId, sessionId)) {
        logRoastCallGreeting('greeting_error', {
          callSessionId: sessionId,
          error: caught instanceof Error ? caught.message : 'greeting_failed',
        });
      }
    } finally {
      if (isActiveCallRun(localRunId, sessionId)) {
        console.log('[ROAST_GREETING_RESTORE_LISTENING]', JSON.stringify({
          callSessionId: sessionId,
          nativeRequestId: greetingNativeRequestIdRef.current,
          isMicMuted: persistentAsrRef.current?.client?.isMicMuted ?? null,
          localAudioTrackEnabled: persistentAsrRef.current?.client?.localAudioTrackEnabled ?? null,
        }));
        markAiPlaybackAsrGate(ROAST_CALL_GREETING_TEXT);
        greetingInFlightRef.current = false;
        greetingSessionIdRef.current = null;
        greetingCandidateNativeRequestIdRef.current = null;
        greetingNativeRequestIdRef.current = null;
        greetingPlaybackUrlPathRef.current = null;
        greetingPlaybackWaiterRef.current = null;
        isAiSpeakingRef.current = false;
        persistentAsrRef.current?.client?.unmuteMic?.();
        if (persistentCallStateRef.current !== 'ended') {
          setPersistentCallState('listening');
          setPersistentTurnState('none');
        }
      } else {
        greetingPlaybackWaiterRef.current = null;
        greetingCandidateNativeRequestIdRef.current = null;
        greetingNativeRequestIdRef.current = null;
        greetingPlaybackUrlPathRef.current = null;
      }
    }
  }

  async function stopAiPlaybackOnly() {
    if (realtimeRoastTurnActiveRequestIdRef.current) {
      persistentActiveTurnAbortRef.current?.();
      persistentTurnWsRef.current?.cancelTurn(realtimeRoastTurnActiveRequestIdRef.current);
      persistentActiveTurnAbortRef.current = null;
    }
    await stopRoastChunkStreamPlayer();
    rejectGreetingPlaybackWaiter('greeting_playback_stopped');
    const stoppedGreeting = greetingInFlightRef.current;
    if (stoppedGreeting) {
      logRoastCallGreeting('greeting_stopped', {
        callSessionId: greetingSessionIdRef.current,
      });
      greetingInFlightRef.current = false;
      greetingSessionIdRef.current = null;
      greetingCandidateNativeRequestIdRef.current = null;
      greetingNativeRequestIdRef.current = null;
      greetingPlaybackUrlPathRef.current = null;
    }
    markAiPlaybackAsrGate(lastAiPlaybackTextRef.current || (stoppedGreeting ? ROAST_CALL_GREETING_TEXT : null));
    isAiSpeakingRef.current = false;
    realtimeRoastTurnAsrRef.current?.client?.unmuteMic?.();
    persistentAsrRef.current?.client?.unmuteMic?.();
    if (persistentAsrRef.current && persistentCallStateRef.current !== 'ended') {
      setPersistentCallState('listening');
      setPersistentTurnState('none');
    }
    realtimeRoastTurnStateRef.current = 'stopped';
    setRealtimeRoastTurn((current) => {
      const next: RealtimeRoastTurnState = { ...current, state: current.state === 'idle' ? 'idle' : 'stopped' };
      if (current.requestId) {
        appendRoastTurnHistory(buildTurnHistory(next, 'stopped'));
      }
      return next;
    });
    logNativeEventBinding({
      eventType: 'manual_stop',
      nativeRequestId: realtimeRoastTurnNativeStreamRequestIdRef.current,
      activeTurnId: realtimeRoastTurnActiveRequestIdRef.current,
      activeNativeRequestId: realtimeRoastTurnNativeStreamRequestIdRef.current,
      turnState: 'stopped',
      callState: persistentCallStateRef.current,
      action: 'mark_stopped',
      reason: 'user_stop_ai',
    });
    logRealtimeRoastTurn({ eventType: 'stop_ai', requestId: realtimeRoastTurnActiveRequestIdRef.current, sessionId: persistentSessionIdRef.current });
    logRoastCallState('stop_ai');
  }

  async function endPersistentCall(options: Partial<RoastEndCallOptions> = {}) {
    const sessionId = persistentSessionIdRef.current;
    const requestId = options.requestId ?? sessionId;
    const expectedSessionId = options.expectedSessionId;
    const explicit = options.explicit === true;
    const reason = options.reason ?? (explicit ? 'explicit_user_end' : 'unknown');
    const source = options.source ?? (explicit ? 'user' : 'unknown');
    const stackHint = options.stackHint ?? 'endPersistentCall';
    const expectedSessionMismatch = expectedSessionId != null && expectedSessionId !== sessionId;
    const lifecycleCleanup = source === 'useEffect_cleanup' || source === 'app_state' || reason === 'effect_cleanup' || reason === 'app_state_inactive';
    const nonExplicitConnectingStop = !explicit && !lifecycleCleanup && persistentCallStateRef.current === 'connecting' && Boolean(sessionId);
    const shouldActuallyEnd = Boolean(sessionId) && !expectedSessionMismatch && !nonExplicitConnectingStop;

    logRoastEndCallTrace({
      reason,
      source,
      requestId,
      expectedSessionId,
      explicit,
      stackHint,
      shouldActuallyEnd,
      activeSessionId: sessionId,
    });

    if (!shouldActuallyEnd) {
      return;
    }

    invalidateActiveCallRun('end_call_invalidate_run', reason, sessionId);
    persistentSessionIdRef.current = null;
    setPersistentSessionId(null);
    persistentActiveTurnAbortRef.current?.();
    persistentActiveTurnAbortRef.current = null;
    persistentTurnWsRef.current?.close();
    persistentTurnWsRef.current = null;
    persistentTurnWsReadyRef.current = false;
    persistentTurnWsReadyMsRef.current = null;
    persistentTurnWsConnectedAtMsRef.current = null;
    await stopRoastChunkStreamPlayer();
    rejectGreetingPlaybackWaiter('greeting_call_ended');
    greetingInFlightRef.current = false;
    greetingSessionIdRef.current = null;
    greetingCandidateNativeRequestIdRef.current = null;
    greetingNativeRequestIdRef.current = null;
    greetingPlaybackUrlPathRef.current = null;
    isAiSpeakingRef.current = false;
    aiPlaybackGateUntilRef.current = 0;
    aiPlaybackEchoGuardUntilRef.current = 0;
    lastAiPlaybackTextRef.current = '';
    const controller = persistentAsrRef.current;
    persistentAsrRef.current = null;
    if (controller) {
      await controller.stop().catch(() => undefined);
    }
    persistentCurrentTurnRef.current = { turnId: null, partialText: '' };
    realtimeRoastTurnActiveRequestIdRef.current = null;
    setPersistentCallState('ended');
    setPersistentTurnState('none');
    logRealtimeRoastTurn({ eventType: 'persistent_end_call', requestId: sessionId });
    logRoastCallState('end_call', { requestId: sessionId, reason, source });
  }

  stopPersistentCallRef.current = endPersistentCall;

  async function stopRealtimeRoastTurnAsrOnly(requestId?: string) {
    const controller = realtimeRoastTurnAsrRef.current;
    if (requestId && controller?.requestId && controller.requestId !== requestId) return;
    realtimeRoastTurnAsrRef.current = null;
    if (controller) {
      await controller.stop().catch(() => undefined);
    }
  }

  async function stopRealtimeRoastTurn() {
    const requestId = realtimeRoastTurnActiveRequestIdRef.current;
    realtimeRoastTurnActiveRequestIdRef.current = null;
    realtimeRoastTurnNativeStreamRequestIdRef.current = null;
    await stopRealtimeRoastTurnAsrOnly();
    await stopRoastChunkStreamPlayer();
    realtimeRoastTurnStartedAtRef.current = null;
    realtimeRoastTurnStateRef.current = 'stopped';
    setRealtimeRoastTurn((current) => ({
      ...current,
      state: current.state === 'idle' ? 'idle' : 'stopped',
    }));
    if (requestId && isRealtimeRoastTurnRunning(realtimeRoastTurn.state)) {
      appendRoastTurnHistory(buildTurnHistory({ ...realtimeRoastTurn, state: 'stopped' }, 'stopped'));
    }
    logRealtimeRoastTurn({ eventType: 'stop', requestId });
  }

  stopRealtimeRoastTurnRef.current = stopRealtimeRoastTurn;

  async function testRealtimeRoastTurn() {
    if (state === 'recording' || streamTestInFlight || isRealtimeRoastTurnRunning(realtimeRoastTurn.state)) return;
    if (!appSession.session) {
      setRealtimeRoastTurn((current) => ({ ...current, state: 'error', error: 'Sign in before testing Realtime Roast Turn.' }));
      return;
    }

    await stopRealtimeRoastTurn();
    await stopRoastChunkStreamPlayer();
    await stopRealtimeAsrTest({ preserveCompleted: true });
    setError(null);
    clearAssistantReplyCard();
    setTranscript('');
    setChunkStreamState(null);
    setLatestChunkStreamEvent(null);
    setChunkStreamEventCount(0);
    setChunkStreamStatus(null);

    const requestId = createRealtimeRoastTurnRequestId();
    const t0 = now();
    realtimeRoastTurnActiveRequestIdRef.current = requestId;
    realtimeRoastTurnStartedAtRef.current = t0;
    realtimeRoastTurnNativeStreamRequestIdRef.current = null;
    realtimeRoastTurnStateRef.current = 'connectingAsr';
    setRealtimeRoastTurn({
      state: 'connectingAsr',
      requestId,
      nativeStreamRequestId: null,
      asrRawText: '',
      eventCount: 0,
      t0,
      asrQualityOk: null,
      asrQualityReason: null,
      enteredTurnStream: false,
      enteredAudioQueue: false,
      reply: null,
      remoteTrackPresent: false,
      unexpectedVoice: false,
      staleEventCount: 0,
      error: null,
    });
    logRealtimeRoastTurn({ eventType: 'test_start', requestId, elapsedMs: 0 });

    try {
      const controller = await startRoastRealtimeAsr({
        requestId,
        mode: 'verbatim',
        session: appSession.session,
        onEvent: handleRealtimeRoastTurnAsrEvent,
      });
      if (realtimeRoastTurnActiveRequestIdRef.current !== requestId) {
        await controller.stop().catch(() => undefined);
        return;
      }
      realtimeRoastTurnAsrRef.current = controller;
    } catch (caught) {
      if (realtimeRoastTurnActiveRequestIdRef.current !== requestId) return;
      const message = caught instanceof Error ? caught.message : 'Realtime Roast Turn failed to start.';
      realtimeRoastTurnStateRef.current = 'error';
      setRealtimeRoastTurn((current) => current.requestId === requestId ? { ...current, state: 'error', error: message } : current);
      setError(message);
    }
  }

  async function testChunkStreamError() {
    if (state === 'recording' || streamTestInFlight) return;
    setError(null);
    setStreamTestInFlight(true);
    setChunkStreamState(null);
    setLatestChunkStreamEvent(null);
    setChunkStreamEventCount(0);
    setChunkStreamStatus('chunk error test loading...');
    try {
      const badUrl = buildRoastTtsStreamTestUrl().replace('/tts-stream-test?', '/tts-stream-test-missing?');
      const result = await playRoastChunkStreamUrl(badUrl, now());
      const currentState = result.supported ? await getRoastChunkStreamState() : null;
      setChunkStreamState(currentState ?? result.state ?? null);
      setChunkStreamStatus(
        result.supported
          ? 'chunk error test unexpectedly played'
          : `chunk error handled · ${result.reason ?? result.error ?? 'unknown'}`,
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Chunk stream error test failed.';
      setChunkStreamStatus(`chunk error handled · ${message}`);
    } finally {
      setStreamTestInFlight(false);
    }
  }

  async function testHlsVoice() {
    if (state === 'recording' || streamTestInFlight) return;
    const t0 = now();
    setError(null);
    setStreamTestInFlight(true);
    setStreamTestStatus('loading HLS playlist...');
    try {
      const url = buildRoastTtsHlsTestUrl();
      console.log('[ROAST_HLS_TEST] click', JSON.stringify({ textLength: ROAST_STREAM_TEST_TEXT.length }));
      const result = isRoastNativeStreamPlayerAvailable()
        ? await playRoastNativeStreamUrl(url, t0)
        : await playRoastRemoteStreamUrl(url, t0);
      console.log('[ROAST_HLS_TEST] result', JSON.stringify({
        supported: result.supported,
        reason: result.reason ?? null,
        error: result.error ?? null,
        clickToPlayEventMs: 't3FirstPlaybackEvent' in result && result.t3FirstPlaybackEvent ? Math.round(result.t3FirstPlaybackEvent - t0) : null,
        nativePlayingMs: 'clickToNativePlayingMs' in result ? result.clickToNativePlayingMs : null,
        playerReadyMs: 'playerReadyMs' in result ? result.playerReadyMs ?? null : null,
      }));
      setStreamTestStatus(
        result.supported
          ? `hls playing · ${'clickToNativePlayingMs' in result && typeof result.clickToNativePlayingMs === 'number'
            ? result.clickToNativePlayingMs
            : 'firstPlaybackEventMs' in result
              ? result.firstPlaybackEventMs ?? '--'
              : '--'}ms`
          : `hls failed · ${result.reason ?? result.error ?? 'unknown'}`,
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'HLS voice test failed.';
      setStreamTestStatus(`hls failed · ${message}`);
      setError(message);
    } finally {
      setStreamTestInFlight(false);
    }
  }

  const busy = state === 'transcribing' || state === 'thinking' || state === 'speaking' || callState === 'processing' || callState === 'speaking';
  const realtimeAsrRunning = isRealtimeAsrRunning(realtimeAsr.status);
  const realtimeRoastTurnRunning = isRealtimeRoastTurnRunning(realtimeRoastTurn.state);
  const persistentCallRunning = callState === 'connecting' || callState === 'listening' || callState === 'processing' || callState === 'speaking' || callState === 'paused';
  const canStartPersistentCall = !streamTestInFlight && (callState === 'idle' || callState === 'ended' || callState === 'error') && !persistentAsrRef.current && !persistentSessionId;
  const debugStatusLabel = __DEV__ ? debugTransportStatusLabel(streamTestInFlight, state, chunkStreamStatus || streamTestStatus) : null;
  const debugStatusSubLabel = __DEV__ ? debugTransportSubLabel(streamTestInFlight, chunkStreamStatus || streamTestStatus) : null;
  const mainStatusLabel = debugStatusLabel ?? persistentCallStatusLabel(callState, turnState);
  const mainStatusSubLabel = debugStatusSubLabel ?? (lastSfxStatus ?? persistentCallSubLabel(callState, turnState));
  const orbState = roastCallOrbState(state, callState, turnState);
  const isGreetingReply = reply?.spokenText === ROAST_CALL_GREETING_TEXT && reply.correction.hasCorrection === false;
  const replyTranslationEntry = reply?.spokenText ? getTranslationEntry(reply.spokenText, null) : undefined;
  const replyTranslationZh = replyTranslationEntry?.status === 'success' ? replyTranslationEntry.translationZh ?? '' : '';
  const replyTranslationMessage = replyTranslationEntry?.status === 'loading'
    ? '翻译中...'
    : replyTranslationEntry?.status === 'error'
      ? replyTranslationEntry.error ?? '翻译暂时不可用，稍后再试。'
      : '';
  const isTabletLayout = windowWidth >= 768;
  const isLandscape = windowWidth > windowHeight;
  const contentMaxWidth = isTabletLayout
    ? isLandscape
      ? ROAST_CALL_TABLET_LANDSCAPE_MAX_WIDTH
      : ROAST_CALL_TABLET_PORTRAIT_MAX_WIDTH
    : undefined;
  const contentFrameStyle = { width: '100%' as const, ...(contentMaxWidth ? { maxWidth: contentMaxWidth } : null) };
  const tabletCallPaneStyle = {
    flex: isLandscape ? 0.47 : 0.44,
    maxWidth: isLandscape ? 580 : 540,
  };
  const tabletFeedbackPaneStyle = {
    flex: isLandscape ? 0.53 : 0.56,
    maxWidth: isLandscape ? 760 : 720,
  };
  const orbSize = isTabletLayout ? (isLandscape ? 312 : 304) : 244;
  const controlsBottomPadding = Math.max(
    ROAST_CALL_CONTROLS_MIN_BOTTOM_PADDING,
    safeAreaInsets.bottom + ROAST_CALL_CONTROLS_SAFE_AREA_EXTRA,
  );
  const scrollBottomPadding =
    ROAST_CALL_CONTROLS_PADDING_TOP +
    ROAST_CALL_PRIMARY_BUTTON_HEIGHT +
    ROAST_CALL_CONTROLS_GAP +
    ROAST_CALL_SECONDARY_BUTTON_MIN_HEIGHT +
    controlsBottomPadding +
    ROAST_CALL_SCROLL_BOTTOM_BREATHING_ROOM;
  const feedbackIsEmpty = !transcript && !reply && roastTurns.length === 0 && !error;

  if (isTabletLayout) {
    return (
      <View style={styles.root}>
        <View
          style={[
            styles.tabletPage,
            {
              paddingTop: Math.max(safeAreaInsets.top + 18, 38),
              paddingBottom: Math.max(safeAreaInsets.bottom + 18, 28),
            },
          ]}
        >
          <View style={styles.tabletHeader}>
            <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.iconButton}>
              <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
            </Pressable>
            <View style={styles.titleWrap}>
              <AppText style={styles.title}>LA Bro Voice Coach</AppText>
              <AppText style={styles.subtitle}>Street talk · Quick fixes</AppText>
            </View>
            <Pressable accessibilityRole="button" onPress={() => { void endPersistentCall({ reason: 'explicit_user_end', source: 'header_stop_button', requestId: persistentSessionIdRef.current, expectedSessionId: persistentSessionIdRef.current, explicit: true, stackHint: 'tablet_header_stop_press' }); void stopRoastAudioQueue(); void stopRoastChunkStreamPlayer(); void stopRealtimeRoastTurn(); }} style={styles.iconButton}>
              <Ionicons name="stop" size={20} color="#FFFFFF" />
            </Pressable>
          </View>

          <View style={styles.tabletColumns}>
            <View style={[styles.tabletCallPane, tabletCallPaneStyle]}>
              <View style={styles.tabletOrbArea}>
                <RoastCallOrb
                  state={orbState}
                  isAiSpeaking={orbState === 'speaking'}
                  isListening={orbState === 'listening'}
                  intensity={busy ? 0.65 : 0.28}
                  size={orbSize}
                />
                <AppText style={styles.status}>{mainStatusLabel}</AppText>
                <AppText style={styles.statusSub}>{mainStatusSubLabel}</AppText>
              </View>

              <View style={styles.tabletControlsCard}>
                <Pressable
                  accessibilityRole="button"
                  disabled={streamTestInFlight}
                  onPress={() => void startPersistentCall()}
                  style={({ pressed }) => [
                    styles.talkButton,
                    styles.startButton,
                    !canStartPersistentCall && styles.disabledButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Ionicons name={canStartPersistentCall ? 'call' : 'radio'} size={20} color="#FFFFFF" />
                  <AppText style={styles.talkButtonText}>
                    {streamTestInFlight && __DEV__ ? 'Debug Test Running' : persistentCallButtonLabel(callState)}
                  </AppText>
                </Pressable>
                <View style={styles.configRow}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={callState !== 'speaking'}
                    onPress={() => void stopAiPlaybackOnly()}
                    style={({ pressed }) => [styles.configButton, callState !== 'speaking' && styles.disabledButton, pressed && styles.pressed]}
                  >
                    <AppText style={styles.configButtonText}>Stop AI</AppText>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={!persistentCallRunning && callState !== 'error'}
                    onPress={() => { void endPersistentCall({ reason: 'explicit_user_end', source: 'end_call_button', requestId: persistentSessionIdRef.current, expectedSessionId: persistentSessionIdRef.current, explicit: true, stackHint: 'tablet_end_call_press' }); }}
                    style={({ pressed }) => [styles.configButton, pressed && styles.pressed]}
                  >
                    <AppText style={styles.configButtonText}>End Call</AppText>
                  </Pressable>
                </View>
              </View>
            </View>

            <ScrollView style={[styles.tabletFeedbackPane, tabletFeedbackPaneStyle]} contentContainerStyle={styles.tabletFeedbackContent} showsVerticalScrollIndicator={false}>
              {feedbackIsEmpty ? (
                <View style={styles.feedbackEmptyCard}>
                  <AppText style={styles.panelLabel}>AI FEEDBACK</AppText>
                  <AppText style={styles.feedbackEmptyTitle}>Start a call to get your transcript, street-style corrections, and quick fixes.</AppText>
                  <AppText style={styles.feedbackEmptySubtitle}>开始通话后，这里会显示你的原文、街头口语纠错和表达优化。</AppText>
                </View>
              ) : null}

              {transcript ? (
                <View style={styles.transcriptPanel}>
                  <View style={styles.panelHeaderRow}>
                    <AppText style={styles.panelLabel}>YOU SAID</AppText>
                    <AppText style={styles.languagePill}>{detectRoastTranscriptLanguage(transcript)}</AppText>
                  </View>
                  <AppText style={styles.panelText}>{transcript}</AppText>
                  {realtimeRoastTurn.asrQualityOk === false ? (
                    <AppText style={styles.asrHint}>
                      {isLanguageMisrecognitionReason(realtimeRoastTurn.asrQualityReason)
                        ? "I might've misheard the language. Try English again, or ask in Chinese."
                        : '可能识别不准，换一句再说也可以。'}
                    </AppText>
                  ) : null}
                </View>
              ) : null}

              {reply ? (
                <View style={styles.replyCard}>
                  <View style={styles.replyMetaRow}>
                    <AppText style={styles.replyPill}>{roastModeLabel(reply.mode)}</AppText>
                    <AppText style={styles.replyMeta}>{isGreetingReply ? 'Greeting' : `${roastReactionLabel(reply.reaction)} · ${roastNextActionLabel(reply.nextAction)}`}</AppText>
                  </View>
                  <AppText style={styles.spoken}>{reply.spokenText}</AppText>
                  {reply.spokenText ? (
                    <>
                      <Pressable accessibilityRole="button" onPress={toggleReplyTranslation} style={({ pressed }) => [styles.translateButton, pressed && styles.pressed]}>
                        <Ionicons name={replyTranslationOpen ? 'chevron-up' : 'language-outline'} size={14} color="#FFD1A8" />
                        <AppText style={styles.translateButtonText}>
                          {replyTranslationOpen ? (replyTranslationEntry?.status === 'loading' ? '翻译中...' : '收起翻译') : '翻译'}
                        </AppText>
                      </Pressable>
                      {replyTranslationOpen ? <AppText style={styles.translationText}>{replyTranslationZh}</AppText> : null}
                      {replyTranslationOpen && !replyTranslationZh && replyTranslationMessage ? <AppText style={styles.translationText}>{replyTranslationMessage}</AppText> : null}
                    </>
                  ) : null}
                  {reply.nextPrompt ? <AppText style={styles.reason}>{reply.nextPrompt}</AppText> : null}
                  {reply.correction.hasCorrection ?? Boolean(reply.correction.wrong || reply.correction.right) ? (
                    <View style={styles.quickFixBox}>
                      <View style={styles.quickFixHeader}>
                        <AppText style={styles.quickFixTitle}>Quick Fix</AppText>
                        {reply.mode === 'mixed' ? <AppText style={styles.quickFixHint}>side note</AppText> : null}
                      </View>
                      {reply.correction.right ? (
                        <AppText style={styles.quickFixBetter}>Say it like this: {reply.correction.right}</AppText>
                      ) : null}
                      {reply.correction.wrong ? (
                        <AppText style={styles.quickFixWrong}>Instead of: {reply.correction.wrong}</AppText>
                      ) : null}
                      {reply.correction.reason ? (
                        <AppText style={styles.quickFixWhy}>Why: {reply.correction.reason}</AppText>
                      ) : null}
                    </View>
                  ) : isGreetingReply ? null : (
                    <AppText style={styles.noFixText}>No major fix — keep talking.</AppText>
                  )}
                </View>
              ) : null}

              {roastTurns.length > 0 ? (
                <View style={styles.recentPanel}>
                  <AppText style={styles.panelLabel}>Recent Turns</AppText>
                  {roastTurns.slice(0, 3).map((turn) => (
                    <View key={turn.id} style={styles.turnHistoryItem}>
                      <View style={styles.turnHistoryHeader}>
                        <AppText style={styles.turnHistoryMode}>{roastModeLabel(turn.mode)}</AppText>
                        {turn.correction.hasCorrection ? <AppText style={styles.fixedPill}>Fixed</AppText> : null}
                      </View>
                      <AppText style={styles.turnUserText}>{turn.asrRawText || '--'}</AppText>
                      {turn.spokenText ? <AppText style={styles.turnAiText}>{turn.spokenText}</AppText> : null}
                      {turn.spokenText ? (() => {
                        const entry = getTranslationEntry(turn.spokenText, turn.id);
                        const text = entry?.status === 'success' ? entry.translationZh ?? '' : '';
                        const message = entry?.status === 'loading'
                          ? '翻译中...'
                          : entry?.status === 'error'
                            ? entry.error ?? '翻译暂时不可用，稍后再试。'
                            : '';
                        return (
                          <>
                            <Pressable accessibilityRole="button" onPress={() => toggleTurnTranslation(turn)} style={({ pressed }) => [styles.turnTranslateButton, pressed && styles.pressed]}>
                              <AppText style={styles.turnTranslateButtonText}>{turnTranslationOpenById[turn.id] ? (entry?.status === 'loading' ? '翻译中...' : '收起翻译') : '翻译'}</AppText>
                            </Pressable>
                            {turnTranslationOpenById[turn.id] && text ? <AppText style={styles.turnTranslationText}>{text}</AppText> : null}
                            {turnTranslationOpenById[turn.id] && !text && message ? <AppText style={styles.turnTranslationText}>{message}</AppText> : null}
                          </>
                        );
                      })() : null}
                      {turn.status === 'rejected' && turn.nextPrompt ? (
                        <AppText style={styles.turnAiText}>{turn.nextPrompt}</AppText>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : null}

              {error ? <AppText style={styles.error}>{error}</AppText> : null}
              {__DEV__ ? (
                <View style={styles.panel}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setDebugToolsOpen((open) => !open)}
                    style={({ pressed }) => [styles.debugHeader, pressed && styles.pressed]}
                  >
                    <AppText style={styles.panelLabel}>Debug Tools / Advanced</AppText>
                    <Ionicons name={debugToolsOpen ? 'chevron-up' : 'chevron-down'} size={18} color="rgba(255,255,255,0.72)" />
	                  </Pressable>
	                  {debugToolsOpen ? (
	                    <>
	                      <AppText style={styles.debugSectionTitle}>TTS A/B volume</AppText>
	                      <Pressable accessibilityRole="button" disabled={state === 'recording' || streamTestInFlight} onPress={() => void testRoastTtsAbPlayback('normal')} style={({ pressed }) => [styles.testButton, pressed && styles.pressed]}>
	                        <AppText style={styles.testButtonText}>Test normal TTS</AppText>
	                      </Pressable>
	                      <Pressable accessibilityRole="button" disabled={state === 'recording' || streamTestInFlight} onPress={() => void testRoastTtsAbPlayback('louder')} style={({ pressed }) => [styles.testButton, pressed && styles.pressed]}>
	                        <AppText style={styles.testButtonText}>Test louder TTS</AppText>
	                      </Pressable>
	                      <AppText style={styles.chunkDebugText}>Dev diagnostics are available on iPad in development builds.</AppText>
	                    </>
	                  ) : null}
	                </View>
	              ) : null}
            </ScrollView>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={[styles.topBar, contentFrameStyle]}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.iconButton}>
          <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
        </Pressable>
        <View style={styles.titleWrap}>
          <AppText style={styles.title}>LA Bro Voice Coach</AppText>
          <AppText style={styles.subtitle}>Street talk · Quick fixes</AppText>
        </View>
        <Pressable accessibilityRole="button" onPress={() => { void endPersistentCall({ reason: 'explicit_user_end', source: 'header_stop_button', requestId: persistentSessionIdRef.current, expectedSessionId: persistentSessionIdRef.current, explicit: true, stackHint: 'phone_header_stop_press' }); void stopRoastAudioQueue(); void stopRoastChunkStreamPlayer(); void stopRealtimeRoastTurn(); }} style={styles.iconButton}>
          <Ionicons name="stop" size={20} color="#FFFFFF" />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: scrollBottomPadding }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.orbShell, contentFrameStyle]}>
          <RoastCallOrb
            state={orbState}
            isAiSpeaking={orbState === 'speaking'}
            isListening={orbState === 'listening'}
            intensity={busy ? 0.65 : 0.28}
            size={orbSize}
          />
          <AppText style={styles.status}>{mainStatusLabel}</AppText>
          <AppText style={styles.statusSub}>{mainStatusSubLabel}</AppText>
        </View>

        {transcript ? (
          <View style={[styles.transcriptPanel, contentFrameStyle]}>
            <View style={styles.panelHeaderRow}>
              <AppText style={styles.panelLabel}>YOU SAID</AppText>
              <AppText style={styles.languagePill}>{detectRoastTranscriptLanguage(transcript)}</AppText>
            </View>
            <AppText style={styles.panelText}>{transcript}</AppText>
            {realtimeRoastTurn.asrQualityOk === false ? (
              <AppText style={styles.asrHint}>
                {isLanguageMisrecognitionReason(realtimeRoastTurn.asrQualityReason)
                  ? "I might've misheard the language. Try English again, or ask in Chinese."
                  : '可能识别不准，换一句再说也可以。'}
              </AppText>
            ) : null}
          </View>
        ) : null}

        {reply ? (
          <View style={[styles.replyCard, contentFrameStyle]}>
            <View style={styles.replyMetaRow}>
              <AppText style={styles.replyPill}>{roastModeLabel(reply.mode)}</AppText>
              <AppText style={styles.replyMeta}>{isGreetingReply ? 'Greeting' : `${roastReactionLabel(reply.reaction)} · ${roastNextActionLabel(reply.nextAction)}`}</AppText>
            </View>
            <AppText style={styles.spoken}>{reply.spokenText}</AppText>
            {reply.spokenText ? (
              <>
                <Pressable accessibilityRole="button" onPress={toggleReplyTranslation} style={({ pressed }) => [styles.translateButton, pressed && styles.pressed]}>
                  <Ionicons name={replyTranslationOpen ? 'chevron-up' : 'language-outline'} size={14} color="#FFD1A8" />
                  <AppText style={styles.translateButtonText}>
                    {replyTranslationOpen ? (replyTranslationEntry?.status === 'loading' ? '翻译中...' : '收起翻译') : '翻译'}
                  </AppText>
                </Pressable>
                {replyTranslationOpen ? <AppText style={styles.translationText}>{replyTranslationZh}</AppText> : null}
                {replyTranslationOpen && !replyTranslationZh && replyTranslationMessage ? <AppText style={styles.translationText}>{replyTranslationMessage}</AppText> : null}
              </>
            ) : null}
            {reply.nextPrompt ? <AppText style={styles.reason}>{reply.nextPrompt}</AppText> : null}
            {reply.correction.hasCorrection ?? Boolean(reply.correction.wrong || reply.correction.right) ? (
              <View style={styles.quickFixBox}>
                <View style={styles.quickFixHeader}>
                  <AppText style={styles.quickFixTitle}>Quick Fix</AppText>
                  {reply.mode === 'mixed' ? <AppText style={styles.quickFixHint}>side note</AppText> : null}
                </View>
                {reply.correction.right ? (
                  <AppText style={styles.quickFixBetter}>Say it like this: {reply.correction.right}</AppText>
                ) : null}
                {reply.correction.wrong ? (
                  <AppText style={styles.quickFixWrong}>Instead of: {reply.correction.wrong}</AppText>
                ) : null}
                {reply.correction.reason ? (
                  <AppText style={styles.quickFixWhy}>Why: {reply.correction.reason}</AppText>
                ) : null}
              </View>
            ) : isGreetingReply ? null : (
              <AppText style={styles.noFixText}>No major fix — keep talking.</AppText>
            )}
          </View>
        ) : null}

        {roastTurns.length > 0 ? (
          <View style={[styles.recentPanel, contentFrameStyle]}>
            <AppText style={styles.panelLabel}>Recent Turns</AppText>
            {roastTurns.slice(0, 3).map((turn) => (
              <View key={turn.id} style={styles.turnHistoryItem}>
                <View style={styles.turnHistoryHeader}>
                  <AppText style={styles.turnHistoryMode}>{roastModeLabel(turn.mode)}</AppText>
                  {turn.correction.hasCorrection ? <AppText style={styles.fixedPill}>Fixed</AppText> : null}
                </View>
                <AppText style={styles.turnUserText}>{turn.asrRawText || '--'}</AppText>
                {turn.spokenText ? <AppText style={styles.turnAiText}>{turn.spokenText}</AppText> : null}
                {turn.spokenText ? (() => {
                  const entry = getTranslationEntry(turn.spokenText, turn.id);
                  const text = entry?.status === 'success' ? entry.translationZh ?? '' : '';
                  const message = entry?.status === 'loading'
                    ? '翻译中...'
                    : entry?.status === 'error'
                      ? entry.error ?? '翻译暂时不可用，稍后再试。'
                      : '';
                  return (
                    <>
                      <Pressable accessibilityRole="button" onPress={() => toggleTurnTranslation(turn)} style={({ pressed }) => [styles.turnTranslateButton, pressed && styles.pressed]}>
                        <AppText style={styles.turnTranslateButtonText}>{turnTranslationOpenById[turn.id] ? (entry?.status === 'loading' ? '翻译中...' : '收起翻译') : '翻译'}</AppText>
                      </Pressable>
                      {turnTranslationOpenById[turn.id] && text ? <AppText style={styles.turnTranslationText}>{text}</AppText> : null}
                      {turnTranslationOpenById[turn.id] && !text && message ? <AppText style={styles.turnTranslationText}>{message}</AppText> : null}
                    </>
                  );
                })() : null}
                {turn.status === 'rejected' && turn.nextPrompt ? (
                  <AppText style={styles.turnAiText}>{turn.nextPrompt}</AppText>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {error ? <AppText style={[styles.error, contentFrameStyle]}>{error}</AppText> : null}
        {__DEV__ ? (
          <View style={[styles.panel, contentFrameStyle]}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setDebugToolsOpen((open) => !open)}
              style={({ pressed }) => [styles.debugHeader, pressed && styles.pressed]}
            >
              <AppText style={styles.panelLabel}>Debug Tools / Advanced</AppText>
              <Ionicons name={debugToolsOpen ? 'chevron-up' : 'chevron-down'} size={18} color="rgba(255,255,255,0.72)" />
            </Pressable>
            {debugToolsOpen ? (
              <>
                <AppText style={styles.debugSectionTitle}>Recorder config</AppText>
                <View style={styles.configRow}>
                  {(Object.values(SPEAKING_RECORDER_CONFIGS) as Array<typeof selectedRecorderConfig>).map((config) => (
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy || state === 'recording'}
                      key={config.id}
                      onPress={() => setRecordingConfigId(config.id)}
                      style={({ pressed }) => [
                        styles.configButton,
                        config.id === recordingConfigId && styles.configButtonActive,
                        pressed && styles.pressed,
                      ]}
                    >
                      <AppText style={styles.configButtonText}>{config.id.replace('roast_', '').replace('high_quality_', 'high ')}</AppText>
                    </Pressable>
                  ))}
                </View>

                <AppText style={styles.debugSectionTitle}>Streaming tests</AppText>
	                <Pressable accessibilityRole="button" disabled={busy || state === 'recording' || streamTestInFlight} onPress={() => void testChunkStreamVoice()} style={({ pressed }) => [styles.testButton, pressed && styles.pressed]}>
	                  <AppText style={styles.testButtonText}>{streamTestInFlight ? 'Testing Chunk...' : 'Test Chunk Stream Voice'}</AppText>
	                </Pressable>
	                <Pressable accessibilityRole="button" disabled={state === 'recording' || streamTestInFlight} onPress={() => void testRoastTtsAbPlayback('normal')} style={({ pressed }) => [styles.testButton, pressed && styles.pressed]}>
	                  <AppText style={styles.testButtonText}>Test normal TTS</AppText>
	                </Pressable>
	                <Pressable accessibilityRole="button" disabled={state === 'recording' || streamTestInFlight} onPress={() => void testRoastTtsAbPlayback('louder')} style={({ pressed }) => [styles.testButton, pressed && styles.pressed]}>
	                  <AppText style={styles.testButtonText}>Test louder TTS</AppText>
	                </Pressable>
	                <Pressable accessibilityRole="button" disabled={state === 'recording'} onPress={() => void stopChunkStreamTest()} style={({ pressed }) => [styles.testButton, pressed && styles.pressed]}>
	                  <AppText style={styles.testButtonText}>Stop Chunk Stream</AppText>
	                </Pressable>
                <Pressable accessibilityRole="button" disabled={busy || state === 'recording' || streamTestInFlight} onPress={() => void testChunkStreamError()} style={({ pressed }) => [styles.testButton, pressed && styles.pressed]}>
                  <AppText style={styles.testButtonText}>Test Chunk Error</AppText>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={busy || state === 'recording' || streamTestInFlight} onPress={() => void testStreamVoice()} style={({ pressed }) => [styles.testButton, pressed && styles.pressed]}>
                  <AppText style={styles.testButtonText}>{streamTestInFlight ? 'Testing Stream...' : 'Test Stream Voice'}</AppText>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={busy || state === 'recording' || streamTestInFlight} onPress={() => void testHlsVoice()} style={({ pressed }) => [styles.testButton, pressed && styles.pressed]}>
                  <AppText style={styles.testButtonText}>Test HLS Voice</AppText>
                </Pressable>

                <AppText style={styles.debugSectionTitle}>Call pipeline tests</AppText>
                <Pressable accessibilityRole="button" disabled={busy || state === 'recording' || streamTestInFlight} onPress={() => void testTextTurnStream()} style={({ pressed }) => [styles.testButton, pressed && styles.pressed]}>
                  <AppText style={styles.testButtonText}>Test Text Reply Audio</AppText>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={busy || state === 'recording' || streamTestInFlight || realtimeRoastTurnRunning} onPress={() => void testRealtimeRoastTurn()} style={({ pressed }) => [styles.testButton, realtimeRoastTurnRunning && styles.disabledButton, pressed && styles.pressed]}>
                  <AppText style={styles.testButtonText}>{realtimeRoastTurnRunning ? 'Realtime Roast Running' : 'Test Realtime Roast Turn'}</AppText>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={!realtimeRoastTurnRunning} onPress={() => void stopRealtimeRoastTurn()} style={({ pressed }) => [styles.testButton, !realtimeRoastTurnRunning && styles.disabledButton, pressed && styles.pressed]}>
                  <AppText style={styles.testButtonText}>Stop Realtime Roast Turn</AppText>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={busy || state === 'recording'} onPress={() => void testFullTurn()} style={({ pressed }) => [styles.testButton, pressed && styles.pressed]}>
                  <AppText style={styles.testButtonText}>Test Full Roast Turn</AppText>
                </Pressable>

                <AppText style={styles.debugSectionTitle}>ASR tests</AppText>
                <View style={styles.configRow}>
                  {(['default', 'verbatim'] as RoastRealtimeAsrMode[]).map((mode) => (
                    <Pressable
                      accessibilityRole="button"
                      disabled={realtimeAsrRunning}
                      key={mode}
                      onPress={() => setRealtimeAsrMode(mode)}
                      style={({ pressed }) => [
                        styles.configButton,
                        realtimeAsrMode === mode && styles.configButtonActive,
                        realtimeAsrRunning && styles.disabledButton,
                        pressed && styles.pressed,
                      ]}
                    >
                      <AppText style={styles.configButtonText}>ASR {mode}</AppText>
                    </Pressable>
                  ))}
                </View>
                <Pressable accessibilityRole="button" disabled={busy || state === 'recording' || streamTestInFlight || realtimeAsrRunning} onPress={() => void testRealtimeAsr()} style={({ pressed }) => [styles.testButton, realtimeAsrRunning && styles.disabledButton, pressed && styles.pressed]}>
                  <AppText style={styles.testButtonText}>{realtimeAsrRunning ? 'Realtime ASR Running' : 'Test Realtime ASR'}</AppText>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={busy || state === 'recording' || !realtimeAsrRunning} onPress={() => void stopRealtimeAsrTest()} style={({ pressed }) => [styles.testButton, !realtimeAsrRunning && styles.disabledButton, pressed && styles.pressed]}>
                  <AppText style={styles.testButtonText}>Stop Realtime ASR</AppText>
                </Pressable>

                <AppText style={styles.debugSectionTitle}>Performance</AppText>
                <AppText style={styles.chunkDebugText}>recorder: {selectedRecorderConfig.label}</AppText>
                {timingRows.map(([label, value]) => (
                  <View style={styles.timingRow} key={label}>
                    <AppText style={styles.timingLabel}>{label}</AppText>
                    <AppText style={styles.timingValue}>{value}</AppText>
                  </View>
                ))}
                {lastAsrStatus ? <AppText style={styles.streamStatus}>{lastAsrStatus}</AppText> : null}
                {chunkStreamStatus ? <AppText style={styles.streamStatus}>{chunkStreamStatus}</AppText> : null}
                {streamTestStatus ? <AppText style={styles.streamStatus}>{streamTestStatus}</AppText> : null}
                {chunkStreamState ? (
                  <View style={styles.chunkDebugPanel}>
                    <AppText style={styles.chunkDebugText}>status: {chunkStreamState.status ?? '--'} · events: {chunkStreamEventCount}</AppText>
                    <AppText style={styles.chunkDebugText}>first: {chunkStreamState.firstNetworkChunkMs ?? '--'}ms · packet: {chunkStreamState.firstPacketParsedMs ?? '--'}ms · queue: {chunkStreamState.audioQueueStartedMs ?? '--'}ms · ended: {chunkStreamState.playbackEndedMs ?? '--'}ms</AppText>
                    <AppText style={styles.chunkDebugText}>bytes: {chunkStreamState.bytesReceived ?? 0} · packets: {chunkStreamState.packetsQueued ?? 0} · buffers: {chunkStreamState.buffersQueued ?? 0} · inFlight: {chunkStreamState.buffersInFlight ?? 0}</AppText>
                    <AppText style={styles.chunkDebugText}>event: {latestChunkStreamEvent?.type ?? '--'} · error: {chunkStreamState.error ?? '--'}</AppText>
                  </View>
                ) : null}
                <View style={styles.chunkDebugPanel}>
                  <AppText style={styles.chunkDebugText}>Realtime Roast: {realtimeRoastTurn.state} · request: {realtimeRoastTurn.requestId ?? '--'}</AppText>
                  <AppText style={styles.chunkDebugText}>Call: {callState} · turn: {turnState} · session: {persistentSessionId ?? '--'}</AppText>
                  <AppText style={styles.chunkDebugText}>stoppedToFinal: {realtimeRoastTurn.stoppedToFinalMs ?? '--'}ms · finalToTurn: {realtimeRoastTurn.finalToTurnResponseMs ?? '--'}ms</AppText>
                  <AppText style={styles.chunkDebugText}>turnToAudioStart: {realtimeRoastTurn.turnResponseToAudioQueueStartedMs ?? '--'}ms · stoppedToAudioStart: {realtimeRoastTurn.stoppedToAudioQueueStartedMs ?? '--'}ms</AppText>
                  <AppText style={styles.chunkDebugText}>stale: {realtimeRoastTurn.staleEventCount} · busyIgnored: {ignoredWhileBusy} · aiIgnored: {ignoredAiPlayback}</AppText>
                  <AppText style={styles.chunkDebugText}>unexpectedVoice: {realtimeRoastTurn.unexpectedVoice ? 'yes' : 'no'} · ASR mode: verbatim</AppText>
                  <AppText style={styles.chunkDebugText}>reply mode: {realtimeRoastTurn.reply?.mode ?? '--'} · hasCorrection: {realtimeRoastTurn.reply?.correction.hasCorrection ? 'yes' : 'no'}</AppText>
                </View>
                <View style={styles.chunkDebugPanel}>
                  <AppText style={styles.chunkDebugText}>Realtime ASR: {realtimeAsr.status} · mode: {realtimeAsr.asrMode} · request: {realtimeAsr.requestId ?? '--'}</AppText>
                  <AppText style={styles.chunkDebugText}>stop→partial: {realtimeAsr.stoppedToFirstDeltaMs ?? '--'}ms · stop→final: {realtimeAsr.stoppedToFinalMs ?? '--'}ms · unexpected voice: {realtimeAsr.unexpectedVoice ? 'yes' : 'no'}</AppText>
                  <AppText style={styles.chunkDebugText}>final: {realtimeAsr.finalText || '--'} · error: {realtimeAsr.error ?? '--'}</AppText>
                </View>
              </>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.controls, { paddingBottom: controlsBottomPadding }]}>
        <View style={[styles.controlsInner, contentFrameStyle]}>
          <Pressable
            accessibilityRole="button"
            disabled={streamTestInFlight}
            onPress={() => void startPersistentCall()}
            style={({ pressed }) => [
              styles.talkButton,
              styles.startButton,
              !canStartPersistentCall && styles.disabledButton,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name={canStartPersistentCall ? 'call' : 'radio'} size={20} color="#FFFFFF" />
            <AppText style={styles.talkButtonText}>
              {streamTestInFlight && __DEV__ ? 'Debug Test Running' : persistentCallButtonLabel(callState)}
            </AppText>
          </Pressable>
          <View style={styles.configRow}>
            <Pressable
              accessibilityRole="button"
              disabled={callState !== 'speaking'}
              onPress={() => void stopAiPlaybackOnly()}
              style={({ pressed }) => [styles.configButton, callState !== 'speaking' && styles.disabledButton, pressed && styles.pressed]}
            >
              <AppText style={styles.configButtonText}>Stop AI</AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!persistentCallRunning && callState !== 'error'}
              onPress={() => { void endPersistentCall({ reason: 'explicit_user_end', source: 'end_call_button', requestId: persistentSessionIdRef.current, expectedSessionId: persistentSessionIdRef.current, explicit: true, stackHint: 'phone_end_call_press' }); }}
              style={({ pressed }) => [styles.configButton, pressed && styles.pressed]}
            >
              <AppText style={styles.configButtonText}>End Call</AppText>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#02040A' },
  tabletPage: {
    flex: 1,
    paddingHorizontal: 28,
  },
  tabletHeader: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tabletColumns: {
    flex: 1,
    marginTop: 18,
    flexDirection: 'row',
    gap: 24,
    justifyContent: 'center',
  },
  tabletCallPane: {
    flex: 0.42,
    minWidth: 0,
    borderRadius: 30,
    padding: 22,
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.085)',
    justifyContent: 'space-between',
  },
  tabletOrbArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 18,
  },
  tabletControlsCard: {
    gap: ROAST_CALL_CONTROLS_GAP,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  tabletFeedbackPane: {
    flex: 0.58,
    minWidth: 0,
  },
  tabletFeedbackContent: {
    paddingBottom: 8,
  },
  feedbackEmptyCard: {
    borderRadius: 26,
    padding: 22,
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.085)',
  },
  feedbackEmptyTitle: {
    marginTop: 12,
    color: '#FFFFFF',
    fontSize: 20,
    lineHeight: 27,
    fontWeight: '800',
  },
  feedbackEmptySubtitle: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.56)',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  topBar: {
    width: '100%',
    alignSelf: 'center',
    paddingTop: 58,
    paddingHorizontal: 18,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  titleWrap: { alignItems: 'center' },
  title: { fontSize: 18, lineHeight: 23, color: '#FFFFFF', fontWeight: '800' },
  subtitle: { marginTop: 2, fontSize: 12, lineHeight: 16, color: 'rgba(255,255,255,0.55)', fontWeight: '700' },
  content: { paddingHorizontal: 20, paddingBottom: 200, alignItems: 'center' },
  orbShell: { alignItems: 'center', paddingTop: 22, paddingBottom: 28 },
  status: { marginTop: 6, fontSize: 24, lineHeight: 30, color: '#FFFFFF', fontWeight: '900' },
  statusSub: { marginTop: 6, fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.54)', fontWeight: '700' },
  panel: {
    marginTop: 14,
    borderRadius: 22,
    padding: 18,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  transcriptPanel: {
    marginTop: 18,
    borderRadius: 24,
    padding: 18,
    backgroundColor: 'rgba(255,255,255,0.075)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.11)',
    shadowColor: '#000000',
    shadowOpacity: 0.28,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
  },
  recentPanel: {
    marginTop: 16,
    borderRadius: 24,
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.075)',
  },
  panelHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  panelLabel: { fontSize: 11, lineHeight: 15, color: 'rgba(255,255,255,0.48)', fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0 },
  languagePill: {
    overflow: 'hidden',
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.66)',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
  },
  panelText: { marginTop: 10, fontSize: 18, lineHeight: 25, color: '#FFFFFF', fontWeight: '700' },
  asrHint: { marginTop: 10, fontSize: 13, lineHeight: 18, color: 'rgba(255,190,130,0.9)', fontWeight: '700' },
  debugHeader: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  debugSectionTitle: {
    marginTop: 16,
    marginBottom: 8,
    fontSize: 12,
    lineHeight: 16,
    color: 'rgba(255,255,255,0.72)',
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  turnHistoryItem: {
    marginTop: 12,
    borderRadius: 18,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.065)',
  },
  replyCard: {
    marginTop: 16,
    borderRadius: 26,
    padding: 18,
    backgroundColor: 'rgba(24,22,25,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(255,204,155,0.14)',
    shadowColor: '#D16935',
    shadowOpacity: 0.16,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 14 },
  },
  replyMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  replyPill: {
    overflow: 'hidden',
    borderRadius: 13,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(255,160,92,0.16)',
    color: '#FFD1A8',
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '900',
  },
  replyMeta: { fontSize: 12, lineHeight: 16, color: 'rgba(255,255,255,0.48)', fontWeight: '800' },
  spoken: { marginTop: 12, fontSize: 21, lineHeight: 29, color: '#FFFFFF', fontWeight: '800' },
  translateButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
    minHeight: 30,
    borderRadius: 15,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,160,92,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,204,155,0.14)',
  },
  translateButtonText: { color: '#FFD1A8', fontSize: 12, lineHeight: 16, fontWeight: '900' },
  translationText: { marginTop: 8, color: 'rgba(255,255,255,0.70)', fontSize: 14, lineHeight: 21, fontWeight: '700' },
  quickFixBox: {
    marginTop: 12,
    borderRadius: 16,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,204,155,0.10)',
  },
  quickFixHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  quickFixTitle: { fontSize: 11, lineHeight: 15, color: '#FFD1A8', fontWeight: '900', textTransform: 'uppercase' },
  quickFixHint: { fontSize: 11, lineHeight: 15, color: 'rgba(255,255,255,0.38)', fontWeight: '800' },
  quickFixBetter: { marginTop: 7, fontSize: 15, lineHeight: 21, color: '#F7FFE8', fontWeight: '800' },
  quickFixWrong: { marginTop: 4, fontSize: 12, lineHeight: 17, color: 'rgba(255,190,172,0.62)', fontWeight: '700' },
  quickFixWhy: { marginTop: 5, fontSize: 12, lineHeight: 17, color: 'rgba(255,255,255,0.48)', fontWeight: '700' },
  reason: { marginTop: 12, fontSize: 14, lineHeight: 20, color: 'rgba(255,255,255,0.62)', fontWeight: '700' },
  noFixText: { marginTop: 10, fontSize: 12, lineHeight: 17, color: 'rgba(255,255,255,0.42)', fontWeight: '700' },
  turnHistoryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  turnHistoryMode: { fontSize: 11, lineHeight: 15, color: 'rgba(255,209,168,0.68)', fontWeight: '900' },
  fixedPill: {
    overflow: 'hidden',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: 'rgba(255,209,168,0.08)',
    color: 'rgba(255,209,168,0.56)',
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '900',
  },
  turnUserText: { marginTop: 7, fontSize: 14, lineHeight: 20, color: 'rgba(255,255,255,0.82)', fontWeight: '700' },
  turnAiText: { marginTop: 5, fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.48)', fontWeight: '700' },
  turnTranslateButton: {
    marginTop: 7,
    alignSelf: 'flex-start',
    minHeight: 26,
    borderRadius: 13,
    paddingHorizontal: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,209,168,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,209,168,0.10)',
  },
  turnTranslateButtonText: { color: 'rgba(255,209,168,0.74)', fontSize: 11, lineHeight: 14, fontWeight: '900' },
  turnTranslationText: { marginTop: 6, fontSize: 12, lineHeight: 18, color: 'rgba(255,255,255,0.56)', fontWeight: '700' },
  timingRow: { marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  timingLabel: { flex: 1, fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.62)', fontWeight: '700' },
  timingValue: { fontSize: 13, lineHeight: 18, color: '#FFFFFF', fontWeight: '900' },
  error: { marginTop: 14, color: '#FF8A8A', fontSize: 14, lineHeight: 20, fontWeight: '800' },
  streamStatus: { marginTop: 10, color: '#93C5FD', fontSize: 13, lineHeight: 18, fontWeight: '800' },
  chunkDebugPanel: {
    marginTop: 10,
    borderRadius: 14,
    padding: 12,
    backgroundColor: 'rgba(59,130,246,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(147,197,253,0.22)',
  },
  chunkDebugText: { marginTop: 3, color: '#BFDBFE', fontSize: 11, lineHeight: 15, fontWeight: '700' },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: ROAST_CALL_CONTROLS_PADDING_TOP,
    paddingBottom: ROAST_CALL_CONTROLS_MIN_BOTTOM_PADDING,
    gap: ROAST_CALL_CONTROLS_GAP,
    backgroundColor: 'rgba(2,4,10,0.92)',
  },
  controlsInner: {
    width: '100%',
    alignSelf: 'center',
    gap: ROAST_CALL_CONTROLS_GAP,
  },
  talkButton: {
    height: ROAST_CALL_PRIMARY_BUTTON_HEIGHT,
    borderRadius: ROAST_CALL_PRIMARY_BUTTON_HEIGHT / 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  startButton: { backgroundColor: '#0A84FF' },
  stopButton: { backgroundColor: '#EF4444' },
  talkButtonText: { color: '#FFFFFF', fontSize: 17, lineHeight: 22, fontWeight: '900' },
  testButton: {
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  testButtonText: { color: '#FFFFFF', fontSize: 14, lineHeight: 18, fontWeight: '800' },
  disabledButton: { opacity: 0.42 },
  configRow: { flexDirection: 'row', gap: 8 },
  configButton: {
    flex: 1,
    minHeight: ROAST_CALL_SECONDARY_BUTTON_MIN_HEIGHT,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  configButtonActive: {
    backgroundColor: 'rgba(59,130,246,0.34)',
    borderColor: 'rgba(147,197,253,0.55)',
  },
  configButtonText: { color: '#FFFFFF', fontSize: 10, lineHeight: 13, fontWeight: '800', textAlign: 'center' },
  pressed: { opacity: 0.72 },
});
