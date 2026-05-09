import { Platform } from 'react-native';

import type { SpeakingV2TransportEvent } from '@/types/speakingV2';

export interface SpeakingRealtimeClientCapability {
  available: boolean;
  reason: string | null;
}

export interface SpeakingRealtimeClientConnectInput {
  requestId?: string;
  signal?: AbortSignal;
  ephemeralKey: string;
  model?: string;
  voice?: string;
  sessionInstructions?: string;
  inputTranscriptionPrompt?: string;
  inputTranscriptionLanguage?: string | null;
  asrOnly?: boolean;
  vadSilenceDurationMs?: number;
  createCall: (offerSdp: string, signal?: AbortSignal) => Promise<{ answerSdp: string }>;
  onEvent?: (event: SpeakingV2TransportEvent) => void;
}

export interface SpeakingRealtimeResponseRequest {
  instructions?: string;
  metadata?: Record<string, string>;
}

export interface SpeakingRealtimeAudioDetachStatus {
  hasPeerConnection: boolean;
  hasAudioSender: boolean;
  hadLocalAudioTrack: boolean;
  localTrackEnabledBefore: boolean | null;
  localTrackEnabledAfter: boolean | null;
}

export interface SpeakingRealtimeAudioDetachHandle {
  status: SpeakingRealtimeAudioDetachStatus;
  restore: () => Promise<SpeakingRealtimeAudioDetachStatus>;
}

interface ReactNativeWebRtcModule {
  RTCPeerConnection: new (configuration?: Record<string, unknown>) => any;
  RTCSessionDescription: new (init?: { type: 'offer' | 'answer'; sdp: string }) => any;
  mediaDevices: {
    getUserMedia: (constraints: Record<string, unknown>) => Promise<any>;
  };
  registerGlobals?: () => void;
}

let cachedWebRtcModule: ReactNativeWebRtcModule | null | undefined;

const SDP_SUMMARY_PREFIXES = [
  'a=group:BUNDLE',
  'm=audio',
  'a=mid:',
  'a=sendrecv',
  'm=application',
  'a=sctp-port:',
  'a=max-message-size:',
];

const DEFAULT_V2_INPUT_TRANSCRIPTION_PROMPT =
  'The speaker is practicing English in an EchoLingo speaking scenario. Transcribe only the English words the user says. Do not translate. Do not output Chinese, Arabic, or any other language. If the audio is unclear, keep the closest English transcription.';
const DEFAULT_REALTIME_VAD_SILENCE_DURATION_MS = 650;
const ALLOWED_REALTIME_VAD_SILENCE_DURATION_MS = new Set([500, 550, 650]);

function summarizeSdp(sdp: string) {
  const lines = sdp
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    length: sdp.length,
    previewLines: lines.slice(0, 30),
    flags: {
      hasBundle: lines.some((line) => line.startsWith('a=group:BUNDLE')),
      hasAudioMid: lines.some((line) => line === 'm=audio' || line.startsWith('m=audio ')),
      hasMid: lines.some((line) => line.startsWith('a=mid:')),
      hasSendRecv: lines.includes('a=sendrecv'),
      hasApplication: lines.some((line) => line === 'm=application' || line.startsWith('m=application ')),
      hasDataChannel: lines.some((line) => line.includes('webrtc-datachannel')),
    },
    keyLines: lines.filter((line) => SDP_SUMMARY_PREFIXES.some((prefix) => line.startsWith(prefix))),
  };
}

function resolveWebRtcModule(): ReactNativeWebRtcModule | null {
  if (cachedWebRtcModule !== undefined) {
    return cachedWebRtcModule;
  }

  try {
    const module = require('react-native-webrtc') as ReactNativeWebRtcModule;
    module.registerGlobals?.();
    cachedWebRtcModule = module;
    return module;
  } catch {
    cachedWebRtcModule = null;
    return null;
  }
}

function detectRealtimeCapability(): SpeakingRealtimeClientCapability {
  if (Platform.OS === 'web') {
    return {
      available: false,
      reason: '当前设备环境无法启动实时语音通话，请使用移动端应用继续练习。',
    };
  }

  const module = resolveWebRtcModule();
  const hasRtc = typeof module?.RTCPeerConnection === 'function';
  const hasMedia = typeof module?.mediaDevices?.getUserMedia === 'function';

  if (!hasRtc || !hasMedia) {
    return {
      available: false,
      reason: '当前应用环境无法启动实时语音通话，请更新应用后重试。',
    };
  }

  return {
    available: true,
    reason: null,
  };
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

function normalizeRealtimeVadSilenceDurationMs(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return ALLOWED_REALTIME_VAD_SILENCE_DURATION_MS.has(parsed)
    ? parsed
    : DEFAULT_REALTIME_VAD_SILENCE_DURATION_MS;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('Realtime connect aborted.');
    error.name = 'AbortError';
    throw error;
  }
}

function extractConversationItemText(item: Record<string, unknown> | null | undefined): string {
  if (!item) return '';

  const directTranscript = typeof item.transcript === 'string' ? item.transcript.trim() : '';
  if (directTranscript) return directTranscript;

  const directText = typeof item.text === 'string' ? item.text.trim() : '';
  if (directText) return directText;

  const content = Array.isArray(item.content) ? item.content : [];
  const textParts: string[] = [];

  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const record = part as Record<string, unknown>;
    const transcript = typeof record.transcript === 'string' ? record.transcript.trim() : '';
    const text = typeof record.text === 'string' ? record.text.trim() : '';
    const inputText = typeof record.input_text === 'string' ? record.input_text.trim() : '';
    if (transcript) textParts.push(transcript);
    else if (text) textParts.push(text);
    else if (inputText) textParts.push(inputText);
  }

  return textParts.join(' ').trim();
}

function getNestedRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function getContentRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    : [];
}

function extractTranscriptFromRealtimeEvent(event: Record<string, unknown>): string {
  const directTranscript = typeof event.transcript === 'string' ? event.transcript.trim() : '';
  if (directTranscript) return directTranscript;

  const item = getNestedRecord(event.item);
  const itemTranscript = typeof item?.transcript === 'string' ? item.transcript.trim() : '';
  if (itemTranscript) return itemTranscript;

  const eventContentTranscript = getContentRecords(event.content)
    .map((content) => (typeof content.transcript === 'string' ? content.transcript.trim() : ''))
    .find(Boolean);
  if (eventContentTranscript) return eventContentTranscript;

  const itemContentTranscript = getContentRecords(item?.content)
    .map((content) => (typeof content.transcript === 'string' ? content.transcript.trim() : ''))
    .find(Boolean);
  if (itemContentTranscript) return itemContentTranscript;

  return '';
}

function extractResponseOutputText(event: Record<string, unknown>): string {
  const textParts: string[] = [];
  const output = getContentRecords(event.output);
  const response = getNestedRecord(event.response);
  const responseOutput = getContentRecords(response?.output);
  const outputItems = output.length > 0 ? output : responseOutput;

  for (const outputItem of outputItems) {
    const itemText = extractConversationItemText(outputItem);
    if (itemText) {
      textParts.push(itemText);
      continue;
    }
    for (const content of getContentRecords(outputItem.content)) {
      const transcript = typeof content.transcript === 'string' ? content.transcript.trim() : '';
      const text = typeof content.text === 'string' ? content.text.trim() : '';
      if (transcript) textParts.push(transcript);
      else if (text) textParts.push(text);
    }
  }

  return textParts.join(' ').trim();
}

function extractRealtimeResponseId(
  event: Record<string, unknown>,
  fallbackActiveResponseId?: string | null,
): string | null {
  const response = getNestedRecord(event.response);
  const item = getNestedRecord(event.item);
  const output = getNestedRecord(event.output);
  const outputRecords = getContentRecords(event.output);
  const outputResponseId = outputRecords
    .map((record) => (typeof record.response_id === 'string' ? record.response_id : null))
    .find((value): value is string => !!value);
  return (
    (typeof event.response_id === 'string' && event.response_id) ||
    (typeof response?.id === 'string' && response.id) ||
    (typeof item?.response_id === 'string' && item.response_id) ||
    (typeof output?.response_id === 'string' && output.response_id) ||
    outputResponseId ||
    fallbackActiveResponseId ||
    null
  );
}

function extractRealtimeItemId(event: Record<string, unknown>): string {
  const item = getNestedRecord(event.item);
  return (
    (typeof event.item_id === 'string' && event.item_id) ||
    (typeof event.itemId === 'string' && event.itemId) ||
    (typeof item?.id === 'string' && item.id) ||
    `user_${Date.now()}`
  );
}

function getAudioInputRecord(session: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  const audio = getNestedRecord(session?.audio);
  return getNestedRecord(audio?.input);
}

function summarizeSessionAudioInput(session: Record<string, unknown> | null | undefined) {
  const input = getAudioInputRecord(session);
  const transcription = getNestedRecord(input?.transcription);
  const turnDetection = getNestedRecord(input?.turn_detection);
  return {
    hasAudioInput: !!input,
    hasInputTranscription: !!transcription,
    transcriptionModel: typeof transcription?.model === 'string' ? transcription.model : null,
    language: typeof transcription?.language === 'string' ? transcription.language : null,
    returnedLanguage: typeof transcription?.language === 'string' ? transcription.language : null,
    hasTranscriptionPrompt: typeof transcription?.prompt === 'string' && transcription.prompt.trim().length > 0,
    hasTurnDetection: !!turnDetection,
    turnDetectionType: typeof turnDetection?.type === 'string' ? turnDetection.type : null,
    createResponse: typeof turnDetection?.create_response === 'boolean' ? turnDetection.create_response : null,
    interruptResponse: typeof turnDetection?.interrupt_response === 'boolean' ? turnDetection.interrupt_response : null,
  };
}

function previewText(text: string, maxLength = 80): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function isNonFatalRealtimeConfigError(message: string) {
  return (
    message.includes('input_audio_transcription') ||
    message.includes('interrupt_response') ||
    message.includes('session.update') ||
    message.includes("Unknown parameter: 'session.")
  );
}

function summarizeConversationItemContent(
  eventType: string,
  item: Record<string, unknown> | null | undefined,
) {
  const content = Array.isArray(item?.content) ? item.content : [];
  const contentRecords = content.filter((part): part is Record<string, unknown> => !!part && typeof part === 'object');
  const transcriptCandidates: string[] = [];
  const textCandidates: string[] = [];

  for (const record of contentRecords) {
    const transcript = typeof record.transcript === 'string' ? record.transcript : '';
    const text = typeof record.text === 'string' ? record.text : '';
    const inputText = typeof record.input_text === 'string' ? record.input_text : '';
    if (transcript.trim()) transcriptCandidates.push(transcript);
    if (text.trim()) textCandidates.push(text);
    if (inputText.trim()) textCandidates.push(inputText);
  }

  const directTranscript = typeof item?.transcript === 'string' ? item.transcript : '';
  const directText = typeof item?.text === 'string' ? item.text : '';
  if (directTranscript.trim()) transcriptCandidates.unshift(directTranscript);
  if (directText.trim()) textCandidates.unshift(directText);

  return {
    eventType,
    itemRole: typeof item?.role === 'string' ? item.role : null,
    itemStatus: typeof item?.status === 'string' ? item.status : null,
    contentTypes: contentRecords.map((record) => (typeof record.type === 'string' ? record.type : null)),
    contentKeysByIndex: contentRecords.map((record) => Object.keys(record).filter((key) => key !== 'audio')),
    hasTranscript: transcriptCandidates.some((value) => value.trim().length > 0),
    hasText: textCandidates.some((value) => value.trim().length > 0),
    hasAudio: contentRecords.some((record) => 'audio' in record),
    transcriptPreview: previewText(transcriptCandidates.find((value) => value.trim().length > 0) || ''),
    textPreview: previewText(textCandidates.find((value) => value.trim().length > 0) || ''),
  };
}

export class SpeakingRealtimeClient {
  readonly capability: SpeakingRealtimeClientCapability = detectRealtimeCapability();
  private onEvent: ((event: SpeakingV2TransportEvent) => void) | null = null;
  private connected = false;
  private micMuted = false;
  private pc: any = null;
  private dc: any = null;
  private localStream: any = null;
  private remoteStream: any = null;
  private dataChannelReady = false;
  private hasRemoteAudioTrack = false;
  private dataChannelTimeout: ReturnType<typeof setTimeout> | null = null;
  private remoteAudioTimeout: ReturnType<typeof setTimeout> | null = null;
  private sessionConfigured = false;
  private disconnectEmitted = false;
  private audioStartedResponseId: string | null = null;
  private activeResponseId: string | null = null;
  private sessionInstructions = '';
  private sessionVoice: string | null = null;
  private inputTranscriptionPrompt = DEFAULT_V2_INPUT_TRANSCRIPTION_PROMPT;
  private inputTranscriptionLanguage: string | null = 'en';
  private asrOnly = false;
  private vadSilenceDurationMs = DEFAULT_REALTIME_VAD_SILENCE_DURATION_MS;
  private localStreamWarmupPromise: Promise<any> | null = null;

  private logRoastRealtimeConnectAbort(phase: string, requestId?: string | null): void {
    console.log('[ROAST_REALTIME_CONNECT_ABORT]', JSON.stringify({
      phase,
      requestId: requestId ?? null,
      hasPeerConnection: Boolean(this.pc),
      hasDataChannel: Boolean(this.dc),
      localAudioTrackCount: this.localStream?.getAudioTracks?.()?.length ?? 0,
    }));
  }

  async prepareLocalAudio(): Promise<void> {
    if (!this.capability.available) {
      throw new Error(this.capability.reason || '当前构建不支持 realtime transport。');
    }

    if (this.localStream) {
      return;
    }

    if (this.localStreamWarmupPromise) {
      await this.localStreamWarmupPromise;
      return;
    }

    const webRtc = resolveWebRtcModule();
    if (!webRtc?.mediaDevices?.getUserMedia) {
      throw new Error(this.capability.reason || '当前构建缺少 realtime transport 运行时。');
    }

    this.localStreamWarmupPromise = webRtc.mediaDevices
      .getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })
      .then((stream) => {
        this.localStream = stream;
        this.onEvent?.({ type: 'local_audio_ready' });
        console.log('[V2][transport] local-audio:ready');
        return stream;
      })
      .finally(() => {
        this.localStreamWarmupPromise = null;
      });

    await this.localStreamWarmupPromise;
  }

  async connect(input: SpeakingRealtimeClientConnectInput): Promise<void> {
    console.log('[V2][transport] connect:start');
    const abortSignal = input.signal;
    const requestId = input.requestId ?? null;
    const abortListener = () => {
      this.logRoastRealtimeConnectAbort('abort_requested', requestId);
      void this.disconnect().then(() => {
        this.logRoastRealtimeConnectAbort('abort_cleanup_done', requestId);
      });
    };
    abortSignal?.addEventListener?.('abort', abortListener, { once: true });
    if (!input.ephemeralKey?.trim()) {
      throw new Error('缺少 realtime token。');
    }
    if (!this.capability.available) {
      throw new Error(this.capability.reason || '当前构建不支持 realtime transport。');
    }
    const webRtc = resolveWebRtcModule();
    if (!webRtc?.RTCPeerConnection || !webRtc.mediaDevices?.getUserMedia) {
      throw new Error(this.capability.reason || '当前构建缺少 realtime transport 运行时。');
    }

    try {
      throwIfAborted(abortSignal);
      const previousHandler = this.onEvent;
      this.onEvent = null;
      await this.disconnect({ preserveLocalStream: !!this.localStream });
      this.onEvent = input.onEvent || previousHandler || null;
      this.sessionInstructions = input.sessionInstructions?.trim() || '';
      this.inputTranscriptionPrompt = input.inputTranscriptionPrompt?.trim() || DEFAULT_V2_INPUT_TRANSCRIPTION_PROMPT;
      this.inputTranscriptionLanguage = input.inputTranscriptionLanguage === undefined ? 'en' : input.inputTranscriptionLanguage;
      this.asrOnly = input.asrOnly === true;
      this.vadSilenceDurationMs = normalizeRealtimeVadSilenceDurationMs(input.vadSilenceDurationMs);
      if (abortSignal?.aborted) {
        this.logRoastRealtimeConnectAbort('abort_before_peer_create', requestId);
      }
      throwIfAborted(abortSignal);

      const pc = new webRtc.RTCPeerConnection({
      bundlePolicy: 'max-bundle',
      iceTransportPolicy: 'all',
    });
      this.pc = pc;
      if (abortSignal?.aborted) {
        this.logRoastRealtimeConnectAbort('abort_after_peer_create', requestId);
      }
      throwIfAborted(abortSignal);
    console.log('[V2][transport] peer:create');
    this.onEvent?.({ type: 'peer_created' });
    this.connected = false;
    this.dataChannelReady = false;
    this.hasRemoteAudioTrack = false;
    this.sessionConfigured = false;
    this.disconnectEmitted = false;
    this.audioStartedResponseId = null;
    this.activeResponseId = null;
    this.sessionVoice = input.voice?.trim() || null;

    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      const state = pc.connectionState;
      console.log('[V2][transport] peer:state', state);
      console.log(
        `[V1_ULTRA_TRANSPORT_DEBUG] webrtc_connection_state = ${JSON.stringify({
          state,
        })}`,
      );
      if (state === 'connected') {
        this.connected = true;
        this.disconnectEmitted = false;
        this.onEvent?.({ type: 'connected' });
        return;
      }
      if (state === 'failed') {
        this.connected = false;
        this.emitDisconnected();
        return;
      }
      if (state === 'disconnected' || state === 'closed') {
        this.connected = false;
        this.emitDisconnected();
      }
    };

    pc.ontrack = (event: { streams?: any[]; track?: { kind?: string } }) => {
      if (this.pc !== pc) return;
      if (event.track?.kind !== 'audio') {
        return;
      }
      console.log('[V2][transport] remote-audio:track');
      console.log(
        '[V2_AUDIO] remote-track',
        JSON.stringify({
          kind: event.track?.kind ?? 'unknown',
          enabled: (event.track as { enabled?: boolean } | undefined)?.enabled ?? null,
          muted: (event.track as { muted?: boolean } | undefined)?.muted ?? null,
          readyState: (event.track as { readyState?: string } | undefined)?.readyState ?? null,
          streamCount: event.streams?.length ?? 0,
        }),
      );
      console.log(
        `[V1_ULTRA_TRANSPORT_DEBUG] track_received = ${JSON.stringify({
          kind: event.track?.kind ?? 'unknown',
          streamCount: event.streams?.length ?? 0,
        })}`,
      );
      console.log('[V2][transport] v2_remote_audio_track_received');
      this.onEvent?.({ type: 'remote_audio_track_received' });
      this.hasRemoteAudioTrack = true;
      this.clearRemoteAudioTimeout();
      this.remoteStream = event.streams?.[0] ?? this.remoteStream;
    };

    pc.ondatachannel = (event: { channel?: any }) => {
      if (this.pc !== pc) return;
      if (event.channel) {
        this.attachDataChannel(event.channel);
      }
    };

    if (typeof pc.addTransceiver === 'function') {
      pc.addTransceiver('audio', {
        direction: 'sendrecv',
      });
      console.log('[V2_SDP] transceiver:add', 'audio', 'sendrecv');
    }

    const dc = pc.createDataChannel('oai-events', {
      ordered: true,
    });
    console.log('[V2_SDP] data-channel:create', 'oai-events');
    this.attachDataChannel(dc);

    if (abortSignal?.aborted) {
      this.logRoastRealtimeConnectAbort('abort_before_local_audio', requestId);
    }
    throwIfAborted(abortSignal);
    if (!this.localStream) {
      await this.prepareLocalAudio();
    }
    if (abortSignal?.aborted) {
      this.logRoastRealtimeConnectAbort('abort_after_local_audio', requestId);
    }
    throwIfAborted(abortSignal);

    const tracks = this.localStream?.getTracks?.() || [];
    console.log('[V2_SDP] local-tracks', tracks.length);
    for (const track of tracks) {
      pc.addTrack(track, this.localStream);
      console.log('[V2_SDP] track:add', track.kind ?? 'unknown');
      console.log(
        '[V2_AUDIO] local-track',
        JSON.stringify({
          kind: track.kind ?? 'unknown',
          enabled: track.enabled ?? null,
          readyState: track.readyState ?? null,
          muted: track.muted ?? null,
        }),
      );
    }
    if (abortSignal?.aborted) {
      this.logRoastRealtimeConnectAbort('abort_before_offer', requestId);
    }
    throwIfAborted(abortSignal);

    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
    });
    if (abortSignal?.aborted) {
      this.logRoastRealtimeConnectAbort('abort_after_offer', requestId);
    }
    throwIfAborted(abortSignal);
    const offerSummary = summarizeSdp(offer?.sdp || '');
    console.log('[V2_SDP] offer:create', JSON.stringify(offerSummary));
    console.log(
      `[V1_ULTRA_TRANSPORT_DEBUG] webrtc_local_offer_created = ${JSON.stringify({
        length: offer?.sdp?.length ?? 0,
        hasDataChannel: offerSummary.flags.hasDataChannel,
        hasAudioMid: offerSummary.flags.hasAudioMid,
      })}`,
    );
    this.onEvent?.({
      type: 'local_offer_created',
      offerLength: offer?.sdp?.length ?? 0,
    });
    await pc.setLocalDescription(offer);
    if (abortSignal?.aborted) {
      this.logRoastRealtimeConnectAbort('abort_before_calls_request', requestId);
    }
    throwIfAborted(abortSignal);
    const localDescriptionSummary = summarizeSdp(pc.localDescription?.sdp || offer?.sdp || '');
    console.log('[V2][transport] sdp:offer-ready');
    console.log('[V2_SDP] local-description:set', JSON.stringify(localDescriptionSummary));

    this.onEvent?.({
      type: 'calls_started',
      offerLength: offer?.sdp?.length ?? 0,
    });
    const answer = await input.createCall(offer?.sdp || '', abortSignal);
    if (abortSignal?.aborted) {
      this.logRoastRealtimeConnectAbort('abort_after_calls_response', requestId);
    }
    throwIfAborted(abortSignal);
    if (this.pc !== pc) {
      console.log('[V2][transport] sdp:answer-stale-ignored');
      throw new Error('stale_peer_connection');
    }
    this.onEvent?.({
      type: 'calls_completed',
      answerLength: answer.answerSdp.length,
    });
    console.log('[V2][transport] sdp:answer-received');
    if (abortSignal?.aborted) {
      this.logRoastRealtimeConnectAbort('abort_before_remote_description', requestId);
    }
    throwIfAborted(abortSignal);
    await pc.setRemoteDescription(new webRtc.RTCSessionDescription({
      type: 'answer',
      sdp: answer.answerSdp,
    }));
    console.log('[V2][transport] sdp:remote-set');
    console.log(
      `[V1_ULTRA_TRANSPORT_DEBUG] webrtc_remote_answer_set = ${JSON.stringify({
        answerLength: answer.answerSdp.length,
      })}`,
    );
    this.onEvent?.({
      type: 'remote_answer_set',
      answerLength: answer.answerSdp.length,
    });

    this.armDataChannelTimeout();
    } catch (caught) {
      if (abortSignal?.aborted || isAbortError(caught)) {
        await this.disconnect().catch(() => undefined);
        this.logRoastRealtimeConnectAbort('abort_cleanup_done', requestId);
      }
      throw caught;
    } finally {
      abortSignal?.removeEventListener?.('abort', abortListener);
    }
  }

  async disconnect(options?: { preserveLocalStream?: boolean }): Promise<void> {
    console.log('[V2][transport] disconnect:start');
    this.clearDataChannelTimeout();
    this.clearRemoteAudioTimeout();
    if (this.dc) {
      try {
        this.dc.close?.();
      } catch {
        // noop
      }
      this.dc = null;
    }
    if (this.pc) {
      try {
        this.pc.close?.();
      } catch {
        // noop
      }
      this.pc = null;
    }
    if (!options?.preserveLocalStream) {
      const tracks = this.localStream?.getTracks?.() || [];
      for (const track of tracks) {
        try {
          track.stop?.();
        } catch {
          // noop
        }
      }
      this.localStream = null;
    }
    const remoteTracks = this.remoteStream?.getTracks?.() || [];
    for (const track of remoteTracks) {
      try {
        track.stop?.();
      } catch {
        // noop
      }
    }
    this.remoteStream = null;
    this.dataChannelReady = false;
    this.hasRemoteAudioTrack = false;
    this.connected = false;
    this.sessionConfigured = false;
    this.audioStartedResponseId = null;
    this.activeResponseId = null;
    this.sessionVoice = null;
    this.inputTranscriptionPrompt = DEFAULT_V2_INPUT_TRANSCRIPTION_PROMPT;
    this.inputTranscriptionLanguage = 'en';
    this.asrOnly = false;
    this.vadSilenceDurationMs = DEFAULT_REALTIME_VAD_SILENCE_DURATION_MS;
    console.log('[V2][transport] disconnect:done');
    this.emitDisconnected();
  }

  muteMic(): void {
    this.micMuted = true;
    const tracks = this.localStream?.getAudioTracks?.() || [];
    for (const track of tracks) {
      track.enabled = false;
    }
  }

  unmuteMic(): void {
    this.micMuted = false;
    const tracks = this.localStream?.getAudioTracks?.() || [];
    for (const track of tracks) {
      track.enabled = true;
    }
  }

  async detachAudioSenderForTtsExperiment(): Promise<SpeakingRealtimeAudioDetachHandle> {
    const pc = this.pc;
    const tracks = this.localStream?.getAudioTracks?.() || [];
    const localTrack = tracks[0] ?? null;
    const senders = typeof pc?.getSenders === 'function' ? pc.getSenders() : [];
    const sender = senders.find((candidate: any) =>
      candidate?.track === localTrack || candidate?.track?.kind === 'audio',
    ) ?? null;
    const localTrackEnabledBefore = typeof localTrack?.enabled === 'boolean' ? localTrack.enabled : null;

    if (localTrack) {
      localTrack.enabled = false;
    }
    if (sender?.replaceTrack) {
      await sender.replaceTrack(null);
    }

    const status: SpeakingRealtimeAudioDetachStatus = {
      hasPeerConnection: Boolean(pc),
      hasAudioSender: Boolean(sender),
      hadLocalAudioTrack: Boolean(localTrack),
      localTrackEnabledBefore,
      localTrackEnabledAfter: typeof localTrack?.enabled === 'boolean' ? localTrack.enabled : null,
    };

    return {
      status,
      restore: async () => {
        if (sender?.replaceTrack && localTrack) {
          await sender.replaceTrack(localTrack);
        }
        if (localTrack && typeof localTrackEnabledBefore === 'boolean') {
          localTrack.enabled = localTrackEnabledBefore;
        }
        return {
          hasPeerConnection: Boolean(this.pc),
          hasAudioSender: Boolean(sender),
          hadLocalAudioTrack: Boolean(localTrack),
          localTrackEnabledBefore,
          localTrackEnabledAfter: typeof localTrack?.enabled === 'boolean' ? localTrack.enabled : null,
        };
      },
    };
  }

  interrupt(): void {
    if (this.dc?.readyState === 'open') {
      try {
        this.sendDataChannelEvent({
          type: 'response.cancel',
        });
      } catch {
        this.onEvent?.({ type: 'error', message: '发送打断指令失败，请重试。' });
      }
    } else {
      this.onEvent?.({ type: 'error', message: '当前 realtime data channel 尚未建立，无法打断 AI。' });
    }
    this.onEvent?.({ type: 'interrupted' });
  }

  setEventHandler(handler: ((event: SpeakingV2TransportEvent) => void) | null): void {
    this.onEvent = handler;
  }

  updateSession(sessionPatch: Record<string, unknown>): void {
    const audioInput = getAudioInputRecord(sessionPatch);
    const transcription = getNestedRecord(audioInput?.transcription);
    const hasAudioInputTranscription = !!getNestedRecord(audioInput?.transcription);
    const hasLegacyInputAudioTranscription =
      !!sessionPatch.input_audio_transcription && typeof sessionPatch.input_audio_transcription === 'object';
    const hasLegacyModalities = 'modalities' in sessionPatch;
    console.log(
      '[V2][transport] realtime_session_update_payload_sanitized',
      JSON.stringify({
        keys: Object.keys(sessionPatch),
        hasSessionType: typeof sessionPatch.type === 'string',
        hasInstructions: typeof sessionPatch.instructions === 'string' && sessionPatch.instructions.trim().length > 0,
        hasAudio: !!sessionPatch.audio && typeof sessionPatch.audio === 'object',
        hasAudioInputTranscription,
        hasLegacyInputAudioTranscription,
        hasLegacyModalities,
        transcriptionModel: typeof transcription?.model === 'string' ? transcription.model : null,
        language: typeof transcription?.language === 'string' ? transcription.language : null,
        hasPrompt: typeof transcription?.prompt === 'string' && transcription.prompt.trim().length > 0,
      }),
    );
    console.log(
      '[V2][transport] v2_realtime_session_update_schema_version',
      JSON.stringify({
        version: 'audio.input.transcription',
        hasAudioInputTranscription,
        hasLegacyInputAudioTranscription,
        hasLegacyModalities,
      }),
    );
    console.log(
      '[V2][transport] v2_realtime_input_transcription_config',
      JSON.stringify({
        model: typeof transcription?.model === 'string' ? transcription.model : null,
        language: typeof transcription?.language === 'string' ? transcription.language : null,
        hasPrompt: typeof transcription?.prompt === 'string' && transcription.prompt.trim().length > 0,
      }),
    );
    console.log(
      `[V1_ULTRA_REALTIME_DEBUG] session_update_payload = ${JSON.stringify({
        sessionKeys: Object.keys(sessionPatch),
        hasType: typeof sessionPatch.type === 'string',
        hasAudioInputTranscription,
        hasLegacyInputAudioTranscription,
      })}`,
    );
    this.sendDataChannelEvent({
      type: 'session.update',
      session: sessionPatch,
    });
    this.onEvent?.({
      type: 'session_update_sent',
      keys: Object.keys(sessionPatch),
      hasSessionType: typeof sessionPatch.type === 'string',
      hasInstructions: typeof sessionPatch.instructions === 'string' && sessionPatch.instructions.trim().length > 0,
      hasAudio: !!sessionPatch.audio && typeof sessionPatch.audio === 'object',
      hasAudioInputTranscription,
      hasLegacyInputAudioTranscription,
      hasLegacyModalities,
    });
  }

  requestResponse(input?: SpeakingRealtimeResponseRequest): void {
    const response: Record<string, unknown> = {};

    if (input?.instructions?.trim()) {
      response.instructions = input.instructions.trim();
    }

    if (input?.metadata && Object.keys(input.metadata).length > 0) {
      response.metadata = input.metadata;
    }

    const event: Record<string, unknown> = {
      type: 'response.create',
    };

    if (Object.keys(response).length > 0) {
      event.response = response;
    }

    this.sendDataChannelEvent(event);
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get isMicMuted(): boolean {
    return this.micMuted;
  }

  get isDataChannelOpen(): boolean {
    return !!this.dc && this.dc.readyState === 'open' && this.dataChannelReady;
  }

  get localAudioTrackEnabled(): boolean | null {
    const tracks = this.localStream?.getAudioTracks?.() || [];
    if (!tracks.length) return null;
    return tracks.some((track: { enabled?: boolean }) => track.enabled !== false);
  }

  private handleRawEvent(rawData: string): void {
    try {
      const parsed = JSON.parse(rawData) as Record<string, unknown>;
      const type = typeof parsed.type === 'string' ? parsed.type : '';
      if (type) {
        console.log('[V2][transport] dc:event', type);
        console.log('[V2_EVENT] recv', type);
      }

      if (type.includes('transcription')) {
        console.log(
          '[V2][transport] transcription:event',
          JSON.stringify({
            type,
            keys: Object.keys(parsed),
          }),
        );
      }

      if (type === 'session.created' || type === 'session.updated') {
        if (type === 'session.updated') {
          const session = getNestedRecord(parsed.session);
          const summary = summarizeSessionAudioInput(session);
          console.log(
            '[V2][transport] v2_realtime_session_updated_received',
            JSON.stringify({
              sessionKeys: Object.keys(session ?? {}),
            }),
          );
          console.log(
            '[V2][transport] v2_realtime_session_audio_input_summary',
            JSON.stringify(summary),
          );
          console.log(
            '[V2][transport] v2_realtime_turn_detection_session_confirmed',
            JSON.stringify(summary),
          );
          this.onEvent?.({ type: 'session_updated' });
        }
        return;
      }

      if (type === 'input_audio_buffer.speech_started') {
        this.onEvent?.({ type: 'user_speech_started' });
        return;
      }
      if (type === 'input_audio_buffer.speech_stopped') {
        this.onEvent?.({ type: 'user_speech_stopped' });
        return;
      }
      if (type === 'input_audio_buffer.committed') {
        const itemId = typeof parsed.item_id === 'string' ? parsed.item_id : undefined;
        this.onEvent?.({ type: 'user_audio_committed', itemId });
        return;
      }
      if (type === 'conversation.item.input_audio_transcription.delta') {
        const text = typeof parsed.delta === 'string' ? parsed.delta : '';
        this.onEvent?.({ type: 'user_transcript_delta', text });
        return;
      }
      if (type === 'conversation.item.input_audio_transcription.completed') {
        this.handleUserTranscriptDoneEvent(type, parsed);
        return;
      }
      if (type === 'input_audio_transcription.completed') {
        this.handleUserTranscriptDoneEvent(type, parsed);
        return;
      }
      if (
        type === 'conversation.item.input_audio_transcription.failed' ||
        type === 'input_audio_transcription.failed'
      ) {
        console.log(
          '[V2][transport] v2_realtime_user_transcript_failed',
          JSON.stringify({
            type,
            itemId: extractRealtimeItemId(parsed),
            errorKeys: Object.keys(getNestedRecord(parsed.error) ?? {}),
          }),
        );
        return;
      }
      if (type === 'response.created') {
        const response = parsed.response as Record<string, unknown> | undefined;
        const id = extractRealtimeResponseId(parsed);
        if (!id) {
          console.log('[V2][transport] v2_realtime_response_id_extracted', JSON.stringify({
            type,
            responseId: null,
            source: 'response.created',
          }));
          return;
        }
        this.activeResponseId = id;
        console.log('[V2][transport] v2_realtime_response_id_extracted', JSON.stringify({
          type,
          responseId: id,
          source: 'response.created',
        }));
        this.armRemoteAudioTimeout();
        this.audioStartedResponseId = null;
        this.onEvent?.({ type: 'ai_response_created', id });
        return;
      }
      if (type === 'response.output_audio_transcript.delta') {
        const delta = typeof parsed.delta === 'string' ? parsed.delta : '';
        const responseId = extractRealtimeResponseId(parsed, this.activeResponseId);
        console.log('[V2][transport] v2_realtime_response_id_extracted', JSON.stringify({
          type,
          responseId,
          source: 'audio_transcript.delta',
        }));
        if (!responseId) return;
        this.onEvent?.({ type: 'ai_response_delta', id: responseId, text: delta });
        return;
      }
      if (type === 'response.output_audio_transcript.done') {
        const transcript =
          typeof parsed.transcript === 'string'
            ? parsed.transcript
            : typeof parsed.text === 'string'
              ? parsed.text
              : '';
        const responseId = extractRealtimeResponseId(parsed, this.activeResponseId);
        console.log('[V2][transport] v2_realtime_response_id_extracted', JSON.stringify({
          type,
          responseId,
          source: 'audio_transcript.done',
        }));
        if (!responseId) {
          console.log('[V2][transport] v2_realtime_assistant_turn_rejected_missing_response_id', JSON.stringify({
            type,
            textLength: transcript.length,
          }));
          return;
        }
        this.onEvent?.({ type: 'ai_response_transcript_done', id: responseId, text: transcript });
        return;
      }
      if (type === 'response.content_part.done' || type === 'response.output_item.done') {
        const responseId = extractRealtimeResponseId(parsed, this.activeResponseId);
        console.log(
          '[V2][transport] v2_realtime_assistant_turn_ignored_partial',
          JSON.stringify({
            type,
            responseId,
            keys: Object.keys(parsed),
            textLength: extractResponseOutputText(parsed).length,
          }),
        );
        return;
      }
      if (type === 'output_audio_buffer.started') {
        const responseId = typeof parsed.response_id === 'string' ? parsed.response_id : undefined;
        if (responseId && this.audioStartedResponseId !== responseId) {
          this.audioStartedResponseId = responseId;
        }
        this.onEvent?.({ type: 'assistant_audio_started', id: responseId });
        return;
      }
      if (type === 'output_audio_buffer.stopped') {
        const responseId = typeof parsed.response_id === 'string' ? parsed.response_id : undefined;
        this.onEvent?.({ type: 'assistant_audio_stopped', id: responseId });
        return;
      }
      if (type === 'output_audio_buffer.cleared') {
        const responseId = typeof parsed.response_id === 'string' ? parsed.response_id : undefined;
        this.onEvent?.({ type: 'output_audio_cleared', id: responseId });
        return;
      }
      if (type === 'response.audio.delta') {
        const responseId = typeof parsed.response_id === 'string' ? parsed.response_id : undefined;
        if (responseId && this.audioStartedResponseId !== responseId) {
          this.audioStartedResponseId = responseId;
          this.onEvent?.({ type: 'assistant_audio_started', id: responseId });
        }
        return;
      }
      if (type === 'response.text.delta' || type === 'response.audio_transcript.delta') {
        const delta = typeof parsed.delta === 'string' ? parsed.delta : '';
        const responseId = extractRealtimeResponseId(parsed, this.activeResponseId);
        console.log('[V2][transport] v2_realtime_response_id_extracted', JSON.stringify({
          type,
          responseId,
          source: 'text_delta',
        }));
        if (!responseId) return;
        this.onEvent?.({ type: 'ai_response_delta', id: responseId, text: delta });
        return;
      }
      if (type === 'conversation.item.truncated') {
        const itemId = typeof parsed.item_id === 'string' ? parsed.item_id : undefined;
        this.onEvent?.({ type: 'conversation_item_truncated', itemId });
        return;
      }

      if (type === 'response.done') {
        const responseId = extractRealtimeResponseId(parsed, this.activeResponseId);
        console.log('[V2][transport] v2_realtime_response_id_extracted', JSON.stringify({
          type,
          responseId,
          source: 'response.done',
        }));
        if (!responseId) {
          console.log('[V2][transport] v2_realtime_response_done_missing_response_id', JSON.stringify({
            type,
            keys: Object.keys(parsed),
          }));
          this.onEvent?.({ type: 'ai_response_done', text: extractResponseOutputText(parsed) || undefined });
          return;
        }
        this.activeResponseId = null;
        this.onEvent?.({ type: 'ai_response_done', id: responseId, text: extractResponseOutputText(parsed) || undefined });
        return;
      }
      if (type === 'conversation.item.added' || type === 'conversation.item.done') {
        const item =
          parsed.item && typeof parsed.item === 'object' ? (parsed.item as Record<string, unknown>) : null;
        const role = typeof item?.role === 'string' ? item.role : '';
        const extractedText = extractConversationItemText(item);

        if (role === 'user') {
          this.onEvent?.({
            type: 'user_turn_pending',
            itemId: extractRealtimeItemId(parsed),
            startedAt: Date.now(),
          });
          console.log(
            '[V2][transport] v2_realtime_user_transcript_event_received',
            JSON.stringify({
              type,
              itemId: extractRealtimeItemId(parsed),
              summary: summarizeConversationItemContent(type, item),
            }),
          );
          console.log(
            `[V1_ULTRA_TRANSPORT_DEBUG] user_conversation_item_content_summary = ${JSON.stringify(
              summarizeConversationItemContent(type, item),
            )}`,
          );
        }

        if (role === 'user' && extractedText) {
          this.handleUserTranscriptDoneEvent(type, parsed, extractedText);
          return;
        }

        if (role === 'assistant' && extractedText && type === 'conversation.item.done') {
          console.log(
            '[V2][transport] v2_realtime_assistant_turn_ignored_partial',
            JSON.stringify({
              type,
              itemId: extractRealtimeItemId(parsed),
              responseId: extractRealtimeResponseId(parsed, this.activeResponseId),
              textLength: extractedText.length,
            }),
          );
          return;
        }

        if (role === 'user') {
          console.log(
            `[V1_ULTRA_TRANSPORT_DEBUG] user_conversation_item_unparsed = ${JSON.stringify({
              type,
              itemKeys: item ? Object.keys(item) : [],
              contentCount: Array.isArray(item?.content) ? item?.content.length : 0,
            })}`,
          );
          console.log(
            '[V2][transport] v2_realtime_user_transcript_empty',
            JSON.stringify({
              type,
              itemId: extractRealtimeItemId(parsed),
              summary: summarizeConversationItemContent(type, item),
              rawPreview: previewText(JSON.stringify(parsed), 640),
            }),
          );
          console.log(
            '[V2][transport] v2_realtime_user_transcript_still_null_after_session_update',
            JSON.stringify({
              type,
              itemId: extractRealtimeItemId(parsed),
              summary: summarizeConversationItemContent(type, item),
            }),
          );
        }
        return;
      }
      if (type === 'error') {
        const nestedError =
          parsed.error && typeof parsed.error === 'object' ? (parsed.error as Record<string, unknown>) : null;
        const message =
          (typeof parsed.message === 'string' && parsed.message) ||
          (typeof nestedError?.message === 'string' && nestedError.message) ||
          'Realtime transport error';
        if (isNonFatalRealtimeConfigError(message)) {
          console.log(
            '[V2][transport] nonfatal-config-error',
            JSON.stringify({
              message,
              code: typeof parsed.code === 'string' ? parsed.code : null,
              nestedCode: typeof nestedError?.code === 'string' ? nestedError.code : null,
            }),
          );
          console.log(
            '[V2][transport] session_update_error_detail',
            JSON.stringify({
              message,
              code: typeof parsed.code === 'string' ? parsed.code : null,
              nestedCode: typeof nestedError?.code === 'string' ? nestedError.code : null,
              param: typeof parsed.param === 'string' ? parsed.param : null,
            }),
          );
          console.log(
            '[V2][transport] v2_realtime_session_update_error_after_vad_tuning',
            JSON.stringify({
              message,
              param: typeof parsed.param === 'string' ? parsed.param : null,
              nestedParam: typeof nestedError?.param === 'string' ? nestedError.param : null,
            }),
          );
          return;
        }
        console.log(
          `[V1_ULTRA_ERROR] realtime_server_error = ${JSON.stringify({
            type,
            code: typeof parsed.code === 'string' ? parsed.code : null,
            param: typeof parsed.param === 'string' ? parsed.param : null,
            message,
            event_id: typeof parsed.event_id === 'string' ? parsed.event_id : null,
            nestedCode: typeof nestedError?.code === 'string' ? nestedError.code : null,
            nestedType: typeof nestedError?.type === 'string' ? nestedError.type : null,
          })}`,
        );
        console.log(
          '[V2_EVENT] error-detail',
          JSON.stringify({
            message,
            code: typeof parsed.code === 'string' ? parsed.code : null,
            nestedCode: typeof nestedError?.code === 'string' ? nestedError.code : null,
            nestedType: typeof nestedError?.type === 'string' ? nestedError.type : null,
            eventId: typeof parsed.event_id === 'string' ? parsed.event_id : null,
          }),
        );
        this.onEvent?.({ type: 'error', message });
      }
    } catch {
      this.onEvent?.({ type: 'error', message: 'Realtime transport event parse failed' });
    }
  }

  private attachDataChannel(dataChannel: any): void {
    this.dc = dataChannel;
    dataChannel.onopen = () => {
      if (this.dc !== dataChannel) return;
      console.log('[V2][transport] dc:open');
      console.log('[V2_FLOW] dc:open');
      console.log(
        `[V1_ULTRA_TRANSPORT_DEBUG] datachannel_open = ${JSON.stringify({
          readyState: dataChannel.readyState ?? 'unknown',
        })}`,
      );
      this.dataChannelReady = true;
      this.clearDataChannelTimeout();
      this.onEvent?.({ type: 'datachannel_open' });
      this.configureSessionAfterOpen();
    };
    dataChannel.onclose = () => {
      if (this.dc !== dataChannel) return;
      console.log('[V2][transport] dc:close');
      console.log(
        `[V1_ULTRA_TRANSPORT_DEBUG] datachannel_close = ${JSON.stringify({
          readyState: dataChannel.readyState ?? 'unknown',
        })}`,
      );
      this.dataChannelReady = false;
      if (this.sessionConfigured || this.connected) {
        this.connected = false;
        this.emitDisconnected();
      }
    };
    dataChannel.onerror = () => {
      if (this.dc !== dataChannel) return;
      console.log('[V2][transport] dc:error');
      console.log('[V1_ULTRA_TRANSPORT_DEBUG] datachannel_error = {"message":"Realtime data channel 建立失败。"}');
      this.onEvent?.({ type: 'error', message: 'Realtime data channel 建立失败。' });
    };
    dataChannel.onmessage = (event: { data: string }) => {
      if (this.dc !== dataChannel) return;
      this.handleRawEvent(event.data);
    };
  }

  private sendDataChannelEvent(event: Record<string, unknown>): void {
    if (!this.dc || this.dc.readyState !== 'open') {
      throw new Error('Realtime data channel is not open');
    }
    const type = typeof event.type === 'string' ? event.type : 'unknown';
    const response =
      event.response && typeof event.response === 'object'
        ? (event.response as Record<string, unknown>)
        : null;
    console.log(
      `[V1_ULTRA_REALTIME_DEBUG] send_event = ${JSON.stringify({
        type,
        keys: Object.keys(event),
        responseKeys: response ? Object.keys(response) : [],
      })}`,
    );
    console.log('[V2_FLOW] dc:send', type);
    this.dc.send(JSON.stringify(event));
  }

  private configureSessionAfterOpen(): void {
    if (this.sessionConfigured) {
      return;
    }

    try {
      const createResponse = !this.asrOnly;
      const interruptResponse = !this.asrOnly;
      const silenceDurationMs = normalizeRealtimeVadSilenceDurationMs(this.vadSilenceDurationMs);
      const audio: Record<string, unknown> = {
        input: {
          noise_reduction: {
            type: 'near_field',
          },
          transcription: {
            model: 'gpt-4o-mini-transcribe',
            ...(this.inputTranscriptionLanguage ? { language: this.inputTranscriptionLanguage } : {}),
            prompt: this.inputTranscriptionPrompt,
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.82,
            silence_duration_ms: silenceDurationMs,
            prefix_padding_ms: 300,
            create_response: createResponse,
            interrupt_response: interruptResponse,
          },
        },
      };
      if (this.sessionVoice && !this.asrOnly) {
        audio.output = {
          voice: this.sessionVoice,
        };
      }
      console.log(
        '[V2][transport] v2_realtime_turn_detection_config',
        JSON.stringify({
          type: 'server_vad',
          threshold: 0.82,
          silence_duration_ms: silenceDurationMs,
          prefix_padding_ms: 300,
          create_response: createResponse,
          interrupt_response: interruptResponse,
          asrOnly: this.asrOnly,
        }),
      );
      console.log(
        '[V2][transport] v2_realtime_noise_reduction_config',
        JSON.stringify({
          type: 'near_field',
        }),
      );
      this.updateSession({
        type: 'realtime',
        instructions: this.sessionInstructions || undefined,
        audio,
      });
      this.sessionConfigured = true;
    } catch (error) {
      console.log(
        '[V2_FLOW] session.update:error',
        error instanceof Error ? error.message : 'unknown',
      );
      console.log(
        '[V2][transport] session_update_error_detail',
        JSON.stringify({
          message: error instanceof Error ? error.message : 'unknown',
        }),
      );
    }
  }

  private handleUserTranscriptDoneEvent(
    type: string,
    event: Record<string, unknown>,
    fallbackText?: string,
  ): void {
    const itemId = extractRealtimeItemId(event);
    const text = (fallbackText ?? extractTranscriptFromRealtimeEvent(event)).trim();
    console.log(
      '[V2][transport] v2_realtime_user_transcript_event_received',
      JSON.stringify({
        type,
        itemId,
        keys: Object.keys(event),
      }),
    );

    if (!text) {
      console.log(
        '[V2][transport] v2_realtime_user_transcript_empty',
        JSON.stringify({
          type,
          itemId,
          itemKeys: Object.keys(getNestedRecord(event.item) ?? {}),
          contentCount: getContentRecords(event.content).length,
          itemContentCount: getContentRecords(getNestedRecord(event.item)?.content).length,
          rawPreview: previewText(JSON.stringify(event), 640),
        }),
      );
      console.log(
        '[V2][transport] v2_realtime_user_transcript_still_null_after_session_update',
        JSON.stringify({
          type,
          itemId,
          rawPreview: previewText(JSON.stringify(event), 640),
        }),
      );
      return;
    }

    console.log(
      '[V2][transport] v2_realtime_user_transcript_completed',
      JSON.stringify({
        type,
        itemId,
        textLength: text.length,
      }),
    );
    console.log(
      '[V2][transport] v2_realtime_user_transcript_extracted',
      JSON.stringify({
        type,
        itemId,
        textLength: text.length,
        textPreview: previewText(text),
      }),
    );
    this.onEvent?.({
      type: 'user_transcript_done',
      itemId,
      text,
      completedAt: Date.now(),
    });
  }

  private armDataChannelTimeout(): void {
    this.clearDataChannelTimeout();
    this.dataChannelTimeout = setTimeout(() => {
      if (!this.dataChannelReady) {
        console.log('[V1_ULTRA_TRANSPORT_DEBUG] datachannel_timeout = {"timeoutMs":8000}');
        this.onEvent?.({ type: 'error', message: 'Realtime data channel 建立超时。' });
      }
    }, 8000);
  }

  private clearDataChannelTimeout(): void {
    if (this.dataChannelTimeout) {
      clearTimeout(this.dataChannelTimeout);
      this.dataChannelTimeout = null;
    }
  }

  private armRemoteAudioTimeout(): void {
    this.clearRemoteAudioTimeout();
    this.remoteAudioTimeout = setTimeout(() => {
      if (!this.hasRemoteAudioTrack) {
        this.onEvent?.({ type: 'error', message: 'AI 已开始响应，但当前未收到远端音频轨道。' });
      }
    }, 6000);
  }

  private clearRemoteAudioTimeout(): void {
    if (this.remoteAudioTimeout) {
      clearTimeout(this.remoteAudioTimeout);
      this.remoteAudioTimeout = null;
    }
  }

  private emitDisconnected(): void {
    if (this.disconnectEmitted) {
      return;
    }

    this.disconnectEmitted = true;
    this.onEvent?.({ type: 'disconnected' });
  }
}
