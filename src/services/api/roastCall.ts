import { env } from '@/lib/env';

export type RoastReaction = 'laugh_crazy' | 'laugh_mocking' | 'no_way' | 'bruh' | 'none';
export type RoastNextAction = 'repeat' | 'continue';
export type RoastReplyMode = 'correction' | 'conversation' | 'mixed';

export type RoastReply = {
  mode?: RoastReplyMode;
  reaction: RoastReaction;
  spokenText: string;
  correction: {
    hasCorrection?: boolean;
    wrong: string;
    right: string;
    reason: string;
  };
  nextPrompt?: string;
  nextAction: RoastNextAction;
  durationMs?: number;
};

export type RoastTranscription = {
  text: string;
  durationMs?: number;
  service?: string;
  mode?: string;
  fileSize?: number;
  mimeType?: string | null;
  fileName?: string | null;
  textLength?: number;
  formDataParsedMs?: number;
  gatewayRequestSentMs?: number | null;
  gatewayResponseMs?: number | null;
  responseTextReadMs?: number;
  timings?: Record<string, number | null | undefined>;
};

export type RoastTextTurnStream = {
  reply: RoastReply;
  streamUrl: string;
  metrics?: Record<string, number | string | boolean | null | undefined>;
};

export type RoastTurnStreamV2Event =
  | {
      type: 'llm_started';
      provider?: string;
      model?: string;
      timeoutMs?: number;
      elapsedMs?: number;
      serverElapsedMs?: number;
      clientElapsedMs?: number;
      clientMinusServerMs?: number | null;
    }
  | {
      type: 'spoken_text_ready';
      spokenText: string;
      voiceSpokenText?: string;
      cardExtraText?: string;
      streamUrl?: string;
      mode?: RoastReplyMode;
      provider?: string;
      model?: string;
      firstTokenMs?: number | null;
      spokenTextReadyMs?: number | null;
      ttsStreamReadyMs?: number | null;
      billingFastPathMs?: number | null;
      ttsModelId?: string;
      spokenTextLength?: number;
      voiceSpokenTextLength?: number;
      wasVoiceTrimmed?: boolean;
      trimReason?: string;
      elapsedMs?: number;
      serverElapsedMs?: number;
      clientElapsedMs?: number;
      clientMinusServerMs?: number | null;
    }
  | {
      type: 'tts_stream_ready';
      streamUrl: string;
      provider?: string;
      model?: string;
      ttsStreamReadyMs?: number | null;
      voiceSpokenTextLength?: number;
      wasVoiceTrimmed?: boolean;
      trimReason?: string;
      serverElapsedMs?: number;
      clientElapsedMs?: number;
      clientMinusServerMs?: number | null;
    }
  | {
      type: 'reply_ready';
      reply: RoastReply;
      metrics?: Record<string, number | string | boolean | null | undefined>;
      serverElapsedMs?: number;
      clientElapsedMs?: number;
      clientMinusServerMs?: number | null;
    }
  | {
      type: 'error';
      error: string;
      message?: string;
      provider?: string;
      model?: string;
      durationMs?: number;
      serverElapsedMs?: number;
      clientElapsedMs?: number;
      clientMinusServerMs?: number | null;
    }
  | {
      type: 'done';
      durationMs?: number;
      serverElapsedMs?: number;
      clientElapsedMs?: number;
      clientMinusServerMs?: number | null;
    };

export type RoastTurnStreamV2Result = {
  reply?: RoastReply;
  streamUrl?: string;
  metrics?: Record<string, number | string | boolean | null | undefined>;
  events: RoastTurnStreamV2Event[];
};

export type RoastTurnStreamV3Event = RoastTurnStreamV2Event;

export type RoastTurnStreamV3Result = {
  reply?: RoastReply;
  streamUrl?: string;
  metrics?: Record<string, number | string | boolean | null | undefined>;
  events: RoastTurnStreamV3Event[];
};

export type RoastTranslationSource = 'assistant_reply' | 'recent_turn';

export type RoastTranslationResult = {
  translationZh: string;
};

export type RoastTurnStreamV2Handlers = {
  onLlmStarted?: (event: Extract<RoastTurnStreamV2Event, { type: 'llm_started' }>) => void | Promise<void>;
  onSpokenTextReady?: (event: Extract<RoastTurnStreamV2Event, { type: 'spoken_text_ready' }>) => void | Promise<void>;
  onTtsStreamReady?: (event: Extract<RoastTurnStreamV2Event, { type: 'tts_stream_ready' }>) => void | Promise<void>;
  onReplyReady?: (event: Extract<RoastTurnStreamV2Event, { type: 'reply_ready' }>) => void | Promise<void>;
  onDone?: (event: Extract<RoastTurnStreamV2Event, { type: 'done' }>) => void | Promise<void>;
  onError?: (event: Extract<RoastTurnStreamV2Event, { type: 'error' }>) => void | Promise<void>;
  onEvent?: (event: RoastTurnStreamV2Event) => void | Promise<void>;
};

export type RoastTurnStreamV3Handlers = RoastTurnStreamV2Handlers;

export type RoastTurnHistoryItem = {
  user: string;
  assistant: string;
  mode?: RoastReplyMode | string;
};

export type RoastLanguageIntent = {
  wantsChineseExplanation: boolean;
  wantsTranslationHelp: boolean;
  userSpokeChinese: boolean;
  userSpokeEnglish: boolean;
  likelyAsrMisheardChineseRequest: boolean;
  reason: string;
};

function buildApiUrl(path: string) {
  return `${env.apiBaseUrl.replace(/\/$/, '')}${path}`;
}

function normalizeApiUrl(pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return buildApiUrl(pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`);
}

export const ROAST_STREAM_TEST_TEXT = 'Bruh. Say: I really like this app. Run it back.';

export function buildRoastTtsStreamTestUrl(text = ROAST_STREAM_TEST_TEXT) {
  return `${buildApiUrl('/api/mobile/roast/tts-stream-test')}?text=${encodeURIComponent(text)}`;
}

// Production-safe greeting endpoint. Backend whitelists the text and rate-limits
// per-IP, so it is safe to call without auth. Use this in Release; DEV builds
// can keep using buildRoastTtsStreamTestUrl for free-form local testing.
export function buildRoastGreetingProdUrl(text: string) {
  return `${buildApiUrl('/api/mobile/roast/greeting-stream')}?text=${encodeURIComponent(text)}`;
}

export function buildRoastTtsHlsTestUrl(text = ROAST_STREAM_TEST_TEXT) {
  return `${buildApiUrl('/api/mobile/roast/tts-hls-test/playlist.m3u8')}?text=${encodeURIComponent(text)}`;
}

function truncatePreview(text: string, maxLength = 260) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

async function assertOk(response: Response, fallback: string) {
  if (response.ok) return;
  const text = await response.text().catch(() => '');
  throw new Error(truncatePreview(text) || fallback);
}

export async function transcribeRoastAudio(input: {
  audioUri: string;
  fileName?: string;
  mimeType?: string;
  fastMode?: boolean;
}): Promise<RoastTranscription> {
  const formData = new FormData();
  formData.append('audio', {
    uri: input.audioUri,
    name: input.fileName || `roast-recording-${Date.now()}.m4a`,
    type: input.mimeType || 'audio/m4a',
  } as any);
  if (input.fastMode) {
    formData.append('fastMode', 'true');
  }

  const response = await fetch(buildApiUrl('/api/mobile/roast/transcribe'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
    body: formData,
  });

  await assertOk(response, 'Roast transcription failed.');
  return (await response.json()) as RoastTranscription;
}

export async function createRoastReply(text: string, coachId = 'la_bro_roast'): Promise<RoastReply> {
  const response = await fetch(buildApiUrl('/api/mobile/roast/respond'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text, coachId }),
  });

  await assertOk(response, 'Roast reply failed.');
  return (await response.json()) as RoastReply;
}

export async function translateRoastText(input: {
  text: string;
  source?: RoastTranslationSource;
  turnId?: string;
  accessToken?: string | null;
}): Promise<RoastTranslationResult> {
  const response = await fetch(buildApiUrl('/api/mobile/roast/translate'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(input.accessToken ? { Authorization: `Bearer ${input.accessToken}` } : {}),
    },
    body: JSON.stringify({
      text: input.text,
      source: input.source ?? 'assistant_reply',
      turnId: input.turnId,
    }),
  });

  await assertOk(response, '翻译暂时不可用。');
  return (await response.json()) as RoastTranslationResult;
}

export async function createRoastTextTurnStream(input: {
  text: string;
  coachId: string;
  history?: RoastTurnHistoryItem[];
}): Promise<RoastTextTurnStream> {
  const response = await fetch(buildApiUrl('/api/mobile/roast/turn-text-stream'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  await assertOk(response, 'Roast text turn stream failed.');
  const payload = (await response.json()) as RoastTextTurnStream;
  return {
    ...payload,
    streamUrl: normalizeApiUrl(payload.streamUrl),
  };
}

function parseRoastTurnStreamV2Event(eventName: string, rawJson: string): RoastTurnStreamV2Event | null {
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    if (eventName === 'tts_stream_ready' && typeof parsed.streamUrl === 'string') {
      return {
        ...(parsed as any),
        type: 'tts_stream_ready',
        streamUrl: normalizeApiUrl(parsed.streamUrl),
      };
    }
    return {
      ...(parsed as any),
      type: eventName,
    } as RoastTurnStreamV2Event;
  } catch {
    return null;
  }
}

function parseRoastTurnStreamV2SseBlock(block: string): RoastTurnStreamV2Event | null {
  let eventName = 'message';
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }
  const data = dataLines.join('\n').trim();
  if (!data) return null;
  return parseRoastTurnStreamV2Event(eventName, data);
}

export async function createRoastTurnStreamV2(
  input: {
    text: string;
    coachId: string;
    history?: RoastTurnHistoryItem[];
  },
  onEvent: (event: RoastTurnStreamV2Event) => void | Promise<void>,
  options: { signal?: AbortSignal } = {},
): Promise<RoastTurnStreamV2Result> {
  const requestStartedAt = Date.now();
  const response = await fetch(buildApiUrl('/api/mobile/roast/turn-stream-v2'), {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
    signal: options.signal,
  });

  await assertOk(response, 'Roast turn stream v2 failed.');
  const events: RoastTurnStreamV2Event[] = [];
  const result: RoastTurnStreamV2Result = { events };
  const reader = response.body?.getReader?.();

  const handleEvent = async (event: RoastTurnStreamV2Event) => {
    const clientElapsedMs = Date.now() - requestStartedAt;
    const serverElapsedMs = typeof (event as any).serverElapsedMs === 'number' ? (event as any).serverElapsedMs : undefined;
    (event as any).clientElapsedMs = clientElapsedMs;
    (event as any).clientMinusServerMs = typeof serverElapsedMs === 'number'
      ? clientElapsedMs - serverElapsedMs
      : null;
    console.log('[ROAST_TURN_STREAM_V2_EVENT_TIMING]', JSON.stringify({
      eventType: event.type,
      serverElapsedMs: serverElapsedMs ?? null,
      clientElapsedMs,
      clientMinusServerMs: (event as any).clientMinusServerMs,
      provider: (event as any).provider ?? (event.type === 'reply_ready' ? event.metrics?.provider : null) ?? null,
      model: (event as any).model ?? (event.type === 'reply_ready' ? event.metrics?.model : null) ?? null,
    }));
    events.push(event);
    if (event.type === 'tts_stream_ready') {
      result.streamUrl = event.streamUrl;
    } else if (event.type === 'spoken_text_ready' && typeof event.streamUrl === 'string') {
      result.streamUrl = event.streamUrl;
    } else if (event.type === 'reply_ready') {
      result.reply = event.reply;
      result.metrics = event.metrics;
    }
    await onEvent(event);
  };

  if (!reader) {
    const rawText = await response.text();
    for (const block of rawText.split(/\n\n+/)) {
      const event = parseRoastTurnStreamV2SseBlock(block.trim());
      if (event) {
        await handleEvent(event);
      }
    }
    return result;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\n\n/);
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const event = parseRoastTurnStreamV2SseBlock(block.trim());
      if (event) {
        await handleEvent(event);
      }
    }
  }
  if (buffer.trim()) {
    const event = parseRoastTurnStreamV2SseBlock(buffer.trim());
    if (event) {
      await handleEvent(event);
    }
  }
  return result;
}

export function startRoastTurnStreamV2(
  input: {
    text: string;
    coachId: string;
    history?: RoastTurnHistoryItem[];
    turnId?: string;
  },
  handlers: RoastTurnStreamV2Handlers = {},
) {
  const abortController = new AbortController();
  const promise = createRoastTurnStreamV2(
    input,
    async (event) => {
      await handlers.onEvent?.(event);
      switch (event.type) {
        case 'llm_started':
          await handlers.onLlmStarted?.(event);
          break;
        case 'spoken_text_ready':
          await handlers.onSpokenTextReady?.(event);
          break;
        case 'tts_stream_ready':
          await handlers.onTtsStreamReady?.(event);
          break;
        case 'reply_ready':
          await handlers.onReplyReady?.(event);
          break;
        case 'done':
          await handlers.onDone?.(event);
          break;
        case 'error':
          await handlers.onError?.(event);
          break;
        default:
          break;
      }
    },
    { signal: abortController.signal },
  );

  return {
    turnId: input.turnId,
    promise,
    abort: () => abortController.abort(),
  };
}

function parseRoastTurnStreamV3Line(line: string): RoastTurnStreamV3Event | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (
      (parsed.type === 'tts_stream_ready' || parsed.type === 'spoken_text_ready')
      && typeof parsed.streamUrl === 'string'
    ) {
      return {
        ...(parsed as any),
        streamUrl: normalizeApiUrl(parsed.streamUrl),
      } as RoastTurnStreamV3Event;
    }
    return parsed as RoastTurnStreamV3Event;
  } catch {
    return null;
  }
}

export async function createRoastTurnStreamV3(
  input: {
    text: string;
    coachId: string;
    history?: RoastTurnHistoryItem[];
    turnId?: string;
    sessionId?: string;
    accessToken?: string | null;
    languageIntent?: RoastLanguageIntent;
  },
  onEvent: (event: RoastTurnStreamV3Event) => void | Promise<void>,
  options: { signal?: AbortSignal } = {},
): Promise<RoastTurnStreamV3Result> {
  const requestStartedAt = Date.now();
  const response = await fetch(buildApiUrl('/api/mobile/roast/turn-stream-v3'), {
    method: 'POST',
    headers: {
      Accept: 'application/x-ndjson',
      'Content-Type': 'application/json',
      ...(input.accessToken ? { Authorization: `Bearer ${input.accessToken}` } : {}),
    },
    body: JSON.stringify({
      text: input.text,
      coachId: input.coachId,
      history: input.history,
      turnId: input.turnId,
      sessionId: input.sessionId,
      languageIntent: input.languageIntent,
    }),
    signal: options.signal,
  });

  await assertOk(response, 'Roast turn stream v3 failed.');
  const events: RoastTurnStreamV3Event[] = [];
  const result: RoastTurnStreamV3Result = { events };
  const reader = response.body?.getReader?.();

  const handleEvent = async (event: RoastTurnStreamV3Event) => {
    const clientElapsedMs = Date.now() - requestStartedAt;
    const serverElapsedMs = typeof (event as any).serverElapsedMs === 'number' ? (event as any).serverElapsedMs : undefined;
    (event as any).clientElapsedMs = clientElapsedMs;
    (event as any).clientMinusServerMs = typeof serverElapsedMs === 'number'
      ? clientElapsedMs - serverElapsedMs
      : null;
    console.log('[ROAST_TURN_STREAM_V3_EVENT_TIMING]', JSON.stringify({
      eventType: event.type,
      serverElapsedMs: serverElapsedMs ?? null,
      clientElapsedMs,
      clientMinusServerMs: (event as any).clientMinusServerMs,
      provider: (event as any).provider ?? (event.type === 'reply_ready' ? event.metrics?.provider : null) ?? null,
      model: (event as any).model ?? (event.type === 'reply_ready' ? event.metrics?.model : null) ?? null,
    }));
    events.push(event);
    if (event.type === 'tts_stream_ready') {
      result.streamUrl = event.streamUrl;
    } else if (event.type === 'reply_ready') {
      result.reply = event.reply;
      result.metrics = event.metrics;
    }
    await onEvent(event);
  };

  if (!reader) {
    const rawText = await response.text();
    for (const line of rawText.split(/\r?\n/)) {
      const event = parseRoastTurnStreamV3Line(line);
      if (event) {
        await handleEvent(event);
      }
    }
    return result;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const event = parseRoastTurnStreamV3Line(line);
      if (event) {
        await handleEvent(event);
      }
    }
  }
  if (buffer.trim()) {
    const event = parseRoastTurnStreamV3Line(buffer);
    if (event) {
      await handleEvent(event);
    }
  }
  return result;
}

export function startRoastTurnStreamV3(
  input: {
    text: string;
    coachId: string;
    history?: RoastTurnHistoryItem[];
    turnId?: string;
    sessionId?: string;
    accessToken?: string | null;
    languageIntent?: RoastLanguageIntent;
  },
  handlers: RoastTurnStreamV3Handlers = {},
) {
  const abortController = new AbortController();
  const promise = createRoastTurnStreamV3(
    input,
    async (event) => {
      await handlers.onEvent?.(event);
      switch (event.type) {
        case 'llm_started':
          await handlers.onLlmStarted?.(event);
          break;
        case 'spoken_text_ready':
          await handlers.onSpokenTextReady?.(event);
          break;
        case 'tts_stream_ready':
          await handlers.onTtsStreamReady?.(event);
          break;
        case 'reply_ready':
          await handlers.onReplyReady?.(event);
          break;
        case 'done':
          await handlers.onDone?.(event);
          break;
        case 'error':
          await handlers.onError?.(event);
          break;
        default:
          break;
      }
    },
    { signal: abortController.signal },
  );

  return {
    turnId: input.turnId,
    promise,
    abort: () => abortController.abort(),
  };
}

export async function fetchRoastTtsAudio(text: string): Promise<ArrayBuffer> {
  const response = await fetch(buildApiUrl('/api/mobile/roast/tts'), {
    method: 'POST',
    headers: {
      Accept: 'audio/mpeg',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  await assertOk(response, 'Roast TTS failed.');
  return await response.arrayBuffer();
}

export async function fetchRoastTtsStream(text: string): Promise<Response> {
  const response = await fetch(buildApiUrl('/api/mobile/roast/tts-stream'), {
    method: 'POST',
    headers: {
      Accept: 'audio/mpeg',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  await assertOk(response, 'Roast TTS stream failed.');
  return response;
}
