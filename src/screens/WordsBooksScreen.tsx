import { router, useFocusEffect, type Href } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { ActionButton, ChromeIconButton, MetricTile, ProgressBar, StatusPill, SurfaceCard } from '@/components/ui/ApplePrimitives';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useDeviceClass } from '@/hooks/useDeviceClass';
import { useVocabularyDashboardData } from '@/hooks/useVocabularyDashboardData';
import { useVocabularyTodayPlanData } from '@/hooks/useVocabularyTodayPlanData';
import { safeBack } from '@/navigation/safeBack';
import { updateVocabularyTodayPlan } from '@/services/api/vocabulary';
import { getVocabularyUserErrorMessage } from '@/services/api/vocabularyErrorCopy';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import {
  BG_CARD_SOFT,
  BG_PAGE,
  BORDER_SOFT,
  COLOR_BLUE,
  COLOR_BLUE_BG,
  COLOR_GREEN,
  COLOR_GREEN_BG,
  COLOR_RED,
  FONT_CALLOUT,
  FONT_CAPTION,
  SPACING_PAGE_H,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from '@/theme/tokens';
import { useAppTheme } from '@/theme/AppThemeProvider';

const TABLET_PAGE_MAX_WIDTH = 1220;

type BookSummary = {
  slug: string;
  title: string;
  totalWords: number;
  masteredWords: number;
  dueWords: number;
  mistakeWords: number;
  percentage: number;
  remainingWords: number;
  isFocus: boolean;
};

function buildReviewRoute(mode: 'learn' | 'review', bookSlug?: string | null, source?: 'plan' | 'extra' | 'direct'): Href {
  if (bookSlug) {
    const sourceQuery = source ? `&source=${encodeURIComponent(source)}` : '';
    return `/words/review?mode=${mode}&bookSlug=${encodeURIComponent(bookSlug)}${sourceQuery}&resume=true` as Href;
  }
  if (source) {
    return `/words/review?mode=${mode}&source=${encodeURIComponent(source)}&resume=true` as Href;
  }
  return `/words/review?mode=${mode}&resume=true` as Href;
}

function buildMyWordsRoute(bookSlug?: string | null): Href {
  if (!bookSlug) return '/words/my-words';
  return `/words/my-words?bookSlug=${encodeURIComponent(bookSlug)}` as Href;
}

function buildBookStatus(book: BookSummary) {
  if (book.isFocus) return { label: '当前主攻', tone: 'blue' as const };
  if (book.dueWords > 0) return { label: '建议先复习', tone: 'amber' as const };
  return { label: '可开始', tone: 'green' as const };
}

function GuestPanel() {
  const { theme } = useAppTheme();

  return (
    <SurfaceCard style={{ marginHorizontal: SPACING_PAGE_H, padding: 22, gap: 14, borderRadius: 30 }}>
      <StatusPill label="词书中心" tone="blue" />
      <AppText style={{ fontSize: 28, lineHeight: 34, fontWeight: '700', color: theme.textPrimary }}>登录后查看词书中心</AppText>
      <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: theme.textSecondary }}>
        登录后即可同步词书进度、主攻词书和对应学习入口。
      </AppText>
      <ActionButton label="去登录" variant="dark" onPress={() => router.push('/auth/sign-in')} />
    </SurfaceCard>
  );
}

function PlaceholderLine({
  width,
  height = 12,
}: {
  width: number | `${number}%`;
  height?: number;
}) {
  return (
    <View
      style={{
        width,
        height,
        borderRadius: 999,
        backgroundColor: BORDER_SOFT,
      }}
    />
  );
}

function FocusBookPlaceholder() {
  return (
    <SurfaceCard
      style={{
        marginHorizontal: SPACING_PAGE_H,
        borderRadius: 30,
        padding: 22,
        gap: 18,
        borderColor: BORDER_SOFT,
      }}
    >
      <View style={{ alignSelf: 'flex-start', width: 98, height: 28, borderRadius: 999, backgroundColor: COLOR_BLUE_BG }} />
      <View style={{ gap: 8 }}>
        <PlaceholderLine width="40%" height={28} />
        <PlaceholderLine width="72%" />
      </View>
      <View style={{ gap: 8 }}>
        <View style={{ height: 8, borderRadius: 999, backgroundColor: BORDER_SOFT }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
          <PlaceholderLine width={64} />
          <PlaceholderLine width={48} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {[0, 1, 2, 3].map((index) => (
          <View
            key={index}
            style={{
              width: '48%',
              borderRadius: 18,
              backgroundColor: BG_CARD_SOFT,
              paddingHorizontal: 14,
              paddingVertical: 12,
              gap: 8,
            }}
          >
            <PlaceholderLine width="44%" />
            <PlaceholderLine width="34%" height={18} />
            <PlaceholderLine width="56%" />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1, height: 48, borderRadius: 16, backgroundColor: BORDER_SOFT }} />
        <View style={{ flex: 1, height: 48, borderRadius: 16, backgroundColor: BG_CARD_SOFT }} />
      </View>
    </SurfaceCard>
  );
}

function BookCardPlaceholder() {
  return (
    <SurfaceCard style={{ padding: 18, gap: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 8 }}>
          <PlaceholderLine width="38%" height={20} />
          <PlaceholderLine width="74%" />
        </View>
        <View style={{ width: 76, height: 28, borderRadius: 999, backgroundColor: BG_CARD_SOFT }} />
      </View>
      <View style={{ gap: 8 }}>
        <View style={{ height: 8, borderRadius: 999, backgroundColor: BORDER_SOFT }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
          <PlaceholderLine width={64} />
          <PlaceholderLine width={48} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: COLOR_BLUE_BG, gap: 8 }}>
          <PlaceholderLine width="44%" />
          <PlaceholderLine width="34%" height={18} />
        </View>
        <View style={{ flex: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: BG_CARD_SOFT, gap: 8 }}>
          <PlaceholderLine width="44%" />
          <PlaceholderLine width="48%" height={18} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1, height: 48, borderRadius: 16, backgroundColor: BORDER_SOFT }} />
        <View style={{ flex: 1, height: 48, borderRadius: 16, backgroundColor: BG_CARD_SOFT }} />
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1, height: 48, borderRadius: 16, backgroundColor: BG_CARD_SOFT }} />
        <View style={{ flex: 1, height: 48, borderRadius: 16, backgroundColor: BG_CARD_SOFT }} />
      </View>
    </SurfaceCard>
  );
}

function FocusBookCard({
  book,
  masteryRate,
  dueNowCount,
  onLearn,
  onReview,
}: {
  book: BookSummary;
  masteryRate: number;
  dueNowCount: number;
  onLearn: () => void;
  onReview: () => void;
}) {
  const { theme } = useAppTheme();

  return (
    <SurfaceCard
      style={{
        marginHorizontal: SPACING_PAGE_H,
        borderRadius: 30,
        padding: 22,
        gap: 18,
        borderColor: BORDER_SOFT,
      }}
    >
      <StatusPill label="当前主攻词书" tone="blue" />

      <View style={{ gap: 8 }}>
        <AppText style={{ fontSize: 30, lineHeight: 36, fontWeight: '700', color: theme.textPrimary }}>{book.title}</AppText>
        <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: theme.textSecondary }}>
          总词数 {book.totalWords} · 已掌握 {book.masteredWords} · 待复习 {book.dueWords} · 错词 {book.mistakeWords}
        </AppText>
      </View>

      <View style={{ gap: 8 }}>
        <ProgressBar progress={book.percentage} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
          <AppText style={{ fontSize: 12, fontWeight: '600', color: theme.textSecondary }}>学习进度</AppText>
          <AppText style={{ fontSize: 12, fontWeight: '700', color: COLOR_BLUE }}>{book.percentage}%</AppText>
        </View>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <MetricTile label="当前进度" value={`${book.percentage}%`} note={`剩余 ${book.remainingWords} 词`} tone="blue" />
        <MetricTile label="待复习" value={book.dueWords} note={book.dueWords > 0 ? '建议优先清理' : '当前积压不高'} tone={book.dueWords > 0 ? 'amber' : 'green'} />
        <MetricTile label="错词" value={book.mistakeWords} note={book.mistakeWords > 0 ? '需要回补一轮' : '错词压力可控'} tone={book.mistakeWords > 0 ? 'red' : 'green'} />
        <MetricTile label="整体掌握率" value={`${masteryRate}%`} note={dueNowCount > 0 ? `全局到期 ${dueNowCount} 个` : '今日节奏较稳'} tone="green" />
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <ActionButton label="学习新词" variant="primary" onPress={onLearn} style={{ flex: 1 }} />
        <ActionButton label={book.dueWords > 0 ? '复习到期词' : '暂无到期'} variant="secondary" disabled={book.dueWords <= 0} onPress={onReview} style={{ flex: 1 }} />
      </View>
    </SurfaceCard>
  );
}

function BookCard({
  book,
  saving,
  canSetFocus,
  onSetFocus,
  onLearn,
  onReview,
  onOpenNotebook,
}: {
  book: BookSummary;
  saving: boolean;
  canSetFocus: boolean;
  onSetFocus: () => void;
  onLearn: () => void;
  onReview: () => void;
  onOpenNotebook: () => void;
}) {
  const { theme } = useAppTheme();
  const status = buildBookStatus(book);

  return (
    <SurfaceCard style={{ padding: 18, gap: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 6 }}>
          <AppText style={{ fontSize: 20, lineHeight: 26, fontWeight: '700', color: theme.textPrimary }}>{book.title}</AppText>
          <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: theme.textSecondary }}>
            总词数 {book.totalWords} · 已掌握 {book.masteredWords} · 待复习 {book.dueWords} · 错词 {book.mistakeWords}
          </AppText>
        </View>
        <StatusPill label={status.label} tone={status.tone} />
      </View>

      <View style={{ gap: 8 }}>
        <ProgressBar progress={book.percentage} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
          <AppText style={{ fontSize: 12, fontWeight: '600', color: theme.textSecondary }}>学习进度</AppText>
          <AppText style={{ fontSize: 12, fontWeight: '700', color: COLOR_BLUE }}>{book.percentage}%</AppText>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View
          style={{
            flex: 1,
            borderRadius: 16,
            paddingHorizontal: 14,
            paddingVertical: 12,
            backgroundColor: theme.colorScheme === 'dark' ? 'rgba(10,132,255,0.16)' : COLOR_BLUE_BG,
            gap: 3,
          }}
        >
          <AppText style={{ fontSize: 12, fontWeight: '600', color: theme.textSecondary }}>当前进度</AppText>
          <AppText style={{ fontSize: 18, fontWeight: '700', color: theme.textPrimary }}>{book.percentage}%</AppText>
        </View>
        <View
          style={{
            flex: 1,
            borderRadius: 16,
            paddingHorizontal: 14,
            paddingVertical: 12,
            backgroundColor: book.dueWords > 0 ? (theme.colorScheme === 'dark' ? 'rgba(255,159,10,0.16)' : 'rgba(245,166,35,0.10)') : theme.colorScheme === 'dark' ? 'rgba(48,209,88,0.14)' : COLOR_GREEN_BG,
            gap: 3,
          }}
        >
          <AppText style={{ fontSize: 12, fontWeight: '600', color: theme.textSecondary }}>当前状态</AppText>
          <AppText style={{ fontSize: 16, fontWeight: '700', color: book.dueWords > 0 ? (theme.colorScheme === 'dark' ? theme.warning : '#B76B00') : COLOR_GREEN }}>
            {book.dueWords > 0 ? '建议先复习' : book.isFocus ? '继续推进' : '可直接开始'}
          </AppText>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <ActionButton
          label={book.isFocus ? '当前主攻' : !canSetFocus ? '计划同步中' : saving ? '设置中…' : '设为主攻'}
          variant={book.isFocus ? 'secondary' : 'dark'}
          disabled={book.isFocus || saving || !canSetFocus}
          onPress={onSetFocus}
          style={{ flex: 1 }}
        />
        <ActionButton label="学习新词" variant="primary" onPress={onLearn} style={{ flex: 1 }} />
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <ActionButton
          label={book.dueWords > 0 ? '复习到期词' : '暂无到期'}
          variant="secondary"
          disabled={book.dueWords <= 0}
          onPress={onReview}
          style={{ flex: 1 }}
        />
        <ActionButton label="查看词库" variant="secondary" onPress={onOpenNotebook} style={{ flex: 1 }} />
      </View>
    </SurfaceCard>
  );
}

export function WordsBooksScreen() {
  const { theme } = useAppTheme();
  const session = useAppSession();
  const { isTablet } = useDeviceClass();
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
  const [savingSlug, setSavingSlug] = useState<string | null>(null);

  const isLoggedIn = session.status === 'authenticated';
  const hasAnyData = Boolean(dashboard || plan);
  const showGuestState = !isLoggedIn || (!hasAnyData && (dashboardAuthRequired || planAuthRequired));

  useFocusEffect(
    useCallback(() => {
      if (!isLoggedIn) return undefined;
      void refreshDashboard();
      void refreshPlan();
      return undefined;
    }, [isLoggedIn, refreshDashboard, refreshPlan]),
  );

  const focusBookSlug = plan?.summary.focusBook.slug ?? plan?.plan.focusBookSlug ?? null;

  const books = useMemo<BookSummary[]>(() => {
    const dashboardBooks = dashboard?.books ?? [];
    const planBooks = plan?.books ?? [];
    const dashboardMap = new Map(dashboardBooks.map((book) => [book.slug, book]));
    const planMap = new Map(planBooks.map((book) => [book.slug, book]));
    const seen = new Set<string>();
    const orderedSlugs = [
      ...(focusBookSlug ? [focusBookSlug] : []),
      ...dashboardBooks.map((book) => book.slug),
      ...planBooks.map((book) => book.slug),
    ].filter((slug) => {
      if (!slug || seen.has(slug)) return false;
      seen.add(slug);
      return true;
    });

    return orderedSlugs
      .map((slug) => {
        const dashboardBook = dashboardMap.get(slug);
        const planBook = planMap.get(slug);
        const totalWords = dashboardBook?.totalWords ?? planBook?.wordCount ?? 0;
        const masteredWords = dashboardBook?.masteredWords ?? 0;
        const dueWords = dashboardBook?.dueWords ?? 0;
        const mistakeWords = dashboardBook?.mistakeWords ?? 0;
        const percentage = totalWords > 0 ? Math.round((masteredWords / totalWords) * 100) : 0;

        return {
          slug,
          title: dashboardBook?.title ?? planBook?.title ?? '当前词书',
          totalWords,
          masteredWords,
          dueWords,
          mistakeWords,
          percentage,
          remainingWords: Math.max(totalWords - masteredWords, 0),
          isFocus: slug === focusBookSlug,
        };
      })
      .sort((left, right) => {
        if (left.isFocus !== right.isFocus) return left.isFocus ? -1 : 1;
        if (left.dueWords !== right.dueWords) return right.dueWords - left.dueWords;
        if (left.mistakeWords !== right.mistakeWords) return right.mistakeWords - left.mistakeWords;
        return left.title.localeCompare(right.title, 'zh-CN');
      });
  }, [dashboard?.books, focusBookSlug, plan?.books]);

  const focusBook = books.find((book) => book.isFocus) ?? books[0] ?? null;
  const dueNowCount = plan?.summary.backlog.dueNowCount ?? dashboard?.todayDueCount ?? 0;
  const masteryRate = dashboard?.masteryRate ?? focusBook?.percentage ?? 0;
  const combinedError = planError || dashboardError;
  const canSetFocus = Boolean(plan?.plan && session.session);
  const remainingNew = Math.max(plan?.summary.today.remainingNew ?? 0, 0);
  const remainingReview = Math.max(plan?.summary.today.remainingReview ?? 0, 0);

  const buildLearnEntryRoute = useCallback(
    (book: BookSummary) => buildReviewRoute('learn', book.slug, book.isFocus ? (remainingNew > 0 ? 'plan' : 'extra') : 'direct'),
    [remainingNew],
  );
  const buildReviewEntryRoute = useCallback(
    (book: BookSummary) => buildReviewRoute('review', book.slug, book.isFocus ? (remainingReview > 0 ? 'plan' : 'extra') : 'direct'),
    [remainingReview],
  );

  const handleSetFocusBook = useCallback(
    async (book: BookSummary) => {
      if (!session.session || !plan?.plan) return;
      setSavingSlug(book.slug);
      try {
        await updateVocabularyTodayPlan(session.session, {
          ...plan.plan,
          focusBookSlug: book.slug,
        });
        Alert.alert('主攻词书已更新', `之后的新词计划会优先围绕《${book.title}》生成。`);
      } catch (error) {
        Alert.alert('设置失败', getVocabularyUserErrorMessage(error, 'today_plan_save'));
      } finally {
        setSavingSlug(null);
      }
    },
    [plan?.plan, session.session],
  );

  if (showGuestState) {
    return (
      <AppScreenShell
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        includeBottomInset={false}
        disableTabletTopInset={isTablet}
      >
        <View style={{ width: '100%', maxWidth: isTablet ? TABLET_PAGE_MAX_WIDTH : undefined, alignSelf: 'center' }}>
        <View style={{ paddingHorizontal: SPACING_PAGE_H, paddingTop: isTablet ? 8 : 16, paddingBottom: 12 }}>
          <ChromeIconButton icon="chevron-back" onPress={() => safeBack()} accessibilityLabel="返回" />
        </View>
        <GuestPanel />
        </View>
      </AppScreenShell>
    );
  }

  if ((dashboardLoading || planLoading) && !hasAnyData) {
    return (
      <AppScreenShell
        contentContainerStyle={{ paddingBottom: 30, backgroundColor: theme.pageBackground }}
        showsVerticalScrollIndicator={false}
        includeBottomInset={false}
        disableTabletTopInset={isTablet}
      >
        <View style={{ width: '100%', maxWidth: isTablet ? TABLET_PAGE_MAX_WIDTH : undefined, alignSelf: 'center' }}>
        <View style={{ paddingHorizontal: SPACING_PAGE_H, paddingTop: isTablet ? 8 : 16, paddingBottom: 12 }}>
          <ChromeIconButton icon="chevron-back" onPress={() => safeBack()} accessibilityLabel="返回" />
        </View>

        <View style={{ paddingHorizontal: SPACING_PAGE_H, paddingBottom: 6, gap: 6 }}>
          <AppText style={{ fontSize: 34, lineHeight: 40, fontWeight: '700', color: theme.textPrimary }}>词书中心</AppText>
          <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: theme.textSecondary }}>
            直接管理主攻词书、复习压力和每本词书的学习入口。
          </AppText>
        </View>

        <FocusBookPlaceholder />
        <SectionHeader title="全部词书" description="每本词书都给出当前状态、进度和可执行动作。" />
        <View
          style={{
            paddingHorizontal: SPACING_PAGE_H,
            gap: 14,
            flexDirection: isTablet ? 'row' : 'column',
            flexWrap: isTablet ? 'wrap' : 'nowrap',
          }}
        >
          {[0, 1, 2].map((index) => (
            <View key={index} style={{ width: isTablet ? '48.8%' : '100%' }}>
              <BookCardPlaceholder />
            </View>
          ))}
        </View>
        </View>
      </AppScreenShell>
    );
  }

  if (!books.length) {
    return (
      <AppScreenShell
        contentContainerStyle={{ paddingBottom: 28, backgroundColor: theme.pageBackground }}
        showsVerticalScrollIndicator={false}
        includeBottomInset={false}
        disableTabletTopInset={isTablet}
      >
        <View style={{ width: '100%', maxWidth: isTablet ? TABLET_PAGE_MAX_WIDTH : undefined, alignSelf: 'center' }}>
        <View style={{ paddingHorizontal: SPACING_PAGE_H, paddingTop: isTablet ? 8 : 16, paddingBottom: 12 }}>
          <ChromeIconButton icon="chevron-back" onPress={() => safeBack()} accessibilityLabel="返回" />
        </View>
        <SurfaceCard style={{ marginHorizontal: SPACING_PAGE_H, padding: 20 }}>
          <View style={{ gap: 10 }}>
            <AppText style={{ fontSize: 24, fontWeight: '700', color: theme.textPrimary }}>词书数据暂时不可用</AppText>
            <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: theme.textSecondary }}>
              {combinedError ?? '当前还没有成功读取到词书列表，请稍后重试。'}
            </AppText>
            <ActionButton label="重新加载" variant="dark" onPress={() => { void refreshPlan(); void refreshDashboard(); }} />
          </View>
        </SurfaceCard>
        </View>
      </AppScreenShell>
    );
  }

  return (
    <AppScreenShell
      contentContainerStyle={{ paddingBottom: 30, backgroundColor: theme.pageBackground }}
      showsVerticalScrollIndicator={false}
      includeBottomInset={false}
      disableTabletTopInset={isTablet}
    >
      <View style={{ width: '100%', maxWidth: isTablet ? TABLET_PAGE_MAX_WIDTH : undefined, alignSelf: 'center' }}>
      <View style={{ paddingHorizontal: SPACING_PAGE_H, paddingTop: isTablet ? 8 : 16, paddingBottom: 14 }}>
        <ChromeIconButton icon="chevron-back" onPress={() => safeBack()} accessibilityLabel="返回" />
      </View>

      <View style={{ paddingHorizontal: SPACING_PAGE_H, paddingBottom: 6, gap: 6 }}>
        <AppText style={{ fontSize: 34, lineHeight: 40, fontWeight: '700', color: theme.textPrimary }}>词书中心</AppText>
        <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: theme.textSecondary }}>
          直接管理主攻词书、复习压力和每本词书的学习入口。
        </AppText>
      </View>

      {focusBook ? (
        <FocusBookCard
          book={focusBook}
          masteryRate={masteryRate}
          dueNowCount={dueNowCount}
          onLearn={() => router.push(buildLearnEntryRoute(focusBook))}
          onReview={() => router.push(buildReviewEntryRoute(focusBook))}
        />
      ) : null}

      <SectionHeader title="全部词书" description="每本词书都给出当前状态、进度和可执行动作。" />
      <View
        style={{
          paddingHorizontal: SPACING_PAGE_H,
          gap: 14,
          flexDirection: isTablet ? 'row' : 'column',
          flexWrap: isTablet ? 'wrap' : 'nowrap',
          alignItems: 'stretch',
        }}
      >
        {books.map((book) => (
          <View key={book.slug} style={{ width: isTablet ? '48.8%' : '100%' }}>
            <BookCard
              book={book}
              saving={savingSlug === book.slug}
              canSetFocus={canSetFocus}
              onSetFocus={() => void handleSetFocusBook(book)}
              onLearn={() => router.push(buildLearnEntryRoute(book))}
              onReview={() => router.push(buildReviewEntryRoute(book))}
              onOpenNotebook={() => router.push(buildMyWordsRoute(book.slug))}
            />
          </View>
        ))}
      </View>

      {combinedError ? (
        <View style={{ marginHorizontal: SPACING_PAGE_H, marginTop: 16 }}>
          <AppText style={{ fontSize: 12, color: COLOR_RED }}>{combinedError}</AppText>
        </View>
      ) : null}
      </View>
    </AppScreenShell>
  );
}
