import { env } from '@/lib/env';
import type { StoredSession } from '@/types/auth';
import type {
  SpeakingV2RealtimeCallRequest,
  SpeakingV2RealtimeCallResponse,
  SpeakingV2RealtimeSessionResponse,
  SpeakingV2RealtimeTokenResponse,
} from '@/types/speakingV2';

function buildSpeakingApiUrl(path: string) {
  return `${env.apiBaseUrl.replace(/\/$/, '')}${path}`;
}

function normalizeBaseUrl(baseUrl?: string | null) {
  return (baseUrl || '').trim().replace(/\/+$/, '');
}

function joinApiUrl(baseUrl: string, path: string) {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

type SpeakingApiErrorCode =
  | 'credits_exhausted'
  | 'input_too_large'
  | 'rate_limited'
  | 'unauthorized'
  | 'forbidden'
  | 'invalid_request'
  | 'session_inactive'
  | 'timeout'
  | 'gateway_error'
  | 'service_error'
  | 'service_unavailable'
  | 'configuration_error'
  | 'internal_error'
  | 'unknown_error';

interface SpeakingApiErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
}

export class SpeakingApiError extends Error {
  code: SpeakingApiErrorCode | string;
  status?: number;
  rawMessage?: string;
  contentType?: string;

  constructor(
    code: SpeakingApiErrorCode | string,
    message: string,
    options?: { status?: number; rawMessage?: string; contentType?: string },
  ) {
    super(message);
    this.name = 'SpeakingApiError';
    this.code = code;
    this.status = options?.status;
    this.rawMessage = options?.rawMessage;
    this.contentType = options?.contentType;
  }
}

export function isSpeakingAuthError(error: unknown): error is SpeakingApiError {
  return error instanceof SpeakingApiError && error.code === 'unauthorized';
}

function getSpeakingApiErrorMessage(code?: string, fallback?: string) {
  const messageMap: Record<string, string> = {
    credits_exhausted: '额度已用完，请先补充 AI 练习额度。',
    input_too_large: '本次输入过长，请缩短后再试。',
    rate_limited: '请求过于频繁，请稍后再试。',
    unauthorized: '请先登录后再继续。',
    forbidden: '无权访问当前口语资源。',
    invalid_request: '当前请求参数无效。',
    session_inactive: '会话已结束，请重新开始练习。',
    timeout: '请求超时，请检查网络后重试。',
    gateway_error: 'AI 服务暂时不可用，请稍后再试。',
    service_error: '口语服务异常，请稍后再试。',
    service_unavailable: '口语服务暂时不可用，请稍后再试。',
    configuration_error: '口语服务配置异常，请联系管理员。',
    internal_error: '系统内部错误，请稍后再试。',
  };
  return (code && messageMap[code]) || fallback || '口语服务请求失败，请稍后再试。';
}

function truncateApiPreview(text: string, maxLength = 180) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function buildSpeakingApiError(status: number, text: string, contentType?: string | null): Error {
  let parsed: SpeakingApiErrorResponse | null = null;
  try {
    parsed = JSON.parse(text) as SpeakingApiErrorResponse;
  } catch {
    parsed = null;
  }

  const preview = truncateApiPreview(parsed?.error || text || `HTTP ${status}`);

  const code =
    parsed?.code ||
    (status === 401
      ? 'unauthorized'
      : status === 403
        ? 'forbidden'
        : status === 402 || status === 409
          ? 'credits_exhausted'
          : status === 413
            ? 'input_too_large'
            : status === 429
              ? 'rate_limited'
              : status >= 500 && status < 600
                ? 'service_error'
                : 'unknown_error');

  return new SpeakingApiError(
    code,
    getSpeakingApiErrorMessage(code, preview || `HTTP ${status}`),
    {
      status,
      rawMessage: preview || `HTTP ${status}`,
      contentType: contentType ?? undefined,
    },
  );
}

async function createSpeakingApiResponse(
  path: string,
  session: StoredSession,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${session.accessToken}`);

  const response = await fetch(buildSpeakingApiUrl(path), {
    ...init,
    headers,
  });

  if (!response.ok) {
    const contentType = response.headers.get('content-type') ?? response.headers.get('Content-Type');
    const text = await response.text().catch(() => '');
    throw buildSpeakingApiError(response.status, text, contentType);
  }

  return response;
}

async function fetchSpeakingApiJson<T>(
  path: string,
  session: StoredSession,
  init?: RequestInit,
): Promise<T> {
  return fetchSpeakingApiJsonByUrl<T>(buildSpeakingApiUrl(path), session, init);
}

async function fetchSpeakingApiJsonByUrl<T>(
  url: string,
  session: StoredSession,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  headers.set('Authorization', `Bearer ${session.accessToken}`);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const contentType = response.headers.get('content-type') ?? response.headers.get('Content-Type');
    const text = await response.text().catch(() => '');
    throw buildSpeakingApiError(response.status, text, contentType);
  }

  const contentType = response.headers.get('content-type') ?? response.headers.get('Content-Type') ?? '';
  if (!/application\/json/i.test(contentType)) {
    const bodyPreview = truncateApiPreview(await response.text().catch(() => ''), 180) || 'unexpected_non_json_response';
    throw new SpeakingApiError(
      'service_error',
      `Unexpected response content type: ${contentType || 'unknown'}`,
      {
        status: response.status,
        rawMessage: bodyPreview,
        contentType,
      },
    );
  }

  return (await response.json()) as T;
}

export interface SpeakingCredits {
  balanceCredits: number;
  giftedCreditsTotal: number;
  purchasedCreditsTotal: number;
  consumedCreditsTotal: number;
  scenarioTurnsTotal: number;
  freeChatTurnsTotal: number;
  scenarioCreditsConsumed: number;
  freeChatCreditsConsumed: number;
  turnsUntilNextScenarioDeduct: number;
  turnsUntilNextFreeChatDeduct: number;
}

export interface SpeakingChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface SpeakingChatReply {
  reply: string;
  translation?: string;
  hint?: string;
}

export interface SpeakingScoreResult {
  fluency: number;
  accuracy: number;
  vocabulary: number;
  overall: number;
  errors: Array<{
    wrong: string;
    correct: string;
    reason: string;
  }>;
  suggestion: string;
  correction?: {
    type: 'error' | 'ok' | 'tip';
    original: string;
    fixed?: string;
    reason?: string;
  };
  pronScores?: Array<{
    word: string;
    score: number;
  }>;
}

export interface SpeakingExpressionStyleResult {
  expression: string;
  explanationZh: string;
  score: number | null;
}

export interface SpeakingExpressionStylesResponse {
  americanCasual: SpeakingExpressionStyleResult;
  businessFormal: SpeakingExpressionStyleResult;
  britishNatural: SpeakingExpressionStyleResult;
}

export interface SpeakingMessageTranslationResponse {
  translation: string;
}

export interface SpeakingSessionCreateResponse {
  sessionId: string;
  status: 'active';
  mode: 'scenario' | 'free_chat';
}

export interface SpeakingSessionProgressResponse {
  sessionId: string;
  turnCount: number;
  consumedCredits: number;
  creditsDeductedThisCall: number;
  balanceCreditsAfter: number | null;
  status: 'active' | 'completed' | 'aborted';
}

export interface SpeakingSessionCompleteResponse {
  sessionId: string;
  status: 'completed' | 'aborted';
  turnCount: number;
  consumedCredits: number;
  startedAt: string;
  endedAt: string;
  transcriptJson: unknown[];
  scoreJson: Record<string, unknown> | null;
}

export type SpeakingChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'meta'; translation?: string; hint?: string }
  | { type: 'done' }
  | { type: 'error'; code: SpeakingApiErrorCode | string; message: string };

function summarizeChatDebugText(text: string, maxLength = 300) {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function parseSpeakingChatJsonText(rawText: string): SpeakingChatReply | null {
  try {
    const parsed = JSON.parse(rawText) as Partial<SpeakingChatReply>;
    if (typeof parsed.reply === 'string' && parsed.reply.trim()) {
      return {
        reply: parsed.reply,
        translation: typeof parsed.translation === 'string' ? parsed.translation : undefined,
        hint: typeof parsed.hint === 'string' ? parsed.hint : undefined,
      };
    }
  } catch {
    return null;
  }
  return null;
}

function parseSpeakingChatSseText(rawText: string): SpeakingChatStreamEvent[] {
  const events: SpeakingChatStreamEvent[] = [];
  const lines = rawText.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('data:')) continue;
    const rawJson = trimmed.slice(5).trim();
    if (!rawJson) continue;

    try {
      const parsed = JSON.parse(rawJson) as SpeakingChatStreamEvent;
      events.push(parsed);
    } catch {
      // ignore malformed SSE lines
    }
  }

  return events;
}

export async function fetchSpeakingCredits(session: StoredSession) {
  return fetchSpeakingApiJson<SpeakingCredits>('/api/ai-practice/credits', session);
}

export async function createSpeakingSession(
  session: StoredSession,
  input: { scenarioId: string; mode: 'scenario' | 'free_chat' },
) {
  return fetchSpeakingApiJson<SpeakingSessionCreateResponse>('/api/ai-practice/sessions', session, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateSpeakingSessionProgress(
  session: StoredSession,
  sessionId: string,
  turnCount: number,
) {
  return fetchSpeakingApiJson<SpeakingSessionProgressResponse>(
    `/api/ai-practice/sessions/${encodeURIComponent(sessionId)}/progress`,
    session,
    {
      method: 'POST',
      body: JSON.stringify({ turnCount }),
    },
  );
}

export async function completeSpeakingSession(
  session: StoredSession,
  sessionId: string,
  payload?: {
    status?: 'completed' | 'aborted';
    transcriptJson?: unknown;
    scoreJson?: unknown;
  },
) {
  return fetchSpeakingApiJson<SpeakingSessionCompleteResponse>(
    `/api/ai-practice/sessions/${encodeURIComponent(sessionId)}/complete`,
    session,
    {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    },
  );
}

export async function createSpeakingRealtimeSession(
  session: StoredSession,
  input: {
    scenarioId: string;
    mode: 'scenario' | 'free_chat';
  },
) {
  return fetchSpeakingApiJson<SpeakingV2RealtimeSessionResponse>(
    '/api/ai-practice/realtime/session',
    session,
    {
      method: 'POST',
      body: JSON.stringify({
        scenarioId: input.scenarioId,
        mode: input.mode,
      }),
    },
  );
}

export async function getSpeakingRealtimeToken(
  session: StoredSession,
  input: {
    scenarioId: string;
    scenarioName: string;
    aiName: string;
    aiRole: string;
    systemPrompt: string;
  },
) {
  return fetchSpeakingApiJson<SpeakingV2RealtimeTokenResponse>(
    '/api/ai-practice/realtime/token',
    session,
    {
      method: 'POST',
      body: JSON.stringify({
        scenarioId: input.scenarioId,
        scenarioName: input.scenarioName,
        aiName: input.aiName,
        aiRole: input.aiRole,
        systemPrompt: input.systemPrompt,
      }),
    },
  );
}

export async function createSpeakingRealtimeCall(
  input: SpeakingV2RealtimeCallRequest,
): Promise<SpeakingV2RealtimeCallResponse> {
  const url = buildSpeakingApiUrl('/api/ai-practice/realtime/calls');
  console.log('[V2_RUNTIME] calls:url', url);
  console.log('[V2_RUNTIME] calls:request', input.sdp.length);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.ephemeralKey}`,
      'Content-Type': 'application/sdp',
      Accept: 'application/sdp, text/plain, application/json',
    },
    body: input.sdp,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.log('[V2_RUNTIME] calls:error', response.status, text.slice(0, 180));
    throw buildSpeakingApiError(response.status, text);
  }

  const answerSdp = await response.text();
  console.log('[V2_RUNTIME] calls:response', response.status, answerSdp.length);
  return {
    answerSdp,
    contentType: response.headers.get('content-type') ?? 'application/sdp',
    status: response.status,
  };
}

export async function transcribeSpeakingAudio(
  session: StoredSession,
  input: {
    uri: string;
    fileName?: string;
    mimeType?: string;
  },
) {
  const resolvedFileName = input.fileName?.trim() || `recording-${Date.now()}.m4a`;
  const resolvedMimeType = input.mimeType?.trim() || 'audio/m4a';
  console.log(
    `[V1_RECORDING_DEBUG] transcribe_input = ${JSON.stringify({
      uri: input.uri,
      isFileUri: input.uri.startsWith('file://'),
      fileName: resolvedFileName,
      mimeType: resolvedMimeType,
    })}`,
  );

  const formData = new FormData();
  console.log(
    `[V1_RECORDING_DEBUG] transcribe_formdata_append = ${JSON.stringify({
      field: 'file',
      uri: input.uri,
      fileName: resolvedFileName,
      mimeType: resolvedMimeType,
    })}`,
  );
  formData.append('file', {
    uri: input.uri,
    name: resolvedFileName,
    type: resolvedMimeType,
  } as any);

  const response = await createSpeakingApiResponse('/api/ai-practice/transcribe', session, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
    body: formData,
  });

  return (await response.json()) as { text: string };
}

export async function sendSpeakingChatMessage(
  session: StoredSession,
  input: {
    message: string;
    history: SpeakingChatHistoryItem[];
    scenarioId: string;
  },
) {
  return fetchSpeakingApiJson<SpeakingChatReply>('/api/ai-practice/chat', session, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function generateSpeakingExpressionStyles(
  session: StoredSession,
  input: {
    transcript: string;
    scenarioId: string;
    scenarioTitle: string;
    level: string;
    currentBetterExpression: string;
    currentExplanationZh: string;
  },
) {
  const webApiBase = normalizeBaseUrl(env.webApiBaseUrl) || normalizeBaseUrl(env.apiBaseUrl);
  const url = joinApiUrl(webApiBase, '/api/ai-practice/expression-styles');
  console.log(
    `[V1_PCM_DUAL] expression_styles_request_start = ${JSON.stringify({
      url,
      method: 'POST',
      webApiBase,
      transcriptPreview: input.transcript.slice(0, 120),
      betterExpressionPreview: input.currentBetterExpression.slice(0, 120),
    })}`,
  );
  return fetchSpeakingApiJsonByUrl<SpeakingExpressionStylesResponse>(url, session, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function translateSpeakingMessage(
  session: StoredSession,
  input: {
    text: string;
    role: 'assistant' | 'user';
    scenarioId?: string;
    scenarioTitle?: string;
    level?: string;
    previousUserText?: string;
    previousAssistantText?: string;
    roundId?: number;
    betterExpression?: string;
  },
) {
  const webApiBase = normalizeBaseUrl(env.webApiBaseUrl) || normalizeBaseUrl(env.apiBaseUrl);
  const url = joinApiUrl(webApiBase, '/api/ai-practice/message-translate');
  return fetchSpeakingApiJsonByUrl<SpeakingMessageTranslationResponse>(url, session, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function* streamSpeakingChatMessage(
  session: StoredSession,
  input: {
    message: string;
    history: SpeakingChatHistoryItem[];
    scenarioId: string;
  },
  signal?: AbortSignal,
): AsyncGenerator<SpeakingChatStreamEvent> {
  const chatUrl = buildSpeakingApiUrl('/api/ai-practice/chat');
  console.log(
    `[V1_CHAT_DEBUG] request = ${JSON.stringify({
      url: chatUrl,
      scenarioId: input.scenarioId,
      messageLength: input.message.length,
      historyCount: input.history.length,
      stream: true,
    })}`,
  );

  const response = await createSpeakingApiResponse('/api/ai-practice/chat', session, {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      stream: true,
    }),
    signal,
    headers: {
      Accept: 'text/event-stream, application/json',
      'Content-Type': 'application/json',
    },
  });

  const contentType = response.headers.get('Content-Type') ?? response.headers.get('content-type') ?? '';
  console.log(
    `[V1_CHAT_DEBUG] response_meta = ${JSON.stringify({
      status: response.status,
      ok: response.ok,
      contentType,
      hasReader: typeof response.body?.getReader === 'function',
    })}`,
  );
  const reader = response.body?.getReader?.();

  if (!contentType.includes('text/event-stream') || !reader) {
    const rawText = await response.text();
    console.log(
      `[V1_CHAT_DEBUG] response_text = ${JSON.stringify({
        status: response.status,
        contentType,
        preview: summarizeChatDebugText(rawText),
      })}`,
    );

    const jsonReply = parseSpeakingChatJsonText(rawText);
    if (jsonReply) {
      console.log('[V1_CHAT_DEBUG] parse_mode = json');
      yield { type: 'delta', text: jsonReply.reply };
      if (jsonReply.translation || jsonReply.hint) {
        yield { type: 'meta', translation: jsonReply.translation, hint: jsonReply.hint };
      }
      yield { type: 'done' };
      return;
    }

    const sseEvents = parseSpeakingChatSseText(rawText);
    if (sseEvents.length > 0) {
      console.log(
        `[V1_CHAT_DEBUG] parse_mode = ${JSON.stringify({
          mode: 'sse_text_fallback',
          eventCount: sseEvents.length,
        })}`,
      );
      for (const event of sseEvents) {
        yield event;
      }
      return;
    }

    console.log(
      `[V1_CHAT_DEBUG] parse_failed = ${JSON.stringify({
        status: response.status,
        contentType,
        preview: summarizeChatDebugText(rawText),
      })}`,
    );
    throw new Error('AI 回复返回格式异常');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const rawJson = trimmed.slice(5).trim();
      if (!rawJson) continue;

      try {
        yield JSON.parse(rawJson) as SpeakingChatStreamEvent;
      } catch {
        // ignore malformed SSE lines
      }
    }
  }
}

export async function scoreSpeakingMessage(
  session: StoredSession,
  input: {
    userText: string;
    scenarioId: string;
    scenarioTitle?: string;
    assistantPreviousMessage?: string;
    level?: string;
  },
) {
  return fetchSpeakingApiJson<SpeakingScoreResult>('/api/ai-practice/score', session, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function ttsSpeakingText(
  session: StoredSession,
  input: {
    text: string;
    voice?: string;
  },
) {
  const response = await createSpeakingApiResponse('/api/ai-practice/tts', session, {
    method: 'POST',
    body: JSON.stringify(input),
    headers: {
      Accept: 'audio/mpeg',
      'Content-Type': 'application/json',
    },
  });

  return response.arrayBuffer();
}
