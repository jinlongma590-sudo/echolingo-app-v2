import { createWavBytes, encodeBase64, concatUint8Arrays } from '@/services/audio/pcmUtils';
import { getSpeakingRealtimeToken } from '@/services/api/speakingPractice';
import type { Scenario } from '@/data/scenarios';
import type { StoredSession } from '@/types/auth';
import type { OpenAiRealtimeTokenPayload, OpenAiRealtimeWsEvent } from '@/types/pcmDualStream';

const REALTIME_LOG_PREFIX = '[V1_PCM_DUAL]';
const REALTIME_WS_URL = 'wss://api.openai.com/v1/realtime';
const DEFAULT_GATEWAY_RELAY_URL = 'wss://gateway.echolingo.cn/api/ai-practice/realtime/ws-relay';
const DEFAULT_MODEL = 'gpt-realtime-mini';
const DEFAULT_AUDIO_SAMPLE_RATE = 24000;
const OPENAI_REALTIME_CONNECT_TIMEOUT_MS = 8000;
const REALTIME_TOKEN_SOURCE = '/api/ai-practice/realtime/token';
const DEFAULT_TRANSPORT_MODE = 'tokyo_gateway';
const TEXT_DELTA_EVENT_TYPES = new Set([
  'response.output_text.delta',
  'response.text.delta',
  'response.audio_transcript.delta',
  'response.output_audio_transcript.delta',
  'relay.assistant_text_delta',
]);
const TEXT_DONE_EVENT_TYPES = new Set([
  'response.audio_transcript.done',
  'response.output_audio_transcript.done',
  'response.output_item.done',
  'response.content_part.done',
]);

function log(step: string, payload: Record<string, unknown>) {
  console.log(`${REALTIME_LOG_PREFIX} ${step} = ${JSON.stringify(payload)}`);
}

function buildRealtimeSystemPrompt(scenario: Scenario) {
  const coffeeRule =
    scenario.id === 'coffee-order'
      ? [
          'For the coffee shop ordering scenario, you are the barista. Keep the conversation only about ordering coffee.',
          'If the user says "I\'d like a cup of latte", continue as a barista by asking about size, hot or iced, milk, sugar, or anything else.',
        ]
      : [];
  return [
    'You are an English speaking-practice partner inside EchoLingo.',
    'You must always reply in English only.',
    'Never reply in Spanish, Chinese, French, German, Portuguese, Japanese, Korean, or any other language.',
    `You are ${scenario.aiName}, acting as ${scenario.aiRole} in the scenario "${scenario.name}".`,
    `The current scenario is: ${scenario.name}.`,
    `Scenario goal: ${scenario.description}.`,
    `The learner level is ${scenario.level}.`,
    'Stay strictly inside this scenario.',
    'Do not introduce unrelated topics.',
    'Do not explain productivity methods, general knowledge, or unrelated concepts unless the current scenario asks for them.',
    'The user is practicing as the customer/student/patient/traveler depending on the scenario.',
    'You play the counterpart role required by the scenario.',
    ...coffeeRule,
    'Keep each reply to one or two short natural spoken-English sentences.',
    'Ask one simple follow-up question at a time.',
    'Hard rule: If you are about to answer in any language other than English, stop and rewrite the answer in English.',
  ].join(' ');
}

function buildRealtimeResponseInstructions(scenario: Scenario) {
  return [
    'Respond in English only.',
    `Stay in the current scenario: ${scenario.name}.`,
    `Reply as ${scenario.aiRole}.`,
    'Do not switch languages.',
    'Do not discuss unrelated topics.',
    'Keep the answer short and conversational.',
    scenario.id === 'coffee-order'
      ? 'For coffee ordering, continue like a barista: ask about size, hot or iced, milk, sugar, or anything else.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

type RealtimeTransportMode = 'tokyo_gateway' | 'direct';

function normalizeUrl(value?: string | null) {
  return (value || '').trim().replace(/\/+$/, '');
}

function getRealtimeTransportMode(): RealtimeTransportMode {
  const mode = process.env.EXPO_PUBLIC_OPENAI_REALTIME_TRANSPORT?.trim();
  return mode === 'direct' ? 'direct' : DEFAULT_TRANSPORT_MODE;
}

function getRelayEndpoint() {
  return (
    normalizeUrl(process.env.EXPO_PUBLIC_OPENAI_REALTIME_RELAY_URL) || DEFAULT_GATEWAY_RELAY_URL
  );
}

export function logRealtimeTransportConfig() {
  const mode = getRealtimeTransportMode();
  const endpoint = mode === 'tokyo_gateway' ? getRelayEndpoint() : REALTIME_WS_URL;
  log('realtime_transport_config', {
    mode,
    endpoint,
    source:
      mode === 'tokyo_gateway'
        ? process.env.EXPO_PUBLIC_OPENAI_REALTIME_RELAY_URL?.trim()
          ? 'EXPO_PUBLIC_OPENAI_REALTIME_RELAY_URL'
          : 'default_gateway_endpoint'
        : 'direct_debug_mode',
    directDisabledReason: 'china_network_requires_tokyo_gateway',
  });
}

type OpenAiRealtimeWsClientOptions = {
  session: StoredSession;
  scenario: Scenario;
  onEvent?: (event: OpenAiRealtimeWsEvent) => void;
  turnDetection?:
    | null
    | {
        type: 'server_vad';
        threshold?: number;
        silence_duration_ms?: number;
        prefix_padding_ms?: number;
        create_response?: boolean;
        interrupt_response?: boolean;
      };
  inputAudioTranscription?:
    | boolean
    | {
        model?: string;
      };
};

export class OpenAiRealtimeWsClient {
  private readonly session: StoredSession;
  private readonly scenario: Scenario;
  private readonly onEvent?: (event: OpenAiRealtimeWsEvent) => void;
  private readonly turnDetection:
    | null
    | {
        type: 'server_vad';
        threshold?: number;
        silence_duration_ms?: number;
        prefix_padding_ms?: number;
        create_response?: boolean;
        interrupt_response?: boolean;
      };
  private readonly inputAudioTranscription:
    | boolean
    | {
        model?: string;
      };
  private readonly transportMode: RealtimeTransportMode;
  private readonly relayEndpoint: string;
  private websocket: WebSocket | null = null;
  private tokenPayload: OpenAiRealtimeTokenPayload | null = null;
  private connectingPromise: Promise<void> | null = null;
  private assistantText = '';
  private assistantTextByResponseId = new Map<string, string>();
  private assistantAudioChunks: Uint8Array[] = [];
  private currentResponseId: string | null = null;
  private activeResponseId: string | null = null;
  private responseInProgress = false;
  private pendingResponseRoundId: number | null = null;
  private pendingCreateForRoundId: number | null = null;
  private lastCreateSentRoundId: number | null = null;
  private responseRoundIdByResponseId = new Map<string, number>();
  private chunksSent = 0;
  private bytesSent = 0;
  private connectedAt = 0;
  private connectionState: 'idle' | 'connecting' | 'connected' | 'failed' = 'idle';
  private connectPhase: 'token' | 'websocket' | 'relay_ready' | 'session_update' | 'unknown' = 'unknown';
  private manualClose = false;

  constructor(options: OpenAiRealtimeWsClientOptions) {
    this.session = options.session;
    this.scenario = options.scenario;
    this.onEvent = options.onEvent;
    this.turnDetection = options.turnDetection ?? null;
    this.inputAudioTranscription = options.inputAudioTranscription ?? false;
    this.transportMode = getRealtimeTransportMode();
    this.relayEndpoint = getRelayEndpoint();
  }

  async connect() {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.connectionState = 'connected';
      return;
    }
    if (this.connectingPromise) {
      return this.connectingPromise;
    }
    if (this.websocket && this.websocket.readyState !== WebSocket.OPEN) {
      this.close();
    }

    this.connectingPromise = this.connectInternal();
    try {
      await this.connectingPromise;
    } finally {
      this.connectingPromise = null;
    }
  }

  getConnectionState() {
    return this.connectionState;
  }

  isConnected() {
    return this.connectionState === 'connected' && this.websocket?.readyState === WebSocket.OPEN;
  }

  private getTransportEndpoint() {
    return this.transportMode === 'tokyo_gateway' ? this.relayEndpoint : REALTIME_WS_URL;
  }

  private async connectInternal() {
    this.connectionState = 'connecting';
    this.connectPhase = this.transportMode === 'tokyo_gateway' ? 'websocket' : 'token';
    this.manualClose = false;
    const connectStartedAt = Date.now();
    let socketForTimeout: WebSocket | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const endpoint = this.getTransportEndpoint();

    log('realtime_transport_config', {
      mode: this.transportMode,
      endpoint,
      source:
        this.transportMode === 'tokyo_gateway'
          ? process.env.EXPO_PUBLIC_OPENAI_REALTIME_RELAY_URL?.trim()
            ? 'EXPO_PUBLIC_OPENAI_REALTIME_RELAY_URL'
            : 'default_gateway_endpoint'
          : 'direct_debug_mode',
      directDisabledReason: 'china_network_requires_tokyo_gateway',
    });
    log('realtime_transport_mode', {
      mode: this.transportMode,
      endpoint,
    });

    if (this.transportMode !== 'direct' && /api\.openai\.com/i.test(endpoint)) {
      this.connectionState = 'failed';
      log('realtime_direct_openai_blocked', {
        reason: 'china_network_requires_tokyo_gateway',
        endpoint,
      });
      throw new Error('realtime_direct_openai_blocked');
    }

    log(this.transportMode === 'tokyo_gateway' ? 'realtime_relay_connect_start' : 'realtime_connect_start', {
      scenarioId: this.scenario.id,
      endpoint,
      hasToken: false,
      tokenSource: this.transportMode === 'direct' ? REALTIME_TOKEN_SOURCE : null,
      timestamp: new Date(connectStartedAt).toISOString(),
    });

    log('realtime_auth_config', {
      mode: this.transportMode === 'tokyo_gateway' ? 'gateway_server_key' : 'ephemeral_token',
      hasToken: false,
      tokenType: this.transportMode === 'tokyo_gateway' ? null : 'ephemeral_client_secret',
      endpoint,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        try {
          socketForTimeout?.close();
        } catch {
          // ignore close failure
        }
        const error = new Error('openai_realtime_connect_timeout');
        (error as Error & { phase?: string }).phase = this.connectPhase;
        log(this.transportMode === 'tokyo_gateway' ? 'realtime_connect_timeout' : 'realtime_connect_timeout', {
          scenarioId: this.scenario.id,
          elapsedMs: Date.now() - connectStartedAt,
          phase: this.connectPhase,
        });
        reject(error);
      }, OPENAI_REALTIME_CONNECT_TIMEOUT_MS);
    });

    const connectPromise =
      this.transportMode === 'tokyo_gateway'
        ? this.connectViaRelay(connectStartedAt, (ws) => {
            socketForTimeout = ws;
          })
        : this.connectDirect(connectStartedAt, (ws) => {
            socketForTimeout = ws;
          });

    try {
      await Promise.race([connectPromise, timeoutPromise]);
    } catch (error) {
      this.connectionState = 'failed';
      const normalizedError = error instanceof Error ? error : new Error('openai_realtime_connect_failed');
      const phase =
        typeof (normalizedError as Error & { phase?: unknown }).phase === 'string'
          ? String((normalizedError as Error & { phase?: unknown }).phase)
          : this.connectPhase;
      log(this.transportMode === 'tokyo_gateway' ? 'realtime_relay_failed' : 'realtime_connect_failed', {
        scenarioId: this.scenario.id,
        code: normalizedError.name || 'Error',
        message: normalizedError.message,
        phase,
        endpoint,
      });
      this.onEvent?.({ type: 'error', message: normalizedError.message, rawType: `connect_failed:${phase}` });
      throw normalizedError;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private async connectDirect(connectStartedAt: number, setTimeoutSocket: (socket: WebSocket) => void) {
    log('realtime_token_start', {
      scenarioId: this.scenario.id,
      tokenSource: REALTIME_TOKEN_SOURCE,
    });
    const tokenResponse = await getSpeakingRealtimeToken(this.session, {
      scenarioId: this.scenario.id,
      scenarioName: this.scenario.name,
      aiName: this.scenario.aiName,
      aiRole: this.scenario.aiRole,
      systemPrompt: buildRealtimeSystemPrompt(this.scenario),
    });
    this.tokenPayload = tokenResponse;

    if (!tokenResponse.clientSecret?.trim()) {
      log('realtime_token_incompatible', {
        scenarioId: this.scenario.id,
        tokenSource: REALTIME_TOKEN_SOURCE,
        reason: 'token_route_returns_webrtc_or_session_token_not_ws_compatible',
      });
      throw new Error('openai_realtime_token_missing_client_secret');
    }

    const model = tokenResponse.model?.trim() || DEFAULT_MODEL;
    const url = `${REALTIME_WS_URL}?model=${encodeURIComponent(model)}`;
    log('realtime_token_success', {
      scenarioId: this.scenario.id,
      hasClientSecret: Boolean(tokenResponse.clientSecret),
      model,
      expiresAt: tokenResponse.expiresAt ?? null,
    });

    this.connectPhase = 'websocket';

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const headers = {
        Authorization: `Bearer ${tokenResponse.clientSecret}`,
        'OpenAI-Beta': 'realtime=v1',
      };

      const WebSocketCtor = WebSocket as unknown as new (
        url: string,
        protocols?: string | string[],
        options?: { headers?: Record<string, string> },
      ) => WebSocket;
      const ws = new WebSocketCtor(url, undefined, {
        headers,
      });
      this.websocket = ws;
      setTimeoutSocket(ws);

      ws.onopen = () => {
        this.connectedAt = Date.now();
        log('realtime_ws_open', {
          scenarioId: this.scenario.id,
          endpoint: url,
          elapsedMs: this.connectedAt - connectStartedAt,
        });
        this.connectPhase = 'session_update';
        try {
          this.configureSession();
          log('realtime_session_update_sent', {
            scenarioId: this.scenario.id,
            model,
            voice: tokenResponse.voice ?? 'marin',
          });
          this.connectionState = 'connected';
          log('realtime_connected', {
            scenarioId: this.scenario.id,
            endpoint: url,
            model,
            voice: tokenResponse.voice ?? null,
          });
          this.onEvent?.({ type: 'connected' });
          succeed();
        } catch (error) {
          fail(error instanceof Error ? error : new Error('openai_realtime_session_update_failed'));
        }
      };

      ws.onclose = () => {
        this.websocket = null;
        const wasManualClose = this.manualClose;
        this.manualClose = false;
        if (!wasManualClose && this.connectionState === 'connecting') {
          fail(new Error('openai_realtime_ws_closed_before_open'));
          return;
        }
        this.connectionState = wasManualClose ? 'idle' : 'failed';
        this.onEvent?.({ type: 'disconnected' });
      };

      ws.onerror = () => {
        if (this.connectionState === 'connecting') {
          fail(new Error('openai_realtime_ws_open_failed'));
          return;
        }
        this.connectionState = 'failed';
        this.onEvent?.({ type: 'error', message: 'openai_realtime_ws_error', rawType: 'socket_error' });
      };

      ws.onmessage = (event) => {
        this.handleRawEvent(String(event.data ?? ''));
      };
    });
  }

  private async connectViaRelay(connectStartedAt: number, setTimeoutSocket: (socket: WebSocket) => void) {
    const relayUrl = this.relayEndpoint;
    const model = DEFAULT_MODEL;
    this.connectPhase = 'websocket';

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const headers = {
        Authorization: `Bearer ${this.session.accessToken}`,
        'X-Echolingo-Transport': 'tokyo_gateway',
      };

      const WebSocketCtor = WebSocket as unknown as new (
        url: string,
        protocols?: string | string[],
        options?: { headers?: Record<string, string> },
      ) => WebSocket;
      const ws = new WebSocketCtor(relayUrl, undefined, {
        headers,
      });
      this.websocket = ws;
      setTimeoutSocket(ws);

      ws.onopen = () => {
        this.connectedAt = Date.now();
        log('realtime_ws_open', {
          scenarioId: this.scenario.id,
          endpoint: relayUrl,
          elapsedMs: this.connectedAt - connectStartedAt,
        });
        this.connectPhase = 'relay_ready';
        try {
          log('realtime_language_policy', {
            defaultReplyLanguage: 'en',
            allowChineseHelp: true,
            allowedAssistantLanguages: ['en', 'zh-CN'],
            forbiddenAssistantLanguagesCount: 6,
          });
          this.sendEvent({
            type: 'client.init',
            scenarioId: this.scenario.id,
            scenarioTitle: this.scenario.name,
            scenarioName: this.scenario.name,
            aiName: this.scenario.aiName,
            aiRole: this.scenario.aiRole,
            level: this.scenario.level,
            language: 'en',
            replyLanguage: 'en',
            forceEnglish: true,
            allowChineseHelp: true,
            allowedAssistantLanguages: ['en', 'zh-CN'],
            forbiddenAssistantLanguages: ['de', 'fr', 'ru', 'es', 'ja', 'ko'],
            model,
            voice: 'marin',
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            systemPrompt: buildRealtimeSystemPrompt(this.scenario),
          });
        } catch (error) {
          fail(error instanceof Error ? error : new Error('realtime_relay_init_send_failed'));
        }
      };

      ws.onclose = () => {
        this.websocket = null;
        const wasManualClose = this.manualClose;
        this.manualClose = false;
        if (!wasManualClose && this.connectionState === 'connecting') {
          fail(new Error('realtime_relay_closed_before_ready'));
          return;
        }
        this.connectionState = wasManualClose ? 'idle' : 'failed';
        this.onEvent?.({ type: 'disconnected' });
      };

      ws.onerror = () => {
        if (this.connectionState === 'connecting') {
          fail(new Error('realtime_relay_ws_open_failed'));
          return;
        }
        this.connectionState = 'failed';
        this.onEvent?.({ type: 'error', message: 'realtime_relay_ws_error', rawType: 'socket_error' });
      };

      ws.onmessage = (event) => {
        const raw = String(event.data ?? '');
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          if (parsed.type === 'relay.ready') {
            log('realtime_relay_ready_event', {
              scenarioId: this.scenario.id,
              endpoint: relayUrl,
              ok: parsed.ok === true,
              transport: typeof parsed.transport === 'string' ? parsed.transport : null,
              upstream: typeof parsed.upstream === 'string' ? parsed.upstream : null,
              model: typeof parsed.model === 'string' ? parsed.model : model,
              voice: typeof parsed.voice === 'string' ? parsed.voice : 'marin',
            });
            this.connectPhase = 'session_update';
            this.configureSession();
            log('realtime_session_update_sent_after_relay_ready', {
              scenarioId: this.scenario.id,
              scenarioTitle: this.scenario.name,
              hasInstructions: true,
            });
            this.connectionState = 'connected';
            log('realtime_relay_connected', {
              scenarioId: this.scenario.id,
              endpoint: relayUrl,
              upstream: typeof parsed.upstream === 'string' ? parsed.upstream : null,
              model: typeof parsed.model === 'string' ? parsed.model : model,
              voice: typeof parsed.voice === 'string' ? parsed.voice : 'marin',
            });
            log('realtime_connected', {
              scenarioId: this.scenario.id,
              endpoint: relayUrl,
              model: typeof parsed.model === 'string' ? parsed.model : model,
              voice: typeof parsed.voice === 'string' ? parsed.voice : 'marin',
            });
            this.onEvent?.({ type: 'connected' });
            succeed();
            return;
          }
          if (parsed.type === 'relay.error') {
            const relayMessage =
              typeof parsed.message === 'string' && parsed.message
                ? parsed.message
                : 'realtime_relay_error';
            const phase =
              typeof parsed.phase === 'string' && parsed.phase ? parsed.phase : this.connectPhase;
            const code =
              typeof parsed.code === 'string' && parsed.code ? parsed.code : 'RELAY_ERROR';
            log('realtime_relay_error_event', {
              scenarioId: this.scenario.id,
              endpoint: relayUrl,
              code,
              message: relayMessage,
              phase,
              status: parsed.status ?? null,
              closeCode: parsed.closeCode ?? null,
              closeReason: parsed.closeReason ?? null,
            });
            if (settled) {
              this.onEvent?.({ type: 'error', message: relayMessage, rawType: `relay_error:${phase}` });
              return;
            }
            const error = new Error(relayMessage) as Error & { phase?: string; code?: string };
            error.phase = phase;
            error.code = code;
            fail(error);
            return;
          }
          if (typeof parsed.type === 'string' && parsed.type.startsWith('relay.')) {
            log('realtime_relay_event_unhandled', {
              scenarioId: this.scenario.id,
              endpoint: relayUrl,
              rawType: parsed.type,
              keys: Object.keys(parsed),
            });
            return;
          }
        } catch {
          // fall through to standard parser
        }
        this.handleRawEvent(raw);
      };
    });
  }

  private configureSession() {
    const sessionUpdate = {
      type: 'session.update',
      session: {
        instructions: buildRealtimeSystemPrompt(this.scenario),
        voice: this.tokenPayload?.voice ?? 'marin',
        modalities: ['text', 'audio'],
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        turn_detection: this.turnDetection,
        ...(this.inputAudioTranscription
          ? {
              input_audio_transcription:
                this.inputAudioTranscription === true
                  ? { model: 'gpt-4o-mini-transcribe' }
                  : {
                      model: this.inputAudioTranscription.model?.trim() || 'gpt-4o-mini-transcribe',
                    },
            }
          : {}),
      },
    };
    log('realtime_session_update_payload_sanitized', {
      scenarioId: this.scenario.id,
      keys: Object.keys(sessionUpdate.session),
      turnDetection: this.turnDetection ?? null,
      inputAudioTranscription:
        this.inputAudioTranscription === true
          ? { model: 'gpt-4o-mini-transcribe' }
          : this.inputAudioTranscription || null,
    });
    this.sendEvent({
      ...sessionUpdate,
    });
    log('realtime_session_update_sent', {
      scenarioId: this.scenario.id,
      scenarioTitle: this.scenario.name,
      modalities: sessionUpdate.session.modalities,
      voice: sessionUpdate.session.voice,
      hasInstructions: Boolean(sessionUpdate.session.instructions),
      instructionPreview: sessionUpdate.session.instructions.slice(0, 160),
      audioConfigKeys: Object.keys(sessionUpdate.session).filter((key) => key.includes('audio') || key === 'turn_detection'),
      requestedTranscript: sessionUpdate.session.modalities.includes('text') && sessionUpdate.session.modalities.includes('audio'),
    });
  }

  createResponse(input?: { instructions?: string; metadata?: Record<string, unknown> }) {
    if (!this.isConnected()) {
      log('realtime_error', {
        roundId: null,
        message: 'openai_realtime_ws_not_connected_on_create_response',
      });
      return false;
    }
    this.assistantText = '';
    this.assistantAudioChunks = [];
    this.currentResponseId = null;
    this.pendingResponseRoundId = null;
    this.sendEvent({
      type: 'response.create',
      response: {
        modalities: ['text', 'audio'],
        instructions: input?.instructions?.trim() || buildRealtimeResponseInstructions(this.scenario),
        ...(input?.metadata ? { metadata: input.metadata } : {}),
      },
    });
    log('realtime_response_create_sent', {
      scenarioId: this.scenario.id,
      hasCustomInstructions: Boolean(input?.instructions?.trim()),
      metadataKeys: input?.metadata ? Object.keys(input.metadata) : [],
    });
    return true;
  }

  interrupt() {
    if (!this.isConnected()) {
      return false;
    }
    this.sendEvent({ type: 'response.cancel' });
    log('realtime_response_cancel_sent', {
      scenarioId: this.scenario.id,
      responseId: this.currentResponseId,
    });
    return true;
  }

  appendInputAudio(pcmChunk: Uint8Array) {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      throw new Error('openai_realtime_ws_not_connected');
    }
    this.chunksSent += 1;
    this.bytesSent += pcmChunk.byteLength;
    this.sendEvent({
      type: 'input_audio_buffer.append',
      audio: encodeBase64(pcmChunk),
    });
    if (this.chunksSent === 1 || this.chunksSent % 25 === 0) {
      log('realtime_audio_append_stats', {
        scenarioId: this.scenario.id,
        chunksSent: this.chunksSent,
        bytesSent: this.bytesSent,
        elapsedMs: this.connectedAt ? Date.now() - this.connectedAt : null,
      });
    }
  }

  commitAndCreateResponse(roundId: number) {
    if (!this.isConnected()) {
      log('realtime_error', {
        roundId,
        message: 'openai_realtime_ws_not_connected_on_commit',
      });
      return false;
    }
    if (this.responseInProgress || this.activeResponseId) {
      log('v2_response_create_skipped_already_active', {
        roundId,
        activeResponseId: this.activeResponseId,
        responseInProgress: this.responseInProgress,
        pendingCreateForRoundId: this.pendingCreateForRoundId,
        lastCreateSentRoundId: this.lastCreateSentRoundId,
      });
      return false;
    }
    if (this.lastCreateSentRoundId === roundId || this.pendingCreateForRoundId === roundId) {
      log('v2_response_create_skipped_duplicate_round', {
        roundId,
        activeResponseId: this.activeResponseId,
        responseInProgress: this.responseInProgress,
        pendingCreateForRoundId: this.pendingCreateForRoundId,
        lastCreateSentRoundId: this.lastCreateSentRoundId,
      });
      return false;
    }
    this.assistantText = '';
    this.assistantTextByResponseId.clear();
    this.assistantAudioChunks = [];
    this.currentResponseId = null;
    this.pendingResponseRoundId = roundId;
    this.pendingCreateForRoundId = roundId;
    this.lastCreateSentRoundId = roundId;
    this.sendEvent({ type: 'input_audio_buffer.commit' });
    log('v2_commit_input_audio_sent', {
      roundId,
      chunksSent: this.chunksSent,
      bytesSent: this.bytesSent,
    });
    this.sendEvent({
      type: 'response.create',
      response: {
        modalities: ['text', 'audio'],
        instructions: buildRealtimeResponseInstructions(this.scenario),
      },
    });
    this.responseInProgress = true;
    log('v2_response_create_sent', {
      roundId,
      responseInstructionsPreview: buildRealtimeResponseInstructions(this.scenario).slice(0, 160),
    });
    log('realtime_commit', {
      roundId,
      chunksSent: this.chunksSent,
      bytesSent: this.bytesSent,
      responseInstructionsPreview: buildRealtimeResponseInstructions(this.scenario).slice(0, 160),
    });
    return true;
  }

  /**
   * 文字输入回合：发送 conversation.item.create (input_text) + response.create
   * 用于 Android V1 无 PCM 原生模块时的文字 fallback
   */
  sendTextItemAndCreateResponse(text: string, roundId: number): boolean {
    if (!this.isConnected()) {
      log('realtime_error', {
        roundId,
        message: 'openai_realtime_ws_not_connected_on_send_text',
      });
      return false;
    }
    if (this.responseInProgress || this.activeResponseId) {
      log('v1_text_response_create_skipped_already_active', {
        roundId,
        activeResponseId: this.activeResponseId,
        responseInProgress: this.responseInProgress,
      });
      return false;
    }
    if (this.lastCreateSentRoundId === roundId || this.pendingCreateForRoundId === roundId) {
      log('v1_text_response_create_skipped_duplicate_round', {
        roundId,
      });
      return false;
    }
    this.assistantText = '';
    this.assistantTextByResponseId.clear();
    this.assistantAudioChunks = [];
    this.currentResponseId = null;
    this.pendingResponseRoundId = roundId;
    this.pendingCreateForRoundId = roundId;
    this.lastCreateSentRoundId = roundId;
    // 1. 添加用户文字消息到对话历史
    this.sendEvent({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      },
    });
    // 2. 触发 AI 回复
    this.sendEvent({
      type: 'response.create',
      response: {
        modalities: ['text', 'audio'],
        instructions: buildRealtimeResponseInstructions(this.scenario),
      },
    });
    this.responseInProgress = true;
    log('v1_text_response_create_sent', {
      roundId,
      textLength: text.length,
      textPreview: text.slice(0, 80),
    });
    return true;
  }

  close() {
    if (this.websocket) {
      try {
        this.manualClose = true;
        this.websocket.close();
      } catch {
        // ignore close failure
      }
    }
    this.websocket = null;
    this.connectingPromise = null;
    this.connectionState = 'idle';
    this.connectPhase = 'unknown';
    this.activeResponseId = null;
    this.responseInProgress = false;
    this.pendingResponseRoundId = null;
    this.pendingCreateForRoundId = null;
    this.lastCreateSentRoundId = null;
    this.responseRoundIdByResponseId.clear();
  }

  private sendEvent(event: Record<string, unknown>) {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      throw new Error('openai_realtime_ws_not_connected');
    }
    this.websocket.send(JSON.stringify(event));
  }

  private handleRawEvent(raw: string) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const type = typeof parsed.type === 'string' ? parsed.type : 'unknown';
      const responseId = extractResponseId(parsed) ?? this.currentResponseId;

      if (type === 'session.created' || type === 'session.updated') {
        log('realtime_session_event', {
          scenarioId: this.scenario.id,
          rawType: type,
        });
        if (type === 'session.updated') {
          this.onEvent?.({ type: 'session_updated' });
        }
        return;
      }

      if (type === 'input_audio_buffer.speech_started') {
        log('v2_realtime_user_speech_started', {
          scenarioId: this.scenario.id,
          responseId,
        });
        this.onEvent?.({ type: 'user_speech_started' });
        return;
      }

      if (type === 'input_audio_buffer.speech_stopped') {
        log('v2_realtime_user_speech_stopped', {
          scenarioId: this.scenario.id,
          responseId,
        });
        this.onEvent?.({ type: 'user_speech_stopped' });
        return;
      }

      if (type === 'input_audio_buffer.committed') {
        log('v2_realtime_input_committed', {
          scenarioId: this.scenario.id,
          responseId,
        });
        this.onEvent?.({ type: 'user_audio_committed' });
        return;
      }

      if (type === 'response.created') {
        const createdResponseId = extractResponseId(parsed);
        log('v2_realtime_response_created_after_user', {
          scenarioId: this.scenario.id,
          responseId: createdResponseId,
          pendingCreateForRoundId: this.pendingCreateForRoundId,
        });
        this.currentResponseId = createdResponseId;
        this.activeResponseId = createdResponseId;
        this.responseInProgress = true;
        if (this.currentResponseId && this.pendingResponseRoundId != null) {
          this.responseRoundIdByResponseId.set(this.currentResponseId, this.pendingResponseRoundId);
        }
        this.assistantText = '';
        if (this.currentResponseId) {
          this.assistantTextByResponseId.set(this.currentResponseId, '');
        }
        this.assistantAudioChunks = [];
        this.onEvent?.({
          type: 'assistant_response_created',
          responseId: this.currentResponseId,
        });
        return;
      }

      if (TEXT_DELTA_EVENT_TYPES.has(type)) {
        const delta = extractEventTextDelta(parsed);
        if (!delta) return;
        this.currentResponseId = responseId ?? this.currentResponseId;
        const responseKey = this.currentResponseId ?? '__pending__';
        const accumulated = `${this.assistantTextByResponseId.get(responseKey) ?? ''}${delta}`;
        this.assistantTextByResponseId.set(responseKey, accumulated);
        this.assistantText = accumulated;
        log('realtime_relay_text_delta', {
          scenarioId: this.scenario.id,
          sourceType: type,
          deltaPreview: delta.slice(0, 80),
          accumulatedLength: accumulated.length,
        });
        this.onEvent?.({
          type: 'assistant_text_delta',
          textDelta: delta,
          roundId:
            (this.currentResponseId ? this.responseRoundIdByResponseId.get(this.currentResponseId) : null) ??
            this.pendingResponseRoundId,
          responseId: this.currentResponseId,
          sourceType: type,
        });
        return;
      }

      if (TEXT_DONE_EVENT_TYPES.has(type)) {
        const doneText = extractEventDoneText(parsed);
        if (!doneText) {
          return;
        }
        this.currentResponseId = responseId ?? this.currentResponseId;
        const responseKey = this.currentResponseId ?? '__pending__';
        const accumulated = this.assistantTextByResponseId.get(responseKey) ?? this.assistantText;
        if (doneText.length >= accumulated.length) {
          this.assistantTextByResponseId.set(responseKey, doneText);
          this.assistantText = doneText;
        } else {
          log('assistant_text_final_ignored_shorter', {
            scenarioId: this.scenario.id,
            responseId: this.currentResponseId,
            sourceType: type,
            accumulatedLength: accumulated.length,
            finalLength: doneText.length,
          });
          this.assistantText = accumulated;
        }
        log('realtime_relay_text_delta', {
          scenarioId: this.scenario.id,
          sourceType: type,
          deltaPreview: doneText.slice(0, 80),
          accumulatedLength: this.assistantText.length,
        });
        return;
      }

      if (type === 'response.audio.delta' || type === 'response.output_audio.delta') {
        const delta = typeof parsed.delta === 'string' ? parsed.delta : '';
        if (!delta) return;
        const audioBytes = atobCompatible(delta);
        this.assistantAudioChunks.push(audioBytes);
        this.currentResponseId = responseId ?? this.currentResponseId;
        log('realtime_relay_audio_delta', {
          scenarioId: this.scenario.id,
          sourceType: type,
          audioBytes: audioBytes.byteLength,
        });
        this.onEvent?.({
          type: 'assistant_audio_delta',
          audioBytes: audioBytes.byteLength,
          roundId:
            (this.currentResponseId ? this.responseRoundIdByResponseId.get(this.currentResponseId) : null) ??
            this.pendingResponseRoundId,
          responseId: this.currentResponseId,
          sourceType: type,
        });
        return;
      }

      if (type === 'response.done') {
        this.currentResponseId = responseId ?? this.currentResponseId;
        const responseKey = this.currentResponseId ?? '__pending__';
        const mergedAudio = concatUint8Arrays(this.assistantAudioChunks);
        const wavAudio = mergedAudio.byteLength > 0
          ? createWavBytes(mergedAudio, DEFAULT_AUDIO_SAMPLE_RATE, 1)
          : mergedAudio;
        const extractedDoneText = extractResponseDoneText(parsed);
        if (extractedDoneText) {
          const accumulated = this.assistantTextByResponseId.get(responseKey) ?? this.assistantText;
          if (extractedDoneText.length >= accumulated.length) {
            this.assistantTextByResponseId.set(responseKey, extractedDoneText);
            this.assistantText = extractedDoneText;
            log('realtime_response_done_text_extracted', {
              scenarioId: this.scenario.id,
              textLength: extractedDoneText.length,
              textPreview: extractedDoneText.slice(0, 120),
              source: 'response.done',
            });
          } else {
            this.assistantText = accumulated;
            log('assistant_text_final_ignored_shorter', {
              scenarioId: this.scenario.id,
              responseId: this.currentResponseId,
              sourceType: type,
              accumulatedLength: accumulated.length,
              finalLength: extractedDoneText.length,
            });
          }
        }
        log('realtime_response_done', {
          scenarioId: this.scenario.id,
          responseId: this.currentResponseId,
          audioBytes: mergedAudio.byteLength,
          wavBytes: wavAudio.byteLength,
        });
        log('v2_realtime_response_done_after_user', {
          scenarioId: this.scenario.id,
          responseId: this.currentResponseId,
          audioBytes: mergedAudio.byteLength,
          wavBytes: wavAudio.byteLength,
        });
        log('realtime_relay_done', {
          scenarioId: this.scenario.id,
          responseId: this.currentResponseId,
          audioBytes: mergedAudio.byteLength,
          wavBytes: wavAudio.byteLength,
        });
        this.onEvent?.({
          type: 'assistant_response_done',
          roundId:
            (this.currentResponseId ? this.responseRoundIdByResponseId.get(this.currentResponseId) : null) ??
            this.pendingResponseRoundId,
          responseId: this.currentResponseId,
          assistantText: this.assistantText.trim(),
          audioBytes: wavAudio.byteLength,
          audioBase64: wavAudio.byteLength > 0 ? encodeBase64(wavAudio) : null,
          audioSampleRate: DEFAULT_AUDIO_SAMPLE_RATE,
          audioMimeType: 'audio/wav',
          sourceType: type,
        });
        log('ai_response_done', {
          responseId: this.currentResponseId,
          audioBytes: mergedAudio.byteLength,
          wavBytes: wavAudio.byteLength,
          textLength: this.assistantText.trim().length,
          textPreview: this.assistantText.slice(0, 120),
        });
        this.assistantTextByResponseId.delete(responseKey);
        if (this.currentResponseId) {
          this.responseRoundIdByResponseId.delete(this.currentResponseId);
        }
        this.assistantText = '';
        this.assistantAudioChunks = [];
        this.activeResponseId = null;
        this.responseInProgress = false;
        this.currentResponseId = null;
        this.pendingResponseRoundId = null;
        this.pendingCreateForRoundId = null;
        return;
      }

      if (type === 'response.cancelled' || type === 'response.failed') {
        log('v2_realtime_response_terminal', {
          scenarioId: this.scenario.id,
          rawType: type,
          responseId,
          activeResponseId: this.activeResponseId,
          pendingCreateForRoundId: this.pendingCreateForRoundId,
        });
        if (!responseId || responseId === this.activeResponseId || responseId === this.currentResponseId) {
          this.activeResponseId = null;
          this.responseInProgress = false;
          this.currentResponseId = null;
          this.pendingResponseRoundId = null;
          this.pendingCreateForRoundId = null;
          this.assistantText = '';
          this.assistantAudioChunks = [];
        }
        return;
      }

      if (type === 'error') {
        const nested = parsed.error as Record<string, unknown> | undefined;
        const message =
          (typeof nested?.message === 'string' && nested.message) ||
          (typeof parsed.message === 'string' && parsed.message) ||
          'openai_realtime_ws_error';
        log('realtime_error', {
          rawType: type,
          message,
        });
        if (/Conversation already has an active response in progress/i.test(message)) {
          log('v2_realtime_active_response_error_ignored', {
            rawType: type,
            message,
            activeResponseId: this.activeResponseId,
            responseInProgress: this.responseInProgress,
            pendingCreateForRoundId: this.pendingCreateForRoundId,
            lastCreateSentRoundId: this.lastCreateSentRoundId,
          });
          this.responseInProgress = Boolean(this.activeResponseId || this.currentResponseId);
          this.onEvent?.({ type: 'error', message, rawType: type, nonFatal: true });
          return;
        }
        this.onEvent?.({ type: 'error', message, rawType: type });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'openai_realtime_ws_parse_failed';
      this.onEvent?.({ type: 'error', message, rawType: 'parse_error' });
    }
  }
}

function atobCompatible(base64: string) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  let bufferLength = clean.length * 0.75;
  if (clean.endsWith('==')) bufferLength -= 2;
  else if (clean.endsWith('=')) bufferLength -= 1;

  const bytes = new Uint8Array(bufferLength);
  let byteIndex = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const encoded1 = chars.indexOf(clean[i] ?? 'A');
    const encoded2 = chars.indexOf(clean[i + 1] ?? 'A');
    const encoded3 = chars.indexOf(clean[i + 2] ?? 'A');
    const encoded4 = chars.indexOf(clean[i + 3] ?? 'A');
    const triple =
      ((encoded1 & 63) << 18) |
      ((encoded2 & 63) << 12) |
      (((encoded3 < 0 ? 0 : encoded3) & 63) << 6) |
      ((encoded4 < 0 ? 0 : encoded4) & 63);
    if (byteIndex < bytes.length) bytes[byteIndex++] = (triple >> 16) & 0xff;
    if (byteIndex < bytes.length) bytes[byteIndex++] = (triple >> 8) & 0xff;
    if (byteIndex < bytes.length) bytes[byteIndex++] = triple & 0xff;
  }
  return bytes;
}

function extractResponseId(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.response_id === 'string' && record.response_id.trim()) {
    return record.response_id;
  }
  if (typeof record.id === 'string' && record.id.trim() && record.type === 'response') {
    return record.id;
  }
  const response = record.response;
  if (response && typeof response === 'object') {
    const responseRecord = response as Record<string, unknown>;
    if (typeof responseRecord.id === 'string' && responseRecord.id.trim()) {
      return responseRecord.id;
    }
  }
  const item = record.item;
  if (item && typeof item === 'object') {
    const itemRecord = item as Record<string, unknown>;
    if (typeof itemRecord.response_id === 'string' && itemRecord.response_id.trim()) {
      return itemRecord.response_id;
    }
  }
  return null;
}

function extractEventTextDelta(event: Record<string, unknown>) {
  const candidates = [
    typeof event.delta === 'string' ? event.delta : '',
    typeof event.text === 'string' ? event.text : '',
    typeof event.transcript === 'string' ? event.transcript : '',
  ];

  const itemText = extractTextFragments(event.item);
  const responseText = extractTextFragments(event.response);

  return [...candidates, itemText, responseText].find((value) => Boolean(value)) ?? '';
}

function extractEventDoneText(event: Record<string, unknown>) {
  const itemText = extractTextFragments(event.item);
  if (itemText) {
    return itemText;
  }
  return extractResponseDoneText(event);
}

function extractResponseDoneText(event: Record<string, unknown>) {
  return extractTextFragments(event.response);
}

function extractTextFragments(value: unknown): string {
  const parts: string[] = [];
  collectTextFragments(value, parts);
  return parts.join('');
}

function collectTextFragments(value: unknown, parts: string[]) {
  if (value == null) {
    return;
  }
  if (typeof value === 'string') {
    if (value) {
      parts.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTextFragments(item, parts);
    }
    return;
  }
  if (typeof value !== 'object') {
    return;
  }

  const record = value as Record<string, unknown>;
  const directTextKeys = ['text', 'transcript', 'delta'];
  for (const key of directTextKeys) {
    const field = record[key];
    if (typeof field === 'string' && field) {
      parts.push(field);
    }
  }

  const nestedKeys = ['response', 'output', 'content', 'item', 'parts'];
  for (const key of nestedKeys) {
    if (key in record) {
      collectTextFragments(record[key], parts);
    }
  }
}

function mergeAssistantText(existing: string, next: string) {
  const current = existing.trim();
  const incoming = next.trim();
  if (!incoming) {
    return existing;
  }
  if (!current) {
    return incoming;
  }
  if (current === incoming || current.endsWith(incoming)) {
    return existing;
  }
  if (incoming.includes(current)) {
    return incoming;
  }
  return `${existing}${next}`;
}
