import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, type Href } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { TopRightAvatarButton } from '@/components/ui/TopRightAvatarButton';
import { useDeviceClass } from '@/hooks/useDeviceClass';
import { useEntitlementGuard } from '@/hooks/useEntitlementGuard';
import { useMobileMe } from '@/hooks/useMobileMe';
import { useVocabularyDashboardData } from '@/hooks/useVocabularyDashboardData';
import { useVocabularyNotebookData } from '@/hooks/useVocabularyNotebookData';
import { useVocabularyTodayPlanData } from '@/hooks/useVocabularyTodayPlanData';
import {
  fetchVocabularyDashboardInsights,
  readCachedVocabularyDashboardInsights,
  isVocabularyAuthError,
  writeCachedVocabularyDashboardInsights,
  type VocabularyDashboardInsights,
} from '@/services/api/vocabulary';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import {
  resolveVocabularyTodayActionRoute,
  type VocabularyTodayActionType,
  type VocabularyTodayResolvedRoute,
} from '@/services/vocabularyTodayActions';
import {
  ACCENT,
  BG_CARD,
  BG_CARD_SOFT,
  BG_PAGE,
  BORDER_SOFT,
  COLOR_AMBER_BG,
  COLOR_GREEN,
  COLOR_GREEN_BG,
  FONT_BODY,
  FONT_CALLOUT,
  FONT_CAPTION,
  FONT_MICRO,
  FONT_TITLE,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
} from '@/theme/tokens';
import { useAppTheme } from '@/theme/AppThemeProvider';
import { useThemeColors } from '@/theme/useThemeColors';
import { WordsScreenTablet } from '@/screens/WordsScreenTablet';

const PAGE_PADDING = 20;
const SECTION_GAP = 26;
const CARD_RADIUS = 28;
const HERO_RADIUS = 28;

const HERO_BG = '#0C1223';
const HERO_TEXT_PRIMARY = 'rgba(255,255,255,0.98)';
const HERO_TEXT_SECONDARY = 'rgba(255,255,255,0.76)';
const HERO_TEXT_TERTIARY = 'rgba(255,255,255,0.54)';

const DOT_PURPLE = '#8C7CFF';
const DOT_BLUE = '#57A4FF';
const DOT_GREEN = '#42C48F';
const DOT_VIOLET = '#7D67FF';

const LIGHT_PURPLE = '#7C6CFF';
const ACTION_BLUE = '#5F89D9';
const INSIGHT_BLUE = '#5E86C7';
const MUTED_BLUE = '#5D8ED6';
const MUTED_ORANGE = '#D49548';
const MUTED_GREEN = '#4FA576';
const MUTED_VIOLET = '#7A69D6';
const SECTION_SUBTITLE = TEXT_SECONDARY;
const SECTION_SUBTITLE_MUTED = TEXT_SECONDARY;
const CAPTION_MUTED = TEXT_TERTIARY;
const SOFT_DIVIDER = BORDER_SOFT;
const WORDS_SCREEN_REFRESH_STALE_MS = 45_000;

const NAV_ITEMS = [
  { title: '学习计划', detail: '设置每日新词、复习节奏和主攻词书。', href: '/words/plan-settings' },
  { title: '我的词库', detail: '继续管理待复习、已掌握和错词。', href: '/words/my-words' },
  { title: 'AI 错词分析', detail: '定位近期高频问题和强化方向。', href: '/words/mistakes' },
  { title: 'AI 学习报告', detail: '回看阶段总结和下一步策略。', href: '/words/report' },
  { title: 'AI 学习分析', detail: '查看当前节奏、薄弱项和建议。', href: '/words/analysis' },
  { title: '词书中心', detail: '查看主攻词书和其他词书入口。', href: '/words/books' },
] as const;

type WordsReviewMode = 'mistake' | 'review' | 'learn';

type FocusBookSummary = {
  slug: string;
  title: string;
  totalWords: number;
  learnedWords: number;
  remainingWords: number;
  percentage: number;
  dueWords?: number;
  mistakeWords?: number;
};

type InsightItem = {
  title: string;
  detail?: string;
  color: string;
};

type AnalysisSummaryData = {
  weakTags: string[];
  strongTags: string[];
  routes: Array<{ title: string; detail: string; href: Href }>;
};

type AnalysisCardStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function safePercent(value: number) {
  return clamp(Math.round(value), 0, 100);
}

function dayKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function buildProgressWidth(percent: number) {
  return `${clamp(percent, 0, 100)}%` as const;
}

function buildRecentStudyDays(values: Array<{ lastReviewedAt?: string; nextReviewAt?: string }>) {
  const now = Date.now();
  const recentDays = new Set<string>();
  values.forEach((item) => {
    const source = item.lastReviewedAt || item.nextReviewAt;
    if (!source) return;
    const diff = now - new Date(source).getTime();
    if (diff <= 7 * 24 * 60 * 60 * 1000) {
      recentDays.add(dayKey(source));
    }
  });
  return recentDays.size;
}

const WORDS_TODAY_HREF: Href = { pathname: '/words/today' };

function buildWordsReviewHref(
  mode: WordsReviewMode,
  bookSlug?: string,
  source?: 'plan' | 'extra' | 'direct',
  resume = true,
): Href {
  const params: Record<string, string> = { mode };
  if (bookSlug) params.bookSlug = bookSlug;
  if (source) params.source = source;
  if (resume) params.resume = 'true';
  return { pathname: '/words/review', params };
}

function decodeHrefParam(raw: string | undefined) {
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function normalizeWordsHref(href: string | null | undefined, fallback: Href): Href {
  if (!href) return fallback;
  if (href === '/words/books') return '/words/books';
  if (href === '/words/today') return WORDS_TODAY_HREF;
  if (!href.startsWith('/words/review')) return fallback;

  const mode = decodeHrefParam(href.match(/[?&]mode=([^&]+)/)?.[1]);
  if (mode !== 'mistake' && mode !== 'review' && mode !== 'learn') {
    return fallback;
  }

  const bookSlug = decodeHrefParam(href.match(/[?&]bookSlug=([^&]+)/)?.[1]);
  const source = decodeHrefParam(href.match(/[?&]source=([^&]+)/)?.[1]);
  const resume = decodeHrefParam(href.match(/[?&]resume=([^&]+)/)?.[1]);
  const normalizedSource = source === 'plan' || source === 'extra' || source === 'direct' ? source : undefined;
  const normalizedResume =
    resume === 'true' || resume === '1' || resume === 'yes'
      ? true
      : resume === 'false' || resume === '0' || resume === 'no'
        ? false
        : true;
  return buildWordsReviewHref(mode, bookSlug, normalizedSource, normalizedResume);
}

function buildRawActionPreview(action: unknown) {
  try {
    return JSON.stringify(action).slice(0, 300);
  } catch {
    return '[unserializable]';
  }
}

function hasRenderableDashboardInsights(
  insight: VocabularyDashboardInsights | null | undefined,
): insight is VocabularyDashboardInsights {
  if (!insight) return false;
  return Boolean(
    insight.heroInsight?.weaknessInsight?.trim() &&
      insight.heroInsight?.memoryWindowInsight?.trim() &&
      insight.heroInsight?.methodInsight?.trim() &&
      insight.panelAnalysis?.weakCategories?.length &&
      insight.panelAnalysis?.strongCategories?.length &&
      insight.panelAnalysis?.recommendations?.length,
  );
}

function hasRealDashboardInsights(
  insight: VocabularyDashboardInsights | null | undefined,
): insight is VocabularyDashboardInsights {
  return hasRenderableDashboardInsights(insight) && !insight.heroInsight.isSample && !insight.panelAnalysis.isSample;
}

function buildDashboardInsightsFingerprint(payload: {
  dueCount: number;
  mistakeCount: number;
  masteredCount: number;
  todayNewLearned: number;
  todayReviewed: number;
  activeBookSlug: string;
  activeBookProgress: number;
}) {
  return [
    payload.dueCount,
    payload.mistakeCount,
    payload.masteredCount,
    payload.todayNewLearned,
    payload.todayReviewed,
    payload.activeBookSlug,
    payload.activeBookProgress,
  ].join('|');
}

function buildInsightsMetaLabel(savedAt?: number) {
  if (!savedAt) return '基于今日学习数据生成';
  const diffMinutes = Math.max(Math.round((Date.now() - savedAt) / 60000), 0);
  if (diffMinutes < 1) return '刚刚更新';
  if (diffMinutes < 60) return `${diffMinutes} 分钟前更新`;
  return '基于今日学习数据生成';
}

function buildLocalDayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function SectionTitle({
  title,
  subtitle,
  action,
  titleStyle,
  subtitleStyle,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  titleStyle?: React.ComponentProps<typeof AppText>['style'];
  subtitleStyle?: React.ComponentProps<typeof AppText>['style'];
}) {
  const { colors } = useThemeColors();

  return (
    <View style={{ paddingHorizontal: PAGE_PADDING, gap: subtitle ? 6 : 0 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: subtitle ? 'flex-start' : 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <AppText
          style={[
            { fontSize: 20, lineHeight: 28, fontWeight: '700', letterSpacing: -0.3, color: colors.textPrimary },
            titleStyle,
          ]}
        >
          {title}
        </AppText>
        {action}
      </View>
      {subtitle ? (
        <AppText style={[{ fontSize: 14, lineHeight: 22, fontWeight: '400', color: colors.textSecondary }, subtitleStyle]}>{subtitle}</AppText>
      ) : null}
    </View>
  );
}

function DarkChip({ label }: { label: string }) {
  return (
    <View
        style={{
          alignSelf: 'flex-start',
          minHeight: 36,
          borderRadius: 999,
          paddingHorizontal: 14,
          paddingVertical: 8,
          backgroundColor: 'rgba(255,255,255,0.09)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.14)',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}
      >
      <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: DOT_PURPLE }} />
      <AppText style={{ fontSize: 13, fontWeight: '600', color: HERO_TEXT_PRIMARY }}>{label}</AppText>
    </View>
  );
}

function HeroSummaryColumn({
  label,
  value,
  note,
  actionLabel,
  onPress,
}: {
  label: string;
  value: string;
  note: string;
  actionLabel?: string;
  onPress?: () => void;
}) {
  return (
    <View style={{ flex: 1, gap: 3 }}>
      <AppText style={{ fontSize: 12, fontWeight: '500', color: HERO_TEXT_TERTIARY }}>{label}</AppText>
      <AppText style={{ fontSize: 18, lineHeight: 22, fontWeight: '700', color: HERO_TEXT_PRIMARY }} numberOfLines={2}>
        {value}
      </AppText>
      <AppText style={{ fontSize: 12, lineHeight: 16, color: HERO_TEXT_TERTIARY }} numberOfLines={1}>
        {note}
      </AppText>
      {actionLabel && onPress ? (
        <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => ({ alignSelf: 'flex-start', marginTop: 6, opacity: pressed ? 0.72 : 1 })}>
          <AppText style={{ fontSize: 13, lineHeight: 18, fontWeight: '600', color: ACTION_BLUE }} numberOfLines={1}>
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

function HeroButton({
  label,
  onPress,
  secondary = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
}) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 56,
        borderRadius: 28,
        backgroundColor: secondary ? 'rgba(255,255,255,0.08)' : theme.colorScheme === 'dark' ? theme.primaryBlue : '#FFFFFF',
        borderWidth: secondary ? 1 : 0,
        borderColor: secondary ? 'rgba(255,255,255,0.14)' : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.82 : 1,
      })}
    >
      <AppText
        style={{
          fontSize: 17,
          fontWeight: secondary ? '600' : '700',
          color: secondary ? 'rgba(255,255,255,0.88)' : theme.colorScheme === 'dark' ? '#FFFFFF' : TEXT_PRIMARY,
        }}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

function HeroActionCard({
  title,
  subtitle,
  onPress,
  disabled = false,
}: {
  title: string;
  subtitle: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 96,
        borderRadius: 22,
        paddingHorizontal: 16,
        paddingVertical: 16,
        justifyContent: 'space-between',
        backgroundColor: disabled ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        borderColor: disabled ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.14)',
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      <AppText style={{ fontSize: 17, lineHeight: 22, fontWeight: '700', color: HERO_TEXT_PRIMARY }}>{title}</AppText>
      <AppText style={{ fontSize: 13, lineHeight: 18, color: HERO_TEXT_SECONDARY }}>{subtitle}</AppText>
    </Pressable>
  );
}

function InsightButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => ({ opacity: disabled ? 0.42 : pressed ? 0.72 : 1 })}>
      <AppText style={{ fontSize: 15, fontWeight: '500', color: INSIGHT_BLUE }}>{label}</AppText>
    </Pressable>
  );
}

function InsightItemRow({
  item,
  isLast,
}: {
  item: InsightItem;
  isLast: boolean;
}) {
  const { colors } = useThemeColors();

  return (
    <View
      style={{
        paddingVertical: 16,
        borderBottomWidth: isLast ? 0 : 0.5,
        borderBottomColor: colors.divider,
        flexDirection: 'row',
        gap: 14,
      }}
    >
      <View style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: item.color, marginTop: 7 }} />
      <View style={{ flex: 1, gap: 4 }}>
        <AppText style={{ fontSize: 16, lineHeight: 24, fontWeight: '600', color: colors.textPrimary }}>
          {item.title}
        </AppText>
        {item.detail ? (
          <AppText style={{ fontSize: 14, lineHeight: 22, color: colors.textSecondary }}>
            {item.detail}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

function StateCard({
  title,
  value,
  note,
  color,
}: {
  title: string;
  value: string;
  note: string;
  color: string;
}) {
  const { colors, theme } = useThemeColors();
  return (
    <View
      style={{
        width: '48.2%',
        minHeight: 100,
        borderRadius: 20,
        backgroundColor: colors.secondaryCardBackground,
        padding: 16,
        gap: 7,
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: color }} />
      <AppText style={{ fontSize: 13, fontWeight: '600', color: colors.textSecondary }}>{title}</AppText>
      <AppText style={{ fontSize: 18, fontWeight: '700', letterSpacing: -0.3, color }}>{value}</AppText>
      <AppText style={{ fontSize: 12, lineHeight: 17, color: colors.textMuted }} numberOfLines={2}>
        {note}
      </AppText>
    </View>
  );
}

function ProgressBar({ progress, tint }: { progress: number; tint: string }) {
  const { theme } = useAppTheme();
  return (
    <View
      style={{
        height: 6,
        borderRadius: 999,
        backgroundColor: theme.fillSecondary,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: buildProgressWidth(progress),
          height: '100%',
          borderRadius: 999,
          backgroundColor: tint,
        }}
      />
    </View>
  );
}

function TagGroup({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: 'weak' | 'strong';
}) {
  const { colors } = useThemeColors();
  const bg = tone === 'weak' ? 'rgba(124,108,255,0.08)' : COLOR_GREEN_BG;
  const fg = tone === 'weak' ? LIGHT_PURPLE : COLOR_GREEN;
  return (
    <View style={{ gap: 10 }}>
      <AppText style={{ fontSize: 14, fontWeight: '600', color: colors.textSecondary }}>{title}</AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {items.map((item) => (
          <View
            key={`${title}-${item}`}
            style={{
              borderRadius: 999,
              paddingHorizontal: 12,
              paddingVertical: 7,
              backgroundColor: bg,
            }}
          >
            <AppText style={{ fontSize: 13, fontWeight: '600', color: fg }}>{item}</AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

function SuggestionRoute({
  title,
  detail,
  isLast,
}: {
  title: string;
  detail: string;
  isLast: boolean;
}) {
  const { colors } = useThemeColors();

  return (
    <View
      style={{
        paddingVertical: 14,
        borderBottomWidth: isLast ? 0 : 0.5,
        borderBottomColor: colors.divider,
        gap: 4,
      }}
    >
      <AppText style={{ fontSize: 15, fontWeight: '600', color: colors.textPrimary }}>{title}</AppText>
      <AppText style={{ fontSize: 13, lineHeight: 20, color: colors.textSecondary }}>{detail}</AppText>
    </View>
  );
}

function GradientButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 50,
        borderRadius: 25,
        overflow: 'hidden',
        justifyContent: 'center',
        alignItems: 'center',
        opacity: pressed ? 0.84 : 1,
      })}
    >
      <View style={{ ...StyleSheetFill, backgroundColor: '#6062F6' }} />
      <View
        style={{
          position: 'absolute',
          left: -28,
          top: -18,
          width: 150,
          height: 84,
          borderRadius: 999,
          backgroundColor: '#856CFF',
          opacity: 0.64,
        }}
      />
      <View
        style={{
          position: 'absolute',
          right: -18,
          bottom: -22,
          width: 150,
          height: 92,
          borderRadius: 999,
          backgroundColor: '#5C9DFF',
          opacity: 0.68,
        }}
      />
      <AppText style={{ fontSize: 16, fontWeight: '600', color: '#FFFFFF' }}>{label}</AppText>
    </Pressable>
  );
}

const StyleSheetFill = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};

function NavigationCard({
  title,
  detail,
  href,
}: {
  title: string;
  detail: string;
  href: string;
}) {
  const { colors } = useThemeColors();

  return (
    <Pressable
      onPress={() => router.push(href as never)}
      style={({ pressed }) => ({
        width: '48%',
        minHeight: 116,
        borderRadius: 20,
        backgroundColor: colors.cardBackground,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 16,
        justifyContent: 'space-between',
        opacity: pressed ? 0.82 : 1,
      })}
    >
      <View style={{ gap: 6 }}>
        <AppText style={{ fontSize: 16, lineHeight: 22, fontWeight: '600', color: colors.textPrimary }}>{title}</AppText>
        <AppText style={{ fontSize: 13, lineHeight: 20, fontWeight: '400', color: colors.textSecondary }} numberOfLines={2}>
          {detail}
        </AppText>
      </View>
      <AppText style={{ fontSize: 13, lineHeight: 18, fontWeight: '500', color: colors.textMuted }}>查看</AppText>
    </Pressable>
  );
}

function TaskActionCard({
  title,
  detail,
  onPress,
  chips,
  actionLabel,
  disabled = false,
}: {
  title: string;
  detail: string;
  onPress?: () => void;
  chips?: string[];
  actionLabel: string;
  disabled?: boolean;
}) {
  const { colors, theme } = useThemeColors();
  return (
    <View
      style={{
        borderRadius: 20,
        backgroundColor: colors.cardBackground,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 20,
        gap: 16,
        minHeight: 164,
      }}
    >
      <View style={{ gap: 8 }}>
        <AppText style={{ fontSize: FONT_MICRO, fontWeight: '700', color: colors.textMuted }}>执行入口</AppText>
        <AppText style={{ fontSize: 17, lineHeight: 24, fontWeight: '700', color: colors.textPrimary }}>{title}</AppText>
        <AppText style={{ fontSize: 14, lineHeight: 22, color: colors.textSecondary }} numberOfLines={2}>
          {detail}
        </AppText>
      </View>

      {chips?.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {chips.map((chip, index) => (
            <View
              key={`${chip}-${index}`}
              style={{
                borderRadius: 14,
                minHeight: 28,
                paddingHorizontal: 10,
                paddingVertical: 5,
                backgroundColor: index === 2 ? COLOR_GREEN_BG : COLOR_AMBER_BG,
              }}
            >
              <AppText style={{ fontSize: 13, fontWeight: '600', color: index === 2 ? COLOR_GREEN : ACCENT }}>{chip}</AppText>
            </View>
          ))}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable disabled={disabled || !onPress} onPress={onPress} style={({ pressed }) => ({ opacity: disabled ? 0.44 : pressed ? 0.76 : 1 })}>
          <AppText style={{ fontSize: 15, fontWeight: '600', color: disabled ? colors.textMuted : ACTION_BLUE }}>{actionLabel}</AppText>
        </Pressable>
        <Pressable
          disabled={disabled || !onPress}
          onPress={onPress}
          style={({ pressed }) => ({
            width: 42,
            height: 42,
            borderRadius: 999,
            backgroundColor: theme.fillSecondary,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: disabled ? 0.44 : pressed ? 0.76 : 1,
          })}
        >
          <Ionicons name="arrow-forward" size={18} color={disabled ? colors.textMuted : colors.textPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

function GuestStateCard() {
  return (
    <View
      style={{
        marginHorizontal: PAGE_PADDING,
        borderRadius: HERO_RADIUS,
        backgroundColor: HERO_BG,
        padding: 20,
        overflow: 'hidden',
        gap: 18,
      }}
    >
      <View style={{ ...StyleSheetFill, backgroundColor: HERO_BG }} />
      <View
        style={{
          position: 'absolute',
          top: -40,
          right: -20,
          width: 180,
          height: 180,
          borderRadius: 999,
          backgroundColor: '#345CFF',
          opacity: 0.16,
        }}
      />
      <View
        style={{
          position: 'absolute',
          bottom: -54,
          left: -26,
          width: 220,
          height: 180,
          borderRadius: 999,
          backgroundColor: '#775BFF',
          opacity: 0.12,
        }}
      />

      <DarkChip label="AI 个性化学习" />
      <AppText style={{ fontSize: 26, lineHeight: 34, fontWeight: '700', color: HERO_TEXT_PRIMARY }}>
        今天先做什么，登录后系统会按你的学习记录直接排好优先级
      </AppText>
      <AppText style={{ fontSize: 15, lineHeight: 24, color: HERO_TEXT_SECONDARY }}>
        登录后即可同步学习计划、词书进度、复习压力和个性化学习建议。
      </AppText>
      <HeroButton label="去登录" onPress={() => router.push('/auth/sign-in')} />
    </View>
  );
}

function mapTodayRecommendationAction(action: 'learn' | 'review' | 'mistake'): VocabularyTodayActionType {
  if (action === 'learn') return 'learn_plan';
  if (action === 'mistake') return 'mistake_review';
  return 'review_plan';
}

export function WordsScreen() {
  const { colors } = useThemeColors();
  const { shouldUseTabletLayout } = useDeviceClass();
  const { guardEntry } = useEntitlementGuard();
  const session = useAppSession();
  const { status: mobileMeStatus, data: mobileMe } = useMobileMe();
  const isLoggedIn = session.status === 'authenticated';
  const vocabularyInsightsAccessResolved =
    !isLoggedIn || mobileMeStatus === 'ready' || (mobileMeStatus === 'sync_failed' && Boolean(mobileMe));
  const canUseVocabularyInsights =
    isLoggedIn && vocabularyInsightsAccessResolved && mobileMe?.entitlements.canUseVocabulary === true;
  const vocabularyInsightsLocked =
    isLoggedIn && vocabularyInsightsAccessResolved && mobileMe?.entitlements.canUseVocabulary === false;
  const {
    dashboard,
    loading: dashboardLoading,
    error: dashboardError,
    authRequired: dashboardAuthRequired,
    refresh: refreshDashboard,
  } = useVocabularyDashboardData();
  const {
    plan,
    loading: planLoading,
    error: planError,
    authRequired: planAuthRequired,
    refresh: refreshPlan,
  } = useVocabularyTodayPlanData();
  const {
    data: notebook,
    loading: notebookLoading,
    error: notebookError,
    authRequired: notebookAuthRequired,
    refresh: refreshNotebook,
  } = useVocabularyNotebookData();
  const [dashboardInsights, setDashboardInsights] = useState<VocabularyDashboardInsights | null>(null);
  const [analysisCardStatus, setAnalysisCardStatus] = useState<AnalysisCardStatus>('idle');
  const [analysisRefreshing, setAnalysisRefreshing] = useState(false);
  const [analysisCacheHydrated, setAnalysisCacheHydrated] = useState(false);
  const [insightSavedAt, setInsightSavedAt] = useState<number | null>(null);
  const lastAnalysisRequestKeyRef = useRef<string | null>(null);
  const wasLoggedInRef = useRef(isLoggedIn);
  const lastStableDataAtRef = useRef(0);
  const hasSkippedInitialFocusRefreshRef = useRef(false);
  const lastPlanSnapshotLogRef = useRef<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!isLoggedIn) return undefined;
      if (!hasSkippedInitialFocusRefreshRef.current) {
        hasSkippedInitialFocusRefreshRef.current = true;
        return undefined;
      }
      if (dashboardLoading || planLoading || notebookLoading) {
        return undefined;
      }
      if (
        lastStableDataAtRef.current > 0 &&
        Date.now() - lastStableDataAtRef.current < WORDS_SCREEN_REFRESH_STALE_MS
      ) {
        return undefined;
      }
      void refreshDashboard();
      void refreshPlan();
      void refreshNotebook();
      return undefined;
    }, [
      dashboardLoading,
      isLoggedIn,
      notebookLoading,
      planLoading,
      refreshDashboard,
      refreshNotebook,
      refreshPlan,
    ]),
  );

  const showGuestState = !isLoggedIn || (!dashboard && !plan && !notebook && (dashboardAuthRequired || planAuthRequired || notebookAuthRequired));
  const hasAnyData = Boolean(dashboard || plan || notebook);
  const combinedError = dashboardError || planError || notebookError;
  const initialVocabularyLoading = (dashboardLoading || planLoading || notebookLoading) && !hasAnyData;

  useEffect(() => {
    if (hasAnyData && !dashboardLoading && !planLoading && !notebookLoading) {
      lastStableDataAtRef.current = Date.now();
    }
  }, [dashboardLoading, hasAnyData, notebookLoading, planLoading]);

  const words = notebook?.words ?? [];
  const totalStudied =
    plan?.summary.backlog.trackedWords ?? notebook?.stats.all ?? dashboard?.myWordsCount ?? words.length ?? 0;
  const dueCount = plan?.summary.backlog.dueCount ?? notebook?.stats.due ?? dashboard?.todayDueCount ?? 0;
  const dueNowCount = plan?.summary.backlog.dueNowCount ?? notebook?.stats.dueNow ?? dueCount;
  const masteredCount = plan?.summary.backlog.masteredCount ?? notebook?.stats.mastered ?? 0;
  const mistakeCount = plan?.summary.backlog.mistakeCount ?? notebook?.stats.mistake ?? dashboard?.mistakeWordsCount ?? 0;
  const masteryRate = totalStudied > 0 ? safePercent((masteredCount / totalStudied) * 100) : dashboard?.masteryRate ?? 0;

  const focusBook: FocusBookSummary | null = useMemo(() => {
    if (plan?.summary.focusBook) {
      return {
        ...plan.summary.focusBook,
        dueWords: dueNowCount,
        mistakeWords: mistakeCount,
      };
    }

    const fallback = dashboard?.books[0];
    if (!fallback) return null;
    return {
      slug: fallback.slug,
      title: fallback.title,
      totalWords: fallback.totalWords,
      learnedWords: fallback.masteredWords,
      remainingWords: Math.max(fallback.totalWords - fallback.masteredWords, 0),
      percentage: fallback.totalWords > 0 ? safePercent((fallback.masteredWords / fallback.totalWords) * 100) : 0,
      dueWords: fallback.dueWords,
      mistakeWords: fallback.mistakeWords,
    };
  }, [dashboard?.books, dueNowCount, mistakeCount, plan?.summary.focusBook]);

  const focusBookSlug = focusBook?.slug ?? '';
  const focusBookTitle = focusBook?.title ?? '当前词书';

  const topMistakeWords = useMemo(
    () =>
      [...words]
        .filter((word) => word.status === 'mistake')
        .sort((a, b) => (b.mistakeCount ?? 0) - (a.mistakeCount ?? 0))
        .slice(0, 5)
        .map((word) => word.word),
    [words],
  );

  const dashboardPatternSignals = useMemo(() => {
    const patternCounts: Record<string, { mistakes: number; mastered: number }> = {};

    words.forEach((word) => {
      if (!word.pattern) return;
      if (!patternCounts[word.pattern]) patternCounts[word.pattern] = { mistakes: 0, mastered: 0 };
      if (word.status === 'mistake' || (word.mistakeCount ?? 0) > 0) patternCounts[word.pattern].mistakes += 1;
      if (word.status === 'mastered') patternCounts[word.pattern].mastered += 1;
    });

    return {
      patternMistakes: Object.entries(patternCounts)
        .filter(([, value]) => value.mistakes > 0)
        .sort((a, b) => b[1].mistakes - a[1].mistakes)
        .slice(0, 3)
        .map(([pattern, value]) => [pattern, value.mistakes] as [string, number]),
      patternMastered: Object.entries(patternCounts)
        .filter(([, value]) => value.mastered > 0 && value.mistakes === 0)
        .sort((a, b) => b[1].mastered - a[1].mastered)
        .slice(0, 3)
        .map(([pattern]) => pattern),
    };
  }, [words]);

  const today = plan?.summary.today;
  const todayNewPlanned = today?.todayNewPlanned ?? 0;
  const todayNewCompleted = today?.todayNewCompleted ?? 0;
  const todayReviewPlanned = today?.todayReviewPlanned ?? 0;
  const todayReviewCompleted = today?.todayReviewCompleted ?? 0;
  const todayMistakePlanned = today?.todayMistakePlanned ?? 0;
  const todayMistakeCompleted = today?.todayMistakeCompleted ?? 0;
  const todayWorkedWords = today?.todayWorkedWords ?? todayNewCompleted + (today?.todayOldWordReviewed ?? todayReviewCompleted + todayMistakeCompleted);
  const remainingNewToLearn = today?.remainingNew ?? Math.max(todayNewPlanned - todayNewCompleted, 0);
  const remainingReviewToComplete = today?.remainingReview ?? Math.max(todayReviewPlanned - todayReviewCompleted, 0);
  const remainingMistakeToComplete = today?.remainingMistake ?? Math.max(todayMistakePlanned - todayMistakeCompleted, 0);
  const extraDueReviewAvailable = today?.extraDueReviewAvailable ?? Math.max(dueNowCount - remainingReviewToComplete, 0);
  const hasFocusBook = Boolean(focusBookSlug);
  const insightDayKey = buildLocalDayKey();
  const hasInsightSignals = totalStudied > 0 || todayWorkedWords > 0 || dueNowCount > 0 || mistakeCount > 0;
  const todayActionContext = useMemo(
    () => ({
      dueNowCount,
      mistakeCount,
      plannedNew: todayNewPlanned,
      plannedReview: todayReviewPlanned,
      plannedMistake: todayMistakePlanned,
      completedNew: todayNewCompleted,
      completedReview: todayReviewCompleted,
      completedMistake: todayMistakeCompleted,
      remainingNew: remainingNewToLearn,
      remainingReview: remainingReviewToComplete,
      remainingMistake: remainingMistakeToComplete,
      extraDueReviewAvailable,
      focusBookSlug: focusBookSlug || undefined,
      focusBookRemainingWords: focusBook?.remainingWords ?? 0,
    }),
    [
      dueNowCount,
      extraDueReviewAvailable,
      focusBookSlug,
      mistakeCount,
      todayMistakeCompleted,
      todayMistakePlanned,
      todayNewCompleted,
      todayNewPlanned,
      todayReviewCompleted,
      todayReviewPlanned,
      remainingMistakeToComplete,
      remainingNewToLearn,
      remainingReviewToComplete,
      focusBook?.remainingWords,
    ],
  );

  const reviewPlanAction = useMemo(
    () =>
      resolveVocabularyTodayActionRoute(
        {
          actionType: 'review_plan',
          source: 'plan',
          focusBookSlug: focusBookSlug || undefined,
        },
        todayActionContext,
      ),
    [focusBookSlug, todayActionContext],
  );
  const reviewExtraAction = useMemo(
    () =>
      resolveVocabularyTodayActionRoute(
        {
          actionType: 'review_extra',
          source: 'extra',
          focusBookSlug: focusBookSlug || undefined,
        },
        todayActionContext,
      ),
    [focusBookSlug, todayActionContext],
  );
  const mistakeAction = useMemo(
    () =>
      resolveVocabularyTodayActionRoute(
        {
          actionType: 'mistake_review',
          source: 'plan',
          focusBookSlug: focusBookSlug || undefined,
        },
        todayActionContext,
      ),
    [focusBookSlug, todayActionContext],
  );
  const learnPlanAction = useMemo(
    () =>
      resolveVocabularyTodayActionRoute(
        {
          actionType: 'learn_plan',
          source: 'plan',
          focusBookSlug: focusBookSlug || undefined,
        },
        todayActionContext,
      ),
    [focusBookSlug, todayActionContext],
  );
  const learnExtraAction = useMemo(
    () =>
      resolveVocabularyTodayActionRoute(
        {
          actionType: 'learn_extra',
          source: 'extra',
          focusBookSlug: focusBookSlug || undefined,
        },
        todayActionContext,
      ),
    [focusBookSlug, todayActionContext],
  );
  const learnActionHref = useMemo<Href>(() => {
    if (remainingNewToLearn > 0 && learnPlanAction.href) return learnPlanAction.href;
    if (learnExtraAction.href) return learnExtraAction.href;
    if (!hasFocusBook) return '/words/books';
    return buildWordsReviewHref('learn', focusBookSlug, 'direct');
  }, [focusBookSlug, hasFocusBook, learnExtraAction.href, learnPlanAction.href, remainingNewToLearn]);

  const reviewActionHref = useMemo<Href>(() => {
    if (remainingReviewToComplete > 0 && reviewPlanAction.href) return reviewPlanAction.href;
    if (reviewExtraAction.href) return reviewExtraAction.href;
    return buildWordsReviewHref('review', focusBookSlug || undefined, 'direct');
  }, [focusBookSlug, remainingReviewToComplete, reviewExtraAction.href, reviewPlanAction.href]);
  const heroState = useMemo(() => {
    if (initialVocabularyLoading) {
      return {
        title: '正在同步今日学习安排',
        description: '词书进度、复习压力和今天的主任务会在几秒内加载完成。',
      };
    }

    if (!hasFocusBook) {
      return {
        title: '先选择一本词书',
        description: '设定主攻方向后，系统会安排每天的新词和复习。',
      };
    }

    if (dueNowCount > 0 && remainingReviewToComplete > 0) {
      return {
        title: '先稳住复习节奏',
        description: `今天有 ${dueNowCount} 个词需要回顾，计划内还剩 ${remainingReviewToComplete} 个。`,
      };
    }

    if (dueNowCount > 0 && remainingReviewToComplete <= 0) {
      return {
        title: '今日复习计划已完成',
        description: `还有 ${extraDueReviewAvailable} 个到期词，可选择继续加练。`,
      };
    }

    if (mistakeCount >= Math.max(6, dueNowCount) && remainingMistakeToComplete > 0) {
      return {
        title: '把易错词再过一遍',
        description: `最近错词偏多，先用一轮强化把薄弱点压实。`,
      };
    }

    if (remainingNewToLearn > 0) {
      return {
        title: '继续推进主攻词书',
        description: `今天适合学习 ${remainingNewToLearn} 个新词，慢慢把词库铺起来。`,
      };
    }

    if ((focusBook?.remainingWords ?? 0) > 0) {
      return {
        title: '今日新词计划已完成',
        description: '可以继续学习新词，或回到复习巩固。',
      };
    }

    return {
      title: '今天节奏不错',
      description: '复习压力已经降低，可以轻量巩固或继续新词。',
    };
  }, [
    dueNowCount,
    extraDueReviewAvailable,
    hasFocusBook,
    initialVocabularyLoading,
    mistakeCount,
    focusBook?.remainingWords,
    remainingMistakeToComplete,
    remainingNewToLearn,
    remainingReviewToComplete,
  ]);

  const heroSummary = useMemo(
    () => [
      {
        label: '待处理',
        value: initialVocabularyLoading ? '--' : `${dueNowCount}`,
        note: initialVocabularyLoading ? '正在同步到期与待处理情况' : dueNowCount > 0 ? `${dueNowCount} 个已到期` : '积压相对可控',
      },
      {
        label: '掌握率',
        value: initialVocabularyLoading ? '--' : `${masteryRate}%`,
        note: initialVocabularyLoading ? '正在同步掌握情况' : masteryRate >= 60 ? '基础框架已建立' : '仍在继续搭框架',
      },
      {
        label: '当前词书',
        value: focusBook ? `${focusBook.title}` : initialVocabularyLoading ? '同步中' : '待同步',
        note: focusBook ? `进度 ${focusBook.percentage}%` : initialVocabularyLoading ? '正在同步词书进度' : '暂无主攻词书',
        actionLabel: hasFocusBook ? '继续学习' : '选择词书',
        actionHref: learnActionHref,
      },
    ],
    [dueNowCount, hasFocusBook, initialVocabularyLoading, learnActionHref, masteryRate, focusBook],
  );

  const insightItems: InsightItem[] = hasRealDashboardInsights(dashboardInsights)
    ? [
        {
          color: DOT_PURPLE,
          title: dashboardInsights.heroInsight.weaknessInsight,
        },
        {
          color: DOT_BLUE,
          title: dashboardInsights.heroInsight.memoryWindowInsight,
        },
        {
          color: DOT_GREEN,
          title: dashboardInsights.heroInsight.methodInsight,
        },
      ]
    : [];

  const stateCards = [
    {
      title: '新词计划',
      value: initialVocabularyLoading ? '--' : `${todayNewPlanned}`,
      note: initialVocabularyLoading ? '正在同步今日新词计划' : todayNewPlanned > 0 ? `已完成 ${todayNewCompleted} / ${todayNewPlanned}` : '今日暂无新词计划',
      color: MUTED_BLUE,
    },
    {
      title: '复习计划',
      value: initialVocabularyLoading ? '--' : `${todayReviewPlanned}`,
      note: initialVocabularyLoading ? '正在同步今日复习计划' : todayReviewPlanned > 0 ? `已完成 ${todayReviewCompleted} / ${todayReviewPlanned}` : '今日暂无复习计划',
      color: MUTED_ORANGE,
    },
    {
      title: '错词处理',
      value: initialVocabularyLoading ? '--' : `${todayMistakePlanned}`,
      note: initialVocabularyLoading ? '正在同步错词强化计划' : todayMistakePlanned > 0 ? `已完成 ${todayMistakeCompleted} / ${todayMistakePlanned}` : '今日暂无错词强化',
      color: MUTED_GREEN,
    },
    {
      title: '当前词书',
      value: focusBook ? focusBook.title : initialVocabularyLoading ? '同步中' : '未设置',
      note: focusBook ? `进度 ${focusBook.percentage}%` : initialVocabularyLoading ? '正在同步词书信息' : '先设定主攻方向',
      color: MUTED_VIOLET,
    },
  ];

  const recommendationFallbacks = useMemo(
    () => [reviewActionHref, '/words/mistakes' as const, learnActionHref],
    [learnActionHref, reviewActionHref],
  );
  const handleTodayActionPress = useCallback(
    (actionType: VocabularyTodayActionType, actionLabel: string, resolvedRoute: VocabularyTodayResolvedRoute, rawAction: unknown) => {
      console.log('vocabulary_training_action_resolved', {
        actionType,
        mode: resolvedRoute.mode,
        source: resolvedRoute.source,
        disabled: resolvedRoute.disabled,
        disabledReason: resolvedRoute.disabledReason,
        remainingNew: remainingNewToLearn,
        remainingReview: remainingReviewToComplete,
        dueNowCount,
        extraDueReviewAvailable,
        mistakeCount,
        href: resolvedRoute.routeTarget,
      });
      console.log('vocabulary_today_action_press', {
        actionType,
        actionLabel,
        mode: resolvedRoute.mode,
        bookSlug: resolvedRoute.bookSlug,
        routeTarget: resolvedRoute.routeTarget,
        dueCount: resolvedRoute.dueCount,
        plannedCount: resolvedRoute.plannedCount,
        remainingCount: resolvedRoute.remainingCount,
        rawAction: buildRawActionPreview(rawAction),
      });
      if (!resolvedRoute.disabled && resolvedRoute.href) {
        router.push(resolvedRoute.href);
      }
    },
    [dueNowCount, extraDueReviewAvailable, mistakeCount, remainingNewToLearn, remainingReviewToComplete],
  );

  useEffect(() => {
    if (!__DEV__ || !hasAnyData) return;
    const snapshot = JSON.stringify({
      dueNowCount,
      todayReviewPlanned,
      todayReviewCompleted,
      remainingReview: remainingReviewToComplete,
      extraDueReviewAvailable,
      todayNewPlanned,
      todayNewCompleted,
      remainingNew: remainingNewToLearn,
      mistakeCount,
      todayMistakePlanned,
      todayMistakeCompleted,
      remainingMistake: remainingMistakeToComplete,
      dailyReviewTarget: plan?.plan.dailyReviewTarget ?? 0,
      dailyNewTarget: plan?.plan.dailyNewTarget ?? 0,
      focusBookSlug: focusBookSlug || null,
    });
    if (lastPlanSnapshotLogRef.current === snapshot) return;
    lastPlanSnapshotLogRef.current = snapshot;

    console.log('vocabulary_words_screen_plan_snapshot', {
      dueNowCount,
      todayReviewPlanned,
      todayReviewCompleted,
      remainingReview: remainingReviewToComplete,
      extraDueReviewAvailable,
      todayNewPlanned,
      todayNewCompleted,
      remainingNew: remainingNewToLearn,
      mistakeCount,
      todayMistakePlanned,
      todayMistakeCompleted,
      remainingMistake: remainingMistakeToComplete,
      dailyReviewTarget: plan?.plan.dailyReviewTarget ?? 0,
      dailyNewTarget: plan?.plan.dailyNewTarget ?? 0,
      focusBookSlug: focusBookSlug || null,
    });
  }, [
    dueNowCount,
    extraDueReviewAvailable,
    focusBookSlug,
    mistakeCount,
    plan?.plan.dailyNewTarget,
    plan?.plan.dailyReviewTarget,
    remainingMistakeToComplete,
    remainingNewToLearn,
    remainingReviewToComplete,
    todayMistakeCompleted,
    todayMistakePlanned,
    todayNewCompleted,
    todayNewPlanned,
    todayReviewCompleted,
    todayReviewPlanned,
    hasAnyData,
  ]);

  const primaryTaskCards = useMemo(() => {
    const planActions = [reviewPlanAction, mistakeAction, learnPlanAction]
      .filter((action) => !action.disabled)
      .sort((left, right) => right.priority - left.priority);

    if (!planActions.length) {
      return [
        {
          title: '今日计划已完成',
          detail:
            extraDueReviewAvailable > 0
              ? `计划任务已经完成，还有 ${extraDueReviewAvailable} 个到期词可以继续加练。`
              : '今天的计划任务已经完成，可以轻量巩固或回看学习分析。',
          actionLabel: '查看计划',
          disabled: false,
          chips:
            extraDueReviewAvailable > 0
              ? [`可加练 ${extraDueReviewAvailable}`, `到期 ${dueNowCount}`]
              : ['计划任务已完成'],
          onPress: () => router.push(WORDS_TODAY_HREF),
        },
      ];
    }

    return planActions.map((action) => ({
      title: action.title,
      detail: action.subtitle,
      actionLabel: action.ctaLabel,
      disabled: action.disabled,
      chips: action.chips,
      onPress: () => handleTodayActionPress(action.actionType, action.ctaLabel, action, action),
    }));
  }, [
    dueNowCount,
    extraDueReviewAvailable,
    handleTodayActionPress,
    learnPlanAction,
    mistakeAction,
    reviewPlanAction,
  ]);
  const extraTaskCards = useMemo(
    () =>
      [reviewExtraAction, learnExtraAction]
        .filter((action) => !action.disabled)
        .map((action) => ({
          title: action.title,
          detail: action.subtitle,
          actionLabel: action.ctaLabel,
          chips: action.chips,
          onPress: () => handleTodayActionPress(action.actionType, action.ctaLabel, action, action),
        })),
    [handleTodayActionPress, learnExtraAction, reviewExtraAction],
  );

  const analysisSummary = useMemo<AnalysisSummaryData | null>(() => {
    if (!hasRealDashboardInsights(dashboardInsights)) return null;

    return {
      weakTags: dashboardInsights.panelAnalysis.weakCategories.slice(0, 3),
      strongTags: dashboardInsights.panelAnalysis.strongCategories.slice(0, 3),
      routes: dashboardInsights.panelAnalysis.recommendations.slice(0, 3).map((item, index) => ({
        title: item.title,
        detail: item.subtitle,
        href: normalizeWordsHref(item.href, recommendationFallbacks[index] ?? '/words/analysis'),
      })),
    };
  }, [dashboardInsights, recommendationFallbacks]);

  const dashboardInsightsPayload = useMemo(
    () => ({
      totalStudied,
      masteredCount,
      mistakeCount,
      dueCount: dueNowCount,
      patternMistakes: dashboardPatternSignals.patternMistakes,
      patternMastered: dashboardPatternSignals.patternMastered,
      topMistakeWords,
      currentBook: focusBookTitle,
      currentBookSlug: focusBookSlug || undefined,
    }),
    [
      dashboardPatternSignals.patternMastered,
      dashboardPatternSignals.patternMistakes,
      dueNowCount,
      focusBookSlug,
      focusBookTitle,
      masteredCount,
      mistakeCount,
      totalStudied,
      topMistakeWords,
    ],
  );

  const insightsFingerprint = useMemo(
    () =>
      buildDashboardInsightsFingerprint({
        dueCount: dueNowCount,
        mistakeCount,
        masteredCount,
        todayNewLearned: todayNewCompleted,
        todayReviewed: todayReviewCompleted,
        activeBookSlug: focusBookSlug,
        activeBookProgress: focusBook?.percentage ?? 0,
      }),
    [dueNowCount, focusBook?.percentage, focusBookSlug, masteredCount, mistakeCount, todayNewCompleted, todayReviewCompleted],
  );

  const analysisUserId = session.session?.user?.id ?? null;
  const analysisBaseReady = canUseVocabularyInsights && Boolean(session.session) && !notebookLoading && !planLoading;

  const loadAnalysisPreview = useCallback(
    async (forceRefresh = false) => {
      if (!session.session || !isLoggedIn) {
        setDashboardInsights(null);
        setAnalysisCardStatus('idle');
        setInsightSavedAt(null);
        return;
      }

      if (!hasInsightSignals) {
        if (!hasRealDashboardInsights(dashboardInsights)) {
          setDashboardInsights(null);
          setAnalysisCardStatus('unavailable');
          setInsightSavedAt(null);
        }
        return;
      }

      if (forceRefresh) {
        setAnalysisRefreshing(true);
      } else {
        setAnalysisCardStatus((current) => (hasRealDashboardInsights(dashboardInsights) || current === 'ready' ? 'ready' : 'loading'));
      }

      const requestKey = `${insightDayKey}|${insightsFingerprint}|${forceRefresh ? 'force' : 'auto'}`;
      const requestPayload = {
        ...dashboardInsightsPayload,
        refresh: forceRefresh,
      };
      lastAnalysisRequestKeyRef.current = requestKey;

      const resolveInsight = (next: VocabularyDashboardInsights | null) => {
        if (lastAnalysisRequestKeyRef.current !== requestKey) return;
        if (hasRealDashboardInsights(next)) {
          const savedAt = Date.now();
          setDashboardInsights(next);
          setAnalysisCardStatus('ready');
          setInsightSavedAt(savedAt);
          if (analysisUserId) {
            void writeCachedVocabularyDashboardInsights(analysisUserId, {
              savedAt,
              dayKey: insightDayKey,
              fingerprint: insightsFingerprint,
              insight: next,
            });
          }
          return;
        }
        if (hasRealDashboardInsights(dashboardInsights)) {
          setAnalysisCardStatus('ready');
          return;
        }
        setDashboardInsights(null);
        setInsightSavedAt(null);
        setAnalysisCardStatus('unavailable');
      };

      try {
        const next = await fetchVocabularyDashboardInsights(session.session, requestPayload);
        resolveInsight(next);
      } catch (error) {
        if (isVocabularyAuthError(error)) {
          const refreshedSession = await session.refreshSession();
          if (refreshedSession) {
            try {
              const retry = await fetchVocabularyDashboardInsights(refreshedSession, requestPayload);
              resolveInsight(retry);
            } catch {
              resolveInsight(null);
            }
          } else {
            resolveInsight(null);
          }
        } else {
          resolveInsight(null);
        }
      } finally {
        setAnalysisRefreshing(false);
      }
    },
    [
      analysisUserId,
      dashboardInsights,
      dashboardInsightsPayload,
      hasInsightSignals,
      insightDayKey,
      insightsFingerprint,
      isLoggedIn,
      session,
      session.session,
    ],
  );

  useEffect(() => {
    let cancelled = false;

    if (!isLoggedIn || !analysisUserId || !analysisBaseReady) {
      if (!isLoggedIn) {
        setDashboardInsights(null);
        setInsightSavedAt(null);
        setAnalysisCardStatus('idle');
      } else if (vocabularyInsightsLocked) {
        setDashboardInsights(null);
        setInsightSavedAt(null);
        setAnalysisCardStatus('unavailable');
      } else if (!vocabularyInsightsAccessResolved) {
        setAnalysisCardStatus(hasRealDashboardInsights(dashboardInsights) ? 'ready' : 'idle');
      }
      setAnalysisCacheHydrated(true);
      return () => {
        cancelled = true;
      };
    }

    setAnalysisCacheHydrated(false);
    void readCachedVocabularyDashboardInsights(analysisUserId)
      .then((cachedEntry) => {
        if (cancelled) return;
        if (
          cachedEntry?.dayKey === insightDayKey &&
          cachedEntry?.fingerprint === insightsFingerprint &&
          hasRealDashboardInsights(cachedEntry.insight)
        ) {
          setDashboardInsights(cachedEntry.insight);
          setAnalysisCardStatus('ready');
          setInsightSavedAt(cachedEntry.savedAt);
          return;
        }
        setDashboardInsights(null);
        setInsightSavedAt(null);
        setAnalysisCardStatus(hasInsightSignals ? 'idle' : 'unavailable');
      })
      .finally(() => {
        if (!cancelled) {
          setAnalysisCacheHydrated(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    analysisBaseReady,
    analysisUserId,
    dashboardInsights,
    hasInsightSignals,
    insightDayKey,
    insightsFingerprint,
    isLoggedIn,
    vocabularyInsightsAccessResolved,
    vocabularyInsightsLocked,
  ]);

  useEffect(() => {
    if (!isLoggedIn) {
      setDashboardInsights(null);
      setAnalysisCardStatus('idle');
      setAnalysisRefreshing(false);
      setAnalysisCacheHydrated(false);
      setInsightSavedAt(null);
      lastAnalysisRequestKeyRef.current = null;
      wasLoggedInRef.current = false;
      return;
    }

    if (!wasLoggedInRef.current) {
      wasLoggedInRef.current = true;
      if (!dashboardInsights) {
        setAnalysisCardStatus('idle');
        lastAnalysisRequestKeyRef.current = null;
      }
    }
  }, [dashboardInsights, isLoggedIn]);

  useEffect(() => {
    if (!analysisBaseReady || !analysisCacheHydrated) return;
    if (!hasInsightSignals) return;
    const autoScopeKey = `${insightDayKey}|${insightsFingerprint}`;
    if (hasRealDashboardInsights(dashboardInsights) && insightSavedAt) {
      lastAnalysisRequestKeyRef.current = autoScopeKey;
      return;
    }
    if (lastAnalysisRequestKeyRef.current === autoScopeKey) return;
    void loadAnalysisPreview(false);
  }, [
    analysisBaseReady,
    analysisCacheHydrated,
    dashboardInsights,
    hasInsightSignals,
    insightDayKey,
    insightSavedAt,
    insightsFingerprint,
    loadAnalysisPreview,
  ]);

  const handleRefreshInsights = useCallback(async () => {
    const ok = await guardEntry('premium_library');
    if (!ok) return;
    await loadAnalysisPreview(true);
  }, [guardEntry, loadAnalysisPreview]);

  const showAnalysisHub = true;
  const handleOpenMyTab = () => {
    router.navigate('/my');
  };
  const tabletPrimaryHref = useMemo(
    () => normalizeWordsHref(today?.recommendedPrimaryHref, learnActionHref),
    [learnActionHref, today?.recommendedPrimaryHref],
  );
  const tabletInsightItems = useMemo(() => {
    if (hasRealDashboardInsights(dashboardInsights)) {
      return [
        { title: dashboardInsights.heroInsight.weaknessInsight },
        { title: dashboardInsights.heroInsight.memoryWindowInsight },
        { title: dashboardInsights.heroInsight.methodInsight },
      ];
    }

    return (plan?.summary.suggestions ?? []).slice(0, 3).map((item) => ({
      title: item.title,
      detail: item.detail,
    }));
  }, [dashboardInsights, plan?.summary.suggestions]);
  const nextReviewAt = useMemo(() => {
    const candidates = words
      .map((word) => word.nextReviewAt)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => Date.parse(left) - Date.parse(right));

    return candidates[0] ?? null;
  }, [words]);
  if (shouldUseTabletLayout) {
    return (
      <WordsScreenTablet
        showGuestState={showGuestState}
        hasAnyData={hasAnyData}
        initialLoading={initialVocabularyLoading}
        combinedError={combinedError}
        focusBookTitle={focusBookTitle}
        todayNewCompleted={todayNewCompleted}
        todayNewPlanned={todayNewPlanned}
        masteryRate={masteryRate}
        dueNowCount={dueNowCount}
        remainingReviewToComplete={remainingReviewToComplete}
        mistakeCount={mistakeCount}
        todayReviewCompleted={todayReviewCompleted}
        todayReviewPlanned={todayReviewPlanned}
        todayMistakeCompleted={todayMistakeCompleted}
        todayMistakePlanned={todayMistakePlanned}
        totalTodayPlanned={todayNewPlanned + todayReviewPlanned + todayMistakePlanned}
        totalTodayCompleted={todayNewCompleted + todayReviewCompleted + todayMistakeCompleted}
        nextReviewAt={nextReviewAt}
        insightItems={tabletInsightItems}
        insightIsFallback={!hasRealDashboardInsights(dashboardInsights)}
        weakTags={analysisSummary?.weakTags ?? []}
        strongTags={analysisSummary?.strongTags ?? []}
        onContinueLearning={() => router.push(tabletPrimaryHref)}
        onOpenTodayPlan={() => router.push(WORDS_TODAY_HREF)}
        onOpenAnalysis={() => router.push('/words/analysis')}
        onOpenBooks={() => router.push('/words/books')}
        onOpenNotebook={() => router.push('/words/my-words')}
        onOpenPlanSettings={() => router.push('/words/plan-settings')}
        onOpenMistakes={() => router.push('/words/mistakes')}
        onOpenMyTab={handleOpenMyTab}
      />
    );
  }

  if (showGuestState) {
    return (
      <AppScreenShell
        showsVerticalScrollIndicator={false}
        headerScrollFade
        title="单词中心"
        rightAction={<TopRightAvatarButton onPress={handleOpenMyTab} />}
      >
          <GuestStateCard />
      </AppScreenShell>
    );
  }

  if (combinedError && !hasAnyData) {
    return (
      <AppScreenShell
        showsVerticalScrollIndicator={false}
        headerScrollFade
        title="单词中心"
        rightAction={<TopRightAvatarButton onPress={handleOpenMyTab} />}
      >
          <View
            style={{
              marginHorizontal: PAGE_PADDING,
              borderRadius: CARD_RADIUS,
              backgroundColor: colors.cardBackground,
              borderWidth: 1,
              borderColor: colors.border,
              padding: 20,
              gap: 10,
            }}
          >
            <AppText style={{ fontSize: FONT_TITLE, fontWeight: '700', color: colors.textPrimary }}>首页数据暂时不可用</AppText>
            <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 22, color: colors.textSecondary }}>
              当前暂时无法加载单词数据，请稍后重试。
            </AppText>
            <AppText style={{ fontSize: FONT_CAPTION, color: colors.textSecondary }}>{combinedError}</AppText>
          </View>
      </AppScreenShell>
    );
  }

  return (
    <AppScreenShell
      showsVerticalScrollIndicator={false}
      headerScrollFade
      title="单词中心"
      rightAction={<TopRightAvatarButton onPress={handleOpenMyTab} />}
    >
        <View
          style={{
            marginHorizontal: PAGE_PADDING,
            borderRadius: HERO_RADIUS,
            backgroundColor: HERO_BG,
            padding: 24,
            overflow: 'hidden',
            gap: 0,
            minHeight: 376,
          }}
        >
          <View style={{ ...StyleSheetFill, backgroundColor: HERO_BG }} />
          <View
            style={{
              position: 'absolute',
              top: -20,
              right: -12,
              width: 208,
              height: 208,
              borderRadius: 999,
              backgroundColor: '#325BFF',
              opacity: 0.09,
            }}
          />
          <View
            style={{
              position: 'absolute',
              bottom: -36,
              left: -16,
              width: 168,
              height: 168,
              borderRadius: 999,
              backgroundColor: '#6E5CFF',
              opacity: 0.07,
            }}
          />

          <DarkChip label="AI 个性化学习" />

          <AppText style={{ fontSize: 22, lineHeight: 30, fontWeight: '700', color: HERO_TEXT_PRIMARY, marginTop: 18 }} numberOfLines={2}>
            {heroState.title}
          </AppText>

          <AppText style={{ fontSize: 15, lineHeight: 24, fontWeight: '400', color: 'rgba(255,255,255,0.74)', marginTop: 18 }} numberOfLines={2}>
            {heroState.description}
          </AppText>

          <View style={{ gap: 12, marginTop: 22 }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <HeroActionCard
                title={
                  dueNowCount > 0 && remainingReviewToComplete > 0
                    ? '复习到期词'
                    : dueNowCount > 0 && reviewExtraAction.disabled === false
                      ? '继续加练'
                      : '暂无到期'
                }
                subtitle={
                  dueNowCount > 0 && remainingReviewToComplete > 0
                    ? `计划内还剩 ${remainingReviewToComplete} 个`
                    : dueNowCount > 0 && reviewExtraAction.disabled === false
                      ? `还有 ${extraDueReviewAvailable} 个到期词可继续加练`
                      : '当前没有额外到期词'
                }
                disabled={dueNowCount <= 0}
                onPress={
                  dueNowCount > 0 && remainingReviewToComplete > 0
                    ? () => handleTodayActionPress(reviewPlanAction.actionType, reviewPlanAction.ctaLabel, reviewPlanAction, reviewPlanAction)
                    : reviewExtraAction.disabled
                      ? undefined
                      : () => handleTodayActionPress(reviewExtraAction.actionType, reviewExtraAction.ctaLabel, reviewExtraAction, reviewExtraAction)
                }
              />
              <HeroActionCard
                title={remainingNewToLearn > 0 ? learnPlanAction.ctaLabel : learnExtraAction.ctaLabel}
                subtitle={remainingNewToLearn > 0 ? learnPlanAction.subtitle : learnExtraAction.subtitle}
                disabled={(remainingNewToLearn > 0 ? learnPlanAction : learnExtraAction).disabled}
                onPress={
                  (remainingNewToLearn > 0 ? learnPlanAction : learnExtraAction).disabled
                    ? undefined
                    : () => {
                        const action = remainingNewToLearn > 0 ? learnPlanAction : learnExtraAction;
                        handleTodayActionPress(action.actionType, action.ctaLabel, action, action);
                      }
                }
              />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
              <Pressable onPress={() => router.push(WORDS_TODAY_HREF)} style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1, alignSelf: 'flex-start' })}>
                <AppText style={{ fontSize: 14, fontWeight: '600', color: HERO_TEXT_SECONDARY }}>查看今日计划</AppText>
              </Pressable>
              <Pressable onPress={() => router.push('/words/plan-settings')} style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1, alignSelf: 'flex-start' })}>
                <AppText style={{ fontSize: 14, fontWeight: '600', color: ACTION_BLUE }}>调整计划</AppText>
              </Pressable>
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: 0, paddingTop: 22, marginTop: 'auto' }}>
            {heroSummary.map((item, index) => (
              <View key={item.label} style={{ flex: 1, flexDirection: 'row', alignItems: 'stretch' }}>
                <HeroSummaryColumn
                  label={item.label}
                  value={item.value}
                  note={item.note}
                  actionLabel={item.actionLabel}
                  onPress={item.actionHref ? () => router.push(item.actionHref as never) : undefined}
                />
                {index < heroSummary.length - 1 ? (
                  <View
                    style={{
                      width: 1,
                      height: '68%',
                      alignSelf: 'center',
                      backgroundColor: 'rgba(255,255,255,0.06)',
                      marginHorizontal: 14,
                    }}
                  />
                ) : null}
              </View>
            ))}
          </View>
        </View>

        <View style={{ height: SECTION_GAP }} />

        <SectionTitle title="AI 洞察" action={<InsightButton label={analysisRefreshing ? '更新中' : '更新洞察'} onPress={() => void handleRefreshInsights()} disabled={analysisRefreshing} />} />
        <View
          style={{
            marginTop: 14,
            marginHorizontal: PAGE_PADDING,
            borderRadius: 26,
            backgroundColor: colors.cardBackground,
            paddingHorizontal: 22,
            paddingTop: 18,
            paddingBottom: 20,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          {!vocabularyInsightsAccessResolved ? (
            <View style={{ minHeight: 102, justifyContent: 'flex-start', gap: 6, paddingTop: 2 }}>
              <AppText style={{ fontSize: 16, lineHeight: 24, fontWeight: '600', color: colors.textPrimary }}>
                正在同步完整学习权益
              </AppText>
              <AppText style={{ fontSize: 14, lineHeight: 22, color: colors.textSecondary }}>
                权益确认完成后，这里才会决定是否展示你的个性化 AI 洞察。
              </AppText>
            </View>
          ) : vocabularyInsightsLocked ? (
            <View style={{ minHeight: 102, justifyContent: 'flex-start', gap: 6, paddingTop: 2 }}>
              <AppText style={{ fontSize: 16, lineHeight: 24, fontWeight: '600', color: colors.textPrimary }}>
                开通后查看 AI 个性化洞察
              </AppText>
              <AppText style={{ fontSize: 14, lineHeight: 22, color: colors.textSecondary }}>
                单词 AI 洞察属于完整学习权益。开通后会基于你的学习记录生成个性化建议。
              </AppText>
            </View>
          ) : analysisCardStatus === 'loading' && !hasRealDashboardInsights(dashboardInsights) ? (
            <View style={{ minHeight: 108, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={colors.textSecondary} />
            </View>
          ) : !hasRealDashboardInsights(dashboardInsights) ? (
            <View style={{ minHeight: 102, justifyContent: 'flex-start', gap: 6, paddingTop: 2 }}>
              <AppText style={{ fontSize: 16, lineHeight: 24, fontWeight: '600', color: colors.textPrimary }}>
                {hasInsightSignals ? '暂时无法生成洞察' : '需要更多学习记录后生成'}
              </AppText>
              <AppText style={{ fontSize: 14, lineHeight: 22, color: colors.textSecondary }}>
                {hasInsightSignals
                  ? '洞察还在整理中，先继续完成今天最重要的学习任务。'
                  : '完成几轮新词或复习后，这里会基于你的学习记录生成稳定洞察。'}
              </AppText>
            </View>
          ) : (
            <>
              {insightItems.map((item, index) => (
                <InsightItemRow key={`${item.title}-${index}`} item={item} isLast={index === insightItems.length - 1} />
              ))}
              <AppText style={{ marginTop: 10, marginBottom: 12, fontSize: 12, lineHeight: 18, fontWeight: '400', color: colors.textMuted }}>
                {buildInsightsMetaLabel(insightSavedAt ?? undefined)}
              </AppText>
            </>
          )}
          <View style={{ height: 1, backgroundColor: colors.divider, marginTop: 10, marginBottom: 14 }} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 }}>
            {stateCards.map((item) => (
              <StateCard key={item.title} title={item.title} value={item.value} note={item.note} color={item.color} />
            ))}
          </View>
        </View>

        <View style={{ height: SECTION_GAP }} />

        <SectionTitle title="今日先做什么" subtitle="按学习计划顺序推进，和今日计划页保持同一口径。" />
        <View style={{ marginTop: 14, paddingHorizontal: PAGE_PADDING, gap: 14 }}>
          {primaryTaskCards.map((item, index) => (
            <TaskActionCard
              key={`${item.title}-${index}`}
              title={item.title}
              detail={item.detail}
              onPress={item.onPress}
              actionLabel={item.actionLabel}
              chips={item.chips}
              disabled={item.disabled}
            />
          ))}
        </View>

        {extraTaskCards.length ? (
          <>
            <View style={{ height: SECTION_GAP }} />
            <SectionTitle title="继续训练" subtitle="今日计划之外，你仍然可以继续推进新词或加练到期词。" />
            <View style={{ marginTop: 14, paddingHorizontal: PAGE_PADDING, gap: 14 }}>
              {extraTaskCards.map((card, index) => (
                <TaskActionCard
                  key={`${card.title}-${index}`}
                  title={card.title}
                  detail={card.detail}
                  onPress={card.onPress}
                  actionLabel={card.actionLabel}
                  chips={card.chips}
                />
              ))}
            </View>
          </>
        ) : null}

        {showAnalysisHub ? (
          <>
            <View style={{ height: SECTION_GAP }} />
            <SectionTitle title="AI 学习分析摘要" />
            <View
              style={{
                marginTop: 14,
                marginHorizontal: PAGE_PADDING,
                borderRadius: 26,
                backgroundColor: colors.cardBackground,
                borderWidth: 1,
                borderColor: colors.border,
                padding: 22,
                gap: 18,
              }}
            >
              <View style={{ gap: 4 }}>
                <AppText style={{ fontSize: 18, lineHeight: 25, fontWeight: '700', color: colors.textPrimary }}>AI 学习分析</AppText>
                <AppText style={{ fontSize: 14, lineHeight: 22, color: colors.textSecondary }}>基于今日学习数据生成，帮助你判断下一步节奏。</AppText>
              </View>

              {!vocabularyInsightsAccessResolved ? (
                <View style={{ minHeight: 220, justifyContent: 'center', gap: 10 }}>
                  <AppText style={{ fontSize: 18, lineHeight: 25, fontWeight: '700', color: colors.textPrimary }}>AI 学习分析</AppText>
                  <AppText style={{ fontSize: 14, lineHeight: 22, color: colors.textSecondary }}>
                    正在同步完整学习权益，确认后会继续载入你的个性化分析摘要。
                  </AppText>
                  <GradientButton label="去学习分析" onPress={() => router.push('/words/analysis')} />
                </View>
              ) : vocabularyInsightsLocked ? (
                <View style={{ minHeight: 220, justifyContent: 'center', gap: 10 }}>
                  <AppText style={{ fontSize: 18, lineHeight: 25, fontWeight: '700', color: colors.textPrimary }}>AI 学习分析</AppText>
                  <AppText style={{ fontSize: 14, lineHeight: 22, color: colors.textSecondary }}>
                    开通完整学习权益后，这里会基于你的单词记录生成 AI 学习分析。
                  </AppText>
                  <View style={{ marginTop: 4, borderRadius: 20, backgroundColor: colors.secondaryCardBackground, padding: 18, gap: 10 }}>
                    <AppText style={{ fontSize: 16, fontWeight: '600', color: colors.textPrimary }}>当前功能属于完整学习权益</AppText>
                    <AppText style={{ fontSize: 14, lineHeight: 22, color: colors.textSecondary }}>
                      开通后可查看薄弱项、掌握较好项和下一步训练建议。
                    </AppText>
                  </View>
                  <GradientButton label="去学习分析" onPress={() => router.push('/words/analysis')} />
                </View>
              ) : !analysisSummary && analysisCardStatus === 'loading' ? (
                <View style={{ minHeight: 220, alignItems: 'center', justifyContent: 'center' }}>
                  <ActivityIndicator color={colors.textSecondary} />
                </View>
              ) : analysisSummary ? (
                <>
                  <View style={{ gap: 10 }}>
                    <AppText style={{ fontSize: 14, fontWeight: '600', color: colors.textSecondary }}>当前薄弱项</AppText>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {analysisSummary.weakTags.map((item) => (
                        <View
                          key={`weak-${item}`}
                          style={{
                            borderRadius: 999,
                            paddingHorizontal: 12,
                            paddingVertical: 7,
                            backgroundColor: 'rgba(124,108,255,0.08)',
                          }}
                        >
                          <AppText style={{ fontSize: 13, fontWeight: '600', color: LIGHT_PURPLE }}>{item}</AppText>
                        </View>
                      ))}
                    </View>
                  </View>

                  <View style={{ gap: 10 }}>
                    <AppText style={{ fontSize: 14, fontWeight: '600', color: colors.textSecondary }}>掌握较好</AppText>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {analysisSummary.strongTags.map((item) => (
                        <View
                          key={`strong-${item}`}
                          style={{
                            borderRadius: 999,
                            paddingHorizontal: 12,
                            paddingVertical: 7,
                            backgroundColor: COLOR_GREEN_BG,
                          }}
                        >
                          <AppText style={{ fontSize: 13, fontWeight: '600', color: COLOR_GREEN }}>{item}</AppText>
                        </View>
                      ))}
                    </View>
                  </View>

                  <View style={{ gap: 0 }}>
                    {analysisSummary.routes.map((item, index) => (
                      <View
                        key={`${item.title}-${index}`}
                        style={{
                          paddingVertical: 14,
                          borderBottomWidth: index === analysisSummary.routes.length - 1 ? 0 : 0.5,
                          borderBottomColor: colors.divider,
                          gap: 4,
                        }}
                      >
                        <AppText style={{ fontSize: 16, lineHeight: 24, fontWeight: '600', color: colors.textPrimary }}>{item.title}</AppText>
                        <AppText style={{ fontSize: 14, lineHeight: 22, color: colors.textSecondary }}>{item.detail}</AppText>
                      </View>
                    ))}
                  </View>

                  <GradientButton label="去学习分析" onPress={() => router.push('/words/analysis')} />
                </>
              ) : (
                <View style={{ minHeight: 220, justifyContent: 'center', gap: 10 }}>
                  <AppText style={{ fontSize: 18, lineHeight: 25, fontWeight: '700', color: colors.textPrimary }}>AI 学习分析</AppText>
                  <AppText style={{ fontSize: 14, lineHeight: 22, color: colors.textSecondary }}>
                    {hasInsightSignals ? '学习解读还在整理中，稍后会补充到这里。' : '需要更多学习记录后生成。'}
                  </AppText>
                  <View style={{ marginTop: 4, borderRadius: 20, backgroundColor: colors.secondaryCardBackground, padding: 18, gap: 10 }}>
                    <AppText style={{ fontSize: 16, fontWeight: '600', color: colors.textPrimary }}>
                      {hasInsightSignals ? '分析稍后更新，先按今日主任务推进' : '先完成几轮学习，再回来查看'}
                    </AppText>
                    <AppText style={{ fontSize: 14, lineHeight: 22, color: colors.textSecondary }}>
                      {hasInsightSignals
                        ? '当前还在等待更稳定的训练建议，先完成今天最该处理的部分会更合适。'
                        : '当你有更多复习、新词或错词记录后，这里会稳定生成个性化分析。'}
                    </AppText>
                  </View>
                  <GradientButton label="去学习分析" onPress={() => router.push('/words/analysis')} />
                </View>
              )}
            </View>
          </>
        ) : null}

        <View style={{ height: SECTION_GAP }} />

        <SectionTitle
          title="更多入口"
          subtitle="继续查看学习计划、词库、错词、报告、分析和词书中心。"
          titleStyle={{ fontSize: 18, lineHeight: 24, fontWeight: '600' }}
          subtitleStyle={{ fontSize: 13, lineHeight: 20, color: SECTION_SUBTITLE_MUTED }}
        />
        <View
          style={{
            marginTop: 14,
            paddingHorizontal: PAGE_PADDING,
            flexDirection: 'row',
            flexWrap: 'wrap',
            justifyContent: 'flex-start',
            columnGap: 14,
            rowGap: 14,
          }}
        >
          {NAV_ITEMS.map((item) => (
            <NavigationCard key={item.title} title={item.title} detail={item.detail} href={item.href} />
          ))}
        </View>
    </AppScreenShell>
  );
}
