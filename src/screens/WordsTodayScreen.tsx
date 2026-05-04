import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { BackLink } from '@/components/ui/BackLink';
import { SurfaceCard } from '@/components/ui/ApplePrimitives';
import { useDeviceClass } from '@/hooks/useDeviceClass';
import { useVocabularyTodayPlanData } from '@/hooks/useVocabularyTodayPlanData';
import { safeBack } from '@/navigation/safeBack';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import {
  getVocabularyTodayRemainingCounts,
  resolveVocabularyTodayActionRoute,
  type VocabularyTodayActionType,
  type VocabularyTodayResolvedRoute,
} from '@/services/vocabularyTodayActions';
import {
  ACCENT,
  BG_CARD,
  BG_CARD_SOFT,
  BG_HERO,
  BG_HERO_BTN_SEC,
  BORDER_SOFT,
  COLOR_AMBER_BG,
  COLOR_BLUE,
  COLOR_BLUE_BG,
  COLOR_GREEN,
  COLOR_GREEN_BG,
  COLOR_RED,
  COLOR_RED_BG,
  FONT_BODY,
  FONT_CALLOUT,
  FONT_CAPTION,
  FONT_MICRO,
  FONT_TITLE,
  RADIUS_BTN,
  RADIUS_CARD,
  RADIUS_HERO,
  SEPARATOR,
  SPACING_PAGE_H,
  TEXT_ON_DARK,
  TEXT_ON_DARK_DIM,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from '@/theme/tokens';
import { useThemeColors } from '@/theme/useThemeColors';

const PAGE_PADDING = 24;
const TABLET_PAGE_MAX_WIDTH = 1180;

function buildMinuteRange(estimatedMinutes: number) {
  const safe = Math.max(estimatedMinutes, 20);
  const start = Math.max(15, Math.floor((safe - 8) / 5) * 5);
  const end = Math.ceil((safe + 7) / 5) * 5;
  return `${start}–${end} 分钟`;
}

function buildMainHeadline(dueNowCount: number, remainingReview: number, mistakeCount: number, remainingNew: number) {
  if (dueNowCount > 0 && remainingReview > 0) return `先处理 ${remainingReview} 个计划内到期词`;
  if (dueNowCount > 0) return '今日计划内复习已完成';
  if (mistakeCount > 0) return `先强化 ${mistakeCount} 个错词`;
  if (remainingNew > 0) return `先推进 ${remainingNew} 个新词`;
  return '今日任务已完成';
}

function getReviewHeroAction(
  remainingReview: number,
  reviewAction: VocabularyTodayResolvedRoute,
  reviewExtraAction: VocabularyTodayResolvedRoute,
) {
  if (remainingReview > 0) return reviewAction;
  return reviewExtraAction;
}

function buildRawActionPreview(action: unknown) {
  try {
    return JSON.stringify(action).slice(0, 300);
  } catch {
    return '[unserializable]';
  }
}

function TaskActionButton({
  label,
  tone,
  onPress,
  disabled = false,
}: {
  label: string;
  tone: 'accent' | 'neutral';
  onPress?: () => void;
  disabled?: boolean;
}) {
  const { colors } = useThemeColors();

  return (
    <Pressable
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        minWidth: 68,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tone === 'accent' ? COLOR_AMBER_BG : colors.chipBackground,
        opacity: disabled ? 0.46 : pressed ? 0.76 : 1,
      })}
    >
      <AppText
        style={{
          fontSize: FONT_CAPTION,
          fontWeight: '600',
          color: colors.textPrimary,
        }}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

function TaskRow({
  icon,
  iconColor,
  iconBackground,
  title,
  detail,
  actionLabel,
  actionTone,
  onPress,
  disabled = false,
  isLast = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBackground: string;
  title: string;
  detail: string;
  actionLabel: string;
  actionTone: 'accent' | 'neutral';
  onPress?: () => void;
  disabled?: boolean;
  isLast?: boolean;
}) {
  const { colors } = useThemeColors();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingHorizontal: 18,
        paddingVertical: 16,
        borderBottomWidth: isLast ? 0 : 0.5,
        borderBottomColor: colors.divider,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 12,
          backgroundColor: iconBackground,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>

      <View style={{ flex: 1, gap: 3 }}>
        <AppText style={{ fontSize: FONT_BODY, fontWeight: '600', color: colors.textPrimary }}>{title}</AppText>
        <AppText numberOfLines={2} style={{ fontSize: FONT_CAPTION, lineHeight: 17, color: colors.textSecondary }}>
          {detail}
        </AppText>
      </View>

      <TaskActionButton label={actionLabel} tone={actionTone} onPress={onPress} disabled={disabled} />
    </View>
  );
}

function SummaryTile({
  label,
  value,
  note,
  backgroundColor,
}: {
  label: string;
  value: string;
  note: string;
  backgroundColor: string;
}) {
  const { colors } = useThemeColors();

  return (
    <View
      style={{
        width: '48.4%',
        borderRadius: RADIUS_CARD,
        backgroundColor,
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 4,
      }}
    >
      <AppText style={{ fontSize: FONT_CAPTION, color: colors.textSecondary }}>{label}</AppText>
      <AppText style={{ fontSize: 24, fontWeight: '700', letterSpacing: -0.6, color: colors.textPrimary }}>{value}</AppText>
      <AppText numberOfLines={1} style={{ fontSize: FONT_CAPTION, color: colors.textSecondary }}>
        {note}
      </AppText>
    </View>
  );
}

function PlaceholderLine({
  width,
  height = 12,
}: {
  width: number | `${number}%`;
  height?: number;
}) {
  const { colors } = useThemeColors();

  return (
    <View
      style={{
        width,
        height,
        borderRadius: 999,
        backgroundColor: colors.border,
      }}
    />
  );
}

function TodayPlanPlaceholder() {
  const { colors } = useThemeColors();

  return (
    <>
      <View
        style={{
          marginHorizontal: PAGE_PADDING,
          marginBottom: 24,
          borderRadius: RADIUS_HERO,
          backgroundColor: BG_HERO,
          padding: 20,
          gap: 18,
        }}
      >
        <View
          style={{
            alignSelf: 'flex-start',
            width: 94,
            height: 24,
            borderRadius: 999,
            backgroundColor: COLOR_AMBER_BG,
          }}
        />
        <View style={{ gap: 8 }}>
          <PlaceholderLine width="58%" height={28} />
          <PlaceholderLine width="66%" height={16} />
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1, minHeight: 50, borderRadius: RADIUS_BTN, backgroundColor: BG_HERO_BTN_SEC }} />
          <View style={{ flex: 1, minHeight: 50, borderRadius: RADIUS_BTN, backgroundColor: COLOR_AMBER_BG }} />
        </View>
      </View>

      <SectionTitle title="今日推荐任务" />
      <View
        style={{
          marginHorizontal: PAGE_PADDING,
          marginBottom: 24,
          borderRadius: RADIUS_CARD + 4,
          backgroundColor: colors.cardBackground,
          borderWidth: 1,
          borderColor: colors.border,
          overflow: 'hidden',
        }}
      >
        {[0, 1, 2].map((index) => (
          <View
            key={index}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              paddingHorizontal: 18,
              paddingVertical: 16,
              borderBottomWidth: index === 2 ? 0 : 0.5,
              borderBottomColor: colors.divider,
            }}
          >
            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.secondaryCardBackground }} />
            <View style={{ flex: 1, gap: 8 }}>
              <PlaceholderLine width="48%" />
              <PlaceholderLine width="74%" />
            </View>
            <View style={{ width: 72, height: 38, borderRadius: 12, backgroundColor: colors.secondaryCardBackground }} />
          </View>
        ))}
      </View>

      <SectionTitle title="今日摘要" />
      <View
        style={{
          marginHorizontal: PAGE_PADDING,
          marginBottom: 24,
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          rowGap: 10,
        }}
      >
        {[0, 1, 2, 3].map((index) => (
          <View
            key={index}
            style={{
              width: '48.4%',
              borderRadius: RADIUS_CARD,
              backgroundColor: index % 2 === 0 ? colors.cardBackground : colors.secondaryCardBackground,
              borderWidth: 1,
              borderColor: colors.border,
              paddingHorizontal: 16,
              paddingVertical: 14,
              gap: 8,
            }}
          >
            <PlaceholderLine width="44%" />
            <PlaceholderLine width="34%" height={24} />
            <PlaceholderLine width="60%" />
          </View>
        ))}
      </View>
    </>
  );
}

function buildCompletionNote(completed: number, planned: number) {
  if (planned <= 0) return `已完成 ${completed}`;
  return `已完成 ${completed} / ${planned}`;
}

function toneToDotColor(tone: 'blue' | 'amber' | 'green' | 'red') {
  if (tone === 'red') return COLOR_RED;
  if (tone === 'green') return COLOR_GREEN;
  if (tone === 'blue') return COLOR_BLUE;
  return ACCENT;
}

function AdviceRow({
  dotColor,
  title,
  detail,
  isLast = false,
}: {
  dotColor: string;
  title: string;
  detail?: string;
  isLast?: boolean;
}) {
  const { colors } = useThemeColors();

  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 12,
        paddingHorizontal: 18,
        paddingVertical: 15,
        borderBottomWidth: isLast ? 0 : 0.5,
        borderBottomColor: colors.divider,
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          backgroundColor: dotColor,
          marginTop: 6,
        }}
      />
      <View style={{ flex: 1, gap: 3 }}>
        <AppText style={{ fontSize: FONT_BODY, fontWeight: '600', color: colors.textPrimary }}>{title}</AppText>
        {detail ? (
          <AppText numberOfLines={1} style={{ fontSize: FONT_CAPTION, color: colors.textSecondary }}>
            {detail}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

function SectionTitle({ title }: { title: string }) {
  const { colors } = useThemeColors();

  return (
    <View style={{ paddingHorizontal: PAGE_PADDING, paddingBottom: 10 }}>
      <AppText
        style={{
          fontSize: FONT_TITLE,
          fontWeight: '700',
          letterSpacing: -0.4,
          color: colors.textPrimary,
        }}
      >
        {title}
      </AppText>
    </View>
  );
}

function GuestPanel() {
  const session = useAppSession();
  const { colors } = useThemeColors();
  const isExpired = session.authStateReason === 'expired';

  return (
    <View
      style={{
        marginHorizontal: PAGE_PADDING,
        borderRadius: RADIUS_HERO,
        backgroundColor: BG_HERO,
        padding: 20,
        gap: 16,
      }}
    >
      <AppText style={{ fontSize: 26, fontWeight: '700', lineHeight: 32, color: TEXT_ON_DARK }}>
        {isExpired ? '重新登录后继续今日计划' : '登录后查看今日计划'}
      </AppText>
      <AppText style={{ fontSize: FONT_CALLOUT, color: TEXT_ON_DARK_DIM, lineHeight: 20 }}>
        {isExpired
          ? '请重新登录以继续同步今天的学习安排、新词进度和复习记录。'
          : '登录后即可同步今天的学习安排、新词进度和复习记录。'}
      </AppText>
      <Pressable
        onPress={() => router.push('/auth/sign-in')}
        style={({ pressed }) => ({
          borderRadius: RADIUS_BTN,
          backgroundColor: colors.cardBackground,
          alignItems: 'center',
          paddingVertical: 15,
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <AppText style={{ fontSize: 16, fontWeight: '600', color: colors.textPrimary }}>{isExpired ? '重新登录' : '去登录'}</AppText>
      </Pressable>
    </View>
  );
}

export function WordsTodayScreen() {
  const session = useAppSession();
  const { colors } = useThemeColors();
  const { isTablet } = useDeviceClass();
  const { plan, loading, error, authRequired, refresh } = useVocabularyTodayPlanData();
  const isLoggedIn = session.status === 'authenticated';

  useFocusEffect(
    useCallback(() => {
      if (session.status === 'authenticated') {
        void refresh();
      }
      return undefined;
    }, [refresh, session.status]),
  );

  if (session.isHydrating) {
    return (
      <AppScreenShell scrollable={false} includeBottomInset={false} disableTabletTopInset={isTablet}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      </AppScreenShell>
    );
  }

  if (!isLoggedIn || authRequired) {
    return (
      <AppScreenShell
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        includeBottomInset={false}
        disableTabletTopInset={isTablet}
      >
          <View style={{ width: '100%', maxWidth: isTablet ? TABLET_PAGE_MAX_WIDTH : undefined, alignSelf: 'center' }}>
          <View style={{ paddingHorizontal: PAGE_PADDING, paddingTop: isTablet ? 8 : 16, paddingBottom: 12 }}>
            <BackLink label="单词中心" onPress={() => safeBack()} />
          </View>
          <GuestPanel />
          </View>
      </AppScreenShell>
    );
  }

  if (loading && !plan) {
    return (
      <AppScreenShell
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        includeBottomInset={false}
        disableTabletTopInset={isTablet}
      >
          <View style={{ width: '100%', maxWidth: isTablet ? TABLET_PAGE_MAX_WIDTH : undefined, alignSelf: 'center' }}>
          <View style={{ paddingHorizontal: PAGE_PADDING, paddingTop: isTablet ? 8 : 16, paddingBottom: 12 }}>
            <BackLink label="单词中心" onPress={() => safeBack()} />
          </View>
          <TodayPlanPlaceholder />
          </View>
      </AppScreenShell>
    );
  }

  if (!plan) {
    return (
      <AppScreenShell
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        includeBottomInset={false}
        disableTabletTopInset={isTablet}
      >
          <View style={{ width: '100%', maxWidth: isTablet ? TABLET_PAGE_MAX_WIDTH : undefined, alignSelf: 'center' }}>
          <View style={{ paddingHorizontal: PAGE_PADDING, paddingTop: isTablet ? 8 : 16, paddingBottom: 12 }}>
            <BackLink label="单词中心" onPress={() => safeBack()} />
          </View>
          <SurfaceCard style={{ marginHorizontal: PAGE_PADDING, padding: 20 }}>
            <View style={{ gap: 14 }}>
              <AppText style={{ fontSize: 24, fontWeight: '700', color: colors.textPrimary }}>
                {error ? '计划加载失败' : '今天还没有可执行计划'}
              </AppText>
              <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: colors.textSecondary }}>
                {error ? '请重试一次。如果问题持续存在，再稍后回来查看。' : '当前还没有生成今日计划，可以稍后重试。'}
              </AppText>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable
                  onPress={() => void refresh()}
                  style={({ pressed }) => ({
                    flex: 1,
                    borderRadius: RADIUS_BTN,
                    backgroundColor: colors.cardBackground,
                    borderWidth: 1,
                    borderColor: colors.border,
                    alignItems: 'center',
                    paddingVertical: 15,
                    opacity: pressed ? 0.75 : 1,
                  })}
                >
                  <AppText style={{ fontSize: 16, fontWeight: '600', color: colors.textPrimary }}>重试</AppText>
                </Pressable>
                <Pressable
                  onPress={() => router.replace('/words')}
                  style={({ pressed }) => ({
                    flex: 1,
                    borderRadius: RADIUS_BTN,
                    backgroundColor: BG_HERO,
                    alignItems: 'center',
                    paddingVertical: 15,
                    opacity: pressed ? 0.75 : 1,
                  })}
                >
                  <AppText style={{ fontSize: 16, fontWeight: '600', color: TEXT_ON_DARK }}>回单词中心</AppText>
                </Pressable>
              </View>
            </View>
          </SurfaceCard>
          </View>
      </AppScreenShell>
    );
  }

  const { today, backlog, focusBook } = plan.summary;
  const minuteRange = buildMinuteRange(today.estimatedMinutes);
  const mistakeCount = Math.max(backlog.mistakeCount, today.todayMistakePlanned);
  const taskBookTitle = focusBook.title || today.recommendedBookTitle || '四级核心词汇';
  const remainingCounts = getVocabularyTodayRemainingCounts({
    dueNowCount: backlog.dueNowCount,
    mistakeCount: backlog.mistakeCount,
    plannedNew: today.todayNewPlanned,
    plannedReview: today.todayReviewPlanned,
    plannedMistake: today.todayMistakePlanned,
    completedNew: today.todayNewCompleted,
    completedReview: today.todayReviewCompleted,
    completedMistake: today.todayMistakeCompleted,
    remainingNew: today.remainingNew,
    remainingReview: today.remainingReview,
    remainingMistake: today.remainingMistake,
    extraDueReviewAvailable: today.extraDueReviewAvailable,
    focusBookSlug: focusBook.slug || undefined,
  });
  const todayActionContext = {
    dueNowCount: backlog.dueNowCount,
    mistakeCount: backlog.mistakeCount,
    plannedNew: today.todayNewPlanned,
    plannedReview: today.todayReviewPlanned,
    plannedMistake: today.todayMistakePlanned,
    completedNew: today.todayNewCompleted,
    completedReview: today.todayReviewCompleted,
    completedMistake: today.todayMistakeCompleted,
    remainingNew: today.remainingNew,
    remainingReview: today.remainingReview,
    remainingMistake: today.remainingMistake,
    extraDueReviewAvailable: today.extraDueReviewAvailable,
    focusBookSlug: focusBook.slug || undefined,
    focusBookRemainingWords: focusBook.remainingWords ?? 0,
  } as const;
  const mistakeAction = resolveVocabularyTodayActionRoute(
    { actionType: 'mistake_review', source: 'plan', focusBookSlug: focusBook.slug || undefined },
    todayActionContext,
  );
  const reviewAction = resolveVocabularyTodayActionRoute(
    { actionType: 'review_plan', source: 'plan', focusBookSlug: focusBook.slug || undefined },
    todayActionContext,
  );
  const reviewExtraAction = resolveVocabularyTodayActionRoute(
    { actionType: 'review_extra', source: 'extra', focusBookSlug: focusBook.slug || undefined },
    todayActionContext,
  );
  const learnPlanAction = resolveVocabularyTodayActionRoute(
    { actionType: 'learn_plan', source: 'plan', focusBookSlug: focusBook.slug || undefined },
    todayActionContext,
  );
  const learnExtraAction = resolveVocabularyTodayActionRoute(
    { actionType: 'learn_extra', source: 'extra', focusBookSlug: focusBook.slug || undefined },
    todayActionContext,
  );
  const suggestions = plan.summary.suggestions.slice(0, 3);
  const fallbackSuggestions = [
    {
      title: '今天的系统建议暂时不可用',
      detail: '建议摘要还没有成功返回，先按今日主动作继续推进。',
      tone: 'amber' as const,
    },
  ];
  const displayedSuggestions = suggestions.length > 0 ? suggestions : fallbackSuggestions;
  const heroReviewAction = getReviewHeroAction(remainingCounts.remainingReview, reviewAction, reviewExtraAction);
  const handleTodayActionPress = useCallback(
    (actionType: VocabularyTodayActionType, actionLabel: string, resolvedRoute: VocabularyTodayResolvedRoute, rawAction: unknown) => {
      console.log('vocabulary_training_action_resolved', {
        actionType,
        mode: resolvedRoute.mode,
        source: resolvedRoute.source,
        disabled: resolvedRoute.disabled,
        disabledReason: resolvedRoute.disabledReason,
        remainingNew: remainingCounts.remainingNew,
        remainingReview: remainingCounts.remainingReview,
        dueNowCount: backlog.dueNowCount,
        extraDueReviewAvailable: reviewExtraAction.extraAvailableCount,
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
    [backlog.dueNowCount, mistakeCount, remainingCounts.remainingNew, remainingCounts.remainingReview, reviewExtraAction.extraAvailableCount],
  );

  return (
    <AppScreenShell
      contentContainerStyle={{ paddingBottom: 28 }}
      showsVerticalScrollIndicator={false}
      includeBottomInset={false}
      disableTabletTopInset={isTablet}
    >
      <View style={{ width: '100%', maxWidth: isTablet ? TABLET_PAGE_MAX_WIDTH : undefined, alignSelf: 'center' }}>
        <View style={{ paddingHorizontal: PAGE_PADDING, paddingTop: isTablet ? 8 : 16, paddingBottom: 12 }}>
          <BackLink label="单词中心" onPress={() => safeBack()} />
        </View>

        <View
          style={{
            marginHorizontal: PAGE_PADDING,
            marginBottom: 24,
            borderRadius: RADIUS_HERO,
            backgroundColor: BG_HERO,
            padding: 20,
            gap: 18,
          }}
        >
          <View
            style={{
              alignSelf: 'flex-start',
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 5,
              backgroundColor: COLOR_AMBER_BG,
            }}
          >
            <AppText style={{ fontSize: FONT_MICRO, fontWeight: '700', color: ACCENT }}>今日学习主动作</AppText>
          </View>

          <View style={{ gap: 8 }}>
            <AppText
              style={{
                fontSize: 30,
                fontWeight: '700',
                lineHeight: 36,
                letterSpacing: -0.8,
                color: TEXT_ON_DARK,
              }}
            >
              {buildMainHeadline(backlog.dueNowCount, remainingCounts.remainingReview, backlog.mistakeCount, remainingCounts.remainingNew)}
            </AppText>
            <AppText style={{ fontSize: FONT_CALLOUT, color: TEXT_ON_DARK_DIM, lineHeight: 19 }}>
              {backlog.dueNowCount > 0 && remainingCounts.remainingReview <= 0
                ? `预计 ${minuteRange}。计划内复习已完成，还有 ${reviewExtraAction.extraAvailableCount} 个到期词可继续加练。`
                : `预计 ${minuteRange}。优先处理计划内任务。`}
            </AppText>
          </View>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              disabled={heroReviewAction.disabled}
              onPress={() =>
                handleTodayActionPress(
                  heroReviewAction.actionType,
                  heroReviewAction.ctaLabel,
                  heroReviewAction,
                  {
                    action: heroReviewAction.actionType,
                    label: 'hero_review_due',
                  },
                )
              }
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 50,
                borderRadius: RADIUS_BTN,
                backgroundColor: BG_HERO_BTN_SEC,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: heroReviewAction.disabled ? 0.44 : pressed ? 0.74 : 1,
              })}
            >
              <AppText style={{ fontSize: 16, fontWeight: '600', color: TEXT_ON_DARK }}>
                {heroReviewAction.ctaLabel}
              </AppText>
            </Pressable>

            <Pressable
              disabled={mistakeAction.disabled}
              onPress={() =>
                handleTodayActionPress('mistake_review', mistakeAction.ctaLabel, mistakeAction, {
                  action: 'mistake_review',
                  label: 'hero_mistake_review',
                  mistakeCount: backlog.mistakeCount,
                  plannedMistake: today.todayMistakePlanned,
                })
              }
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 50,
                borderRadius: RADIUS_BTN,
                backgroundColor: ACCENT,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: mistakeAction.disabled ? 0.44 : pressed ? 0.82 : 1,
              })}
            >
              <AppText style={{ fontSize: 16, fontWeight: '600', color: '#111827' }}>{mistakeAction.ctaLabel}</AppText>
            </Pressable>
            </View>
          </View>

        {isTablet ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 18,
              paddingHorizontal: PAGE_PADDING,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <SectionTitle title="今日推荐任务" />
              <View
                style={{
                  marginBottom: 24,
                  borderRadius: RADIUS_CARD + 4,
                  backgroundColor: colors.cardBackground,
                  borderWidth: 1,
                  borderColor: colors.border,
                  overflow: 'hidden',
                }}
              >
                <TaskRow
                  icon="alert-circle-outline"
                  iconColor={COLOR_RED}
                  iconBackground={COLOR_RED_BG}
                  title="安排错词强化"
                  detail={
                    mistakeAction.disabled
                      ? '今天没有需要继续强化的错词'
                      : `复习强化约 ${mistakeAction.remainingCount} 个错词`
                  }
                  actionLabel={mistakeAction.ctaLabel}
                  actionTone={mistakeAction.disabled ? 'neutral' : 'accent'}
                  disabled={mistakeAction.disabled}
                  onPress={() =>
                    handleTodayActionPress('mistake_review', mistakeAction.ctaLabel, mistakeAction, {
                      action: 'mistake_review',
                      title: '安排错词强化',
                      mistakeCount,
                      plannedMistake: today.todayMistakePlanned,
                    })
                  }
                />
                <TaskRow
                  icon="checkmark-circle-outline"
                  iconColor={COLOR_BLUE}
                  iconBackground={COLOR_BLUE_BG}
                  title={reviewAction.title}
                  detail={reviewAction.disabled ? '今天的计划内到期复习已经完成' : reviewAction.subtitle}
                  actionLabel={reviewAction.ctaLabel}
                  actionTone="neutral"
                  disabled={reviewAction.disabled}
                  onPress={() =>
                    handleTodayActionPress('review_plan', reviewAction.ctaLabel, reviewAction, {
                      action: 'review_plan',
                      title: reviewAction.title,
                      plannedReview: today.todayReviewPlanned,
                    })
                  }
                />
                <TaskRow
                  icon="book-outline"
                  iconColor={COLOR_GREEN}
                  iconBackground={COLOR_GREEN_BG}
                  title={learnPlanAction.title}
                  detail={learnPlanAction.disabled ? `《${taskBookTitle}》今日新词已完成` : learnPlanAction.subtitle}
                  actionLabel={learnPlanAction.ctaLabel}
                  actionTone="neutral"
                  disabled={learnPlanAction.disabled}
                  onPress={() =>
                    handleTodayActionPress('learn_plan', learnPlanAction.ctaLabel, learnPlanAction, {
                      action: 'learn_plan',
                      title: learnPlanAction.title,
                      bookSlug: focusBook.slug,
                      plannedNew: today.todayNewPlanned,
                      completedNew: today.todayNewCompleted,
                    })
                  }
                  isLast
                />
              </View>

              {reviewExtraAction.disabled && learnExtraAction.disabled ? null : (
                <>
                  <SectionTitle title="继续训练" />
                  <View
                    style={{
                      marginBottom: 24,
                      borderRadius: RADIUS_CARD + 4,
                      backgroundColor: colors.cardBackground,
                      overflow: 'hidden',
                      borderWidth: 0.5,
                      borderColor: colors.border,
                    }}
                  >
                    {learnExtraAction.disabled ? null : (
                      <TaskRow
                        icon="book-outline"
                        iconColor={COLOR_GREEN}
                        iconBackground={COLOR_GREEN_BG}
                        title={learnExtraAction.title}
                        detail={learnExtraAction.subtitle}
                        actionLabel={learnExtraAction.ctaLabel}
                        actionTone="neutral"
                        onPress={() =>
                          handleTodayActionPress('learn_extra', learnExtraAction.ctaLabel, learnExtraAction, {
                            action: 'learn_extra',
                            title: learnExtraAction.title,
                          })
                        }
                        isLast={reviewExtraAction.disabled}
                      />
                    )}
                    {reviewExtraAction.disabled ? null : (
                      <TaskRow
                        icon="flash-outline"
                        iconColor={ACCENT}
                        iconBackground={COLOR_AMBER_BG}
                        title={reviewExtraAction.title}
                        detail={reviewExtraAction.subtitle}
                        actionLabel={reviewExtraAction.ctaLabel}
                        actionTone="accent"
                        onPress={() =>
                          handleTodayActionPress('review_extra', reviewExtraAction.ctaLabel, reviewExtraAction, {
                            action: 'review_extra',
                            title: reviewExtraAction.title,
                          })
                        }
                        isLast
                      />
                    )}
                  </View>
                </>
              )}
            </View>

            <View style={{ width: 380, maxWidth: '38%' }}>
              <SectionTitle title="今日摘要" />
              <View
                style={{
                  marginBottom: 24,
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  rowGap: 10,
                }}
              >
                <SummaryTile
                  label="新词计划"
                  value={String(today.todayNewPlanned)}
                  note={buildCompletionNote(today.todayNewCompleted, today.todayNewPlanned)}
                  backgroundColor={COLOR_GREEN_BG}
                />
                <SummaryTile
                  label="复习计划"
                  value={String(today.todayReviewPlanned)}
                  note={buildCompletionNote(today.todayReviewCompleted, today.todayReviewPlanned)}
                  backgroundColor={COLOR_BLUE_BG}
                />
                <SummaryTile
                  label="错词处理"
                  value={String(today.todayMistakePlanned)}
                  note={buildCompletionNote(today.todayMistakeCompleted, today.todayMistakePlanned)}
                  backgroundColor={COLOR_RED_BG}
                />
                <SummaryTile
                  label="当前词书"
                  value={`${focusBook.percentage}%`}
                  note={taskBookTitle}
                  backgroundColor="rgba(245,166,35,0.10)"
                />
              </View>

              <SectionTitle title="系统建议" />
              <View
                style={{
                  marginBottom: 20,
                  borderRadius: RADIUS_CARD + 4,
                  backgroundColor: colors.cardBackground,
                  overflow: 'hidden',
                  borderWidth: 0.5,
                  borderColor: colors.border,
                }}
              >
                {displayedSuggestions.map((item, index) => (
                  <AdviceRow
                    key={`${item.title}-${index}`}
                    dotColor={toneToDotColor(item.tone)}
                    title={item.title}
                    detail={item.detail}
                    isLast={index === displayedSuggestions.length - 1}
                  />
                ))}
              </View>
            </View>
          </View>
        ) : (
          <>
            <SectionTitle title="今日推荐任务" />
            <View
              style={{
                marginHorizontal: PAGE_PADDING,
                marginBottom: 24,
                borderRadius: RADIUS_CARD + 4,
                backgroundColor: colors.cardBackground,
                borderWidth: 1,
                borderColor: colors.border,
                overflow: 'hidden',
              }}
            >
              <TaskRow
                icon="alert-circle-outline"
                iconColor={COLOR_RED}
                iconBackground={COLOR_RED_BG}
                title="安排错词强化"
                detail={
                  mistakeAction.disabled
                    ? '今天没有需要继续强化的错词'
                    : `复习强化约 ${mistakeAction.remainingCount} 个错词`
                }
                actionLabel={mistakeAction.ctaLabel}
                actionTone={mistakeAction.disabled ? 'neutral' : 'accent'}
                disabled={mistakeAction.disabled}
                onPress={() =>
                  handleTodayActionPress('mistake_review', mistakeAction.ctaLabel, mistakeAction, {
                    action: 'mistake_review',
                    title: '安排错词强化',
                    mistakeCount,
                    plannedMistake: today.todayMistakePlanned,
                  })
                }
              />
              <TaskRow
                icon="checkmark-circle-outline"
                iconColor={COLOR_BLUE}
                iconBackground={COLOR_BLUE_BG}
                title={reviewAction.title}
                detail={
                  reviewAction.disabled
                    ? '今天的计划内到期复习已经完成'
                    : reviewAction.subtitle
                }
                actionLabel={reviewAction.ctaLabel}
                actionTone="neutral"
                disabled={reviewAction.disabled}
                onPress={() =>
                  handleTodayActionPress('review_plan', reviewAction.ctaLabel, reviewAction, {
                    action: 'review_plan',
                    title: reviewAction.title,
                    plannedReview: today.todayReviewPlanned,
                  })
                }
              />
              <TaskRow
                icon="book-outline"
                iconColor={COLOR_GREEN}
                iconBackground={COLOR_GREEN_BG}
                title={learnPlanAction.title}
                detail={
                  learnPlanAction.disabled
                    ? `《${taskBookTitle}》今日新词已完成`
                    : learnPlanAction.subtitle
                }
                actionLabel={learnPlanAction.ctaLabel}
                actionTone="neutral"
                disabled={learnPlanAction.disabled}
                onPress={() =>
                  handleTodayActionPress('learn_plan', learnPlanAction.ctaLabel, learnPlanAction, {
                    action: 'learn_plan',
                    title: learnPlanAction.title,
                    bookSlug: focusBook.slug,
                    plannedNew: today.todayNewPlanned,
                    completedNew: today.todayNewCompleted,
                  })
                }
                isLast
              />
            </View>

            {reviewExtraAction.disabled && learnExtraAction.disabled ? null : (
              <>
                <SectionTitle title="继续训练" />
                <View
                  style={{
                    marginHorizontal: PAGE_PADDING,
                    marginBottom: 24,
                    borderRadius: RADIUS_CARD + 4,
                    backgroundColor: colors.cardBackground,
                    overflow: 'hidden',
                    borderWidth: 0.5,
                    borderColor: colors.border,
                  }}
                >
                  {learnExtraAction.disabled ? null : (
                    <TaskRow
                      icon="book-outline"
                      iconColor={COLOR_GREEN}
                      iconBackground={COLOR_GREEN_BG}
                      title={learnExtraAction.title}
                      detail={learnExtraAction.subtitle}
                      actionLabel={learnExtraAction.ctaLabel}
                      actionTone="neutral"
                      onPress={() =>
                        handleTodayActionPress('learn_extra', learnExtraAction.ctaLabel, learnExtraAction, {
                          action: 'learn_extra',
                          title: learnExtraAction.title,
                        })
                      }
                      isLast={reviewExtraAction.disabled}
                    />
                  )}
                  {reviewExtraAction.disabled ? null : (
                    <TaskRow
                      icon="flash-outline"
                      iconColor={ACCENT}
                      iconBackground={COLOR_AMBER_BG}
                      title={reviewExtraAction.title}
                      detail={reviewExtraAction.subtitle}
                      actionLabel={reviewExtraAction.ctaLabel}
                      actionTone="accent"
                      onPress={() =>
                        handleTodayActionPress('review_extra', reviewExtraAction.ctaLabel, reviewExtraAction, {
                          action: 'review_extra',
                          title: reviewExtraAction.title,
                        })
                      }
                      isLast
                    />
                  )}
                </View>
              </>
            )}

            <SectionTitle title="今日摘要" />
            <View
              style={{
                marginHorizontal: PAGE_PADDING,
                marginBottom: 24,
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                rowGap: 10,
              }}
            >
              <SummaryTile
                label="新词计划"
                value={String(today.todayNewPlanned)}
                note={buildCompletionNote(today.todayNewCompleted, today.todayNewPlanned)}
                backgroundColor={COLOR_GREEN_BG}
              />
              <SummaryTile
                label="复习计划"
                value={String(today.todayReviewPlanned)}
                note={buildCompletionNote(today.todayReviewCompleted, today.todayReviewPlanned)}
                backgroundColor={COLOR_BLUE_BG}
              />
              <SummaryTile
                label="错词处理"
                value={String(today.todayMistakePlanned)}
                note={buildCompletionNote(today.todayMistakeCompleted, today.todayMistakePlanned)}
                backgroundColor={COLOR_RED_BG}
              />
              <SummaryTile label="当前词书" value={`${focusBook.percentage}%`} note={taskBookTitle} backgroundColor="rgba(245,166,35,0.10)" />
            </View>

            <SectionTitle title="系统建议" />
            <View
              style={{
                marginHorizontal: PAGE_PADDING,
                marginBottom: 20,
                borderRadius: RADIUS_CARD + 4,
                backgroundColor: colors.cardBackground,
                overflow: 'hidden',
                borderWidth: 0.5,
                borderColor: colors.border,
              }}
            >
              {displayedSuggestions.map((item, index) => (
                <AdviceRow
                  key={`${item.title}-${index}`}
                  dotColor={toneToDotColor(item.tone)}
                  title={item.title}
                  detail={item.detail}
                  isLast={index === displayedSuggestions.length - 1}
                />
              ))}
            </View>
          </>
        )}
      </View>
    </AppScreenShell>
  );
}
