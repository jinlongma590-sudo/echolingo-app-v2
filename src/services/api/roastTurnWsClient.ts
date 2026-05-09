import { env } from '@/lib/env';
import type {
  RoastLanguageIntent,
  RoastReply,
  RoastTurnHistoryItem,
  RoastTurnStreamV3Event,
  RoastTurnStreamV3Handlers,
  RoastTurnStreamV3Result,
} from '@/services/api/roastCall';

type RoastTurnWsTurnEvent = RoastTurnStreamV3Event & {
  turnId?: string;
  errorType?: string;
  deltaMs?: number | null;
};

type RoastTurnWsEvent =
  | RoastTurnWsTurnEvent
  | {
      type: 'ready';
      protocol?: string;
    };

type PendingTurn = {
  turnId: string;
  startedAt: number;
  handlers: RoastTurnStreamV3Handlers;
  resolve: (result: RoastTurnStreamV3Result) => void;
  reject: (error: Error) => void;
  result: RoastTurnStreamV3Result;
};

const ROAST_TURN_WS_READY_TIMEOUT_MS = 3500;

export type RoastTurnWsClient = {
  readyPromise: Promise<void>;
  startTurn: (
    input: {
      turnId: string;
      text: string;
      coachId: string;
      history?: RoastTurnHistoryItem[];
      languageIntent?: RoastLanguageIntent;
    },
    handlers?: RoastTurnStreamV3Handlers,
  ) => {
    promise: Promise<RoastTurnStreamV3Result>;
    abort: () => void;
  };
  cancelTurn: (turnId: string) => void;
  sendUserSpeechStarted: (sessionId?: string | null) => boolean;
  close: () => void;
  isReady: () => boolean;
  getSocketState: () => string;
};

type ConnectRoastTurnWsOptions = {
  accessToken?: string | null;
  sessionId?: string | null;
};

function buildRoastTurnWsUrl() {
  const configured = process.env.EXPO_PUBLIC_ROAST_TURN_WS_URL?.trim();
  // Release also honors the env override so production builds can target
  // wss://echolingo.cn/api/mobile/roast/turn-ws without code changes.
  if (configured) return configured;

  const apiUrl = new URL(env.apiBaseUrl);
  const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  // The 3001 dev-server port is only used in DEV when the API base resolves
  // to a local IP. Release always reuses the API host's port (or none) and
  // expects nginx to reverse-proxy /api/mobile/roast/turn-ws to the ws server.
  const port = __DEV__ && (apiUrl.hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(apiUrl.hostname))
    ? '3001'
    : apiUrl.port;
  return `${protocol}//${apiUrl.hostname}${port ? `:${port}` : ''}/api/mobile/roast/turn-ws`;
}

function normalizeApiUrl(pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${env.apiBaseUrl.replace(/\/$/, '')}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
}

function annotateEvent(event: RoastTurnWsTurnEvent, startedAt: number) {
  const clientElapsedMs = Date.now() - startedAt;
  const serverElapsedMs = typeof event.serverElapsedMs === 'number' ? event.serverElapsedMs : undefined;
  (event as any).clientElapsedMs = clientElapsedMs;
  (event as any).clientMinusServerMs = typeof serverElapsedMs === 'number'
    ? clientElapsedMs - serverElapsedMs
    : null;
  (event as any).deltaMs = (event as any).clientMinusServerMs;
  if (
    (event.type === 'tts_stream_ready' || event.type === 'spoken_text_ready')
    && typeof event.streamUrl === 'string'
  ) {
    event.streamUrl = normalizeApiUrl(event.streamUrl);
  }
  return event as RoastTurnStreamV3Event;
}

function logLatencyTrace(phase: string, fields: Record<string, unknown> = {}) {
  console.log('[ROAST_LATENCY_TRACE]', JSON.stringify({
    phase,
    ...fields,
  }));
}

async function dispatchEvent(pending: PendingTurn, event: RoastTurnStreamV3Event) {
  pending.result.events.push(event);
  if (event.type === 'tts_stream_ready') {
    pending.result.streamUrl = event.streamUrl;
  } else if (event.type === 'spoken_text_ready' && typeof event.streamUrl === 'string') {
    pending.result.streamUrl = event.streamUrl;
  } else if (event.type === 'reply_ready') {
    pending.result.reply = event.reply as RoastReply;
    pending.result.metrics = event.metrics;
  }

  await pending.handlers.onEvent?.(event);
  switch (event.type) {
    case 'llm_started':
      await pending.handlers.onLlmStarted?.(event);
      break;
    case 'spoken_text_ready':
      await pending.handlers.onSpokenTextReady?.(event);
      break;
    case 'tts_stream_ready':
      await pending.handlers.onTtsStreamReady?.(event);
      break;
    case 'reply_ready':
      await pending.handlers.onReplyReady?.(event);
      break;
    case 'done':
      await pending.handlers.onDone?.(event);
      pending.resolve(pending.result);
      break;
    case 'error':
      await pending.handlers.onError?.(event);
      pending.reject(new Error(event.message || event.error || 'Roast WebSocket turn failed.'));
      break;
    default:
      break;
  }
}

export function connectRoastTurnWs(options: ConnectRoastTurnWsOptions = {}): RoastTurnWsClient {
  const url = buildRoastTurnWsUrl();
  const socket = new WebSocket(url);
  const pendingTurns = new Map<string, PendingTurn>();
  let ready = false;
  let closed = false;
  let resolveReady: () => void = () => undefined;
  let rejectReady: (error: Error) => void = () => undefined;
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const readyTimeout = setTimeout(() => {
    if (ready || closed) return;
    const error = new Error('Roast WebSocket ready timeout.');
    console.log('[ROAST_WS_CLIENT]', JSON.stringify({ eventType: 'ready_timeout', timeoutMs: ROAST_TURN_WS_READY_TIMEOUT_MS }));
    rejectReady(error);
    try {
      socket.close();
    } catch {
      // ignore close failures
    }
  }, ROAST_TURN_WS_READY_TIMEOUT_MS);

  console.log('[ROAST_WS_CLIENT]', JSON.stringify({ eventType: 'connect_start', urlHost: url.replace(/^(wss?:\/\/[^/]+).*$/i, '$1') }));

  socket.onopen = () => {
    socket.send(JSON.stringify({
      type: 'hello',
      clientId: `app-${Date.now().toString(36)}`,
      protocol: 'roast-turn-v4',
      accessToken: options.accessToken || undefined,
      sessionId: options.sessionId || undefined,
    }));
    console.log('[ROAST_WS_CLIENT]', JSON.stringify({ eventType: 'socket_open' }));
  };

  socket.onerror = () => {
    const error = new Error('Roast WebSocket connection failed.');
    console.log('[ROAST_WS_CLIENT]', JSON.stringify({ eventType: 'socket_error' }));
    if (!ready) rejectReady(error);
  };

  socket.onclose = () => {
    closed = true;
    console.log('[ROAST_WS_CLIENT]', JSON.stringify({ eventType: 'socket_close' }));
    const error = new Error('Roast WebSocket closed.');
    for (const pending of pendingTurns.values()) {
      pending.reject(error);
    }
    pendingTurns.clear();
    if (!ready) rejectReady(error);
  };

  socket.onmessage = (message) => {
    try {
      const event = JSON.parse(String(message.data)) as RoastTurnWsEvent;
      if (event.type === 'ready') {
        ready = true;
        clearTimeout(readyTimeout);
        console.log('[ROAST_WS_CLIENT]', JSON.stringify({ eventType: 'ready', protocol: event.protocol ?? null }));
        resolveReady();
        return;
      }

      const turnId = event.turnId;
      const pending = turnId ? pendingTurns.get(turnId) : null;
      if (!pending) {
        console.log('[ROAST_WS_CLIENT]', JSON.stringify({ eventType: 'ignored_event_without_pending_turn', type: event.type, turnId: turnId ?? null }));
        return;
      }
      const annotated = annotateEvent(event, pending.startedAt);
      console.log('[ROAST_WS_CLIENT_EVENT_TIMING]', JSON.stringify({
        eventType: annotated.type,
        turnId,
        serverElapsedMs: (annotated as any).serverElapsedMs ?? null,
        clientElapsedMs: (annotated as any).clientElapsedMs ?? null,
        clientMinusServerMs: (annotated as any).clientMinusServerMs ?? null,
        deltaMs: (annotated as any).deltaMs ?? null,
        provider: (annotated as any).provider ?? (annotated.type === 'reply_ready' ? annotated.metrics?.provider : null) ?? null,
        model: (annotated as any).model ?? (annotated.type === 'reply_ready' ? annotated.metrics?.model : null) ?? null,
      }));
      logLatencyTrace(`ws_event_${annotated.type}`, {
        turnId,
        elapsedMs: (annotated as any).clientElapsedMs ?? null,
        deltaMs: (annotated as any).clientMinusServerMs ?? null,
        transport: 'ws_v4',
        provider: (annotated as any).provider ?? (annotated.type === 'reply_ready' ? annotated.metrics?.provider : null) ?? null,
        model: (annotated as any).model ?? (annotated.type === 'reply_ready' ? annotated.metrics?.model : null) ?? null,
        status: 'received',
      });
      void dispatchEvent(pending, annotated).then(() => {
        if ((annotated.type === 'done' || annotated.type === 'error') && turnId) {
          pendingTurns.delete(turnId);
        }
      }).catch((error) => {
        if (turnId) pendingTurns.delete(turnId);
        pending.reject(error instanceof Error ? error : new Error('Roast WebSocket handler failed.'));
      });
    } catch (error) {
      console.log('[ROAST_WS_CLIENT]', JSON.stringify({ eventType: 'message_parse_error', message: error instanceof Error ? error.message : 'unknown' }));
    }
  };

  return {
    readyPromise,
    startTurn(input, handlers = {}) {
      const promise = new Promise<RoastTurnStreamV3Result>((resolve, reject) => {
        if (closed || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
          reject(new Error('Roast WebSocket is closed.'));
          return;
        }
        const pending: PendingTurn = {
          turnId: input.turnId,
          startedAt: Date.now(),
          handlers,
          resolve,
          reject,
          result: { events: [] },
        };
        pendingTurns.set(input.turnId, pending);
        try {
          socket.send(JSON.stringify({
            type: 'start_turn',
            turnId: input.turnId,
            text: input.text,
            coachId: input.coachId,
            sessionId: options.sessionId || undefined,
            accessToken: options.accessToken || undefined,
            history: input.history ?? [],
            languageIntent: input.languageIntent,
          }));
          console.log('[ROAST_WS_CLIENT]', JSON.stringify({
            eventType: 'start_turn_sent',
            turnId: input.turnId,
            textLength: input.text.length,
            historyLength: input.history?.length ?? 0,
            languageIntent: input.languageIntent ?? null,
          }));
          logLatencyTrace('ws_start_turn_sent', {
            turnId: input.turnId,
            elapsedMs: 0,
            textLength: input.text.length,
            transport: 'ws_v4',
            status: 'sent',
          });
        } catch (caught) {
          pendingTurns.delete(input.turnId);
          reject(caught instanceof Error ? caught : new Error('Roast WebSocket start_turn send failed.'));
        }
      });
      return {
        promise,
        abort: () => {
          pendingTurns.delete(input.turnId);
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'cancel_turn', turnId: input.turnId }));
          }
        },
      };
    },
    cancelTurn(turnId) {
      pendingTurns.delete(turnId);
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'cancel_turn', turnId }));
      }
    },
    sendUserSpeechStarted(sessionId) {
      const normalizedSessionId = sessionId?.trim();
      if (!normalizedSessionId) {
        console.log('[ROAST_WS_CLIENT]', JSON.stringify({ eventType: 'user_speech_started_skip', reason: 'missing_session' }));
        return false;
      }
      if (closed) {
        console.log('[ROAST_WS_CLIENT]', JSON.stringify({ eventType: 'user_speech_started_skip', reason: 'socket_closed', sessionId: normalizedSessionId }));
        return false;
      }
      if (!ready || socket.readyState !== WebSocket.OPEN) {
        console.log('[ROAST_WS_CLIENT]', JSON.stringify({
          eventType: 'user_speech_started_skip',
          reason: !ready ? 'ws_not_ready' : 'socket_not_open',
          sessionId: normalizedSessionId,
          socketState: socket.readyState,
        }));
        return false;
      }
      socket.send(JSON.stringify({
        type: 'user_speech_started',
        sessionId: normalizedSessionId,
      }));
      console.log('[ROAST_WS_CLIENT]', JSON.stringify({ eventType: 'user_speech_started_sent', sessionId: normalizedSessionId }));
      return true;
    },
    close() {
      closed = true;
      for (const turnId of pendingTurns.keys()) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'cancel_turn', turnId }));
        }
      }
      pendingTurns.clear();
      clearTimeout(readyTimeout);
      socket.close();
    },
    isReady() {
      return ready && socket.readyState === WebSocket.OPEN;
    },
    getSocketState() {
      switch (socket.readyState) {
        case WebSocket.CONNECTING:
          return 'connecting';
        case WebSocket.OPEN:
          return 'open';
        case WebSocket.CLOSING:
          return 'closing';
        case WebSocket.CLOSED:
          return 'closed';
        default:
          return 'unknown';
      }
    },
  };
}
