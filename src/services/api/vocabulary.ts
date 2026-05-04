import * as FileSystem from 'expo-file-system/legacy';

import { env } from '@/lib/env';
import type { StoredSession } from '@/types/auth';
import { buildRestTableUrl, buildSupabaseUrl } from '@/services/supabase/rest';

type JoinedBook =
  | {
      slug: string | null;
      title: string | null;
      word_count: number | null;
      is_active?: boolean | null;
    }
  | Array<{
      slug: string | null;
      title: string | null;
      word_count: number | null;
      is_active?: boolean | null;
    }>
  | null;

type ProgressRow = {
  word_id: string | null;
  book_id: string | null;
  status: 'due' | 'mastered' | 'mistake';
  last_status: 'due' | 'mastered' | 'mistake' | null;
  next_review_at: string | null;
  last_reviewed_at: string | null;
  updated_at?: string | null;
  created_at: string;
  review_count: number | null;
  mistake_count: number | null;
  vocabulary_books: JoinedBook;
};

type BookRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  word_count: number;
  is_active: boolean;
};

type JoinedWord =
  | {
      id?: string | null;
      word: string | null;
      phonetic: string | null;
      definition_zh: string | null;
      definition_en: string | null;
      example_en: string | null;
      example_zh: string | null;
      metadata?: { pattern?: string } | null;
    }
  | Array<{
      id?: string | null;
      word: string | null;
      phonetic: string | null;
      definition_zh: string | null;
      definition_en: string | null;
      example_en: string | null;
      example_zh: string | null;
      metadata?: { pattern?: string } | null;
    }>
  | null;

type NotebookProgressRow = Omit<ProgressRow, 'vocabulary_books'> & {
  vocabulary_books: JoinedBook;
  vocabulary_words: JoinedWord;
};

type PlanRow = {
  id: string;
  daily_new_target: number;
  daily_review_target: number;
  daily_mistake_target: number;
  daily_minutes_target: number;
  weekly_study_days: number;
  weekly_words_target: number;
  weekly_reviews_target: number;
  monthly_words_target: number;
  monthly_study_days_target: number;
  focus_book_slug: string | null;
  learning_preference: 'new_first' | 'review_first' | 'balanced';
  long_term_goal_type: 'finish_book_by_date' | 'finish_book_in_days' | 'clear_backlog_in_days';
  long_term_goal_value: number;
  long_term_goal_deadline: string | null;
  created_at: string;
  updated_at: string;
};

type ProgressMutationRow = {
  status?: NotebookStatus | null;
  review_count?: number | null;
  mistake_count?: number | null;
  exposure_count?: number | null;
  known_count?: number | null;
  unsure_count?: number | null;
  unknown_count?: number | null;
};

export type ProgressActivity = {
  wordId: string;
  status: NotebookStatus;
  lastStatus: NotebookStatus | null;
  nextReviewAt: string | null;
  lastReviewedAt: string | null;
  createdAt: string;
  reviewCount: number;
  mistakeCount: number;
  bookSlug: string;
  bookTitle: string;
};

function mapProgressRowsToActivities(rows: ProgressRow[]) {
  return rows
    .map((row): ProgressActivity | null => {
      const book = firstJoin(row.vocabulary_books);
      if (!row.word_id) return null;
      return {
        wordId: row.word_id,
        status: row.status,
        lastStatus: row.last_status,
        nextReviewAt: row.next_review_at,
        lastReviewedAt: row.last_reviewed_at,
        createdAt: row.created_at,
        reviewCount: row.review_count ?? 0,
        mistakeCount: row.mistake_count ?? 0,
        bookSlug: book?.slug ?? '',
        bookTitle: book?.title ?? '当前词书',
      };
    })
    .filter((row): row is ProgressActivity => row !== null);
}

export async function fetchVocabularyProgressActivity(session: StoredSession): Promise<ProgressActivity[]> {
  const userId = session.user?.id;
  if (!userId) {
    throw new VocabularyApiError('auth_required', '登录状态已失效，请重新登录。');
  }

  const progressRows = await fetchSupabaseAuthedJson<ProgressRow[]>(
    `/rest/v1/user_vocabulary_progress?select=word_id,status,last_status,next_review_at,last_reviewed_at,created_at,review_count,mistake_count,vocabulary_books(slug,title,word_count)&user_id=eq.${userId}`,
    session,
  );

  return mapProgressRowsToActivities(progressRows);
}

function firstJoin<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function sameDay(left: string | null | undefined, right: Date) {
  if (!left) return false;
  const date = new Date(left);
  return (
    date.getFullYear() === right.getFullYear() &&
    date.getMonth() === right.getMonth() &&
    date.getDate() === right.getDate()
  );
}

function buildAppApiUrl(path: string) {
  return `${env.apiBaseUrl.replace(/\/$/, '')}${path}`;
}

let vocabularyDataRevision = 0;
const vocabularyDataRefreshListeners = new Set<() => void>();

export function subscribeVocabularyDataRefresh(listener: () => void) {
  vocabularyDataRefreshListeners.add(listener);
  return () => {
    vocabularyDataRefreshListeners.delete(listener);
  };
}

export function notifyVocabularyDataChanged(reason: string) {
  vocabularyDataRevision += 1;
  console.log('vocabulary_data_changed', {
    reason,
    revision: vocabularyDataRevision,
  });
  for (const listener of vocabularyDataRefreshListeners) {
    try {
      listener();
    } catch (error) {
      console.warn('vocabulary_data_refresh_listener_failed', {
        reason,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export class VocabularyApiError extends Error {
  code: 'auth_required' | 'request_failed';
  status?: number;
  rawMessage?: string;

  constructor(
    code: 'auth_required' | 'request_failed',
    message: string,
    options?: { status?: number; rawMessage?: string },
  ) {
    super(message);
    this.name = 'VocabularyApiError';
    this.code = code;
    this.status = options?.status;
    this.rawMessage = options?.rawMessage;
  }
}

function extractApiErrorMessage(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return '';

  try {
    const payload = JSON.parse(trimmed) as { error?: string; message?: string };
    return payload.error ?? payload.message ?? trimmed;
  } catch {
    return trimmed;
  }
}

function isAuthSessionError(message: string, status?: number) {
  if (status === 401) return true;
  const normalized = message.toLowerCase();
  return (
    normalized.includes('auth session missing') ||
    normalized.includes('session missing') ||
    normalized.includes('unauthenticated') ||
    normalized.includes('unauthorized') ||
    normalized.includes('jwt expired') ||
    normalized.includes('invalid jwt') ||
    normalized.includes('invalid claim') ||
    normalized.includes('invalid token')
  );
}

export function isVocabularyAuthError(error: unknown): error is VocabularyApiError {
  return error instanceof VocabularyApiError && error.code === 'auth_required';
}

const VOCABULARY_API_TIMEOUT_MS = 30_000;

async function fetchVocabularyApiJson<T>(
  path: string,
  session: StoredSession,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  headers.set('Authorization', `Bearer ${session.accessToken}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VOCABULARY_API_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(buildAppApiUrl(path), {
      ...init,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn('[vocabulary] fetch_timeout', { path, timeoutMs: VOCABULARY_API_TIMEOUT_MS });
      throw new VocabularyApiError('request_failed', '请求超时，请检查网络后重试。', { rawMessage: 'timeout' });
    }
    throw err;
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const text = await response.text();
    const message = extractApiErrorMessage(text) || `Vocabulary API failed: ${response.status}`;
    if (isAuthSessionError(message, response.status)) {
      throw new VocabularyApiError('auth_required', '登录状态已失效，请重新登录。', {
        status: response.status,
        rawMessage: message,
      });
    }
    throw new VocabularyApiError('request_failed', '暂时无法获取数据，请稍后重试。', {
      status: response.status,
      rawMessage: message,
    });
  }

  return (await response.json()) as T;
}

async function fetchSupabaseAuthedJson<T>(
  path: string,
  session: StoredSession,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  headers.set('apikey', env.supabaseAnonKey);
  headers.set('Authorization', `Bearer ${session.accessToken}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VOCABULARY_API_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(buildSupabaseUrl(path), {
      ...init,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn('[vocabulary] supabase_fetch_timeout', { path, timeoutMs: VOCABULARY_API_TIMEOUT_MS });
      throw new VocabularyApiError('request_failed', '请求超时，请检查网络后重试。', { rawMessage: 'timeout' });
    }
    throw err;
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const text = await response.text();
    const message = extractApiErrorMessage(text) || `Supabase request failed: ${response.status}`;
    if (isAuthSessionError(message, response.status)) {
      throw new VocabularyApiError('auth_required', '登录状态已失效，请重新登录。', {
        status: response.status,
        rawMessage: message,
      });
    }
    throw new VocabularyApiError('request_failed', '暂时无法获取数据，请稍后重试。', {
      status: response.status,
      rawMessage: message,
    });
  }

  return (await response.json()) as T;
}

function normalizeBookSlug(title: string) {
  if (title === '四级核心词汇') return 'cet4-core';
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'cet4-core';
}

async function readDashboardInsightsCacheFile() {
  if (!DASHBOARD_INSIGHTS_CACHE_FILE) return {} as Record<string, VocabularyDashboardInsightsCacheEntry>;

  try {
    const exists = await FileSystem.getInfoAsync(DASHBOARD_INSIGHTS_CACHE_FILE);
    if (!exists.exists) return {};
    const raw = await FileSystem.readAsStringAsync(DASHBOARD_INSIGHTS_CACHE_FILE);
    return (JSON.parse(raw) as Record<string, VocabularyDashboardInsightsCacheEntry>) ?? {};
  } catch {
    return {};
  }
}

async function writeDashboardInsightsCacheFile(data: Record<string, VocabularyDashboardInsightsCacheEntry>) {
  if (!DASHBOARD_INSIGHTS_CACHE_FILE) return;

  try {
    await FileSystem.writeAsStringAsync(DASHBOARD_INSIGHTS_CACHE_FILE, JSON.stringify(data));
  } catch {
    return;
  }
}

export async function readCachedVocabularyDashboardInsights(userId: string) {
  const cache = await readDashboardInsightsCacheFile();
  return cache[userId] ?? null;
}

export async function writeCachedVocabularyDashboardInsights(
  userId: string,
  entry: VocabularyDashboardInsightsCacheEntry,
) {
  if (entry.insight.heroInsight.isSample || entry.insight.panelAnalysis.isSample) return;

  const cache = await readDashboardInsightsCacheFile();
  cache[userId] = {
    ...entry,
    savedAt: entry.savedAt || Date.now(),
  };
  await writeDashboardInsightsCacheFile(cache);
}

function formatNextReview(value: string | null) {
  if (!value) return '待安排';

  const date = new Date(value);
  if (date.getTime() <= Date.now()) return '现在到期';

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildProgressStats(words: NotebookWord[]): VocabularyProgressStats {
  const now = Date.now();
  const dueNow = words.filter((word) => {
    if (!word.nextReviewAt) return word.status === 'due' || word.status === 'mistake';
    return Date.parse(word.nextReviewAt) <= now;
  }).length;

  return {
    all: words.length,
    due: words.filter((word) => word.status === 'due').length,
    dueNow,
    mastered: words.filter((word) => word.status === 'mastered').length,
    mistake: words.filter((word) => word.status === 'mistake').length,
  };
}

const VOCABULARY_KNOWN_REVIEW_INTERVAL_DAYS = [1, 2, 4, 7, 15, 30] as const;

type VocabularyReviewSchedule = {
  status: NotebookStatus;
  nextReviewAt: string;
  derivedStageBefore: number;
  derivedStageAfter: number;
};

function deriveVocabularyMasteryStage(snapshot?: ProgressMutationRow | null) {
  const knownCount = Math.max(snapshot?.known_count ?? 0, 0);
  const unsureCount = Math.max(snapshot?.unsure_count ?? 0, 0);
  const unknownCount = Math.max(snapshot?.unknown_count ?? 0, 0);
  const derivedStage = knownCount - unknownCount - Math.floor(unsureCount / 2);
  return Math.max(0, Math.min(VOCABULARY_KNOWN_REVIEW_INTERVAL_DAYS.length, derivedStage));
}

function calculateVocabularyReviewSchedule(
  existing: ProgressMutationRow | null | undefined,
  result: ReviewResult,
  now = new Date(),
): VocabularyReviewSchedule {
  const nextCounters: ProgressMutationRow = {
    known_count: Math.max(existing?.known_count ?? 0, 0) + (result === 'known' ? 1 : 0),
    unsure_count: Math.max(existing?.unsure_count ?? 0, 0) + (result === 'unsure' ? 1 : 0),
    unknown_count: Math.max(existing?.unknown_count ?? 0, 0) + (result === 'unknown' ? 1 : 0),
  };
  const derivedStageBefore = deriveVocabularyMasteryStage(existing);
  const derivedStageAfter = deriveVocabularyMasteryStage(nextCounters);
  const nextReviewAt = new Date(now);

  if (result === 'unknown') {
    nextReviewAt.setHours(nextReviewAt.getHours() + 2);
    return {
      status: 'mistake',
      nextReviewAt: nextReviewAt.toISOString(),
      derivedStageBefore,
      derivedStageAfter,
    };
  }

  if (result === 'unsure') {
    nextReviewAt.setDate(nextReviewAt.getDate() + 1);
    return {
      status: 'due',
      nextReviewAt: nextReviewAt.toISOString(),
      derivedStageBefore,
      derivedStageAfter,
    };
  }

  const stageIndex = Math.max(derivedStageAfter - 1, 0);
  const intervalDays =
    VOCABULARY_KNOWN_REVIEW_INTERVAL_DAYS[
      Math.min(stageIndex, VOCABULARY_KNOWN_REVIEW_INTERVAL_DAYS.length - 1)
    ];
  nextReviewAt.setDate(nextReviewAt.getDate() + intervalDays);

  return {
    status:
      derivedStageAfter >= VOCABULARY_KNOWN_REVIEW_INTERVAL_DAYS.length ? 'mastered' : 'due',
    nextReviewAt: nextReviewAt.toISOString(),
    derivedStageBefore,
    derivedStageAfter,
  };
}

function nextReviewDateForStatus(status: NotebookStatus) {
  const date = new Date();
  if (status === 'mastered') {
    date.setDate(date.getDate() + 7);
  }
  return date.toISOString();
}

function addDays(base: Date, days: number) {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfWeek(date: Date) {
  const next = startOfDay(date);
  const offset = (next.getDay() + 6) % 7;
  next.setDate(next.getDate() - offset);
  return next;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfWeek(date: Date) {
  const next = startOfWeek(date);
  next.setDate(next.getDate() + 7);
  return next;
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

function dayKey(value: string) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function coerceInt(value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(Math.round(parsed), min, max);
}

function normalizeVocabularyPlanInput(
  input: Partial<TodayPlanResponse['plan']> | null | undefined,
  fallbackFocusBookSlug: string,
  validBookSlugs: Set<string>,
): TodayPlanResponse['plan'] {
  const defaultPlan = buildDefaultVocabularyPlan(fallbackFocusBookSlug, toDateInput(addDays(new Date(), 90)));

  const focusBookSlug =
    typeof input?.focusBookSlug === 'string' && validBookSlugs.has(input.focusBookSlug)
      ? input.focusBookSlug
      : fallbackFocusBookSlug;

  const learningPreference =
    input?.learningPreference === 'new_first' ||
    input?.learningPreference === 'review_first' ||
    input?.learningPreference === 'balanced'
      ? input.learningPreference
      : defaultPlan.learningPreference;

  const longTermGoalType =
    input?.longTermGoalType === 'finish_book_by_date' ||
    input?.longTermGoalType === 'finish_book_in_days' ||
    input?.longTermGoalType === 'clear_backlog_in_days'
      ? input.longTermGoalType
      : defaultPlan.longTermGoalType;

  const deadline =
    typeof input?.longTermGoalDeadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.longTermGoalDeadline)
      ? input.longTermGoalDeadline
      : defaultPlan.longTermGoalDeadline;

  return {
    id: input?.id,
    createdAt: input?.createdAt,
    updatedAt: input?.updatedAt,
    dailyNewTarget: coerceInt(input?.dailyNewTarget, defaultPlan.dailyNewTarget, 0, 300),
    dailyReviewTarget: coerceInt(input?.dailyReviewTarget, defaultPlan.dailyReviewTarget, 0, 1000),
    dailyMistakeTarget: coerceInt(input?.dailyMistakeTarget, defaultPlan.dailyMistakeTarget, 0, 200),
    dailyMinutesTarget: coerceInt(input?.dailyMinutesTarget, defaultPlan.dailyMinutesTarget, 5, 360),
    weeklyStudyDays: coerceInt(input?.weeklyStudyDays, defaultPlan.weeklyStudyDays, 1, 7),
    weeklyWordsTarget: coerceInt(input?.weeklyWordsTarget, defaultPlan.weeklyWordsTarget, 0, 3000),
    weeklyReviewsTarget: coerceInt(input?.weeklyReviewsTarget, defaultPlan.weeklyReviewsTarget, 0, 5000),
    monthlyWordsTarget: coerceInt(input?.monthlyWordsTarget, defaultPlan.monthlyWordsTarget, 0, 12000),
    monthlyStudyDaysTarget: coerceInt(input?.monthlyStudyDaysTarget, defaultPlan.monthlyStudyDaysTarget, 1, 31),
    focusBookSlug,
    learningPreference,
    longTermGoalType,
    longTermGoalValue: coerceInt(input?.longTermGoalValue, defaultPlan.longTermGoalValue, 1, 365),
    longTermGoalDeadline: deadline,
  };
}

function serializeVocabularyPlan(plan: TodayPlanResponse['plan'], userId: string) {
  return {
    user_id: userId,
    daily_new_target: plan.dailyNewTarget,
    daily_review_target: plan.dailyReviewTarget,
    daily_mistake_target: plan.dailyMistakeTarget,
    daily_minutes_target: plan.dailyMinutesTarget,
    weekly_study_days: plan.weeklyStudyDays,
    weekly_words_target: plan.weeklyWordsTarget,
    weekly_reviews_target: plan.weeklyReviewsTarget,
    monthly_words_target: plan.monthlyWordsTarget,
    monthly_study_days_target: plan.monthlyStudyDaysTarget,
    focus_book_slug: plan.focusBookSlug || null,
    learning_preference: plan.learningPreference,
    long_term_goal_type: plan.longTermGoalType,
    long_term_goal_value: plan.longTermGoalValue,
    long_term_goal_deadline: plan.longTermGoalDeadline || null,
  };
}

export interface VocabularyDashboard {
  todayDueCount: number;
  completedTodayCount: number;
  myWordsCount: number;
  mistakeWordsCount: number;
  masteryRate: number;
  activeBooksCount: number;
  books: Array<{
    slug: string;
    title: string;
    totalWords: number;
    masteredWords: number;
    dueWords: number;
    mistakeWords: number;
  }>;
}

export type NotebookStatus = 'due' | 'mastered' | 'mistake';
export type ReviewResult = 'known' | 'unsure' | 'unknown';
export type ReviewMode = 'learn' | 'review' | 'mistake';

export type NotebookWord = {
  word: string;
  phonetic: string;
  meaning: string;
  english: string;
  example: string;
  exampleZh: string;
  book: string;
  bookSlug?: string;
  status: NotebookStatus;
  nextReview: string;
  nextReviewAt?: string;
  lastReviewedAt?: string;
  reviewCount?: number;
  mistakeCount?: number;
  lastStatus?: NotebookStatus;
  pattern?: string;
};

export type VocabularyProgressStats = {
  all: number;
  due: number;
  dueNow: number;
  mastered: number;
  mistake: number;
};

export type VocabularyProgressResponse = {
  words: NotebookWord[];
  stats: VocabularyProgressStats;
};

export type VocabularyReviewStats = {
  known: number;
  unsure: number;
  unknown: number;
};

export type AiAnalysisSource = 'mock' | 'base' | 'deepseek' | 'ai';

export type ReviewDeckWord = {
  wordId?: string;
  word: string;
  phonetic: string;
  accent: string;
  bookSlug?: string;
  bookTitle?: string;
  chinese: string;
  english: string | null;
  example: string | null;
  exampleZh: string | null;
  memoryCue: string;
  pattern: string;
  aiNote: string | null;
  aiAnalysis: {
    source: AiAnalysisSource;
    version: 'v1';
    word: string;
    contextualMeaning: string;
    confusableWords: Array<{ word: string; difference: string }>;
    collocations: Array<{ phrase: string; meaning: string }>;
    memoryAdvice: string;
    speakingExpression: string | null;
    errorReason: string;
    predictedRetention: string | null;
    bestReviewWindow: string | null;
  };
  reviewCount?: number;
  mistakeCount?: number;
  pronunciation?: {
    accent: 'us' | 'uk';
    staticUrl?: string;
    storageKey?: string;
    status?: 'ready' | 'missing' | 'collecting' | 'failed';
  };
};

export type ReviewQueueResponse = {
  mode?: ReviewMode;
  book: {
    slug: string;
    title: string;
  };
  words: ReviewDeckWord[];
  totalCount?: number;
  dueCount?: number;
  progress?: {
    currentOffset?: number;
    learnedCount?: number;
    loadedCount?: number;
    remainingCount?: number;
  };
  window?: {
    initial?: boolean;
    limit?: number;
    cursor?: string | null;
    nextCursor?: string | null;
  };
};

export type TodayPlanResponse = {
  plan: {
    id?: string;
    dailyNewTarget: number;
    dailyReviewTarget: number;
    dailyMistakeTarget: number;
    dailyMinutesTarget: number;
    weeklyStudyDays: number;
    weeklyWordsTarget: number;
    weeklyReviewsTarget: number;
    monthlyWordsTarget: number;
    monthlyStudyDaysTarget: number;
    focusBookSlug: string;
    learningPreference: 'new_first' | 'review_first' | 'balanced';
    longTermGoalType: 'finish_book_by_date' | 'finish_book_in_days' | 'clear_backlog_in_days';
    longTermGoalValue: number;
    longTermGoalDeadline: string;
    createdAt?: string;
    updatedAt?: string;
  };
  books: Array<{
    slug: string;
    title: string;
    wordCount: number;
  }>;
  summary: {
    backlog: {
      trackedWords: number;
      masteredCount: number;
      dueCount: number;
      dueNowCount: number;
      mistakeCount: number;
    };
    today: {
      todayNewPlanned: number;
      todayReviewPlanned: number;
      todayMistakePlanned: number;
      todayWorkedWords: number;
      todayNewCompleted: number;
      todayOldWordReviewed: number;
      todayReviewCompleted: number;
      todayMistakeCompleted: number;
      remainingNew: number;
      remainingReview: number;
      remainingMistake: number;
      extraDueReviewAvailable: number;
      estimatedMinutes: number;
      recommendedPrimaryAction: 'learn' | 'review' | 'mistake';
      recommendedPrimaryHref: string;
      recommendedPrimaryLabel: string;
      recommendedBookSlug: string;
      recommendedBookTitle: string;
      recommendedSequence: Array<{
        action: 'learn' | 'review' | 'mistake';
        label: string;
        detail: string;
        href: string;
      }>;
      todayPlanOffset: number;
    };
    week: {
      completed: number;
      target: number;
      percentage: number;
      delta: number;
      note: string;
      reviewCompleted: number;
      studyDaysCompleted: number;
      studyDaysTarget: number;
    };
    month: {
      completed: number;
      target: number;
      percentage: number;
      delta: number;
      note: string;
      studyDaysCompleted: number;
      studyDaysTarget: number;
    };
    longTerm: {
      type: 'finish_book_by_date' | 'finish_book_in_days' | 'clear_backlog_in_days';
      title: string;
      detail: string;
      progressPercent: number;
      remainingWords: number;
      daysLeft: number | null;
      projectedFinishDays: number | null;
      isBehind: boolean;
    };
    focusBook: {
      slug: string;
      title: string;
      totalWords: number;
      learnedWords: number;
      remainingWords: number;
      percentage: number;
    };
    suggestions: Array<{
      title: string;
      detail: string;
      tone: 'blue' | 'amber' | 'green' | 'red';
    }>;
  };
};

function normalizePlannedDueReviewCount(input: {
  dueNowCount: number;
  dailyReviewTarget: number;
  rawPlannedReview: number;
}) {
  const dueNowCount = Math.max(input.dueNowCount, 0);
  const dailyReviewTarget = Math.max(input.dailyReviewTarget, 0);
  const rawPlannedReview = Math.max(input.rawPlannedReview, 0);

  if (dailyReviewTarget <= 0) {
    return Math.min(rawPlannedReview, dueNowCount);
  }

  return Math.min(rawPlannedReview, dueNowCount, dailyReviewTarget);
}

function normalizeTodaySummary(
  today: TodayPlanResponse['summary']['today'],
  backlog: TodayPlanResponse['summary']['backlog'] | undefined,
  plan: TodayPlanResponse['plan'],
): TodayPlanResponse['summary']['today'] {
  const newCompleted = Math.max(today.todayNewCompleted ?? 0, 0);
  const mistakeCompleted = Math.max(today.todayMistakeCompleted ?? 0, 0);
  const hasExplicitOldReviewed = typeof today.todayOldWordReviewed === 'number';
  const oldWordReviewed = Math.max(hasExplicitOldReviewed ? today.todayOldWordReviewed : today.todayReviewCompleted ?? 0, 0);
  const dueReviewCompleted = Math.max(
    hasExplicitOldReviewed ? today.todayReviewCompleted ?? 0 : oldWordReviewed - mistakeCompleted,
    0,
  );
  const dueNowCount = Math.max(backlog?.dueNowCount ?? 0, 0);
  const todayReviewPlanned = normalizePlannedDueReviewCount({
    dueNowCount,
    dailyReviewTarget: plan.dailyReviewTarget,
    rawPlannedReview: today.todayReviewPlanned ?? plan.dailyReviewTarget ?? 0,
  });
  const remainingNew = Math.max(today.remainingNew ?? today.todayNewPlanned - newCompleted, 0);
  const remainingReview = Math.max(today.remainingReview ?? todayReviewPlanned - dueReviewCompleted, 0);
  const remainingMistake = Math.max(today.remainingMistake ?? today.todayMistakePlanned - mistakeCompleted, 0);
  const extraDueReviewAvailable = Math.max(
    today.extraDueReviewAvailable ?? dueNowCount - remainingReview,
    0,
  );

  return {
    ...today,
    todayNewCompleted: newCompleted,
    todayOldWordReviewed: oldWordReviewed,
    todayReviewPlanned,
    todayReviewCompleted: dueReviewCompleted,
    todayMistakeCompleted: mistakeCompleted,
    remainingNew,
    remainingReview,
    remainingMistake,
    extraDueReviewAvailable,
  };
}

function normalizeTodayPlanResponse(response: TodayPlanResponse): TodayPlanResponse {
  return {
    ...response,
    summary: {
      ...response.summary,
      today: normalizeTodaySummary(response.summary.today, response.summary.backlog, response.plan),
    },
  };
}

export type VocabularyInsightCacheStatus =
  | 'hit'
  | 'miss'
  | 'sample'
  | 'refreshed'
  | 'updated'
  | 'using_cache'
  | 'cooling_down'
  | 'already_refreshing';

export type VocabularyReportInsight = {
  stageSummary: string;
  keyProblems: string[];
  strengths: string[];
  nextPhaseAdvice: string[];
  isSample: boolean;
  cacheStatus?: VocabularyInsightCacheStatus;
};

export type VocabularyErrorInsight = {
  errorSummary: string;
  rootCauses: string[];
  riskCategories: string[];
  reinforcementPlan: Array<{ action: string; reason: string }>;
  isSample: boolean;
  cacheStatus?: VocabularyInsightCacheStatus;
};

export type VocabularyAnalysisInsight = {
  summary: string;
  weakPatterns: string[];
  strongPatterns: string[];
  nextStrategies: Array<{ action: string; reason: string }>;
  isSample: boolean;
  cacheStatus?: VocabularyInsightCacheStatus;
};

export type VocabularyDashboardInsights = {
  heroInsight: {
    weaknessInsight: string;
    memoryWindowInsight: string;
    methodInsight: string;
    isSample: boolean;
  };
  panelAnalysis: {
    weakCategories: string[];
    strongCategories: string[];
    recommendations: Array<{ icon: string; title: string; subtitle: string; href?: string }>;
    isSample: boolean;
  };
  cacheStatus?: VocabularyInsightCacheStatus;
};

export type VocabularyDashboardInsightsCacheEntry = {
  savedAt: number;
  dayKey?: string;
  fingerprint?: string;
  insight: VocabularyDashboardInsights;
};

const DASHBOARD_INSIGHTS_CACHE_FILE = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}vocabulary-dashboard-insights-cache.json`
  : null;

export type VocabularyAnalyzeRequest = {
  word: string;
  chinese: string;
  english: string;
  example: string;
  bookSlug?: string;
  pattern?: string;
  learningState: 'pending' | 'known' | 'unsure' | 'unknown';
  mockStats: {
    known: number;
    unsure: number;
    unknown: number;
    answeredTotal: number;
    currentBook: string;
    reviewCount?: number;
    mistakeCount?: number;
  };
};

export type VocabularyAnalyzeResponse = {
  contextualMeaning: string;
  confusableWords: Array<{ word: string; difference: string }>;
  collocations: Array<{ phrase: string; meaning: string }>;
  memoryTip: string;
  speakingPhrase: string;
  errorReasonSummary: string;
  predictedRetention: string;
  bestReviewWindow: string;
};

function buildDefaultVocabularyPlan(focusBookSlug: string, deadline: string): TodayPlanResponse['plan'] {
  return {
    dailyNewTarget: 20,
    dailyReviewTarget: 30,
    dailyMistakeTarget: 8,
    dailyMinutesTarget: 28,
    weeklyStudyDays: 6,
    weeklyWordsTarget: 160,
    weeklyReviewsTarget: 180,
    monthlyWordsTarget: 640,
    monthlyStudyDaysTarget: 24,
    focusBookSlug,
    learningPreference: 'balanced',
    longTermGoalType: 'finish_book_by_date',
    longTermGoalValue: 90,
    longTermGoalDeadline: deadline,
  };
}

function mapPlanRow(row: PlanRow | null, fallbackFocusBookSlug: string): TodayPlanResponse['plan'] {
  if (!row) {
    return buildDefaultVocabularyPlan(fallbackFocusBookSlug, toDateInput(addDays(new Date(), 90)));
  }

  return {
    id: row.id,
    dailyNewTarget: row.daily_new_target,
    dailyReviewTarget: row.daily_review_target,
    dailyMistakeTarget: row.daily_mistake_target,
    dailyMinutesTarget: row.daily_minutes_target,
    weeklyStudyDays: row.weekly_study_days,
    weeklyWordsTarget: row.weekly_words_target,
    weeklyReviewsTarget: row.weekly_reviews_target,
    monthlyWordsTarget: row.monthly_words_target,
    monthlyStudyDaysTarget: row.monthly_study_days_target,
    focusBookSlug: row.focus_book_slug ?? fallbackFocusBookSlug,
    learningPreference: row.learning_preference,
    longTermGoalType: row.long_term_goal_type,
    longTermGoalValue: row.long_term_goal_value,
    longTermGoalDeadline: row.long_term_goal_deadline ?? toDateInput(addDays(new Date(), 90)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function pickFocusBook(
  books: TodayPlanResponse['books'],
  progress: ProgressActivity[],
  preferredSlug: string,
) {
  const bookMap = new Map(books.map((book) => [book.slug, book]));
  if (preferredSlug && bookMap.has(preferredSlug)) {
    return bookMap.get(preferredSlug)!;
  }

  const counts = new Map<string, number>();
  for (const row of progress) {
    counts.set(row.bookSlug, (counts.get(row.bookSlug) ?? 0) + 1);
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0) {
    const matched = bookMap.get(sorted[0][0]);
    if (matched) return matched;
  }

  return books[0] ?? {
    slug: '',
    title: '当前词书',
    wordCount: 0,
  };
}

function buildLongTermSummary({
  plan,
  focusBook,
  now,
  weekWordsCompleted,
  weekStudyDaysCompleted,
  dueNowCount,
  mistakeCount,
}: {
  plan: TodayPlanResponse['plan'];
  focusBook: TodayPlanResponse['summary']['focusBook'];
  now: Date;
  weekWordsCompleted: number;
  weekStudyDaysCompleted: number;
  dueNowCount: number;
  mistakeCount: number;
}): TodayPlanResponse['summary']['longTerm'] {
  const wordsPerStudyDay = Math.max(
    1,
    Math.round(weekWordsCompleted / Math.max(weekStudyDaysCompleted, 1)),
    plan.dailyNewTarget,
  );

  if (plan.longTermGoalType === 'clear_backlog_in_days') {
    const backlogTotal = dueNowCount + mistakeCount;
    const daysTarget = Math.max(plan.longTermGoalValue, 1);
    const dailyCapacity = Math.max(plan.dailyReviewTarget + plan.dailyMistakeTarget, 1);
    const projectedFinishDays = backlogTotal === 0 ? 0 : Math.ceil(backlogTotal / dailyCapacity);
    const progressPercent =
      backlogTotal === 0
        ? 100
        : clamp(Math.round((dailyCapacity * daysTarget * 100) / Math.max(backlogTotal, 1)), 0, 100);

    return {
      type: plan.longTermGoalType,
      title: `在 ${daysTarget} 天内清空到期词与错词`,
      detail:
        backlogTotal === 0
          ? '当前没有积压，到期词和错词已经清空。'
          : `当前还有 ${backlogTotal} 个积压词，按现在的日计划预计 ${projectedFinishDays} 天可以清空。`,
      progressPercent,
      remainingWords: backlogTotal,
      daysLeft: daysTarget,
      projectedFinishDays,
      isBehind: projectedFinishDays > daysTarget,
    };
  }

  const remainingWords = focusBook.remainingWords;
  const projectedFinishDays = remainingWords === 0 ? 0 : Math.ceil(remainingWords / Math.max(wordsPerStudyDay, 1));

  if (plan.longTermGoalType === 'finish_book_in_days') {
    const createdAt = plan.createdAt ? new Date(plan.createdAt) : now;
    const elapsedDays = Math.max(
      1,
      Math.ceil((startOfDay(now).getTime() - startOfDay(createdAt).getTime()) / 86400000) + 1,
    );
    const totalDays = Math.max(plan.longTermGoalValue, 1);
    const daysLeft = Math.max(totalDays - elapsedDays, 0);

    return {
      type: plan.longTermGoalType,
      title: `在 ${totalDays} 天内完成《${focusBook.title}》`,
      detail:
        remainingWords === 0
          ? `《${focusBook.title}》已完成，可以切换下一本主攻词书。`
          : `当前还剩 ${remainingWords} 词，已用 ${elapsedDays} 天，按现在节奏预计还需 ${projectedFinishDays} 天。`,
      progressPercent: focusBook.percentage,
      remainingWords,
      daysLeft,
      projectedFinishDays,
      isBehind: remainingWords > 0 && projectedFinishDays > daysLeft,
    };
  }

  const deadline = plan.longTermGoalDeadline
    ? new Date(`${plan.longTermGoalDeadline}T00:00:00`)
    : addDays(now, 90);
  const daysLeft = Math.max(
    Math.ceil((startOfDay(deadline).getTime() - startOfDay(now).getTime()) / 86400000),
    0,
  );

  return {
    type: plan.longTermGoalType,
    title: `在 ${plan.longTermGoalDeadline} 前完成《${focusBook.title}》`,
    detail:
      remainingWords === 0
        ? `《${focusBook.title}》已完成，长期目标已达成。`
        : `距离完成还剩 ${remainingWords} 词，距离截止还有 ${daysLeft} 天，按现在节奏预计还需 ${projectedFinishDays} 天。`,
    progressPercent: focusBook.percentage,
    remainingWords,
    daysLeft,
    projectedFinishDays,
    isBehind: remainingWords > 0 && projectedFinishDays > daysLeft,
  };
}

function buildTodayPlanSummary(
  plan: TodayPlanResponse['plan'],
  books: TodayPlanResponse['books'],
  progress: ProgressActivity[],
): TodayPlanResponse['summary'] {
  const now = new Date();
  const dayStart = startOfDay(now);
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);
  const weekEnd = endOfWeek(now);
  const monthEnd = endOfMonth(now);

  const focusBookOption = pickFocusBook(books, progress, plan.focusBookSlug);
  const focusBookProgressRows = progress.filter((row) => row.bookSlug === focusBookOption.slug);
  const focusBookLearnedWords = focusBookProgressRows.length;
  const focusBookRemainingWords = Math.max(focusBookOption.wordCount - focusBookLearnedWords, 0);
  const focusBook = {
    slug: focusBookOption.slug,
    title: focusBookOption.title,
    totalWords: focusBookOption.wordCount,
    learnedWords: focusBookLearnedWords,
    remainingWords: focusBookRemainingWords,
    percentage: focusBookOption.wordCount > 0 ? Math.round((focusBookLearnedWords / focusBookOption.wordCount) * 100) : 0,
  };

  const todayWordIds = new Set<string>();
  const weekWordIds = new Set<string>();
  const monthWordIds = new Set<string>();
  const weekDayKeys = new Set<string>();
  const monthDayKeys = new Set<string>();

  let todayNewCompleted = 0;
  let todayOldWordReviewed = 0;
  let todayReviewCompleted = 0;
  let todayMistakeCompleted = 0;
  let weekReviewsCompleted = 0;
  let masteredCount = 0;
  let dueCount = 0;
  let dueNowCount = 0;
  let mistakeCount = 0;

  for (const row of progress) {
    const createdAt = new Date(row.createdAt);
    const reviewedAt = row.lastReviewedAt ? new Date(row.lastReviewedAt) : null;
    const createdToday = createdAt >= dayStart;
    const reviewedToday = reviewedAt ? reviewedAt >= dayStart : false;
    const touchedThisWeek = createdAt >= weekStart || (reviewedAt ? reviewedAt >= weekStart : false);
    const touchedThisMonth = createdAt >= monthStart || (reviewedAt ? reviewedAt >= monthStart : false);

    if (row.status === 'mastered') masteredCount += 1;
    if (row.status === 'due') dueCount += 1;
    if (row.status === 'mistake') mistakeCount += 1;

    if (!row.nextReviewAt) {
      if (row.status === 'due' || row.status === 'mistake') {
        dueNowCount += 1;
      }
    } else if (Date.parse(row.nextReviewAt) <= now.getTime()) {
      dueNowCount += 1;
    }

    if (createdToday) {
      todayNewCompleted += 1;
      todayWordIds.add(row.wordId);
    }
    const isMistakeRelated = row.lastStatus === 'mistake' || row.status === 'mistake' || row.mistakeCount > 0;
    if (reviewedToday && !createdToday) {
      todayOldWordReviewed += 1;
      todayWordIds.add(row.wordId);
      if (!isMistakeRelated) {
        todayReviewCompleted += 1;
      }
    }
    if (reviewedToday && isMistakeRelated) {
      todayMistakeCompleted += 1;
      todayWordIds.add(row.wordId);
    }

    if (touchedThisWeek) weekWordIds.add(row.wordId);
    if (touchedThisMonth) monthWordIds.add(row.wordId);
    if (reviewedAt && reviewedAt >= weekStart) weekReviewsCompleted += 1;

    if (createdAt >= weekStart && createdAt < weekEnd) weekDayKeys.add(dayKey(row.createdAt));
    if (reviewedAt && reviewedAt >= weekStart && reviewedAt < weekEnd) weekDayKeys.add(dayKey(row.lastReviewedAt!));
    if (createdAt >= monthStart && createdAt < monthEnd) monthDayKeys.add(dayKey(row.createdAt));
    if (reviewedAt && reviewedAt >= monthStart && reviewedAt < monthEnd) monthDayKeys.add(dayKey(row.lastReviewedAt!));
  }

  const availableNewWords = focusBook.remainingWords;
  let newPlanBase = plan.dailyNewTarget;
  let reviewPlanBase = plan.dailyReviewTarget;
  let mistakePlanBase = plan.dailyMistakeTarget;

  if (plan.learningPreference === 'review_first') {
    reviewPlanBase = Math.max(reviewPlanBase, Math.min(dueNowCount, plan.dailyReviewTarget + 12));
    if (dueNowCount > plan.dailyReviewTarget) {
      newPlanBase = Math.max(6, Math.round(plan.dailyNewTarget * 0.55));
    }
  } else if (plan.learningPreference === 'new_first') {
    newPlanBase = Math.max(newPlanBase, Math.min(availableNewWords, plan.dailyNewTarget + 8));
    if (dueNowCount > plan.dailyReviewTarget * 2) {
      reviewPlanBase = Math.max(reviewPlanBase, plan.dailyReviewTarget + 10);
    }
  } else {
    if (dueNowCount > plan.dailyReviewTarget) {
      reviewPlanBase = Math.max(reviewPlanBase, plan.dailyReviewTarget + 8);
      newPlanBase = Math.max(8, Math.round(plan.dailyNewTarget * 0.8));
    }
    if (mistakeCount > plan.dailyMistakeTarget) {
      mistakePlanBase = Math.max(mistakePlanBase, Math.min(mistakeCount, plan.dailyMistakeTarget + 6));
    }
  }

  const todayNewPlanned = Math.min(availableNewWords, newPlanBase);
  const todayReviewPlanned = Math.min(dueNowCount, reviewPlanBase);
  const todayMistakePlanned = Math.min(mistakeCount, mistakePlanBase);
  const remainingNew = Math.max(todayNewPlanned - todayNewCompleted, 0);
  const remainingReview = Math.max(todayReviewPlanned - todayReviewCompleted, 0);
  const remainingMistake = Math.max(todayMistakePlanned - todayMistakeCompleted, 0);
  const extraDueReviewAvailable = Math.max(dueNowCount - remainingReview, 0);

  const actionWeights = {
    balanced: { review: 68, mistake: 74, learn: 60 },
    new_first: { review: 40, mistake: 48, learn: 84 },
    review_first: { review: 88, mistake: 64, learn: 34 },
  } as const;

  const actionCandidates: Array<{
    action: TodayPlanResponse['summary']['today']['recommendedPrimaryAction'];
    score: number;
    step: TodayPlanResponse['summary']['today']['recommendedSequence'][number];
  }> = [];

  if (todayReviewPlanned > 0) {
    actionCandidates.push({
      action: 'review',
      score: actionWeights[plan.learningPreference].review + Math.min(dueNowCount, 60),
      step: {
        action: 'review',
        label: '先复习到期词',
        detail: `今天有 ${dueNowCount} 个到期词，先完成其中 ${todayReviewPlanned} 个更稳。`,
        href: '/words/review?mode=review&source=plan',
      },
    });
  }

  if (todayMistakePlanned > 0) {
    actionCandidates.push({
      action: 'mistake',
      score:
        actionWeights[plan.learningPreference].mistake +
        Math.min(mistakeCount * 2, 70) +
        (mistakeCount > plan.dailyMistakeTarget ? 14 : 0),
      step: {
        action: 'mistake',
        label: '安排错词强化',
        detail: `当前有 ${mistakeCount} 个错词积压，建议至少强化 ${todayMistakePlanned} 个。`,
        href: '/words/review?mode=mistake&source=plan',
      },
    });
  }

  if (todayNewPlanned > 0) {
    actionCandidates.push({
      action: 'learn',
      score: actionWeights[plan.learningPreference].learn + Math.min(todayNewPlanned, 50) + (focusBook.remainingWords > 0 ? 10 : 0),
      step: {
        action: 'learn',
        label: `推进主攻词书《${focusBook.title}》`,
        detail: `今天计划学习 ${todayNewPlanned} 个新词，继续推进 ${focusBook.title}。`,
        href: `/words/review?mode=learn&source=plan&bookSlug=${encodeURIComponent(focusBook.slug)}`,
      },
    });
  }

  if (actionCandidates.length === 0) {
    actionCandidates.push({
      action: 'learn',
      score: 1,
      step: {
        action: 'learn',
        label: '切换下一本词书',
        detail: `当前主攻词书《${focusBook.title}》已经推进完成，建议回到词书中心选择下一本。`,
        href: '/words/books',
      },
    });
  }

  actionCandidates.sort((a, b) => b.score - a.score);
  const recommendedSequence = actionCandidates.map((item) => item.step);
  const primaryAction = actionCandidates[0]?.action ?? (todayNewPlanned > 0 ? 'learn' : dueNowCount > 0 ? 'review' : 'mistake');
  const recommendedPrimaryHref =
    primaryAction === 'review'
      ? '/words/review?mode=review&source=plan'
      : primaryAction === 'mistake'
        ? '/words/review?mode=mistake&source=plan'
        : actionCandidates[0]?.step.href ?? `/words/review?mode=learn&source=plan&bookSlug=${encodeURIComponent(focusBook.slug)}`;
  const recommendedPrimaryLabel =
    recommendedPrimaryHref === '/words/books'
      ? '选择下一本词书'
      : primaryAction === 'review'
        ? `开始复习 ${todayReviewPlanned || dueNowCount} 个到期词`
        : primaryAction === 'mistake'
          ? `先强化 ${todayMistakePlanned || mistakeCount} 个错词`
          : `开始学习 ${focusBook.title}`;

  const estimatedMinutes = Math.max(
    plan.dailyMinutesTarget,
    Math.round(todayNewPlanned * 1.6 + todayReviewPlanned * 0.9 + todayMistakePlanned * 1.1),
  );

  const weekWordsCompleted = weekWordIds.size;
  const monthWordsCompleted = monthWordIds.size;
  const todayWorkedWords = todayWordIds.size;
  const elapsedWeekFraction = clamp((now.getTime() - weekStart.getTime()) / Math.max(weekEnd.getTime() - weekStart.getTime(), 1), 0, 1);
  const elapsedMonthFraction = clamp((now.getTime() - monthStart.getTime()) / Math.max(monthEnd.getTime() - monthStart.getTime(), 1), 0, 1);
  const weekExpectedWords = Math.round(plan.weeklyWordsTarget * elapsedWeekFraction);
  const monthExpectedWords = Math.round(plan.monthlyWordsTarget * elapsedMonthFraction);

  const longTerm = buildLongTermSummary({
    plan,
    focusBook,
    now,
    weekWordsCompleted,
    weekStudyDaysCompleted: weekDayKeys.size,
    dueNowCount,
    mistakeCount,
  });

  const suggestions: TodayPlanResponse['summary']['suggestions'] = [];
  if (dueNowCount > plan.dailyReviewTarget) {
    suggestions.push({
      title: '今天到期词偏多，建议先复习后学新词',
      detail: `当前到期词 ${dueNowCount} 个，高于你的每日复习目标 ${plan.dailyReviewTarget} 个，先清理到期词更稳。`,
      tone: 'amber',
    });
  } else if (todayNewPlanned > 0) {
    suggestions.push({
      title: '今天可以稳定推进主攻词书',
      detail: `《${focusBook.title}》还剩 ${focusBook.remainingWords} 词，按当前配置今天适合先推进 ${todayNewPlanned} 个新词。`,
      tone: 'blue',
    });
  }

  if (mistakeCount > plan.dailyMistakeTarget) {
    suggestions.push({
      title: '错词积压高于计划，建议先做强化',
      detail: `当前错词 ${mistakeCount} 个，高于每日错词强化目标 ${plan.dailyMistakeTarget} 个。`,
      tone: 'red',
    });
  } else {
    suggestions.push({
      title: '错词压力可控，按当前节奏继续',
      detail: `当前错词 ${mistakeCount} 个，今天处理 ${todayMistakePlanned} 个即可维持稳定。`,
      tone: 'green',
    });
  }

  if (longTerm.isBehind) {
    const remainingStudyDays = Math.max(plan.weeklyStudyDays - weekDayKeys.size, 1);
    const shortfall = Math.max(plan.weeklyWordsTarget - weekWordsCompleted, 0);
    suggestions.push({
      title: '本周节奏略慢，建议提高日推进量',
      detail: `如果想追上当前目标，接下来每天建议完成约 ${Math.ceil(shortfall / remainingStudyDays)} 个词。`,
      tone: 'amber',
    });
  } else {
    suggestions.push({
      title: '当前节奏可支撑长期目标',
      detail: longTerm.detail,
      tone: 'green',
    });
  }

  return {
    backlog: {
      trackedWords: progress.length,
      masteredCount,
      dueCount,
      dueNowCount,
      mistakeCount,
    },
    today: {
      todayNewPlanned,
      todayReviewPlanned,
      todayMistakePlanned,
      todayWorkedWords,
      todayNewCompleted,
      todayOldWordReviewed,
      todayReviewCompleted,
      todayMistakeCompleted,
      remainingNew,
      remainingReview,
      remainingMistake,
      extraDueReviewAvailable,
      estimatedMinutes,
      recommendedPrimaryAction: primaryAction,
      recommendedPrimaryHref,
      recommendedPrimaryLabel,
      recommendedBookSlug: focusBook.slug,
      recommendedBookTitle: focusBook.title,
      recommendedSequence,
      todayPlanOffset: todayWorkedWords - (todayNewPlanned + todayReviewPlanned + todayMistakePlanned),
    },
    week: {
      completed: weekWordsCompleted,
      target: plan.weeklyWordsTarget,
      percentage: plan.weeklyWordsTarget > 0 ? clamp(Math.round((weekWordsCompleted / plan.weeklyWordsTarget) * 100), 0, 100) : 0,
      delta: weekWordsCompleted - weekExpectedWords,
      note: `本周已学习 ${weekDayKeys.size} / ${plan.weeklyStudyDays} 天，复习 ${weekReviewsCompleted} / ${plan.weeklyReviewsTarget} 词。`,
      reviewCompleted: weekReviewsCompleted,
      studyDaysCompleted: weekDayKeys.size,
      studyDaysTarget: plan.weeklyStudyDays,
    },
    month: {
      completed: monthWordsCompleted,
      target: plan.monthlyWordsTarget,
      percentage: plan.monthlyWordsTarget > 0 ? clamp(Math.round((monthWordsCompleted / plan.monthlyWordsTarget) * 100), 0, 100) : 0,
      delta: monthWordsCompleted - monthExpectedWords,
      note: `本月已学习 ${monthDayKeys.size} / ${plan.monthlyStudyDaysTarget} 天。`,
      studyDaysCompleted: monthDayKeys.size,
      studyDaysTarget: plan.monthlyStudyDaysTarget,
    },
    longTerm,
    focusBook,
    suggestions,
  };
}

async function fetchVocabularyNotebookDirect(session: StoredSession): Promise<VocabularyProgressResponse> {
  const userId = session.user?.id;
  if (!userId) {
    throw new VocabularyApiError('auth_required', '登录状态已失效，请重新登录。');
  }

  const url = new URL(buildRestTableUrl('user_vocabulary_progress'));
  url.searchParams.set('select', 'status,last_status,next_review_at,last_reviewed_at,review_count,mistake_count,updated_at,created_at,vocabulary_words(id,word,phonetic,definition_zh,definition_en,example_en,example_zh,metadata),vocabulary_books(slug,title)');
  url.searchParams.set('user_id', `eq.${userId}`);
  url.searchParams.set('order', 'updated_at.desc.nullslast');

  const rows = await fetchSupabaseAuthedJson<NotebookProgressRow[]>(url.pathname + url.search, session);
  const words = rows
    .map((record): NotebookWord | null => {
      const word = firstJoin(record.vocabulary_words);
      const book = firstJoin(record.vocabulary_books);
      if (!word?.word) return null;

      return {
        word: word.word,
        phonetic: word.phonetic ?? '',
        meaning: word.definition_zh ?? '',
        english: word.definition_en ?? '',
        example: word.example_en ?? '',
        exampleZh: word.example_zh ?? '',
        book: book?.title ?? '四级核心词汇',
        bookSlug: book?.slug ?? undefined,
        status: record.status,
        nextReview: formatNextReview(record.next_review_at),
        nextReviewAt: record.next_review_at ?? undefined,
        lastReviewedAt: record.last_reviewed_at ?? undefined,
        reviewCount: record.review_count ?? 0,
        mistakeCount: record.mistake_count ?? 0,
        lastStatus: record.last_status ?? record.status,
        pattern: word.metadata?.pattern ?? undefined,
      };
    })
    .filter((word): word is NotebookWord => word !== null);

  return {
    words,
    stats: buildProgressStats(words),
  };
}

async function fetchBookBySlug(session: StoredSession, bookSlug: string) {
  const url = new URL(buildRestTableUrl('vocabulary_books'));
  url.searchParams.set('select', 'id,title,slug');
  url.searchParams.set('slug', `eq.${bookSlug}`);
  url.searchParams.set('limit', '1');
  const rows = await fetchSupabaseAuthedJson<Array<{ id: string; title: string | null; slug: string | null }>>(url.pathname + url.search, session);
  return rows[0] ?? null;
}

async function fetchVocabularyWordByNormalized(session: StoredSession, word: string) {
  const url = new URL(buildRestTableUrl('vocabulary_words'));
  url.searchParams.set('select', 'id,word,phonetic,definition_zh,definition_en,example_en,example_zh');
  url.searchParams.set('normalized_word', `eq.${word.trim().toLowerCase()}`);
  url.searchParams.set('limit', '1');
  const rows = await fetchSupabaseAuthedJson<Array<{
    id: string;
    word: string;
    phonetic: string | null;
    definition_zh: string | null;
    definition_en: string | null;
    example_en: string | null;
    example_zh: string | null;
  }>>(url.pathname + url.search, session);
  return rows[0] ?? null;
}

async function fetchExistingProgressRow(session: StoredSession, bookId: string, wordId: string) {
  const userId = session.user?.id;
  if (!userId) {
    throw new VocabularyApiError('auth_required', '登录状态已失效，请重新登录。');
  }

  const url = new URL(buildRestTableUrl('user_vocabulary_progress'));
  url.searchParams.set('select', 'status,review_count,mistake_count,exposure_count,known_count,unsure_count,unknown_count');
  url.searchParams.set('user_id', `eq.${userId}`);
  url.searchParams.set('book_id', `eq.${bookId}`);
  url.searchParams.set('word_id', `eq.${wordId}`);
  url.searchParams.set('limit', '1');
  const rows = await fetchSupabaseAuthedJson<ProgressMutationRow[]>(url.pathname + url.search, session);
  return rows[0] ?? null;
}

async function fetchVocabularyReviewStatsDirect(session: StoredSession): Promise<VocabularyReviewStats> {
  const userId = session.user?.id;
  if (!userId) {
    throw new VocabularyApiError('auth_required', '登录状态已失效，请重新登录。');
  }

  const url = new URL(buildRestTableUrl('user_vocabulary_progress'));
  url.searchParams.set('select', 'known_count,unsure_count,unknown_count');
  url.searchParams.set('user_id', `eq.${userId}`);

  const rows = await fetchSupabaseAuthedJson<
    Array<{
      known_count: number | null;
      unsure_count: number | null;
      unknown_count: number | null;
    }>
  >(url.pathname + url.search, session);

  return rows.reduce<VocabularyReviewStats>(
    (acc, row) => {
      acc.known += row.known_count ?? 0;
      acc.unsure += row.unsure_count ?? 0;
      acc.unknown += row.unknown_count ?? 0;
      return acc;
    },
    { known: 0, unsure: 0, unknown: 0 },
  );
}

async function upsertProgressRow(session: StoredSession, payload: Record<string, unknown>) {
  await fetchSupabaseAuthedJson<unknown>('/rest/v1/user_vocabulary_progress', session, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(payload),
  });
}

async function updateVocabularyWordStatusDirect(
  session: StoredSession,
  payload: { word: string; book?: string; bookSlug?: string; status: NotebookStatus },
) {
  const userId = session.user?.id;
  if (!userId) {
    throw new VocabularyApiError('auth_required', '登录状态已失效，请重新登录。');
  }

  const bookTitle = payload.book || '四级核心词汇';
  const bookSlug = payload.bookSlug || normalizeBookSlug(bookTitle);
  const [book, word] = await Promise.all([
    fetchBookBySlug(session, bookSlug),
    fetchVocabularyWordByNormalized(session, payload.word),
  ]);

  if (!book) {
    throw new VocabularyApiError('request_failed', '暂时无法获取数据，请稍后重试。', { rawMessage: 'Vocabulary book not found.' });
  }
  if (!word) {
    throw new VocabularyApiError('request_failed', '暂时无法获取数据，请稍后重试。', { rawMessage: 'Vocabulary word not found.' });
  }

  const progress = await fetchExistingProgressRow(session, book.id, word.id);
  const nextReviewAt = nextReviewDateForStatus(payload.status);
  const reviewedAt = new Date().toISOString();
  await upsertProgressRow(session, {
    user_id: userId,
    book_id: book.id,
    word_id: word.id,
    status: payload.status,
    last_status: payload.status,
    next_review_at: nextReviewAt,
    last_reviewed_at: reviewedAt,
    review_count: progress?.review_count ?? 0,
    mistake_count: progress?.mistake_count ?? 0,
  });

  return {
    word: {
      word: word.word,
      phonetic: word.phonetic ?? '',
      meaning: word.definition_zh ?? '',
      english: word.definition_en ?? '',
      example: word.example_en ?? '',
      exampleZh: word.example_zh ?? '',
      book: book.title ?? bookTitle,
      bookSlug: book.slug ?? bookSlug,
      status: payload.status,
      nextReview: formatNextReview(nextReviewAt),
      nextReviewAt,
      lastReviewedAt: reviewedAt,
      reviewCount: progress?.review_count ?? 0,
      mistakeCount: progress?.mistake_count ?? 0,
      lastStatus: payload.status,
    },
  };
}

async function submitVocabularyReviewResultDirect(
  session: StoredSession,
  payload: {
    word: string;
    phonetic?: string;
    meaning?: string;
    english?: string;
    example?: string;
    exampleZh?: string;
    book?: string;
    bookSlug?: string;
    result: ReviewResult;
  },
) {
  const userId = session.user?.id;
  if (!userId) {
    throw new VocabularyApiError('auth_required', '登录状态已失效，请重新登录。');
  }

  const bookTitle = payload.book || '四级核心词汇';
  const bookSlug = payload.bookSlug || normalizeBookSlug(bookTitle);
  const [book, word] = await Promise.all([
    fetchBookBySlug(session, bookSlug),
    fetchVocabularyWordByNormalized(session, payload.word),
  ]);

  if (!book) {
    throw new VocabularyApiError('request_failed', '暂时无法获取数据，请稍后重试。', { rawMessage: 'Vocabulary book not found.' });
  }
  if (!word) {
    throw new VocabularyApiError('request_failed', '暂时无法获取数据，请稍后重试。', { rawMessage: 'Vocabulary word not found.' });
  }

  const existing = await fetchExistingProgressRow(session, book.id, word.id);
  const schedule = calculateVocabularyReviewSchedule(existing, payload.result);
  const nextProgress = {
    user_id: userId,
    book_id: book.id,
    word_id: word.id,
    status: schedule.status,
    last_result: payload.result,
    last_status: schedule.status,
    exposure_count: (existing?.exposure_count ?? 0) + 1,
    review_count: (existing?.review_count ?? existing?.exposure_count ?? 0) + 1,
    known_count: (existing?.known_count ?? 0) + (payload.result === 'known' ? 1 : 0),
    unsure_count: (existing?.unsure_count ?? 0) + (payload.result === 'unsure' ? 1 : 0),
    unknown_count: (existing?.unknown_count ?? 0) + (payload.result === 'unknown' ? 1 : 0),
    mistake_count: (existing?.mistake_count ?? existing?.unknown_count ?? 0) + (payload.result === 'unknown' ? 1 : 0),
    next_review_at: schedule.nextReviewAt,
    last_reviewed_at: new Date().toISOString(),
  };
  console.log('vocabulary_review_result_schedule', {
    word: payload.word,
    result: payload.result,
    oldStatus: existing?.status ?? null,
    newStatus: schedule.status,
    oldMasteryLevel: schedule.derivedStageBefore,
    newMasteryLevel: schedule.derivedStageAfter,
    nextReviewAt: nextProgress.next_review_at,
  });
  await upsertProgressRow(session, nextProgress);

  return {
    word: {
      word: word.word,
      phonetic: word.phonetic ?? payload.phonetic ?? '',
      meaning: word.definition_zh ?? payload.meaning ?? '',
      english: word.definition_en ?? payload.english ?? '',
      example: word.example_en ?? payload.example ?? '',
      exampleZh: word.example_zh ?? payload.exampleZh ?? '',
      book: book.title ?? bookTitle,
      bookSlug: book.slug ?? bookSlug,
      status: schedule.status,
      nextReview: formatNextReview(nextProgress.next_review_at),
      nextReviewAt: nextProgress.next_review_at,
      lastReviewedAt: nextProgress.last_reviewed_at,
      reviewCount: nextProgress.review_count,
      mistakeCount: nextProgress.mistake_count,
      lastStatus: schedule.status,
    },
  };
}

async function fetchVocabularyTodayPlanDirect(session: StoredSession): Promise<TodayPlanResponse> {
  const userId = session.user?.id;
  if (!userId) {
    throw new VocabularyApiError('auth_required', '登录状态已失效，请重新登录。');
  }

  const [planRows, bookRows, progressRows] = await Promise.all([
    fetchSupabaseAuthedJson<PlanRow[]>(`/rest/v1/user_vocabulary_plans?select=id,daily_new_target,daily_review_target,daily_mistake_target,daily_minutes_target,weekly_study_days,weekly_words_target,weekly_reviews_target,monthly_words_target,monthly_study_days_target,focus_book_slug,learning_preference,long_term_goal_type,long_term_goal_value,long_term_goal_deadline,created_at,updated_at&user_id=eq.${userId}&limit=1`, session),
    fetchSupabaseAuthedJson<BookRow[]>(`/rest/v1/vocabulary_books?select=id,slug,title,description,word_count,is_active&is_active=eq.true&order=created_at.asc`, session),
    fetchSupabaseAuthedJson<ProgressRow[]>(`/rest/v1/user_vocabulary_progress?select=word_id,status,last_status,next_review_at,last_reviewed_at,created_at,review_count,mistake_count,vocabulary_books(slug,title,word_count)&user_id=eq.${userId}`, session),
  ]);

  const books = bookRows.map((book) => ({
    slug: book.slug,
    title: book.title,
    wordCount: book.word_count,
  }));

  const progress = mapProgressRowsToActivities(progressRows);

  const fallbackFocusBookSlug = books[0]?.slug ?? '';
  const plan = mapPlanRow(planRows[0] ?? null, fallbackFocusBookSlug);
  const summary = buildTodayPlanSummary(plan, books, progress);
  return {
    plan: {
      ...plan,
      focusBookSlug: summary.focusBook.slug || plan.focusBookSlug,
    },
    books,
    summary,
  };
}

async function updateVocabularyTodayPlanDirect(
  session: StoredSession,
  input: Partial<TodayPlanResponse['plan']>,
): Promise<TodayPlanResponse> {
  const userId = session.user?.id;
  if (!userId) {
    throw new VocabularyApiError('auth_required', '登录状态已失效，请重新登录。');
  }

  const books = await fetchSupabaseAuthedJson<BookRow[]>(
    '/rest/v1/vocabulary_books?select=id,slug,title,description,word_count,is_active&is_active=eq.true&order=created_at.asc',
    session,
  );
  const validBookSlugs = new Set(books.map((book) => book.slug));
  const fallbackFocusBookSlug = books[0]?.slug ?? '';
  const normalizedPlan = normalizeVocabularyPlanInput(input, fallbackFocusBookSlug, validBookSlugs);

  await fetchSupabaseAuthedJson<unknown>('/rest/v1/user_vocabulary_plans', session, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(serializeVocabularyPlan(normalizedPlan, userId)),
  });

  return fetchVocabularyTodayPlanDirect(session);
}

export async function fetchVocabularyDashboard(session: StoredSession): Promise<VocabularyDashboard> {
  const userId = session.user?.id;
  if (!userId) {
    throw new VocabularyApiError('auth_required', '登录状态已失效，请重新登录。');
  }

  const [bookRows, progressRows] = await Promise.all([
    fetchSupabaseAuthedJson<BookRow[]>(
      '/rest/v1/vocabulary_books?select=id,slug,title,description,word_count,is_active&is_active=eq.true&order=created_at.asc',
      session,
    ),
    fetchSupabaseAuthedJson<ProgressRow[]>(
      `/rest/v1/user_vocabulary_progress?select=word_id,book_id,status,last_status,next_review_at,last_reviewed_at,updated_at,created_at,review_count,mistake_count,vocabulary_books(slug,title,word_count,is_active)&user_id=eq.${userId}&order=updated_at.desc.nullslast`,
      session,
    ),
  ]);

  const today = new Date();
  const booksMap = new Map(
    bookRows.map((book) => [
      book.slug,
      {
        slug: book.slug,
        title: book.title,
        totalWords: book.word_count,
        masteredWords: 0,
        dueWords: 0,
        mistakeWords: 0,
      },
    ]),
  );

  let dueCount = 0;
  let completedToday = 0;
  let masteredCount = 0;
  let mistakeCount = 0;

  for (const row of progressRows) {
    const book = firstJoin(row.vocabulary_books);
    const bookSlug = book?.slug ?? null;
    const bucket =
      (bookSlug && booksMap.get(bookSlug)) ||
      (bookSlug
        ? {
            slug: bookSlug,
            title: book?.title ?? '当前词书',
            totalWords: book?.word_count ?? 0,
            masteredWords: 0,
            dueWords: 0,
            mistakeWords: 0,
          }
        : null);

    if (row.status === 'mastered') {
      masteredCount += 1;
      if (sameDay(row.last_reviewed_at ?? row.updated_at ?? row.created_at, today)) {
        completedToday += 1;
      }
      if (bucket) bucket.masteredWords += 1;
    } else if (row.status === 'mistake') {
      mistakeCount += 1;
      dueCount += 1;
      if (bucket) bucket.mistakeWords += 1;
    } else {
      dueCount += 1;
      if (bucket) bucket.dueWords += 1;
    }

    if (bucket && bookSlug && !booksMap.has(bookSlug)) {
      booksMap.set(bookSlug, bucket);
    }
  }

  const myWordsCount = progressRows.filter((row) => row.word_id).length;
  const masteryRate = myWordsCount > 0 ? Math.round((masteredCount / myWordsCount) * 100) : 0;

  return {
    todayDueCount: dueCount,
    completedTodayCount: completedToday,
    myWordsCount,
    mistakeWordsCount: mistakeCount,
    masteryRate,
    activeBooksCount: bookRows.length,
    books: Array.from(booksMap.values()),
  };
}

export async function fetchVocabularyNotebook(session: StoredSession) {
  try {
    return await fetchVocabularyApiJson<VocabularyProgressResponse>('/api/vocabulary/progress', session);
  } catch (error) {
    if (!isVocabularyAuthError(error)) throw error;
    return fetchVocabularyNotebookDirect(session);
  }
}

export async function updateVocabularyWordStatus(
  session: StoredSession,
  payload: { word: string; book?: string; bookSlug?: string; status: NotebookStatus },
) {
  try {
    return await fetchVocabularyApiJson<{ word: NotebookWord }>('/api/vocabulary/progress', session, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (!isVocabularyAuthError(error)) throw error;
    return updateVocabularyWordStatusDirect(session, payload);
  }
}

export async function submitVocabularyReviewResult(
  session: StoredSession,
  payload: {
    word: string;
    phonetic?: string;
    meaning?: string;
    english?: string;
    example?: string;
    exampleZh?: string;
    book?: string;
    bookSlug?: string;
    result: ReviewResult;
  },
) {
  try {
    const response = await fetchVocabularyApiJson<{ word: NotebookWord }>('/api/vocabulary/progress', session, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log('vocabulary_review_result_schedule', {
      word: payload.word,
      result: payload.result,
      oldStatus: null,
      newStatus: response.word.status,
      oldMasteryLevel: null,
      newMasteryLevel: null,
      nextReviewAt: response.word.nextReviewAt ?? null,
    });
    return response;
  } catch (error) {
    if (!isVocabularyAuthError(error)) throw error;
    return submitVocabularyReviewResultDirect(session, payload);
  }
}

export async function fetchVocabularyReviewQueue(
  session: StoredSession,
  options?: {
    mode?: ReviewMode;
    bookSlug?: string;
    source?: 'plan' | 'extra' | 'direct';
    initial?: boolean;
    limit?: number;
    cursor?: number;
  },
) {
  const url = new URL(buildAppApiUrl('/api/vocabulary/review-words'));
  url.searchParams.set('mode', options?.mode ?? 'review');
  if (options?.bookSlug) {
    url.searchParams.set('bookSlug', options.bookSlug);
  }
  if (options?.source) {
    url.searchParams.set('source', options.source);
  }
  if (typeof options?.initial === 'boolean') {
    url.searchParams.set('initial', String(options.initial));
  }
  if (typeof options?.limit === 'number') {
    url.searchParams.set('limit', String(options.limit));
  }
  if (typeof options?.cursor === 'number') {
    url.searchParams.set('cursor', String(options.cursor));
  }

  return fetchVocabularyApiJson<ReviewQueueResponse>(`${url.pathname}${url.search}`, session);
}

async function fetchVocabularyMistakeReviewQueue(
  session: StoredSession,
  options?: {
    mode?: ReviewMode;
    bookSlug?: string;
    initial?: boolean;
    limit?: number;
    cursor?: number;
  },
): Promise<ReviewQueueResponse> {
  const notebook = await fetchVocabularyNotebookDirect(session);
  const offset = Math.max(options?.cursor ?? 0, 0);
  const limit = Math.max(options?.limit ?? 20, 1);

  const rankedWords = notebook.words
    .filter((word) => {
      if (options?.bookSlug && word.bookSlug !== options.bookSlug) return false;
      return word.status === 'mistake' || (word.mistakeCount ?? 0) > 0;
    })
    .sort((left, right) => {
      const leftPinned = left.status === 'mistake' ? 1 : 0;
      const rightPinned = right.status === 'mistake' ? 1 : 0;
      if (leftPinned !== rightPinned) return rightPinned - leftPinned;

      const mistakeDelta = (right.mistakeCount ?? 0) - (left.mistakeCount ?? 0);
      if (mistakeDelta !== 0) return mistakeDelta;

      const leftDueAt = left.nextReviewAt ? new Date(left.nextReviewAt).getTime() : Number.MAX_SAFE_INTEGER;
      const rightDueAt = right.nextReviewAt ? new Date(right.nextReviewAt).getTime() : Number.MAX_SAFE_INTEGER;
      if (leftDueAt !== rightDueAt) return leftDueAt - rightDueAt;

      const leftReviewedAt = left.lastReviewedAt ? new Date(left.lastReviewedAt).getTime() : 0;
      const rightReviewedAt = right.lastReviewedAt ? new Date(right.lastReviewedAt).getTime() : 0;
      return leftReviewedAt - rightReviewedAt;
    });

  const queuedWords = rankedWords.slice(offset, offset + limit).map((word) => buildMistakeDeckWord(word));
  const fallbackBookTitle = options?.bookSlug ? (await fetchBookBySlug(session, options.bookSlug))?.title ?? '错词专项' : '错词专项';
  const queueBook = queuedWords[0]
    ? { slug: queuedWords[0].bookSlug ?? options?.bookSlug ?? 'mistake', title: queuedWords[0].bookTitle ?? fallbackBookTitle }
    : { slug: options?.bookSlug ?? 'mistake', title: fallbackBookTitle };

  return {
    mode: 'mistake',
    book: queueBook,
    words: queuedWords,
    totalCount: rankedWords.length,
    dueCount: rankedWords.length,
    progress: {
      currentOffset: offset,
      learnedCount: 0,
      loadedCount: queuedWords.length,
      remainingCount: Math.max(rankedWords.length - offset - queuedWords.length, 0),
    },
    window: {
      initial: options?.initial,
      limit,
      cursor: String(offset),
      nextCursor: offset + queuedWords.length < rankedWords.length ? String(offset + queuedWords.length) : null,
    },
  };
}

function buildMistakeDeckWord(word: NotebookWord): ReviewDeckWord {
  const mistakeCount = Math.max(word.mistakeCount ?? 0, 1);
  const chinese = word.meaning?.trim() || '先回想这个词在当前语境里的核心义。';
  const errorReason = word.pattern?.trim()
    ? `这个词近期更容易在「${word.pattern}」上出错，建议先把这一类辨析重新压稳。`
    : '这个词近期反复出错，建议先重新确认词义，再用例句回想一次。';

  return {
    word: word.word,
    phonetic: word.phonetic ?? '',
    accent: 'us',
    bookSlug: word.bookSlug,
    bookTitle: word.book,
    chinese,
    english: word.english ?? null,
    example: word.example ?? null,
    exampleZh: word.exampleZh ?? null,
    memoryCue: mistakeCount > 1 ? '先用中文义和例句重新绑定，再做一次稳定回想。' : '先确认词义，再做一次完整回想。',
    pattern: word.pattern ?? '未分类错因',
    aiNote: null,
    aiAnalysis: {
      source: 'base',
      version: 'v1',
      word: word.word,
      contextualMeaning: chinese,
      confusableWords: [],
      collocations: [],
      memoryAdvice: mistakeCount > 1 ? '这是近期高频错词，建议今天完成后再快速回看一次。' : '建议在今天内再回看一次，避免刚纠正又回落。',
      speakingExpression: null,
      errorReason,
      predictedRetention: mistakeCount > 2 ? '需要短周期回看' : '今天内再回看一次更稳',
      bestReviewWindow: '建议 2 小时内快速复看一次',
    },
    reviewCount: word.reviewCount ?? 0,
    mistakeCount,
  };
}

export async function fetchVocabularyTodayPlan(session: StoredSession) {
  try {
    const response = await fetchVocabularyApiJson<TodayPlanResponse>('/api/vocabulary/today-plan', session);
    return normalizeTodayPlanResponse(response);
  } catch (error) {
    if (!isVocabularyAuthError(error)) throw error;
    const fallback = await fetchVocabularyTodayPlanDirect(session);
    return normalizeTodayPlanResponse(fallback);
  }
}

export async function updateVocabularyTodayPlan(
  session: StoredSession,
  input: Partial<TodayPlanResponse['plan']>,
) {
  try {
    const response = await fetchVocabularyApiJson<TodayPlanResponse>('/api/vocabulary/today-plan', session, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: input }),
    });
    const normalized = normalizeTodayPlanResponse(response);
    notifyVocabularyDataChanged('today_plan_updated');
    return normalized;
  } catch (error) {
    if (!isVocabularyAuthError(error)) throw error;
    const fallback = await updateVocabularyTodayPlanDirect(session, input);
    const normalized = normalizeTodayPlanResponse(fallback);
    notifyVocabularyDataChanged('today_plan_updated_fallback');
    return normalized;
  }
}

export async function fetchVocabularyReviewStats(session: StoredSession) {
  return fetchVocabularyReviewStatsDirect(session);
}

export async function fetchVocabularyDashboardInsights(
  session: StoredSession,
  payload: {
    totalStudied: number;
    masteredCount: number;
    mistakeCount: number;
    dueCount: number;
    patternMistakes: Array<[string, number]>;
    patternMastered: string[];
    topMistakeWords: string[];
    currentBook: string;
    currentBookSlug?: string;
    refresh?: boolean;
  },
) {
  return fetchVocabularyApiJson<VocabularyDashboardInsights>('/api/vocabulary/dashboard-insights', session, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function fetchVocabularyReportInsight(
  session: StoredSession,
  payload: {
    totalStudied: number;
    masteredCount: number;
    mistakeCount: number;
    dueCount: number;
    patternMistakes: Array<[string, number]>;
    reviewStats?: { known: number; unsure: number; unknown: number };
    refresh?: boolean;
  },
) {
  return fetchVocabularyApiJson<VocabularyReportInsight>('/api/vocabulary/page-insights', session, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'report', ...payload }),
  });
}

export async function fetchVocabularyAnalysisInsight(
  session: StoredSession,
  payload: {
    totalStudied: number;
    masteredCount: number;
    mistakeCount: number;
    dueCount: number;
    patternMistakes: Array<[string, number]>;
    patternMastered: string[];
    topMistakeWords: string[];
    reviewStats?: { known: number; unsure: number; unknown: number };
    refresh?: boolean;
  },
) {
  return fetchVocabularyApiJson<VocabularyAnalysisInsight>('/api/vocabulary/page-insights', session, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'analysis', ...payload }),
  });
}

export async function fetchVocabularyErrorInsight(
  session: StoredSession,
  payload: {
    totalStudied: number;
    mistakeCount: number;
    totalMistakeEvents: number;
    patternMistakes: Array<[string, number]>;
    topMistakeWords: string[];
    refresh?: boolean;
  },
) {
  return fetchVocabularyApiJson<VocabularyErrorInsight>('/api/vocabulary/page-insights', session, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'error', ...payload }),
  });
}

export async function fetchVocabularyWordAnalysis(
  session: StoredSession,
  payload: VocabularyAnalyzeRequest,
) {
  return fetchVocabularyApiJson<VocabularyAnalyzeResponse>('/api/vocabulary/analyze', session, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
