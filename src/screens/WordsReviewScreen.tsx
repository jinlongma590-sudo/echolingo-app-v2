import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import { VideoView } from 'expo-video';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { ActionButton, StatusPill, SurfaceCard } from '@/components/ui/ApplePrimitives';
import { useDeviceClass } from '@/hooks/useDeviceClass';
import { useWordPronunciation } from '@/hooks/useWordPronunciation';
import { extractVocabularyPhoneticCandidates, resolveVocabularyPhonetic } from '@/lib/resolveVocabularyPhonetic';
import { safeBack } from '@/navigation/safeBack';
import { WordsReviewScreenTablet } from '@/screens/WordsReviewScreenTablet';
import type { DisplayAnalysis, QueueStatus, ReviewCounts, ReviewEntrySource } from '@/screens/words-review/types';
import { SpeakingTtsPlayback } from '@/services/audio/ttsPlayback';
import {
  fetchVocabularyTodayPlan,
  fetchVocabularyReviewQueue,
  fetchVocabularyWordAnalysis,
  isVocabularyAuthError,
  submitVocabularyReviewResult,
  type ReviewDeckWord,
  type ReviewMode,
  type ReviewQueueResponse,
  type ReviewResult,
  type VocabularyAnalyzeResponse,
} from '@/services/api/vocabulary';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import {
  ACCENT,
  BG_HERO,
  BG_PAGE,
  BORDER_SOFT,
  COLOR_BLUE,
  COLOR_GREEN,
  COLOR_RED,
  FONT_BODY,
  FONT_CALLOUT,
  FONT_CAPTION,
  FONT_MICRO,
  TEXT_ON_DARK,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
} from '@/theme/tokens';
import { useAppTheme } from '@/theme/AppThemeProvider';

type ReviewQueuePlanContext = {
  remainingNew: number;
  dueNowCount: number;
  todayReviewPlanned: number;
  todayReviewCompleted: number;
  remainingReview: number;
  extraDueReviewAvailable: number;
  mistakeCount: number;
};

type LoadedTodayPlan = Awaited<ReturnType<typeof fetchVocabularyTodayPlan>> | null;
type DerivedQueuePlanState = {
  effectiveBookSlug?: string;
  effectiveBookTitle?: string;
  remainingNewCount: number;
  remainingReviewCount: number;
  remainingMistakeCount: number;
  dueNowCount: number;
  mistakeCount: number;
  dailyNewTarget: number;
  dailyReviewTarget: number;
  todayMistakePlanned: number;
  todayReviewPlanned: number;
  todayReviewCompleted: number;
  extraDueReviewAvailable: number;
  focusBookRemainingWords: number;
};

const PAGE_PADDING = 24;
const REVIEW_QUEUE_FALLBACK_MS = 1500;
const TTS_PRELOAD_CACHE_LIMIT = 8;
const MISSING_PHONETIC_PLACEHOLDER = '音标补充中';
const REVIEW_QUEUE_CACHE_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}vocabulary-review-queue-cache/`
  : null;

const INITIAL_REVIEW_QUEUE_PLAN_CONTEXT: ReviewQueuePlanContext = {
  remainingNew: 0,
  dueNowCount: 0,
  todayReviewPlanned: 0,
  todayReviewCompleted: 0,
  remainingReview: 0,
  extraDueReviewAvailable: 0,
  mistakeCount: 0,
};

type TtsPreloadEntry = {
  uri?: string;
  promise?: Promise<string>;
  createdAt: number;
  failedAt?: number;
};

function getLocalDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function encodeCacheSegment(value: string) {
  return encodeURIComponent(value).replace(/%/g, '_');
}

function buildReviewQueueCacheFile(params: {
  userId?: string | null;
  mode: ReviewMode;
  bookSlug?: string;
  source: ReviewEntrySource;
}) {
  if (!REVIEW_QUEUE_CACHE_DIR || !params.userId) return null;
  return `${REVIEW_QUEUE_CACHE_DIR}${encodeCacheSegment(params.userId)}-${getLocalDateKey()}-${params.mode}-${encodeCacheSegment(params.bookSlug ?? 'all')}-${encodeCacheSegment(params.source)}.json`;
}

function normalizeReviewEntrySource(raw: string | string[] | undefined): ReviewEntrySource {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === 'plan' || value === 'extra') return value;
  if (value === 'today_plan' || value === 'words_home') return 'plan';
  return 'direct';
}

function parseResumeFlag(raw: string | string[] | undefined) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function buildReviewFlowLabel(mode: ReviewMode, source: ReviewEntrySource) {
  if (mode === 'learn') return source === 'plan' ? '今日新词' : source === 'extra' ? '额外新词' : '本轮学习';
  if (mode === 'mistake') return '错词强化';
  if (source === 'extra') return '额外加练';
  if (source === 'plan') return '今日计划内复习';
  return '本轮复习';
}

function buildQueueLoadingTitle(mode: ReviewMode, source: ReviewEntrySource) {
  if (mode === 'review' && source === 'extra') return '正在准备额外加练';
  if (mode === 'review' && source === 'plan') return '正在准备今日计划内复习';
  if (mode === 'learn' && source === 'plan') return '正在准备今日新词';
  if (mode === 'learn' && source === 'extra') return '正在准备额外新词';
  if (mode === 'mistake') return '正在准备错词强化';
  return `正在准备${buildReviewFlowLabel(mode, source)}`;
}

function logWordsReviewPerf(event: string, payload: Record<string, unknown>) {
  if (!(typeof __DEV__ === 'boolean' && __DEV__)) return;
  console.log(`[WordsReview] ${event}`, payload);
}

function buildOptimisticQueueRequest(params: {
  mode: ReviewMode;
  source: ReviewEntrySource;
  requestedBookSlug?: string;
}) {
  if (params.mode === 'learn' && !params.requestedBookSlug) return null;
  return {
    bookSlug: params.requestedBookSlug,
    rawLimit:
      params.mode === 'review' && params.source === 'extra'
        ? 40
        : params.mode === 'learn'
          ? 40
          : 20,
  };
}

function deriveQueuePlanState(params: {
  todayPlan: LoadedTodayPlan;
  mode: ReviewMode;
  requestedBookSlug?: string;
}): DerivedQueuePlanState {
  const { todayPlan, mode, requestedBookSlug } = params;
  const effectiveBookSlug =
    requestedBookSlug ??
    (mode === 'learn' ? todayPlan?.summary.focusBook.slug ?? todayPlan?.plan.focusBookSlug : undefined);
  const effectiveBookTitle =
    (effectiveBookSlug && todayPlan?.summary.focusBook.slug === effectiveBookSlug
      ? todayPlan.summary.focusBook.title
      : undefined) ?? todayPlan?.summary.today.recommendedBookTitle;
  const todaySummary = todayPlan?.summary.today;
  const backlogSummary = todayPlan?.summary.backlog;
  const dailyNewTarget = Math.max(todayPlan?.plan.dailyNewTarget ?? 10, 0);
  const dailyReviewTarget = Math.max(todayPlan?.plan.dailyReviewTarget ?? 20, 0);
  const remainingNewCount = Math.max(
    todaySummary
      ? todaySummary.remainingNew ?? (todaySummary.todayNewPlanned ?? dailyNewTarget) - (todaySummary.todayNewCompleted ?? 0)
      : dailyNewTarget,
    0,
  );
  const remainingReviewCount = Math.max(
    todaySummary
      ? todaySummary.remainingReview ?? (todaySummary.todayReviewPlanned ?? dailyReviewTarget) - (todaySummary.todayReviewCompleted ?? 0)
      : dailyReviewTarget,
    0,
  );
  const remainingMistakeCount = Math.max(
    todaySummary
      ? todaySummary.remainingMistake ?? (todaySummary.todayMistakePlanned ?? todayPlan?.plan.dailyMistakeTarget ?? 0) - (todaySummary.todayMistakeCompleted ?? 0)
      : Math.max(todayPlan?.plan.dailyMistakeTarget ?? 10, 0),
    0,
  );
  const dueNowCount = Math.max(backlogSummary?.dueNowCount ?? 0, 0);
  const mistakeCount = Math.max(backlogSummary?.mistakeCount ?? todaySummary?.todayMistakePlanned ?? 0, 0);
  const todayMistakePlanned = Math.max(todaySummary?.todayMistakePlanned ?? todayPlan?.plan.dailyMistakeTarget ?? 0, 0);
  const todayReviewPlanned = Math.max(
    Math.min(todaySummary?.todayReviewPlanned ?? dailyReviewTarget, dueNowCount, dailyReviewTarget || dueNowCount),
    0,
  );
  const todayReviewCompleted = Math.max(todaySummary?.todayReviewCompleted ?? 0, 0);
  const extraDueReviewAvailable = Math.max(
    todaySummary?.extraDueReviewAvailable ?? dueNowCount - remainingReviewCount,
    0,
  );
  const extraLearnBatchSize = Math.max(10, Math.min(dailyNewTarget || 10, 20));
  const focusBookRemainingWords = Math.max(
    todayPlan?.summary.focusBook.remainingWords ?? (effectiveBookSlug ? extraLearnBatchSize : 0),
    0,
  );

  return {
    effectiveBookSlug,
    effectiveBookTitle,
    remainingNewCount,
    remainingReviewCount,
    remainingMistakeCount,
    dueNowCount,
    mistakeCount,
    dailyNewTarget,
    dailyReviewTarget,
    todayMistakePlanned,
    todayReviewPlanned,
    todayReviewCompleted,
    extraDueReviewAvailable,
    focusBookRemainingWords,
  };
}

function buildCompletedQueue(mode: ReviewMode, bookSlug?: string, bookTitle?: string): ReviewQueueResponse {
  const fallbackTitle = mode === 'learn' ? '今日新词' : mode === 'mistake' ? '错词强化' : '到期复习';
  return {
    mode,
    book: {
      slug: bookSlug ?? mode,
      title: bookTitle ?? fallbackTitle,
    },
    words: [],
    totalCount: 0,
    dueCount: 0,
    progress: {
      currentOffset: 0,
      learnedCount: 0,
      loadedCount: 0,
      remainingCount: 0,
    },
    window: {
      initial: true,
      limit: 0,
      cursor: '0',
      nextCursor: null,
    },
  };
}

function normalizeFreshReviewQueue(queue: ReviewQueueResponse): ReviewQueueResponse {
  const loadedCount = queue.words.length;
  const totalCount = queue.totalCount ?? loadedCount;
  return {
    ...queue,
    totalCount,
    dueCount: queue.dueCount ?? totalCount,
    progress: {
      ...queue.progress,
      currentOffset: 0,
      learnedCount: 0,
      loadedCount: queue.progress?.loadedCount ?? loadedCount,
      remainingCount: queue.progress?.remainingCount ?? Math.max(totalCount - loadedCount, 0),
    },
    window: {
      ...queue.window,
      cursor: queue.window?.cursor ?? '0',
      limit: queue.window?.limit ?? loadedCount,
    },
  };
}

function sliceReviewQueueForEntry(
  queue: ReviewQueueResponse,
  params: {
    mode: ReviewMode;
    source: ReviewEntrySource;
    finalLimit: number;
    remainingReview: number;
    dueNowCount: number;
    extraDueReviewAvailable: number;
  },
) {
  const rawCount = queue.words.length;
  const finalLimit = Math.max(params.finalLimit, 0);
  const splitOffset =
    params.mode === 'review' && params.source === 'extra' ? Math.max(params.remainingReview, 0) : 0;
  const availableCountAfterSplit = Math.max((queue.totalCount ?? rawCount) - splitOffset, 0);
  const slicedWords =
    finalLimit <= 0 ? [] : queue.words.slice(splitOffset, splitOffset + finalLimit);
  const finalCount = slicedWords.length;
  const targetCount = finalLimit > 0 ? Math.min(finalLimit, availableCountAfterSplit || finalCount) : 0;
  const nextCursor = finalCount < targetCount ? queue.window?.nextCursor ?? null : null;
  const normalizedQueue: ReviewQueueResponse = {
    ...queue,
    words: slicedWords,
    totalCount: availableCountAfterSplit,
    dueCount: availableCountAfterSplit,
    progress: {
      ...queue.progress,
      currentOffset: 0,
      learnedCount: 0,
      loadedCount: finalCount,
      remainingCount: Math.max(targetCount - finalCount, 0),
    },
    window: {
      ...queue.window,
      cursor: '0',
      limit: finalCount,
      nextCursor,
    },
  };

  console.log('vocabulary_review_plan_extra_split', {
    mode: params.mode,
    source: params.source,
    dueNowCount: params.dueNowCount,
    remainingReview: params.remainingReview,
    extraAvailable: params.extraDueReviewAvailable,
    rawCount,
    finalCount,
    firstWord: normalizedQueue.words[0]?.word ?? null,
  });

  return {
    queue: normalizedQueue,
    rawCount,
    finalCount,
    targetCount,
    firstWord: normalizedQueue.words[0]?.word ?? null,
  };
}

function buildReviewWordKey(word: ReviewDeckWord) {
  return [
    word.wordId ?? 'word',
    word.bookSlug ?? 'book',
    word.word,
    String(word.reviewCount ?? 0),
    String(word.mistakeCount ?? 0),
  ].join('|');
}

function registerReviewWordKeys(words: ReviewDeckWord[], target: Set<string>) {
  for (const word of words) {
    target.add(buildReviewWordKey(word));
  }
}

function deriveSessionTargetCount(queue: ReviewQueueResponse) {
  const learnedCount = Math.max(queue.progress?.learnedCount ?? 0, 0);
  const loadedCount = queue.words.length;
  const remainingCount = Math.max(queue.progress?.remainingCount ?? 0, 0);
  const derived = learnedCount + loadedCount + remainingCount;
  if (derived > 0) return derived;
  return queue.totalCount ?? loadedCount;
}

function buildTtsPreloadKey(word: string) {
  return String(word || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
}

async function readCachedReviewQueue(filePath: string | null) {
  if (!filePath) return null;
  try {
    const info = await FileSystem.getInfoAsync(filePath);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(filePath);
    const parsed = JSON.parse(raw) as ReviewQueueResponse;
    return Array.isArray(parsed.words) ? parsed : null;
  } catch (error) {
    console.log('vocabulary_review_queue_cache_read_failed', error);
    return null;
  }
}

async function writeCachedReviewQueue(filePath: string | null, queue: ReviewQueueResponse) {
  if (!filePath) return;
  try {
    await FileSystem.makeDirectoryAsync(REVIEW_QUEUE_CACHE_DIR!, {
      intermediates: true,
    });
    await FileSystem.writeAsStringAsync(filePath, JSON.stringify(queue));
  } catch (error) {
    console.log('vocabulary_review_queue_cache_write_failed', error);
  }
}

function logQueuePhoneticCoverage(queue: ReviewQueueResponse, source: 'cache' | 'remote') {
  if (!(typeof __DEV__ === 'boolean' && __DEV__)) return;
  const missingWords = queue.words
    .filter((word) => !hasResolvedPhonetic(word))
    .map((word) => ({
      word: word.word,
      bookSlug: word.bookSlug ?? queue.book.slug ?? null,
    }));
  console.log('vocabulary_phonetic_queue_missing_count', {
    source,
    mode: queue.mode,
    total: queue.words.length,
    missingCount: missingWords.length,
    missingWords: missingWords.slice(0, 40),
  });
}

function buildQueueMergeKey(word: ReviewDeckWord) {
  return word.wordId
    ? `id:${word.wordId}`
    : `${word.bookSlug ?? 'all'}:${word.word.trim().toLowerCase()}`;
}

function logWordsReviewAudio(event: string, payload: Record<string, unknown>) {
  console.log(`[words-review][audio] ${event}`, payload);
}

function mergeReviewQueueWordFields(current: ReviewQueueResponse, refreshed: ReviewQueueResponse): ReviewQueueResponse {
  const refreshedByKey = new Map(refreshed.words.map((word) => [buildQueueMergeKey(word), word]));
  let changed = false;
  const words = current.words.map((word) => {
    const next = refreshedByKey.get(buildQueueMergeKey(word));
    if (!next) return word;
    const merged = {
      ...word,
      phonetic: next.phonetic?.trim() ? next.phonetic : word.phonetic,
      pronunciation: next.pronunciation ?? word.pronunciation,
      english: next.english ?? word.english,
      example: next.example ?? word.example,
      exampleZh: next.exampleZh ?? word.exampleZh,
    };
    if (
      merged.phonetic !== word.phonetic ||
      merged.pronunciation !== word.pronunciation ||
      merged.english !== word.english ||
      merged.example !== word.example ||
      merged.exampleZh !== word.exampleZh
    ) {
      changed = true;
    }
    return merged;
  });

  const mergedQueue: ReviewQueueResponse = {
    ...current,
    words,
    totalCount: refreshed.totalCount ?? current.totalCount,
    dueCount: refreshed.dueCount ?? current.dueCount,
    progress: refreshed.progress ?? current.progress,
    window: refreshed.window ?? current.window,
  };

  if (
    mergedQueue.totalCount !== current.totalCount ||
    mergedQueue.dueCount !== current.dueCount ||
    mergedQueue.progress !== current.progress ||
    mergedQueue.window !== current.window
  ) {
    changed = true;
  }

  return changed ? mergedQueue : current;
}

function getDisplayPhonetic(word: ReviewDeckWord) {
  return resolveVocabularyPhonetic(word) || MISSING_PHONETIC_PLACEHOLDER;
}

function hasResolvedPhonetic(word: ReviewDeckWord) {
  return Boolean(resolveVocabularyPhonetic(word));
}

type ReviewDeckWordWithAudio = ReviewDeckWord & {
  audioUrl?: string | null;
  ipa?: string | null;
  usPhonetic?: string | null;
  ukPhonetic?: string | null;
  phonetics?: unknown;
  dictionary?: unknown;
  metadata?: unknown;
  raw?: unknown;
  extra?: unknown;
  payload?: unknown;
};

function first80(value: unknown) {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).slice(0, 80);
  }
  try {
    return JSON.stringify(value).slice(0, 80);
  } catch {
    return '[unserializable]';
  }
}

function hasNestedPhonetic(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  try {
    const raw = JSON.stringify(value).toLowerCase();
    return raw.includes('phonetic') || raw.includes('ipa') || raw.includes('"us"') || raw.includes('"uk"');
  } catch {
    return false;
  }
}

function logSafePhoneticFields(word: ReviewDeckWord) {
  const flexible = word as ReviewDeckWordWithAudio;
  console.log('vocabulary_review_word_raw_fields', {
    id: first80((flexible as { id?: unknown }).id),
    word: first80(flexible.word),
    phonetic: first80(flexible.phonetic),
    ipa: first80(flexible.ipa),
    usPhonetic: first80(flexible.usPhonetic),
    ukPhonetic: first80(flexible.ukPhonetic),
    phonetics: first80(flexible.phonetics),
    pronunciation: first80(flexible.pronunciation),
    dictionary: first80(flexible.dictionary),
    metadata: first80(flexible.metadata),
    raw: first80(flexible.raw),
    extra: first80(flexible.extra),
  });
  console.log('vocabulary_word_phonetic_fields', {
    word: first80(flexible.word),
    phonetic: first80(flexible.phonetic),
    ipa: first80(flexible.ipa),
    usPhonetic: first80(flexible.usPhonetic),
    ukPhonetic: first80(flexible.ukPhonetic),
    phonetics: first80(flexible.phonetics),
    pronunciation: first80(flexible.pronunciation),
    dictionary: first80(flexible.dictionary),
    metadata: first80(flexible.metadata),
    rawHasPhonetic: hasNestedPhonetic(flexible.raw),
    extraHasPhonetic: hasNestedPhonetic(flexible.extra),
    payloadHasPhonetic: hasNestedPhonetic(flexible.payload),
    candidateCount: extractVocabularyPhoneticCandidates(word).length,
  });
}

function getWordAudioUrl(word: ReviewDeckWord) {
  return (word as ReviewDeckWordWithAudio).audioUrl ?? null;
}

function toReviewUserMessage(kind: 'queue' | 'analysis' | 'submit', error: unknown) {
  if (isVocabularyAuthError(error)) {
    if (kind === 'queue') return '登录状态已失效，请重新登录后继续复习。';
    if (kind === 'submit') return '登录状态已失效，请重新登录后继续提交。';
    return '完整解读稍后补充，先根据本轮训练结果继续推进。';
  }

  if (kind === 'queue') return '暂时无法加载复习内容，请稍后重试。';
  if (kind === 'submit') return '提交本次判断失败，请稍后重试。';
  return '完整解读稍后补充，先根据本轮训练结果继续推进。';
}

function AnswerButton({
  label,
  tone,
  onPress,
  disabled,
}: {
  label: string;
  tone: 'unknown' | 'unsure' | 'known';
  onPress: () => void;
  disabled?: boolean;
}) {
  const { theme } = useAppTheme();
  const palette = {
    unknown: {
      bg: theme.colorScheme === 'dark' ? 'rgba(255,69,58,0.14)' : 'rgba(255,243,240,0.94)',
      fg: theme.colorScheme === 'dark' ? theme.destructive : TEXT_PRIMARY,
      border: theme.colorScheme === 'dark' ? 'rgba(255,69,58,0.28)' : 'rgba(255,59,48,0.12)',
    },
    unsure: {
      bg: theme.colorScheme === 'dark' ? 'rgba(235,235,245,0.10)' : 'rgba(255,255,255,0.78)',
      fg: TEXT_PRIMARY,
      border: theme.colorScheme === 'dark' ? 'rgba(235,235,245,0.16)' : 'rgba(28,28,30,0.08)',
    },
    known: {
      bg: theme.colorScheme === 'dark' ? 'rgba(48,209,88,0.14)' : 'rgba(255,250,242,0.96)',
      fg: theme.colorScheme === 'dark' ? COLOR_GREEN : TEXT_PRIMARY,
      border: theme.colorScheme === 'dark' ? 'rgba(48,209,88,0.24)' : 'rgba(245,166,35,0.16)',
    },
  } as const;

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 54,
        borderRadius: 18,
        backgroundColor: palette[tone].bg,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 10,
        borderWidth: 0.75,
        borderColor: palette[tone].border,
        opacity: disabled ? 0.5 : pressed ? 0.62 : 1,
        transform: [{ scale: pressed && !disabled ? 0.985 : 1 }],
      })}
    >
      <AppText style={{ fontSize: 16, fontWeight: '600', letterSpacing: -0.1, color: palette[tone].fg }}>{label}</AppText>
    </Pressable>
  );
}

function LightTopBar({
  currentStep,
  totalCount,
  progressPercent,
  onBack,
}: {
  currentStep: number;
  totalCount: number;
  progressPercent: number;
  onBack: () => void;
}) {
  return (
    <View style={{ paddingHorizontal: PAGE_PADDING, paddingTop: 10, paddingBottom: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Pressable
          onPress={onBack}
          style={({ pressed }) => ({
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.65 : 1,
          })}
        >
          <Ionicons name="chevron-back" size={22} color={TEXT_PRIMARY} />
        </Pressable>

        <View style={{ flex: 1, alignItems: 'center', gap: 6 }}>
          <AppText style={{ fontSize: FONT_BODY, fontWeight: '600', color: TEXT_PRIMARY }}>
            {Math.max(currentStep, totalCount > 0 ? 1 : 0)} / {Math.max(totalCount, 0)}
          </AppText>
          <View
            style={{
              width: 108,
              height: 4,
              borderRadius: 999,
              overflow: 'hidden',
              backgroundColor: 'rgba(28,28,30,0.08)',
            }}
          >
            <View
              style={{
                width: `${Math.max(0, Math.min(100, progressPercent))}%`,
                height: '100%',
                borderRadius: 999,
                backgroundColor: ACCENT,
              }}
            />
          </View>
        </View>

        <View style={{ width: 36, height: 36 }} />
      </View>
    </View>
  );
}

function StageHint({ text }: { text: string }) {
  return <AppText style={{ fontSize: FONT_MICRO, letterSpacing: 0.2, color: TEXT_TERTIARY }}>{text}</AppText>;
}

function EmptyState({
  mode,
  source,
  counts,
  reviewedCount,
  extraDueReviewAvailable,
}: {
  mode: ReviewMode;
  source: ReviewEntrySource;
  counts: ReviewCounts;
  reviewedCount: number;
  extraDueReviewAvailable: number;
}) {
  const isCompleted = reviewedCount > 0;
  const hasDetailedCounts = counts.known + counts.unsure + counts.unknown > 0;
  const title = isCompleted
    ? mode === 'learn' && source === 'plan'
      ? '今日新词计划完成'
      : mode === 'learn' && source === 'extra'
        ? '本轮额外新词完成'
        : mode === 'review' && source === 'extra'
          ? '加练完成'
          : mode === 'review' && source === 'plan'
            ? '今日复习计划完成'
            : mode === 'mistake'
              ? '错词强化完成'
              : '本轮完成'
    : mode === 'learn' && source === 'plan'
      ? '今日新词计划已完成'
      : mode === 'review' && source === 'plan'
        ? '今日复习计划已完成'
      : mode === 'review' && source === 'extra'
          ? '当前没有可加练的到期词'
          : mode === 'mistake'
            ? '当前没有待强化错词'
            : '暂无待复习';
  const subtitle = isCompleted
    ? mode === 'mistake'
      ? '本轮错词强化已经完成。'
      : mode === 'learn' && source === 'plan'
        ? '今天计划内的新词已经学完。'
        : mode === 'learn' && source === 'extra'
          ? '这一轮额外新词已经学完。'
      : mode === 'review' && source === 'extra'
        ? '额外加练的到期词已经处理完'
        : mode === 'review' && source === 'plan'
          ? extraDueReviewAvailable > 0
            ? `计划内复习已经完成，还有 ${extraDueReviewAvailable} 个到期词可继续加练。`
            : '计划内到期复习已经完成。'
          : mode === 'review'
            ? '本轮到期复习已经收束好'
            : '今天这轮学习已经收束好'
    : mode === 'learn' && source === 'plan'
      ? '今天没有剩余的计划内新词。'
      : mode === 'review' && source === 'plan'
      ? extraDueReviewAvailable > 0
        ? `计划内复习已经完成，还有 ${extraDueReviewAvailable} 个到期词可继续加练。`
        : '今天没有剩余的计划内到期复习。'
      : mode === 'review' && source === 'extra'
        ? '当前没有额外可加练的到期词。'
        : mode === 'mistake'
          ? '当前没有待强化的错词。'
        : '今天暂无复习词';
  const body = isCompleted
    ? mode === 'learn' && source === 'plan'
      ? `今天计划内共完成 ${reviewedCount} 个新词。`
      : mode === 'learn' && source === 'extra'
        ? `这轮额外共完成 ${reviewedCount} 个新词。`
        : mode === 'review' && source === 'extra'
          ? `这轮加练共完成 ${reviewedCount} 个到期词。`
          : mode === 'review' && source === 'plan'
            ? `今天计划内共完成 ${reviewedCount} 个到期复习。`
            : mode === 'mistake'
              ? `这轮共完成 ${reviewedCount} 个错词强化。`
              : `本轮共完成 ${reviewedCount} 个词，继续保持节奏。`
    : mode === 'review' && source === 'extra'
      ? '当前没有额外可加练的到期词。'
      : mode === 'review' && source === 'plan'
        ? '今天的复习计划已经完成。'
        : mode === 'learn' && source === 'plan'
          ? '今天的计划内新词已经完成。'
          : mode === 'mistake'
            ? '今天没有待强化的错词。'
        : '今天暂无复习词，先去添加几个单词吧。';

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', gap: 18 }}>
      <View style={{ alignItems: 'center', gap: 12 }}>
        <View
          style={{
            width: 76,
            height: 76,
            borderRadius: 38,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: isCompleted ? 'rgba(52,199,89,0.12)' : 'rgba(142,142,147,0.12)',
            borderWidth: 0.75,
            borderColor: isCompleted ? 'rgba(52,199,89,0.18)' : 'rgba(142,142,147,0.14)',
          }}
        >
          <Ionicons
            name={isCompleted ? 'checkmark' : 'leaf-outline'}
            size={34}
            color={isCompleted ? '#34C759' : TEXT_SECONDARY}
          />
        </View>
        <AppText style={{ fontSize: 28, fontWeight: '700', letterSpacing: -0.5, color: TEXT_PRIMARY, textAlign: 'center' }}>
          {title}
        </AppText>
        <AppText style={{ fontSize: FONT_CALLOUT, color: TEXT_SECONDARY, textAlign: 'center' }}>{subtitle}</AppText>
        <AppText style={{ maxWidth: 300, fontSize: FONT_CAPTION, lineHeight: 20, color: TEXT_TERTIARY, textAlign: 'center' }}>
          {body}
        </AppText>
      </View>

      <SurfaceCard style={{ width: '100%', padding: 0, overflow: 'hidden', borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.82)' }}>
        {hasDetailedCounts ? (
          <>
            <View style={{ flexDirection: 'row', borderBottomWidth: 0.75, borderBottomColor: 'rgba(28,28,30,0.06)' }}>
              <CompletionStat label="总词数" value={reviewedCount} />
              <CompletionStat label="认识" value={counts.known} withLeftBorder />
            </View>
            <View style={{ flexDirection: 'row' }}>
              <CompletionStat label="模糊" value={counts.unsure} />
              <CompletionStat label="不会" value={counts.unknown} withLeftBorder />
            </View>
          </>
        ) : (
          <View style={{ paddingHorizontal: 18, paddingVertical: 18, gap: 8 }}>
            <AppText style={{ fontSize: FONT_BODY, fontWeight: '700', color: TEXT_PRIMARY }}>
              {isCompleted ? `${title} ${reviewedCount} 个` : title}
            </AppText>
            <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: TEXT_SECONDARY }}>
              详细分布正在整理中，总完成量已按本轮训练同步。
            </AppText>
          </View>
        )}
      </SurfaceCard>

      <View style={{ width: '100%', gap: 10 }}>
        <ActionButton label="回到学习流" variant="dark" onPress={() => router.replace('/(tabs)/words')} />
        <ActionButton label="查看今日计划" variant="secondary" onPress={() => router.replace('/words/today')} style={{ backgroundColor: 'rgba(255,255,255,0.7)' }} />
      </View>
    </View>
  );
}

function CompletionStat({
  label,
  value,
  withLeftBorder,
}: {
  label: string;
  value: number;
  withLeftBorder?: boolean;
}) {
  return (
    <View
      style={{
        flex: 1,
        minHeight: 72,
        paddingVertical: 14,
        paddingHorizontal: 16,
        justifyContent: 'center',
        borderLeftWidth: withLeftBorder ? 0.75 : 0,
        borderLeftColor: 'rgba(28,28,30,0.06)',
      }}
    >
      <AppText style={{ fontSize: 24, fontWeight: '700', letterSpacing: -0.3, color: TEXT_PRIMARY }}>{value}</AppText>
      <AppText style={{ marginTop: 3, fontSize: FONT_MICRO, color: TEXT_TERTIARY }}>{label}</AppText>
    </View>
  );
}

function SlowQueueCard({
  title,
  onRetry,
  onBackToPlan,
}: {
  title: string;
  onRetry: () => void;
  onBackToPlan: () => void;
}) {
  return (
    <SurfaceCard style={{ marginHorizontal: PAGE_PADDING, marginBottom: 0, padding: 20 }}>
      <View style={{ gap: 14 }}>
        <View
          style={{
            width: 46,
            height: 46,
            borderRadius: 23,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(95,137,217,0.12)',
          }}
        >
          <Ionicons name="cloud-download-outline" size={22} color={ACCENT} />
        </View>
        <AppText style={{ fontSize: 24, fontWeight: '700', color: TEXT_PRIMARY }}>{title}</AppText>
        <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 21, color: TEXT_SECONDARY }}>
          网络有点慢，正在后台继续读取。你可以稍等片刻，或先回到今日计划。
        </AppText>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <ActionButton label="重新读取" variant="dark" onPress={onRetry} />
          <ActionButton label="今日计划" variant="secondary" onPress={onBackToPlan} />
        </View>
      </View>
    </SurfaceCard>
  );
}

function ReviewStateCard({
  tone,
  title,
  message,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: {
  tone: 'error' | 'auth';
  title: string;
  message: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  return (
    <SurfaceCard style={{ marginHorizontal: PAGE_PADDING, marginBottom: 0, padding: 20 }}>
      <View style={{ gap: 14 }}>
        <StatusPill label={tone === 'auth' ? '需要登录' : '加载失败'} tone={tone === 'auth' ? 'amber' : 'red'} />
        <AppText style={{ fontSize: 24, fontWeight: '700', color: TEXT_PRIMARY }}>{title}</AppText>
        <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: TEXT_SECONDARY }}>{message}</AppText>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <ActionButton label={primaryLabel} variant="dark" onPress={onPrimary} />
          {secondaryLabel && onSecondary ? <ActionButton label={secondaryLabel} variant="secondary" onPress={onSecondary} /> : null}
        </View>
      </View>
    </SurfaceCard>
  );
}

function AnalysisDrawer({
  expanded,
  onToggle,
  mode,
  onModeChange,
  word,
  analysis,
  loading,
  error,
  onRetry,
}: {
  expanded: boolean;
  onToggle: () => void;
  mode: ReviewMode;
  onModeChange: (mode: ReviewMode) => void;
  word: ReviewDeckWord;
  analysis: DisplayAnalysis;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const { theme } = useAppTheme();
  const subtitle =
    mode === 'learn'
      ? '先理解词义，再做判断。'
      : mode === 'review'
        ? '结合记忆曲线，安排合适复习。'
        : mode === 'mistake'
          ? '优先处理容易混淆的薄弱点。'
          : '根据当前单词生成学习建议。';
  const collapsedSummary = loading
    ? '正在整理这个单词的学习提示…'
    : error
      ? '暂时没整理好，先按自己的感觉判断即可。'
      : subtitle;
  const metricValue = analysis.predictedRetention?.trim() ? analysis.predictedRetention : '整理中';
  const windowValue = analysis.bestReviewWindow?.trim() ? analysis.bestReviewWindow : '整理中';
  const headerIconName = mode === 'learn' ? 'sparkles-outline' : mode === 'review' ? 'analytics-outline' : 'bulb-outline';
  const headerIconTint = mode === 'learn' ? COLOR_BLUE : mode === 'review' ? '#0F766E' : '#B45309';
  const headerIconBackground =
    mode === 'learn' ? 'rgba(0,122,255,0.12)' : mode === 'review' ? 'rgba(15,118,110,0.12)' : 'rgba(180,83,9,0.12)';
  const sectionCardStyle = {
    borderRadius: 20,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.cardBackground,
  };
  const tabItems: Array<{ key: ReviewMode; label: string }> = [
    { key: 'learn', label: '新词理解' },
    { key: 'review', label: '记忆复习' },
    { key: 'mistake', label: '易错强化' },
  ];

  return (
    <View
      style={{
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: 98,
        height: expanded ? 404 : 110,
        borderRadius: 32,
        backgroundColor: 'transparent',
        shadowColor: theme.shadowColor,
        shadowOpacity: theme.colorScheme === 'dark' ? 0.03 : 0.1,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
        elevation: 10,
        overflow: 'visible',
      }}
    >
      <View
        style={{
          flex: 1,
          borderRadius: 32,
          backgroundColor: theme.elevatedCardBackground,
          borderWidth: 0.5,
          borderColor: theme.border,
          overflow: 'hidden',
        }}
      >
        <Pressable onPress={onToggle} style={{ paddingTop: 12, paddingHorizontal: 18, paddingBottom: expanded ? 10 : 14 }}>
          <View style={{ alignItems: 'center', paddingBottom: expanded ? 12 : 10 }}>
            <View style={{ width: 42, height: 5, borderRadius: 999, backgroundColor: theme.separator }} />
          </View>
          <View style={{ gap: expanded ? 10 : 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <View style={{ flex: 1, flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 19,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: headerIconBackground,
                  }}
                >
                  <Ionicons name={headerIconName} size={18} color={headerIconTint} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText style={{ fontSize: 18, fontWeight: '700', color: TEXT_PRIMARY }}>学习提示</AppText>
                  <AppText style={{ fontSize: 13, lineHeight: 18, color: TEXT_SECONDARY }}>{expanded ? subtitle : collapsedSummary}</AppText>
                </View>
              </View>
              <View
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.secondaryCardBackground,
                }}
              >
                <Ionicons name={expanded ? 'chevron-down' : 'chevron-up'} size={18} color={theme.textSecondary} />
              </View>
            </View>
          </View>
        </Pressable>

        {expanded ? (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 24, gap: 14 }}>
            <View
              style={{
                flexDirection: 'row',
                gap: 8,
                padding: 4,
                borderRadius: 18,
                backgroundColor: theme.secondaryCardBackground,
              }}
            >
              {tabItems.map((item) => {
                const active = mode === item.key;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => onModeChange(item.key)}
                    style={({ pressed }) => ({
                      flex: 1,
                      minHeight: 36,
                      borderRadius: 14,
                      alignItems: 'center',
                      justifyContent: 'center',
                      paddingHorizontal: 8,
                      backgroundColor: active ? theme.primaryBlue : 'transparent',
                      opacity: pressed ? 0.82 : 1,
                    })}
                  >
                    <AppText
                      style={{
                        fontSize: 12,
                        fontWeight: active ? '700' : '600',
                        color: active ? '#FFFFFF' : theme.textSecondary,
                      }}
                    >
                      {item.label}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View
                style={{
                  flex: 1,
                  borderRadius: 20,
                  paddingVertical: 14,
                  paddingHorizontal: 14,
                  gap: 6,
                  backgroundColor: theme.colorScheme === 'dark' ? 'rgba(10,132,255,0.14)' : 'rgba(0,122,255,0.08)',
                  borderWidth: 1,
                  borderColor: theme.colorScheme === 'dark' ? 'rgba(10,132,255,0.24)' : 'rgba(0,122,255,0.12)',
                }}
              >
                <AppText style={{ fontSize: 12, fontWeight: '600', color: theme.textSecondary }}>预测记忆率</AppText>
                <AppText style={{ fontSize: 22, fontWeight: '700', color: TEXT_PRIMARY }}>{metricValue}</AppText>
              </View>
              <View
                style={{
                  flex: 1,
                  borderRadius: 20,
                  paddingVertical: 14,
                  paddingHorizontal: 14,
                  gap: 6,
                  backgroundColor: theme.colorScheme === 'dark' ? 'rgba(48,209,88,0.14)' : 'rgba(52,199,89,0.1)',
                  borderWidth: 1,
                  borderColor: theme.colorScheme === 'dark' ? 'rgba(48,209,88,0.24)' : 'rgba(52,199,89,0.14)',
                }}
              >
                <AppText style={{ fontSize: 12, fontWeight: '600', color: theme.textSecondary }}>最佳窗口</AppText>
                <AppText style={{ fontSize: 22, fontWeight: '700', color: TEXT_PRIMARY }}>{windowValue}</AppText>
              </View>
            </View>

            {loading ? (
              <View style={{ ...sectionCardStyle, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ActivityIndicator size="small" color={ACCENT} />
                <AppText style={{ flex: 1, fontSize: FONT_CALLOUT, lineHeight: 20, color: TEXT_SECONDARY }}>
                  正在整理这个单词的学习提示…
                </AppText>
              </View>
            ) : null}

            {error ? (
              <View style={{ ...sectionCardStyle, backgroundColor: theme.secondaryCardBackground }}>
                <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: TEXT_SECONDARY }}>
                  暂时没整理好，先按自己的感觉判断即可。
                </AppText>
                <Pressable onPress={onRetry} style={({ pressed }) => ({ alignSelf: 'flex-start', opacity: pressed ? 0.68 : 1 })}>
                  <AppText style={{ fontSize: FONT_CAPTION, fontWeight: '700', color: ACCENT }}>重新整理</AppText>
                </Pressable>
              </View>
            ) : null}

            <View style={{ gap: 12 }}>
              <View style={sectionCardStyle}>
                <AppText style={{ fontSize: FONT_CAPTION, fontWeight: '600', color: TEXT_SECONDARY }}>语境理解</AppText>
                <AppText style={{ fontSize: FONT_BODY, lineHeight: 21, color: TEXT_PRIMARY }}>{analysis.contextualMeaning}</AppText>
              </View>

              <View style={sectionCardStyle}>
                <AppText style={{ fontSize: FONT_CAPTION, fontWeight: '600', color: TEXT_SECONDARY }}>记忆方法</AppText>
                <AppText style={{ fontSize: FONT_BODY, lineHeight: 21, color: TEXT_PRIMARY }}>{analysis.memoryTip}</AppText>
              </View>

              <View style={sectionCardStyle}>
                <AppText style={{ fontSize: FONT_CAPTION, fontWeight: '600', color: TEXT_SECONDARY }}>容易卡住的点</AppText>
                <AppText style={{ fontSize: FONT_BODY, lineHeight: 21, color: TEXT_PRIMARY }}>{analysis.errorReasonSummary}</AppText>
              </View>

              <View style={sectionCardStyle}>
                <AppText style={{ fontSize: FONT_CAPTION, fontWeight: '600', color: TEXT_SECONDARY }}>下一步练习</AppText>
                <AppText style={{ fontSize: FONT_BODY, lineHeight: 21, color: TEXT_PRIMARY }}>
                  {analysis.speakingPhrase?.trim()
                    ? `先用这个表达回想一遍：${analysis.speakingPhrase}`
                    : analysis.collocations[0]
                      ? `优先记住搭配「${analysis.collocations[0].phrase}」`
                      : '先完成当前判断，再决定是否继续回看这个词。'}
                </AppText>
              </View>

              <View
                style={{
                  borderRadius: 20,
                  backgroundColor: theme.secondaryCardBackground,
                  padding: 16,
                  gap: 8,
                  borderWidth: 1,
                  borderColor: theme.border,
                }}
              >
                <AppText style={{ fontSize: FONT_CAPTION, fontWeight: '600', color: TEXT_SECONDARY }}>词条补充</AppText>
                <AppText style={{ fontSize: FONT_BODY, lineHeight: 21, color: TEXT_PRIMARY }}>{word.chinese}</AppText>
                <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: TEXT_SECONDARY }}>
                  {word.english?.trim() ? word.english : '暂无英文释义'}
                </AppText>
                <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: TEXT_SECONDARY }}>
                  {word.example?.trim() ? word.example : '暂无英文例句'}
                </AppText>
                {word.exampleZh?.trim() ? (
                  <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: TEXT_SECONDARY }}>{word.exampleZh}</AppText>
                ) : null}
              </View>
            </View>
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

export function WordsReviewScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const { isTablet } = useDeviceClass();
  const session = useAppSession();
  const params = useLocalSearchParams<{ mode?: string; bookSlug?: string; source?: string; resume?: string }>();
  const mode: ReviewMode = params.mode === 'review' ? 'review' : params.mode === 'mistake' ? 'mistake' : 'learn';
  const requestedBookSlug = typeof params.bookSlug === 'string' ? params.bookSlug : undefined;
  const reviewSource = normalizeReviewEntrySource(params.source);
  const shouldResumeQueue = parseResumeFlag(params.resume);
  const reviewRouteKey = useMemo(
    () => [mode, reviewSource, requestedBookSlug ?? 'all', shouldResumeQueue ? 'resume' : 'fresh'].join('::'),
    [mode, requestedBookSlug, reviewSource, shouldResumeQueue],
  );
  const queueCacheFile = useMemo(
    () =>
      buildReviewQueueCacheFile({
        userId: session.session?.user?.id,
        mode,
        bookSlug: requestedBookSlug,
        source: reviewSource,
      }),
    [mode, requestedBookSlug, reviewSource, session.session?.user?.id],
  );
  const ttsPlaybackRef = useRef<SpeakingTtsPlayback | null>(null);
  const ttsPreloadCacheRef = useRef(new Map<string, TtsPreloadEntry>());
  const ttsPlaybackRequestIdRef = useRef(0);
  const handledWordKeyRef = useRef<string | null>(null);
  const lastAutoPlayedWordKeyRef = useRef<string | null>(null);
  const previousRouteKeyRef = useRef<string | null>(null);
  const seenWordKeysRef = useRef(new Set<string>());
  const refillInFlightRef = useRef(false);

  const [queue, setQueue] = useState<ReviewQueueResponse | null>(null);
  const [queuePlanContext, setQueuePlanContext] = useState<ReviewQueuePlanContext>(() => ({ ...INITIAL_REVIEW_QUEUE_PLAN_CONTEXT }));
  const [queueStatus, setQueueStatus] = useState<QueueStatus>('loading');
  const [queueError, setQueueError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [drawerExpanded, setDrawerExpanded] = useState(false);
  const [sessionStats, setSessionStats] = useState<ReviewCounts>({ known: 0, unsure: 0, unknown: 0 });
  const [initialDeckSize, setInitialDeckSize] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [analysis, setAnalysis] = useState<VocabularyAnalyzeResponse | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisRetryKey, setAnalysisRetryKey] = useState(0);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const {
    player: pronunciationPlayer,
    playWordPronunciation,
    stopCurrentPronunciation,
    reset: resetPronunciation,
  } = useWordPronunciation();

  const isLoggedIn = session.status === 'authenticated';
  const activeWord = queue?.words[0] ?? null;
  const queueLoadingTitle = useMemo(() => buildQueueLoadingTitle(mode, reviewSource), [mode, reviewSource]);
  const activeWordPhonetic = useMemo(
    () => (activeWord ? getDisplayPhonetic(activeWord) : MISSING_PHONETIC_PLACEHOLDER),
    [activeWord],
  );
  const hasPhonetic = useMemo(() => (activeWord ? hasResolvedPhonetic(activeWord) : false), [activeWord]);

  useEffect(() => {
    handledWordKeyRef.current = null;
  }, [mode, requestedBookSlug, session.session?.user?.id]);

  useEffect(() => {
    const previousKey = previousRouteKeyRef.current;
    console.log('vocabulary_review_route_key_changed', {
      previousKey,
      nextKey: reviewRouteKey,
      mode,
      source: reviewSource,
      bookSlug: requestedBookSlug ?? null,
      resume: shouldResumeQueue,
    });
    previousRouteKeyRef.current = reviewRouteKey;
    handledWordKeyRef.current = null;
    lastAutoPlayedWordKeyRef.current = null;
    seenWordKeysRef.current = new Set();
    refillInFlightRef.current = false;
    ttsPlaybackRequestIdRef.current += 1;
    ttsPlaybackRef.current?.stop('review_route_key_changed');
    stopCurrentPronunciation('review_route_key_changed');
    resetPronunciation();
    setQueue(null);
    setQueuePlanContext({ ...INITIAL_REVIEW_QUEUE_PLAN_CONTEXT });
    setQueueStatus('loading');
    setQueueError(null);
    setSubmitError(null);
    setDrawerExpanded(false);
    setSessionStats({ known: 0, unsure: 0, unknown: 0 });
    setInitialDeckSize(0);
    setCompletedCount(0);
    setAnalysis(null);
    setAnalysisLoading(false);
    setAnalysisError(null);
    setAnalysisRetryKey(0);
    setIsAdvancing(false);
    console.log('vocabulary_review_state_reset', {
      routeKey: reviewRouteKey,
      mode,
      source: reviewSource,
      bookSlug: requestedBookSlug ?? null,
      resume: shouldResumeQueue,
    });
  }, [mode, requestedBookSlug, resetPronunciation, reviewRouteKey, reviewSource, shouldResumeQueue, stopCurrentPronunciation]);

  useEffect(() => {
    return () => {
      ttsPlaybackRequestIdRef.current += 1;
      ttsPlaybackRef.current?.stop('review_screen_unmount');
      ttsPlaybackRef.current?.remove();
      for (const entry of ttsPreloadCacheRef.current.values()) {
        if (entry.uri) {
          void FileSystem.deleteAsync(entry.uri, { idempotent: true }).catch(() => undefined);
        }
      }
      ttsPreloadCacheRef.current.clear();
    };
  }, []);

  useEffect(() => {
    handledWordKeyRef.current = null;
  }, [activeWord?.bookSlug, activeWord?.word, activeWord?.wordId]);

  useEffect(() => {
    if (queueStatus !== 'loading' || activeWord) {
      setIsAdvancing(false);
    }
  }, [activeWord, queueStatus]);

  const maybeRefillReviewQueue = useCallback(
    async (currentSession = session.session, retried = false) => {
      if (!currentSession || session.status !== 'authenticated') return;
      if (mode !== 'review' || reviewSource !== 'plan') return;
      if (refillInFlightRef.current) return;

      const currentQueue = queue;
      if (!currentQueue) return;

      const targetCount = Math.max(initialDeckSize, 0);
      const remainingTarget = Math.max(targetCount - completedCount - currentQueue.words.length, 0);
      const nextCursorRaw = currentQueue.window?.nextCursor;
      const nextCursor = nextCursorRaw ? Number(nextCursorRaw) : NaN;
      if (remainingTarget <= 0 || !Number.isFinite(nextCursor)) return;

      refillInFlightRef.current = true;
      try {
        const refillQueue = await fetchVocabularyReviewQueue(currentSession, {
          mode,
          source: reviewSource,
          bookSlug: requestedBookSlug,
          cursor: nextCursor,
          limit: remainingTarget,
        });

        setQueue((existing) => {
          if (!existing) return existing;

          const dedupedWords = refillQueue.words.filter((word) => {
            const key = buildReviewWordKey(word);
            if (seenWordKeysRef.current.has(key)) return false;
            return true;
          });
          registerReviewWordKeys(dedupedWords, seenWordKeysRef.current);

          const mergedWords = [...existing.words, ...dedupedWords];
          const totalAvailable = refillQueue.totalCount ?? existing.totalCount ?? mergedWords.length;
          const nextTargetCount = Math.min(Math.max(initialDeckSize, 0), totalAvailable);
          setInitialDeckSize(nextTargetCount);

          const mergedQueue: ReviewQueueResponse = {
            ...existing,
            words: mergedWords,
            totalCount: totalAvailable,
            dueCount: refillQueue.dueCount ?? existing.dueCount ?? totalAvailable,
            progress: {
              ...existing.progress,
              currentOffset: existing.progress?.currentOffset ?? 0,
              learnedCount: completedCount,
              loadedCount: mergedWords.length,
              remainingCount: Math.max(nextTargetCount - completedCount - mergedWords.length, 0),
            },
            window: {
              ...existing.window,
              limit: existing.window?.limit ?? existing.words.length,
              nextCursor: dedupedWords.length > 0 ? refillQueue.window?.nextCursor ?? null : null,
            },
          };

          console.log('vocabulary_review_queue_refill_appended', {
            mode,
            source: reviewSource,
            targetCount: nextTargetCount,
            completedCount,
            appendedCount: dedupedWords.length,
            queueLength: mergedWords.length,
            nextCursor: mergedQueue.window?.nextCursor ?? null,
          });
          setQueueStatus(mergedWords.length > 0 ? 'ready' : completedCount >= nextTargetCount ? 'completed' : 'loading');
          void writeCachedReviewQueue(queueCacheFile, mergedQueue);
          return mergedQueue;
        });
      } catch (error) {
        if (isVocabularyAuthError(error) && !retried) {
          const refreshedSession = await session.refreshSession();
          if (refreshedSession) {
            refillInFlightRef.current = false;
            await maybeRefillReviewQueue(refreshedSession, true);
            return;
          }
        }
        console.log('vocabulary_review_queue_refill_failed', {
          mode,
          source: reviewSource,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        refillInFlightRef.current = false;
      }
    },
    [
      completedCount,
      initialDeckSize,
      mode,
      queue,
      queueCacheFile,
      requestedBookSlug,
      reviewSource,
      session,
      session.session,
      session.status,
    ],
  );

  useEffect(() => {
    if (queueStatus !== 'ready' && queueStatus !== 'loading') return;
    if (mode !== 'review' || reviewSource !== 'plan') return;
    if (!queue) return;
    const remainingLoaded = queue.words.length;
    const remainingTarget = Math.max(initialDeckSize - completedCount, 0);
    if (remainingTarget <= remainingLoaded) return;
    if (remainingLoaded > 4) return;
    void maybeRefillReviewQueue();
  }, [completedCount, initialDeckSize, maybeRefillReviewQueue, mode, queue, queueStatus, reviewSource]);

  const loadQueue = useCallback(
    async (currentSession = session.session, retried = false) => {
      if (!currentSession || session.status !== 'authenticated') {
        setQueue(null);
        setQueueStatus('auth_required');
        setQueueError('登录状态已失效，请重新登录后继续复习。');
        return;
      }

      const loadStartedAt = Date.now();
      logWordsReviewPerf('load_queue_start', {
        mode,
        source: reviewSource,
        bookSlug: requestedBookSlug ?? null,
        resume: shouldResumeQueue,
      });
      setQueueError(null);
      setSubmitError(null);

      let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
      const cachedQueue = shouldResumeQueue ? await readCachedReviewQueue(queueCacheFile) : null;
      const loadedFromCache = Boolean(cachedQueue);
      if (cachedQueue) {
        logWordsReviewPerf('cache_hit', {
          mode,
          source: reviewSource,
          bookSlug: requestedBookSlug ?? null,
          queueSize: cachedQueue.words.length,
          elapsedMs: Date.now() - loadStartedAt,
        });
        logQueuePhoneticCoverage(cachedQueue, 'cache');
        setQueue(cachedQueue);
        setInitialDeckSize(deriveSessionTargetCount(cachedQueue));
        setCompletedCount(Math.max(cachedQueue.progress?.learnedCount ?? 0, 0));
        registerReviewWordKeys(cachedQueue.words, seenWordKeysRef.current);
        setQueueStatus(cachedQueue.words.length > 0 ? 'ready' : 'completed');
        logWordsReviewPerf('ready', {
          mode,
          source: reviewSource,
          bookSlug: requestedBookSlug ?? null,
          queueSize: cachedQueue.words.length,
          fromCache: true,
          elapsedMs: Date.now() - loadStartedAt,
        });
      } else {
        logWordsReviewPerf('cache_miss', {
          mode,
          source: reviewSource,
          bookSlug: requestedBookSlug ?? null,
          elapsedMs: Date.now() - loadStartedAt,
        });
        setQueue(null);
        setQueueStatus('loading');
        fallbackTimer = setTimeout(() => {
          setQueueStatus((current) => (current === 'loading' ? 'slow_loading' : current));
          setQueueError((current) => current ?? `${buildQueueLoadingTitle(mode, reviewSource)}，网络有点慢。`);
        }, REVIEW_QUEUE_FALLBACK_MS);
      }

      try {
        const requestQueueWithLogging = async (
          phase: 'optimistic' | 'final',
          params: {
            bookSlug?: string;
            limit: number;
          },
        ) => {
          const queueStartedAt = Date.now();
          logWordsReviewPerf('queue_start', {
            mode,
            source: reviewSource,
            bookSlug: params.bookSlug ?? null,
            phase,
            limit: params.limit,
            elapsedMs: queueStartedAt - loadStartedAt,
          });
          console.log('[WordsReview] queue_request_start', {
            routeKey: reviewRouteKey,
            mode,
            source: reviewSource,
            bookSlug: params.bookSlug ?? null,
            phase,
            limit: params.limit,
          });
          try {
            const result = await fetchVocabularyReviewQueue(currentSession, {
              mode,
              bookSlug: params.bookSlug,
              source: reviewSource,
              initial: true,
              limit: params.limit,
            });
            console.log('[WordsReview] queue_request_done', {
              routeKey: reviewRouteKey,
              mode,
              source: reviewSource,
              bookSlug: params.bookSlug ?? null,
              phase,
              wordCount: result.words.length,
              elapsedMs: Date.now() - queueStartedAt,
            });
            logWordsReviewPerf('queue_done', {
              mode,
              source: reviewSource,
              bookSlug: params.bookSlug ?? null,
              phase,
              queueSize: result.words.length,
              elapsedMs: Date.now() - queueStartedAt,
            });
            return result;
          } catch (error) {
            console.log('[WordsReview] queue_request_error', {
              routeKey: reviewRouteKey,
              mode,
              source: reviewSource,
              bookSlug: params.bookSlug ?? null,
              phase,
              errorName: error instanceof Error ? error.name : 'unknown',
              errorMessage: error instanceof Error ? error.message : String(error),
              elapsedMs: Date.now() - queueStartedAt,
            });
            logWordsReviewPerf('queue_done', {
              mode,
              source: reviewSource,
              bookSlug: params.bookSlug ?? null,
              phase,
              queueSize: 0,
              elapsedMs: Date.now() - queueStartedAt,
              errorMessage: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        };

        const planStartedAt = Date.now();
        logWordsReviewPerf('plan_start', {
          mode,
          source: reviewSource,
          bookSlug: requestedBookSlug ?? null,
          elapsedMs: planStartedAt - loadStartedAt,
        });
        console.log('[WordsReview] plan_fetch_start', {
          routeKey: reviewRouteKey,
          mode,
          source: reviewSource,
          bookSlug: requestedBookSlug ?? null,
        });
        const planPromise = fetchVocabularyTodayPlan(currentSession)
          .then((result) => {
            console.log('[WordsReview] plan_fetch_done', {
              routeKey: reviewRouteKey,
              hasPlan: Boolean(result),
              elapsedMs: Date.now() - planStartedAt,
            });
            logWordsReviewPerf('plan_done', {
              mode,
              source: reviewSource,
              bookSlug: requestedBookSlug ?? null,
              hasPlan: Boolean(result),
              elapsedMs: Date.now() - planStartedAt,
            });
            return result;
          })
          .catch((error) => {
            console.log('[WordsReview] plan_fetch_error', {
              routeKey: reviewRouteKey,
              errorName: error instanceof Error ? error.name : 'unknown',
              errorMessage: error instanceof Error ? error.message : String(error),
              elapsedMs: Date.now() - planStartedAt,
            });
            logWordsReviewPerf('plan_done', {
              mode,
              source: reviewSource,
              bookSlug: requestedBookSlug ?? null,
              hasPlan: false,
              elapsedMs: Date.now() - planStartedAt,
              errorMessage: error instanceof Error ? error.message : String(error),
            });
            return null;
          });

        const optimisticQueueRequest = buildOptimisticQueueRequest({
          mode,
          source: reviewSource,
          requestedBookSlug,
        });
        const optimisticQueuePromise = optimisticQueueRequest
          ? requestQueueWithLogging('optimistic', {
              bookSlug: optimisticQueueRequest.bookSlug,
              limit: optimisticQueueRequest.rawLimit,
            })
          : null;

        const todayPlan = await planPromise;
        const {
          effectiveBookSlug,
          effectiveBookTitle,
          remainingNewCount,
          remainingReviewCount,
          remainingMistakeCount,
          dueNowCount,
          mistakeCount,
          dailyNewTarget,
          dailyReviewTarget,
          todayMistakePlanned,
          todayReviewPlanned,
          todayReviewCompleted,
          extraDueReviewAvailable,
          focusBookRemainingWords,
        } = deriveQueuePlanState({
          todayPlan,
          mode,
          requestedBookSlug,
        });

        setQueuePlanContext({
          remainingNew: remainingNewCount,
          dueNowCount,
          todayReviewPlanned,
          todayReviewCompleted,
          remainingReview: remainingReviewCount,
          extraDueReviewAvailable,
          mistakeCount,
        });
        const isPlannedEntry = reviewSource === 'plan';
        const isExtraEntry = reviewSource === 'extra';
        const extraLearnBatchSize = Math.max(10, Math.min(dailyNewTarget || 10, 20));
        const extraReviewBatchSize = Math.max(10, Math.min(dailyReviewTarget || 20, 20));
        const queueLimit =
          mode === 'learn'
            ? isPlannedEntry
              ? remainingNewCount
              : focusBookRemainingWords > 0
                ? Math.min(focusBookRemainingWords, extraLearnBatchSize)
                : 0
            : mode === 'review'
              ? isPlannedEntry
                ? remainingReviewCount
                : isExtraEntry
                  ? Math.max(Math.min(extraDueReviewAvailable || dueNowCount, extraReviewBatchSize), 0)
                  : Math.max(Math.min(dueNowCount, extraReviewBatchSize), 1)
              : isPlannedEntry
                ? Math.max(remainingMistakeCount, Math.min(mistakeCount, todayMistakePlanned || mistakeCount))
                : Math.max(todayMistakePlanned || todayPlan?.plan.dailyMistakeTarget || 20, 1);
        const reviewSplitOffset = mode === 'review' && isExtraEntry ? remainingReviewCount : 0;
        const rawQueueLimit =
          mode === 'review' && isExtraEntry
            ? Math.max(queueLimit + reviewSplitOffset, 0)
            : queueLimit;

        console.log('vocabulary_review_queue_request', {
          mode,
          source: reviewSource,
          bookSlug: effectiveBookSlug ?? requestedBookSlug ?? null,
          limit: queueLimit,
          rawLimit: rawQueueLimit,
          remainingNew: remainingNewCount,
          remainingReview: remainingReviewCount,
          dueNowCount,
          extraDueReviewAvailable,
          mistakeCount,
        });

        if ((isPlannedEntry || isExtraEntry) && queueLimit <= 0) {
          if (optimisticQueuePromise) {
            void optimisticQueuePromise.catch(() => undefined);
          }
          const completedQueue = buildCompletedQueue(mode, effectiveBookSlug, effectiveBookTitle);
          setQueue(completedQueue);
          setInitialDeckSize(0);
          setCompletedCount(0);
          setQueueStatus('completed');
          void writeCachedReviewQueue(queueCacheFile, completedQueue);
          logWordsReviewPerf('ready', {
            mode,
            source: reviewSource,
            bookSlug: effectiveBookSlug ?? null,
            queueSize: 0,
            fromCache: false,
            elapsedMs: Date.now() - loadStartedAt,
          });
          console.log('vocabulary_review_queue_result', {
            mode,
            source: reviewSource,
            returnedCount: 0,
            initialDeckSize: 0,
            firstWord: null,
            cacheUsed: loadedFromCache,
          });
          return;
        }

        const canReuseOptimisticQueue =
          Boolean(optimisticQueuePromise) &&
          Boolean(optimisticQueueRequest) &&
          (optimisticQueueRequest?.bookSlug ?? null) === (effectiveBookSlug ?? null) &&
          rawQueueLimit <= (optimisticQueueRequest?.rawLimit ?? 0);

        if (optimisticQueuePromise && !canReuseOptimisticQueue) {
          void optimisticQueuePromise.catch(() => undefined);
        }

        const nextQueue = canReuseOptimisticQueue && optimisticQueuePromise
          ? await optimisticQueuePromise
          : await requestQueueWithLogging('final', {
              bookSlug: effectiveBookSlug,
              limit: rawQueueLimit,
            });
        const preparedQueue = loadedFromCache ? nextQueue : normalizeFreshReviewQueue(nextQueue);
        const splitQueueResult = sliceReviewQueueForEntry(preparedQueue, {
          mode,
          source: reviewSource,
          finalLimit: queueLimit,
          remainingReview: remainingReviewCount,
          dueNowCount,
          extraDueReviewAvailable,
        });
        const finalQueue = splitQueueResult.queue;

        logQueuePhoneticCoverage(finalQueue, 'remote');
        void writeCachedReviewQueue(queueCacheFile, finalQueue);
        console.log('vocabulary_review_queue_result', {
          mode,
          source: reviewSource,
          returnedCount: finalQueue.words.length,
          initialDeckSize: splitQueueResult.targetCount,
          firstWord: finalQueue.words[0]?.word ?? null,
          cacheUsed: loadedFromCache,
        });
        if (mode === 'mistake') {
          console.log('vocabulary_review_mistake_queue_loaded', {
            routeKey: reviewRouteKey,
            source: reviewSource,
            returnedCount: finalQueue.words.length,
            firstWord: finalQueue.words[0]?.word ?? null,
          });
        }

        if (loadedFromCache) {
          registerReviewWordKeys(finalQueue.words, seenWordKeysRef.current);
          setInitialDeckSize(Math.max(splitQueueResult.targetCount, deriveSessionTargetCount(finalQueue)));
          setCompletedCount(Math.max(finalQueue.progress?.learnedCount ?? 0, 0));
          setQueueStatus(finalQueue.words.length > 0 ? 'ready' : 'completed');
          setQueue((current) => {
            if (!current) return finalQueue;
            const currentFirstWord = current.words[0]?.word ?? null;
            const finalFirstWord = finalQueue.words[0]?.word ?? null;
            if (current.words.length !== finalQueue.words.length || currentFirstWord !== finalFirstWord) {
              void writeCachedReviewQueue(queueCacheFile, finalQueue);
              return finalQueue;
            }
            const merged = mergeReviewQueueWordFields(current, finalQueue);
            if (merged !== current) {
              logQueuePhoneticCoverage(merged, 'remote');
              void writeCachedReviewQueue(queueCacheFile, merged);
            }
            return merged;
          });
          logWordsReviewPerf('ready', {
            mode,
            source: reviewSource,
            bookSlug: effectiveBookSlug ?? null,
            queueSize: finalQueue.words.length,
            fromCache: true,
            elapsedMs: Date.now() - loadStartedAt,
          });
          return;
        }

        setQueue(finalQueue);
        registerReviewWordKeys(finalQueue.words, seenWordKeysRef.current);
        setInitialDeckSize(Math.max(splitQueueResult.targetCount, deriveSessionTargetCount(finalQueue)));
        setCompletedCount(Math.max(finalQueue.progress?.learnedCount ?? 0, 0));
        setQueueStatus(finalQueue.words.length > 0 ? 'ready' : 'completed');
        logWordsReviewPerf('ready', {
          mode,
          source: reviewSource,
          bookSlug: effectiveBookSlug ?? null,
          queueSize: finalQueue.words.length,
          fromCache: false,
          elapsedMs: Date.now() - loadStartedAt,
        });
      } catch (err) {
        if (isVocabularyAuthError(err) && !retried) {
          const refreshedSession = await session.refreshSession();
          if (refreshedSession) {
            if (fallbackTimer) clearTimeout(fallbackTimer);
            await loadQueue(refreshedSession, true);
            return;
          }
          setQueue(null);
          setQueueStatus('auth_required');
          setQueueError('登录状态已失效，请重新登录后继续复习。');
          return;
        }

        if (loadedFromCache) {
          console.log('vocabulary_review_queue_refresh_failed', err);
          return;
        }

        setQueue(null);
        setQueueStatus(isVocabularyAuthError(err) ? 'auth_required' : 'load_error');
        setQueueError(toReviewUserMessage('queue', err));
      } finally {
        if (fallbackTimer) clearTimeout(fallbackTimer);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, queueCacheFile, requestedBookSlug, reviewRouteKey, reviewSource, session.session, session.status, shouldResumeQueue],
  );

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    setAnalysis(null);
    setAnalysisError(null);
    setAnalysisLoading(false);
    setDrawerExpanded(false);
    ttsPlaybackRef.current?.stop('word_changed');
    resetPronunciation();
    if (activeWord) {
      const nextIndex = completedCount + 1;
      const playbackKey = activeWord.wordId
        ? `${activeWord.wordId}:${nextIndex}`
        : `${activeWord.bookSlug ?? 'all'}:${activeWord.word}:${nextIndex}`;
      logWordsReviewAudio('word_changed', {
        word: activeWord.word,
        wordId: activeWord.wordId ?? null,
        index: nextIndex,
        playbackKey,
        hasPronunciationAudio: Boolean(activeWord.pronunciation?.staticUrl || getWordAudioUrl(activeWord)),
        hasPhonetic,
        source: 'word_change',
      });
      logSafePhoneticFields(activeWord);
    }
  }, [activeWord, completedCount, hasPhonetic, resetPronunciation]);

  useEffect(() => {
    if (!(typeof __DEV__ === 'boolean' && __DEV__)) return;
    if (!activeWord || hasPhonetic) return;
    console.log('vocabulary_missing_phonetic_dev', {
      word: activeWord.word,
      bookSlug: activeWord.bookSlug ?? queue?.book.slug ?? null,
    });
  }, [activeWord, hasPhonetic, queue?.book.slug]);

  useEffect(() => {
    let cancelled = false;

    async function loadAnalysis(word: ReviewDeckWord, currentSession = session.session, retried = false) {
      if (!currentSession) return;
      if (!word.english && !word.example) return;

      setAnalysisLoading(true);
      setAnalysisError(null);
      try {
        const next = await fetchVocabularyWordAnalysis(currentSession, {
          word: word.word,
          chinese: word.chinese,
          english: word.english ?? '',
          example: word.example ?? '',
          bookSlug: word.bookSlug,
          pattern: word.pattern,
          learningState: 'pending',
          mockStats: {
            known: sessionStats.known,
            unsure: sessionStats.unsure,
            unknown: sessionStats.unknown,
            answeredTotal: sessionStats.known + sessionStats.unsure + sessionStats.unknown,
            currentBook: word.bookTitle ?? queue?.book.title ?? '当前词书',
            reviewCount: word.reviewCount ?? 0,
            mistakeCount: word.mistakeCount ?? 0,
          },
        });
        if (!cancelled) setAnalysis(next);
      } catch (err) {
        if (!cancelled) {
          if (isVocabularyAuthError(err) && !retried) {
            const refreshedSession = await session.refreshSession();
            if (cancelled) return;
            if (refreshedSession) {
              await loadAnalysis(word, refreshedSession, true);
              return;
            }
          }
          setAnalysis(null);
          setAnalysisError(toReviewUserMessage('analysis', err));
        }
      } finally {
        if (!cancelled) setAnalysisLoading(false);
      }
    }

    if (activeWord) {
      void loadAnalysis(activeWord);
    }

    return () => {
      cancelled = true;
    };
  }, [activeWord, analysisRetryKey, queue?.book.title, session, session.session, sessionStats.known, sessionStats.unknown, sessionStats.unsure]);

  const reviewedCount = useMemo(() => Math.max(completedCount, 0), [completedCount]);
  const totalCount = useMemo(() => {
    const targetCount = Math.max(initialDeckSize, 0);
    if (targetCount > 0) return targetCount;
    return queue?.totalCount ?? queue?.words.length ?? 0;
  }, [initialDeckSize, queue?.totalCount, queue?.words.length]);
  const currentStep = activeWord ? Math.min(reviewedCount + 1, Math.max(totalCount, 1)) : totalCount;
  const progressPercent = totalCount > 0 ? Math.min(100, Math.round((reviewedCount / totalCount) * 100)) : 0;

  const baseAnalysis: DisplayAnalysis | null = activeWord
    ? {
        contextualMeaning: activeWord.aiAnalysis.contextualMeaning,
        confusableWords: activeWord.aiAnalysis.confusableWords,
        collocations: activeWord.aiAnalysis.collocations,
        memoryTip: activeWord.aiAnalysis.memoryAdvice,
        speakingPhrase: activeWord.aiAnalysis.speakingExpression,
        errorReasonSummary: activeWord.aiAnalysis.errorReason,
        predictedRetention: activeWord.aiAnalysis.predictedRetention ?? '',
        bestReviewWindow: activeWord.aiAnalysis.bestReviewWindow ?? '',
        tier: 'quick',
      }
    : null;

  const displayAnalysis: DisplayAnalysis | null = analysis
    ? {
        contextualMeaning: analysis.contextualMeaning,
        confusableWords: analysis.confusableWords,
        collocations: analysis.collocations,
        memoryTip: analysis.memoryTip,
        speakingPhrase: analysis.speakingPhrase,
        errorReasonSummary: analysis.errorReasonSummary,
        predictedRetention: analysis.predictedRetention,
        bestReviewWindow: analysis.bestReviewWindow,
        tier: 'deep',
      }
    : baseAnalysis;

  const getTtsPlayback = useCallback(() => {
    if (!ttsPlaybackRef.current) {
      ttsPlaybackRef.current = new SpeakingTtsPlayback();
    }
    return ttsPlaybackRef.current;
  }, []);

  const pruneTtsPreloadCache = useCallback(() => {
    const entries = Array.from(ttsPreloadCacheRef.current.entries());
    if (entries.length <= TTS_PRELOAD_CACHE_LIMIT) return;
    entries
      .sort((a, b) => a[1].createdAt - b[1].createdAt)
      .slice(0, entries.length - TTS_PRELOAD_CACHE_LIMIT)
      .forEach(([key, entry]) => {
        ttsPreloadCacheRef.current.delete(key);
        if (entry.uri) {
          void FileSystem.deleteAsync(entry.uri, { idempotent: true }).catch(() => undefined);
        }
      });
  }, []);

  const preloadPronunciation = useCallback(
    (word: ReviewDeckWord | null | undefined) => {
      const currentSession = session.session;
      const rawWord = word?.word?.trim();
      if (!currentSession || !rawWord) return;

      const cacheKey = buildTtsPreloadKey(rawWord);
      const existing = ttsPreloadCacheRef.current.get(cacheKey);
      if (existing?.uri || existing?.promise) return;

      console.log('vocabulary_pronunciation_preload_start', {
        word: rawWord,
        source: 'tts_fast',
      });

      const playback = getTtsPlayback();
      const promise = playback
        .synthesize(currentSession, rawWord)
        .then((uri) => {
          ttsPreloadCacheRef.current.set(cacheKey, {
            uri,
            createdAt: Date.now(),
          });
          pruneTtsPreloadCache();
          console.log('vocabulary_pronunciation_preload_done', {
            word: rawWord,
            source: 'tts_fast',
          });
          return uri;
        })
        .catch((error) => {
          ttsPreloadCacheRef.current.set(cacheKey, {
            createdAt: Date.now(),
            failedAt: Date.now(),
          });
          console.warn('vocabulary_pronunciation_preload_failed', {
            word: rawWord,
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        });

      ttsPreloadCacheRef.current.set(cacheKey, {
        promise,
        createdAt: Date.now(),
      });
      void promise.catch(() => undefined);
    },
    [getTtsPlayback, pruneTtsPreloadCache, session.session],
  );

  const playFallbackTts = useCallback(
    async (word: string, context?: { requestSource: 'auto' | 'manual' }) => {
      const currentSession = session.session;
      if (!currentSession) throw new Error('vocabulary_tts_session_missing');

      const requestId = ttsPlaybackRequestIdRef.current + 1;
      ttsPlaybackRequestIdRef.current = requestId;
      const playback = getTtsPlayback();
      const cacheKey = buildTtsPreloadKey(word);
      const cached = ttsPreloadCacheRef.current.get(cacheKey);
      let source: 'preload_cache' | 'tts_fast' = 'tts_fast';
      let uri: string;

      if (cached?.uri) {
        source = 'preload_cache';
        uri = cached.uri;
      } else if (cached?.promise) {
        source = 'preload_cache';
        uri = await cached.promise;
      } else {
        uri = await playback.synthesize(currentSession, word);
        ttsPreloadCacheRef.current.set(cacheKey, {
          uri,
          createdAt: Date.now(),
        });
        pruneTtsPreloadCache();
      }

      if (requestId !== ttsPlaybackRequestIdRef.current) {
        throw new Error('vocabulary_tts_cancelled_by_newer_request');
      }

      if (context?.requestSource === 'auto') {
        console.log('vocabulary_auto_pronounce_source_selected', {
          word,
          source,
        });
      }

      playback.stop('tts_replaced');
      const result = await playback.playUri(uri, word, undefined, {
        cleanupFileAfterPlay: false,
      });
      if (result !== 'played') {
        throw new Error(`vocabulary_tts_playback_${result}`);
      }
    },
    [getTtsPlayback, pruneTtsPreloadCache, session.session],
  );

  const nextWord = queue?.words[1] ?? null;

  useEffect(() => {
    if (queueStatus !== 'ready') return;
    preloadPronunciation(activeWord);
    preloadPronunciation(nextWord);
  }, [activeWord, nextWord, preloadPronunciation, queueStatus]);

  const activeAutoPronounceKey = activeWord
    ? activeWord.wordId
      ? `${activeWord.wordId}:${currentStep}`
      : `${activeWord.bookSlug ?? 'all'}:${activeWord.word}:${currentStep}`
    : null;

  useEffect(() => {
    if (queueStatus !== 'ready' || !activeWord || !activeAutoPronounceKey) return;
    if (lastAutoPlayedWordKeyRef.current === activeAutoPronounceKey) {
      logWordsReviewAudio('skipped_reason', {
        word: activeWord.word,
        wordId: activeWord.wordId ?? null,
        index: currentStep,
        playbackKey: activeAutoPronounceKey,
        hasPronunciationAudio: Boolean(activeWord.pronunciation?.staticUrl || getWordAudioUrl(activeWord)),
        hasPhonetic,
        source: 'autoplay',
        reason: 'already_played',
      });
      console.log('vocabulary_auto_pronounce_skipped', {
        word: activeWord.word,
        key: activeAutoPronounceKey,
        reason: 'already_played',
      });
      return;
    }

    lastAutoPlayedWordKeyRef.current = activeAutoPronounceKey;
    logWordsReviewAudio('autoplay_start', {
      word: activeWord.word,
      wordId: activeWord.wordId ?? null,
      index: currentStep,
      playbackKey: activeAutoPronounceKey,
      hasPronunciationAudio: Boolean(activeWord.pronunciation?.staticUrl || getWordAudioUrl(activeWord)),
      hasPhonetic,
      source: 'autoplay',
    });
    console.log('vocabulary_auto_pronounce_start', {
      word: activeWord.word,
      key: activeAutoPronounceKey,
    });
    ttsPlaybackRef.current?.stop('auto_word_changed');

    void playWordPronunciation({
      wordId: activeWord.wordId,
      word: activeWord.word,
      staticUrl: activeWord.pronunciation?.staticUrl,
      audioUrl: getWordAudioUrl(activeWord),
      accent: activeWord.pronunciation?.accent ?? 'us',
      playbackKey: activeAutoPronounceKey,
      index: currentStep,
      hasPhonetic,
      hasPronunciationAudio: Boolean(activeWord.pronunciation?.staticUrl || getWordAudioUrl(activeWord)),
      fallbackTts: playFallbackTts,
      requestSource: 'auto',
    })
      .then((played) => {
        if (played) {
          console.log('vocabulary_auto_pronounce_done', {
            word: activeWord.word,
            key: activeAutoPronounceKey,
          });
        }
      })
      .catch((error) => {
        console.log('vocabulary_auto_pronounce_failed', {
          word: activeWord.word,
          key: activeAutoPronounceKey,
          message: error instanceof Error ? error.message : String(error),
        });
      });
  }, [activeAutoPronounceKey, activeWord, currentStep, hasPhonetic, playFallbackTts, playWordPronunciation, queueStatus]);

  async function submitReviewInBackground(
    word: ReviewDeckWord,
    result: ReviewResult,
    currentSession = session.session,
    retried = false,
  ) {
    if (!currentSession) return;

    try {
      await submitVocabularyReviewResult(currentSession, {
        word: word.word,
        phonetic: hasResolvedPhonetic(word) ? getDisplayPhonetic(word) : word.phonetic,
        meaning: word.chinese,
        english: word.english ?? '',
        example: word.example ?? '',
        exampleZh: word.exampleZh ?? '',
        book: word.bookTitle,
        bookSlug: word.bookSlug,
        result,
      });
    } catch (err) {
      if (isVocabularyAuthError(err) && !retried) {
        const refreshedSession = await session.refreshSession();
        if (refreshedSession) {
          await submitReviewInBackground(word, result, refreshedSession, true);
          return;
        }
      }
      console.log('vocabulary_review_submit_failed', err);
    }
  }

  function handleReview(result: ReviewResult) {
    if (!activeWord || queueStatus !== 'ready' || isAdvancing) return;

    const reviewedWord = activeWord;
    const reviewedWordKey = buildReviewWordKey(reviewedWord);
    if (handledWordKeyRef.current === reviewedWordKey) return;
    handledWordKeyRef.current = reviewedWordKey;
    setIsAdvancing(true);
    ttsPlaybackRequestIdRef.current += 1;
    ttsPlaybackRef.current?.stop('review_button_next_word');
    stopCurrentPronunciation('review_button_next_word');
    setSubmitError(null);
    setSessionStats((current) => ({ ...current, [result]: current[result] + 1 }));
    setCompletedCount((current) => current + 1);
    preloadPronunciation(queue?.words[1]);
    setQueue((current) => {
      if (!current) return current;
      const nextWords = current.words.slice(1);
      const nextQueue = {
        ...current,
        dueCount: Math.max((current.dueCount ?? current.words.length) - 1, 0),
        words: nextWords,
        progress: {
          ...current.progress,
          learnedCount: (current.progress?.learnedCount ?? completedCount) + 1,
          loadedCount: nextWords.length,
          remainingCount: Math.max(initialDeckSize - ((current.progress?.learnedCount ?? completedCount) + 1) - nextWords.length, 0),
        },
      };
      const willRemainPlanned = Math.max(initialDeckSize - ((current.progress?.learnedCount ?? completedCount) + 1), 0);
      setQueueStatus(nextWords.length > 0 ? 'ready' : willRemainPlanned > 0 ? 'loading' : 'completed');
      void writeCachedReviewQueue(queueCacheFile, nextQueue);
      return nextQueue;
    });

    void submitReviewInBackground(reviewedWord, result);
  }

  function handleModeChange(nextMode: ReviewMode) {
    if (nextMode === mode) return;
    const nextParams: Record<string, string> = { mode: nextMode, source: reviewSource, resume: 'true' };
    if (requestedBookSlug) nextParams.bookSlug = requestedBookSlug;
    if (nextMode === 'learn') {
      router.replace({ pathname: '/words/review', params: nextParams });
      return;
    }
    if (nextMode === 'review') {
      router.replace({ pathname: '/words/review', params: nextParams });
      return;
    }
    router.replace({ pathname: '/words/review', params: nextParams });
  }

  function handlePronounce() {
    if (!activeWord) return;
    ttsPlaybackRef.current?.stop('manual_pronounce');
    void playWordPronunciation({
      wordId: activeWord.wordId,
      word: activeWord.word,
      staticUrl: activeWord.pronunciation?.staticUrl,
      audioUrl: getWordAudioUrl(activeWord),
      accent: activeWord.pronunciation?.accent ?? 'us',
      playbackKey: activeAutoPronounceKey ?? `manual:${activeWord.wordId ?? activeWord.word}`,
      index: currentStep,
      hasPhonetic,
      hasPronunciationAudio: Boolean(activeWord.pronunciation?.staticUrl || getWordAudioUrl(activeWord)),
      fallbackTts: playFallbackTts,
      requestSource: 'manual',
    });
  }

  if (isTablet) {
    return (
      <WordsReviewScreenTablet
        isLoggedIn={isLoggedIn}
        queueStatus={isLoggedIn ? queueStatus : 'auth_required'}
        queueLoadingTitle={queueLoadingTitle}
        queueError={queueError}
        mode={mode}
        reviewSource={reviewSource}
        activeWord={activeWord}
        activeWordPhonetic={activeWordPhonetic}
        hasPhonetic={hasPhonetic}
        currentStep={currentStep}
        totalCount={totalCount}
        progressPercent={progressPercent}
        displayAnalysis={displayAnalysis}
        analysisLoading={analysisLoading}
        analysisError={analysisError}
        sessionStats={sessionStats}
        reviewedCount={reviewedCount}
        extraDueReviewAvailable={queuePlanContext.extraDueReviewAvailable}
        submitError={submitError}
        pronunciationPlayer={pronunciationPlayer}
        isReviewSubmitting={isAdvancing}
        onBack={() => safeBack()}
        onGoSignIn={() => router.push('/auth/sign-in')}
        onRetryQueue={() => void loadQueue()}
        onBackToPlan={() => router.replace('/words/today')}
        onBackToWords={() => router.replace('/(tabs)/words')}
        onPronounce={handlePronounce}
        onRetryAnalysis={() => setAnalysisRetryKey((current) => current + 1)}
        onModeChange={handleModeChange}
        onReview={handleReview}
      />
    );
  }

  if (!isLoggedIn) {
    return (
      <AppScreenShell
        backgroundColor={BG_PAGE}
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        includeBottomInset={false}
      >
        <View style={{ paddingHorizontal: PAGE_PADDING, paddingTop: 16 }}>
          <Pressable onPress={() => safeBack()} style={{ width: 36, height: 36, justifyContent: 'center' }}>
            <Ionicons name="chevron-back" size={22} color={TEXT_PRIMARY} />
          </Pressable>
        </View>
        <SurfaceCard style={{ marginHorizontal: PAGE_PADDING, marginBottom: 0, marginTop: 12, backgroundColor: BG_HERO, padding: 20 }}>
          <View style={{ gap: 16 }}>
            <AppText style={{ fontSize: 24, fontWeight: '700', color: TEXT_ON_DARK }}>开始学习需要登录</AppText>
            <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: 'rgba(255,255,255,0.72)' }}>
              登录后即可继续当前学习，并同步你的训练进度、复习结果和分析记录。
            </AppText>
            <ActionButton label="去登录" variant="primary" onPress={() => router.push('/auth/sign-in')} />
          </View>
        </SurfaceCard>
      </AppScreenShell>
    );
  }

  if (queueStatus === 'loading') {
    return (
      <AppScreenShell scrollable={false} backgroundColor={BG_PAGE} includeBottomInset={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <ActivityIndicator color={TEXT_SECONDARY} />
          <AppText style={{ fontSize: FONT_CALLOUT, color: TEXT_SECONDARY }}>{queueLoadingTitle}</AppText>
        </View>
      </AppScreenShell>
    );
  }

  return (
    <AppScreenShell scrollable={false} backgroundColor={BG_PAGE} includeBottomInset={false}>
      <View style={{ flex: 1 }}>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 84,
            left: -120,
            width: 520,
            height: 300,
            borderRadius: 999,
            backgroundColor: 'rgba(90,200,250,0.038)',
            transform: [{ rotate: '-10deg' }],
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 248,
            right: -160,
            width: 420,
            height: 260,
            borderRadius: 999,
            backgroundColor: 'rgba(245,166,35,0.042)',
            transform: [{ rotate: '14deg' }],
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 158,
            alignSelf: 'center',
            width: 360,
            height: 220,
            borderRadius: 999,
            backgroundColor: 'rgba(52,199,89,0.028)',
          }}
        />

        <LightTopBar currentStep={currentStep} totalCount={totalCount} progressPercent={progressPercent} onBack={() => safeBack()} />

        <View
          style={{
            flex: 1,
            paddingHorizontal: PAGE_PADDING,
            paddingTop: 16,
            paddingBottom: 220,
            justifyContent: queueStatus === 'ready' && activeWord && displayAnalysis ? 'center' : 'flex-start',
          }}
        >
          {queueStatus === 'ready' && activeWord && displayAnalysis ? (
            <View style={{ alignItems: 'center', gap: 14 }}>
              <View style={{ alignItems: 'center', gap: 12 }}>
                <AppText
                  style={{
                    fontSize: 46,
                    fontWeight: '700',
                    letterSpacing: -1.3,
                    lineHeight: 52,
                    color: TEXT_PRIMARY,
                    textAlign: 'center',
                  }}
                >
                  {activeWord.word}
                </AppText>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <AppText
                    style={{
                      minHeight: 24,
                      lineHeight: 24,
                      fontSize: 18,
                      color: hasPhonetic ? TEXT_SECONDARY : TEXT_TERTIARY,
                    }}
                  >
                    {activeWordPhonetic}
                  </AppText>
                  <Pressable
                    onPress={handlePronounce}
                    style={({ pressed }) => ({
                      width: 34,
                      height: 34,
                      borderRadius: 17,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: pressed
                        ? theme.colorScheme === 'dark'
                          ? 'rgba(10,132,255,0.18)'
                          : 'rgba(255,255,255,0.58)'
                        : theme.secondaryCardBackground,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Ionicons
                      name="volume-medium-outline"
                      size={18}
                      color={theme.colorScheme === 'dark' ? theme.textSecondary : TEXT_PRIMARY}
                    />
                  </Pressable>
                </View>
                <StageHint text="先回想释义，再做判断。" />
              </View>
            </View>
          ) : queueStatus === 'completed' ? (
            <EmptyState
              mode={mode}
              source={reviewSource}
              counts={sessionStats}
              reviewedCount={reviewedCount}
              extraDueReviewAvailable={queuePlanContext.extraDueReviewAvailable}
            />
          ) : queueStatus === 'slow_loading' ? (
            <SlowQueueCard
              title={queueLoadingTitle}
              onRetry={() => void loadQueue()}
              onBackToPlan={() => router.replace('/words/today')}
            />
          ) : queueStatus === 'auth_required' ? (
            <ReviewStateCard
              tone="auth"
              title="登录后继续复习"
              message={queueError ?? '当前登录状态不可用，请重新登录后再继续复习。'}
              primaryLabel="去登录"
              onPrimary={() => router.push('/auth/sign-in')}
              secondaryLabel="返回上一页"
              onSecondary={() => safeBack()}
            />
          ) : (
            <ReviewStateCard
              tone="error"
              title="暂时无法加载复习内容"
              message={queueError ?? '复习队列还没有成功返回，请稍后再试。'}
              primaryLabel="重试"
              onPrimary={() => void loadQueue()}
              secondaryLabel="回看今日计划"
              onSecondary={() => router.replace('/words/today')}
            />
          )}
        </View>

        {queueStatus === 'ready' && activeWord && displayAnalysis ? (
          <AnalysisDrawer
            expanded={drawerExpanded}
            onToggle={() => setDrawerExpanded((current) => !current)}
            mode={mode}
            onModeChange={handleModeChange}
            word={activeWord}
            analysis={displayAnalysis}
            loading={analysisLoading}
            error={analysisError}
            onRetry={() => setAnalysisRetryKey((current) => current + 1)}
          />
        ) : null}

        {queueStatus === 'ready' && activeWord ? (
          <View
            style={{
              position: 'absolute',
              left: 12,
              right: 12,
              bottom: 0,
              paddingTop: 12,
              paddingHorizontal: 12,
              paddingBottom: Math.max(insets.bottom, 12),
              borderTopLeftRadius: 26,
              borderTopRightRadius: 26,
              backgroundColor: theme.colorScheme === 'dark' ? 'rgba(28,28,30,0.94)' : 'rgba(242,242,247,0.96)',
              borderTopWidth: 0.5,
              borderLeftWidth: 0.5,
              borderRightWidth: 0.5,
              borderColor: theme.border,
            }}
          >
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <AnswerButton disabled={isAdvancing} label="不会" tone="unknown" onPress={() => void handleReview('unknown')} />
              <AnswerButton disabled={isAdvancing} label="模糊" tone="unsure" onPress={() => void handleReview('unsure')} />
              <AnswerButton disabled={isAdvancing} label="认识" tone="known" onPress={() => void handleReview('known')} />
            </View>
            {submitError ? <AppText style={{ marginTop: 10, fontSize: FONT_CAPTION, color: COLOR_RED }}>{submitError}</AppText> : null}
          </View>
        ) : null}

        <VideoView player={pronunciationPlayer} nativeControls={false} contentFit="contain" style={{ width: 0, height: 0 }} />
      </View>
    </AppScreenShell>
  );
}
