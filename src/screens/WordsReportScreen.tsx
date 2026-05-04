import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { ChromeIconButton, SurfaceCard } from '@/components/ui/ApplePrimitives';
import { useDeviceClass } from '@/hooks/useDeviceClass';
import { useEntitlementGuard } from '@/hooks/useEntitlementGuard';
import { useMobileMe } from '@/hooks/useMobileMe';
import { useVocabularyDashboardData } from '@/hooks/useVocabularyDashboardData';
import { useVocabularyNotebookData } from '@/hooks/useVocabularyNotebookData';
import { useVocabularyTodayPlanData } from '@/hooks/useVocabularyTodayPlanData';
import { safeBack } from '@/navigation/safeBack';
import {
  fetchVocabularyReportInsight,
  fetchVocabularyReviewStats,
  isVocabularyAuthError,
  type VocabularyReportInsight,
  type VocabularyReviewStats,
} from '@/services/api/vocabulary';
import { getVocabularyUserErrorMessage } from '@/services/api/vocabularyErrorCopy';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import {
  BG_CARD,
  BG_CARD_SOFT,
  BORDER_SOFT,
  COLOR_AMBER_BG,
  COLOR_BLUE_BG,
  COLOR_GREEN_BG,
  COLOR_RED,
  COLOR_RED_BG,
  FONT_BODY,
  FONT_CALLOUT,
  FONT_CAPTION,
  FONT_MICRO,
  RADIUS_CARD,
  SPACING_PAGE_H,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from '@/theme/tokens';
import { useAppTheme } from '@/theme/AppThemeProvider';

const TABLET_PAGE_MAX_WIDTH = 1220;

const EXAMPLE_REPORT: VocabularyReportInsight = {
  stageSummary:
    '本阶段你已经建立起基础词汇输入，但复习闭环还不够稳定。更值得优先处理的不是继续堆新词，而是先把到期复习和高频错词压回可控区间。',
  keyProblems: [
    '复习节奏慢于新词输入，队列容易继续积压。',
    '高频问题更集中在少数词类，说明当前主要是理解偏差而不是单纯词量不足。',
    '错词回收还不够集中，近期风险没有被及时压下去。',
  ],
  strengths: [
    '已掌握词量仍在稳定增加，说明基础输入并没有断掉。',
    '学习节奏还在延续，说明这一阶段具备继续拉稳复习的基础。',
    '主攻词书推进没有停滞，后续仍有持续扩展的空间。',
  ],
  nextPhaseAdvice: [
    '下一阶段先清理到期复习，再继续推进新词。',
    '对高频错词做一轮集中回收，优先压低近期风险。',
    '围绕主攻词书继续做语义辨析练习，提升核心词精度。',
  ],
  isSample: true,
};

const EXAMPLE_TAGS = [
  { label: '当前节奏', value: '节奏稳定', tone: 'stability' as const },
  { label: '主要问题', value: '复习积压', tone: 'pressure' as const },
  { label: '建议方向', value: '先回收复习', tone: 'risk' as const },
];

const EXAMPLE_STAGE_STATS = [
  { label: '总学习词数', value: '387' },
  { label: '掌握率', value: '55%' },
  { label: '本轮正确率', value: '71%' },
  { label: '错词率', value: '18%' },
];

function startOfDayKey(dateValue: string) {
  const date = new Date(dateValue);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function SectionTitle({ title }: { title: string }) {
  return (
    <View style={{ paddingTop: 10, paddingHorizontal: SPACING_PAGE_H, paddingBottom: 10 }}>
      <AppText
        style={{
          fontSize: 20,
          fontWeight: '700',
          letterSpacing: -0.4,
          color: TEXT_PRIMARY,
        }}
      >
        {title}
      </AppText>
    </View>
  );
}

function SmallPill({ label }: { label: string }) {
  const { theme } = useAppTheme();
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 5,
        backgroundColor: theme.colorScheme === 'dark' ? 'rgba(10,132,255,0.16)' : COLOR_BLUE_BG,
      }}
    >
      <AppText style={{ fontSize: FONT_MICRO, fontWeight: '600', color: theme.primaryBlue }}>{label}</AppText>
    </View>
  );
}

function HeaderActionButton({
  loading,
  onPress,
}: {
  loading: boolean;
  onPress: () => void;
}) {
  return <ChromeIconButton icon="refresh-outline" onPress={onPress} accessibilityLabel="更新报告" loading={loading} />;
}

function ReportHeader({
  exampleMode,
  loading,
  onRefresh,
}: {
  exampleMode: boolean;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <View style={{ paddingHorizontal: SPACING_PAGE_H, paddingTop: 16, paddingBottom: 12, gap: 10 }}>
      <View style={{ width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <ChromeIconButton icon="chevron-back" onPress={() => safeBack()} accessibilityLabel="返回" />
        <HeaderActionButton loading={loading} onPress={onRefresh} />
      </View>
      {exampleMode ? <SmallPill label="体验报告" /> : null}
    </View>
  );
}

function SummaryTag({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'stability' | 'pressure' | 'risk';
}) {
  const { theme } = useAppTheme();
  const palette =
    tone === 'stability'
      ? { bg: theme.colorScheme === 'dark' ? 'rgba(48,209,88,0.14)' : COLOR_GREEN_BG, fg: theme.success }
      : tone === 'pressure'
        ? { bg: theme.colorScheme === 'dark' ? 'rgba(255,159,10,0.16)' : COLOR_AMBER_BG, fg: theme.warning }
        : { bg: theme.colorScheme === 'dark' ? 'rgba(255,69,58,0.14)' : COLOR_RED_BG, fg: theme.destructive };

  return (
    <View
      style={{
        flex: 1,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: palette.bg,
        gap: 4,
      }}
    >
      <AppText style={{ fontSize: FONT_MICRO, color: palette.fg }}>{label}</AppText>
      <AppText style={{ fontSize: FONT_CAPTION, fontWeight: '700', lineHeight: 17, color: TEXT_PRIMARY }}>{value}</AppText>
    </View>
  );
}

function ReportActionButton({
  label,
  onPress,
  tone = 'secondary',
  compact = false,
}: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'secondary';
  compact?: boolean;
}) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: compact ? 36 : 44,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: compact ? 11 : 15,
        backgroundColor: tone === 'primary' ? theme.primaryBlue : theme.secondaryCardBackground,
        borderWidth: 1,
        borderColor: tone === 'primary' ? theme.primaryBlue : theme.border,
        opacity: pressed ? 0.76 : 1,
      })}
    >
      <AppText style={{ fontSize: compact ? FONT_CAPTION : FONT_CALLOUT, fontWeight: '600', color: tone === 'primary' ? '#FFFFFF' : theme.textPrimary }}>{label}</AppText>
    </Pressable>
  );
}

function StageCard({
  text,
  tone,
}: {
  text: string;
  tone: 'problem' | 'strong';
}) {
  const { theme } = useAppTheme();
  return (
    <View
      style={{
        marginHorizontal: SPACING_PAGE_H,
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 12,
        backgroundColor: tone === 'problem' ? theme.secondaryCardBackground : theme.elevatedCardBackground,
        borderWidth: 1,
        borderColor: theme.border,
      }}
    >
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            marginTop: 6,
            marginLeft: 10,
            backgroundColor: tone === 'problem' ? 'rgba(255,59,48,0.28)' : 'rgba(52,199,89,0.28)',
          }}
        />
        <AppText style={{ flex: 1, fontSize: FONT_CALLOUT, lineHeight: 20, color: TEXT_PRIMARY }}>{text}</AppText>
      </View>
    </View>
  );
}

function StrategyCard({
  index,
  title,
  description,
  buttonLabel,
  onPress,
}: {
  index: number;
  title: string;
  description: string;
  buttonLabel: string;
  onPress: () => void;
}) {
  return (
    <SurfaceCard style={{ marginHorizontal: SPACING_PAGE_H, marginBottom: 10, padding: 16 }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: index === 0 ? COLOR_AMBER_BG : index === 1 ? COLOR_RED_BG : COLOR_BLUE_BG,
          }}
        >
          <AppText style={{ fontSize: FONT_MICRO, fontWeight: '700', color: TEXT_PRIMARY }}>{index + 1}</AppText>
        </View>

        <View style={{ flex: 1, gap: 8 }}>
          <AppText style={{ fontSize: FONT_BODY, fontWeight: '700', color: TEXT_PRIMARY }}>{title}</AppText>
          <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: TEXT_SECONDARY }}>{description}</AppText>
          <View style={{ width: 118 }}>
            <ReportActionButton label={buttonLabel} onPress={onPress} compact />
          </View>
        </View>
      </View>
    </SurfaceCard>
  );
}

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const { theme } = useAppTheme();
  return (
    <View
      style={{
        width: '48%',
        borderRadius: RADIUS_CARD,
        backgroundColor: theme.secondaryCardBackground,
        borderWidth: 1,
        borderColor: theme.border,
        padding: 14,
        gap: 4,
      }}
    >
      <AppText style={{ fontSize: FONT_MICRO, color: theme.textSecondary }}>{label}</AppText>
      <AppText style={{ fontSize: 24, fontWeight: '700', color: theme.textPrimary }}>{value}</AppText>
    </View>
  );
}

function AnalysisUnavailableCard({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <SurfaceCard style={{ marginHorizontal: SPACING_PAGE_H, padding: 16 }}>
      <View style={{ gap: 6 }}>
        <AppText style={{ fontSize: FONT_BODY, fontWeight: '700', color: TEXT_PRIMARY }}>{title}</AppText>
        <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: TEXT_SECONDARY }}>{message}</AppText>
      </View>
    </SurfaceCard>
  );
}

export function WordsReportScreen() {
  const { isTablet } = useDeviceClass();
  const session = useAppSession();
  const { guardEntry } = useEntitlementGuard();
  const { status: mobileMeStatus, data: mobileMe } = useMobileMe();
  const { data, loading: notebookLoading, error: notebookError, authRequired: notebookAuthRequired, refresh: refreshNotebook } = useVocabularyNotebookData();
  const { dashboard, loading: dashboardLoading, error: dashboardError, authRequired: dashboardAuthRequired } = useVocabularyDashboardData();
  const { plan, loading: planLoading, error: planError, authRequired: planAuthRequired, refresh: refreshPlan } = useVocabularyTodayPlanData();
  const [insight, setInsight] = useState<VocabularyReportInsight | null>(null);
  const [reviewStats, setReviewStats] = useState<VocabularyReviewStats | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightRefreshing, setInsightRefreshing] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);

  const isLoggedIn = session.status === 'authenticated';
  const exampleMode = !isLoggedIn;
  const vocabularyInsightAccessResolved =
    !isLoggedIn || mobileMeStatus === 'ready' || (mobileMeStatus === 'sync_failed' && Boolean(mobileMe));
  const vocabularyInsightLocked =
    isLoggedIn && vocabularyInsightAccessResolved && mobileMe?.entitlements.canUseVocabulary === false;
  const hasAnyData = Boolean(data || dashboard || plan);
  const combinedError = notebookError || dashboardError || planError;

  const words = data?.words ?? [];
  const totalStudied = words.length;
  const masteredCount = data?.stats.mastered ?? plan?.summary.backlog.masteredCount ?? 0;
  const dueCount = plan?.summary.backlog.dueCount ?? data?.stats.due ?? dashboard?.todayDueCount ?? 0;
  const mistakeCount = plan?.summary.backlog.mistakeCount ?? data?.stats.mistake ?? dashboard?.mistakeWordsCount ?? 0;
  const masteryRate = totalStudied > 0 ? clampPercent((masteredCount / totalStudied) * 100) : dashboard?.masteryRate ?? 0;
  const focusBookTitle = plan?.summary.focusBook.title ?? dashboard?.books[0]?.title ?? '当前词书';
  const focusBookSlug = plan?.summary.focusBook.slug ?? dashboard?.books[0]?.slug ?? null;
  const focusBookProgress = plan?.summary.focusBook.percentage ?? 0;

  const patternMistakes = useMemo(() => {
    const bucket = new Map<string, number>();
    for (const word of words) {
      if ((word.mistakeCount ?? 0) <= 0) continue;
      const key = word.pattern || '未分类错因';
      bucket.set(key, (bucket.get(key) ?? 0) + (word.mistakeCount ?? 0));
    }
    return Array.from(bucket.entries()).sort((a, b) => b[1] - a[1]);
  }, [words]);

  const studyDays = useMemo(() => {
    const now = Date.now();
    const recentDays = new Set<string>();
    for (const word of words) {
      const source = word.lastReviewedAt || word.nextReviewAt;
      if (!source) continue;
      const diff = now - new Date(source).getTime();
      if (diff <= 7 * 24 * 60 * 60 * 1000) {
        recentDays.add(startOfDayKey(source));
      }
    }
    return recentDays.size;
  }, [words]);

  async function requestReportInsight(currentSession: NonNullable<typeof session.session>, forceRefresh = false) {
    let nextReviewStats: VocabularyReviewStats | undefined;

    try {
      nextReviewStats = await fetchVocabularyReviewStats(currentSession);
      setReviewStats(nextReviewStats);
    } catch (statsError) {
      if (isVocabularyAuthError(statsError)) {
        throw statsError;
      }
      setReviewStats(null);
    }

    return fetchVocabularyReportInsight(currentSession, {
      totalStudied,
      masteredCount,
      mistakeCount,
      dueCount,
      patternMistakes: patternMistakes.slice(0, 6),
      reviewStats: nextReviewStats,
      ...(forceRefresh ? { refresh: true } : {}),
    });
  }

  useEffect(() => {
    const currentSession = session.session;
    if (!currentSession || !isLoggedIn || !hasAnyData || vocabularyInsightLocked || !vocabularyInsightAccessResolved) {
      setInsight(null);
      setReviewStats(null);
      setInsightError(null);
      setInsightLoading(false);
      setInsightRefreshing(false);
      return;
    }

    let cancelled = false;

    async function loadRealReport(forceRefresh: boolean, activeSession: NonNullable<typeof currentSession>) {
      if (totalStudied <= 0) {
        if (!cancelled) {
          setInsight(null);
          setInsightError('你的学习样本还不够，继续学习后再更新报告。');
          setInsightLoading(false);
          setInsightRefreshing(false);
        }
        return;
      }

      if (!cancelled) {
        if (forceRefresh) {
          setInsightRefreshing(true);
        } else {
          setInsightLoading(true);
        }
        setInsightError(null);
      }

      try {
        const next = await requestReportInsight(activeSession, forceRefresh);
        if (cancelled) return;

        if (next.isSample) {
          setInsight(null);
          setInsightError('阶段报告暂时无法更新，请稍后重试。');
          return;
        }

        setInsight(next);
        setInsightError(null);
      } catch (err) {
        if (cancelled) return;

        if (isVocabularyAuthError(err)) {
          const refreshedSession = await session.refreshSession();
          if (cancelled) return;
          if (refreshedSession) {
            void loadRealReport(forceRefresh, refreshedSession);
            return;
          }
          setInsight(null);
          setInsightError(getVocabularyUserErrorMessage(err, 'report_update'));
          return;
        }

        setInsight(null);
        setInsightError(getVocabularyUserErrorMessage(err, 'report_update'));
      } finally {
        if (!cancelled) {
          setInsightLoading(false);
          setInsightRefreshing(false);
        }
      }
    }

    void loadRealReport(false, currentSession);
    return () => {
      cancelled = true;
    };
  }, [
    data,
    dueCount,
    hasAnyData,
    isLoggedIn,
    masteredCount,
    mistakeCount,
    patternMistakes,
    session,
    session.session,
    totalStudied,
    vocabularyInsightAccessResolved,
    vocabularyInsightLocked,
  ]);

  function handleExampleGate() {
    router.push('/auth/sign-in');
  }

  async function handleRefreshReport() {
    const ok = await guardEntry('premium_library');
    if (!ok) return;

    if (!session.session || insightLoading || insightRefreshing) return;
    if (totalStudied <= 0) {
      setInsight(null);
      setInsightError('你的学习样本还不够，继续学习后再更新报告。');
      return;
    }

    setInsightRefreshing(true);
    setInsightError(null);

    try {
      const next = await requestReportInsight(session.session, true);
      if (next.isSample) {
        setInsight(null);
        setInsightError('阶段报告暂时无法更新，请稍后重试。');
        return;
      }

      setInsight(next);
      setInsightError(null);
    } catch (err) {
      if (isVocabularyAuthError(err)) {
        const refreshedSession = await session.refreshSession();
        if (refreshedSession) {
          try {
            const retry = await requestReportInsight(refreshedSession, true);
            if (retry.isSample) {
              setInsight(null);
              setInsightError('阶段报告暂时无法更新，请稍后重试。');
            } else {
              setInsight(retry);
              setInsightError(null);
            }
          } catch (retryError) {
            setInsight(null);
            setInsightError(getVocabularyUserErrorMessage(retryError, 'report_update'));
          }
        } else {
          setInsight(null);
          setInsightError(getVocabularyUserErrorMessage(err, 'report_update'));
        }
      } else {
        setInsight(null);
        setInsightError(getVocabularyUserErrorMessage(err, 'report_update'));
      }
    } finally {
      setInsightRefreshing(false);
    }
  }

  const allLoading = notebookLoading || dashboardLoading || planLoading;
  const authRequired = (!hasAnyData && (notebookAuthRequired || dashboardAuthRequired || planAuthRequired)) || false;
  const realModeReady = Boolean(insight && insight.isSample === false);
  const displayInsight = exampleMode ? EXAMPLE_REPORT : realModeReady ? insight : null;
  const refreshBusy = insightLoading || insightRefreshing;
  const partialDataError = combinedError && hasAnyData ? combinedError : null;
  const sessionTotal = reviewStats ? reviewStats.known + reviewStats.unsure + reviewStats.unknown : 0;
  const sessionAccuracy = sessionTotal > 0 ? clampPercent((reviewStats!.known / sessionTotal) * 100) : '—';

  const phaseTags = exampleMode
    ? EXAMPLE_TAGS
    : [
        {
          label: '当前节奏',
          value: studyDays >= 4 ? '节奏稳定' : '节奏偏松',
          tone: studyDays >= 4 ? ('stability' as const) : ('pressure' as const),
        },
        {
          label: '主要问题',
          value:
            dueCount > mistakeCount && dueCount > masteredCount * 0.18
              ? '复习积压'
              : mistakeCount > 0
                ? '错词纠偏'
                : '复盘深化',
          tone:
            dueCount > mistakeCount && dueCount > masteredCount * 0.18
              ? ('pressure' as const)
              : mistakeCount > 0
                ? ('risk' as const)
                : ('stability' as const),
        },
        {
          label: '建议方向',
          value: dueCount > 0 ? '先回收复习' : mistakeCount > 0 ? '先做纠偏' : '继续主攻词书',
          tone: dueCount > 0 ? ('pressure' as const) : mistakeCount > 0 ? ('risk' as const) : ('stability' as const),
        },
      ];

  const strategyActions = useMemo(() => {
    if (exampleMode) {
      return EXAMPLE_REPORT.nextPhaseAdvice.map((item, index) => ({
        title: item,
        description: index === 0 ? '登录后可查看基于你的学习记录生成的阶段策略。' : '当前先展示体验策略，登录后会替换为你的个性化建议。',
        href: `/report-example-${index}`,
        buttonLabel: '登录查看',
      }));
    }

    if (!displayInsight) return [];

    return [
      {
        title: displayInsight.nextPhaseAdvice[0] ?? '优先回收当前到期词',
        description:
          dueCount > 0
            ? `当前还有 ${dueCount} 个待复习词，先清理可以最快拉稳下一阶段表现。`
            : '当前待复习压力不高，可以继续把主攻词书稳步推进下去。',
        href:
          dueCount > 0
            ? `/words/review?mode=review${focusBookSlug ? `&bookSlug=${encodeURIComponent(focusBookSlug)}` : ''}`
            : `/words/review?mode=learn${focusBookSlug ? `&bookSlug=${encodeURIComponent(focusBookSlug)}` : ''}`,
        buttonLabel: dueCount > 0 ? '去复习到期词' : '去开始学习',
      },
      {
        title: displayInsight.nextPhaseAdvice[1] ?? '安排一次错词专项回收',
        description:
          mistakeCount > 0
            ? `当前错词池还有 ${mistakeCount} 个词，专项处理会比零散查看更有效。`
            : '如果错词压力不高，可以回到计划页重新排顺下一阶段重点。',
        href: mistakeCount > 0 ? '/words/review?mode=mistake' : '/words/today',
        buttonLabel: mistakeCount > 0 ? '去专项复习' : '返回今日计划',
      },
      {
        title: displayInsight.nextPhaseAdvice[2] ?? `继续主攻 ${focusBookTitle}`,
        description:
          focusBookProgress > 0
            ? `${focusBookTitle} 当前进度 ${focusBookProgress}% ，保持连续输入更利于下一阶段复盘。`
            : `围绕 ${focusBookTitle} 继续推进学习，并补足语义辨析训练。`,
        href: `/words/review?mode=learn${focusBookSlug ? `&bookSlug=${encodeURIComponent(focusBookSlug)}` : ''}`,
        buttonLabel: '去开始学习',
      },
    ];
  }, [displayInsight, dueCount, exampleMode, focusBookProgress, focusBookSlug, focusBookTitle, mistakeCount]);

  const stageStats = exampleMode
    ? EXAMPLE_STAGE_STATS
    : [
        { label: '总学习词数', value: String(totalStudied) },
        { label: '掌握率', value: `${masteryRate}%` },
        { label: '本轮正确率', value: typeof sessionAccuracy === 'number' ? `${sessionAccuracy}%` : '—' },
        { label: '错词率', value: totalStudied > 0 ? `${clampPercent((mistakeCount / totalStudied) * 100)}%` : '—' },
      ];
  const shellHeader = <ReportHeader exampleMode={exampleMode} loading={refreshBusy} onRefresh={handleRefreshReport} />;

  if (!exampleMode && !vocabularyInsightAccessResolved) {
    return (
      <AppScreenShell
        header={shellHeader}
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        includeBottomInset={false}
        disableTabletTopInset={isTablet}
      >
        <AnalysisUnavailableCard title="正在同步完整学习权益" message="权益确认完成后，才会继续生成你的 AI 学习报告。" />
      </AppScreenShell>
    );
  }

  if (!exampleMode && vocabularyInsightLocked) {
    return (
      <AppScreenShell
        header={shellHeader}
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        includeBottomInset={false}
        disableTabletTopInset={isTablet}
      >
        <AnalysisUnavailableCard
          title="开通后查看 AI 学习报告"
          message="单词 AI 学习报告属于完整学习权益。开通后可基于你的学习记录生成阶段总结和建议。"
        />
      </AppScreenShell>
    );
  }

  if (!exampleMode && authRequired) {
    return (
      <AppScreenShell
        header={shellHeader}
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        includeBottomInset={false}
        disableTabletTopInset={isTablet}
      >
        <AnalysisUnavailableCard title="登录后继续查看阶段报告" message="当前登录状态不可用，请重新登录后再更新你的学习报告。" />
      </AppScreenShell>
    );
  }

  if (!exampleMode && allLoading && !hasAnyData) {
    return (
      <AppScreenShell scrollable={false} header={shellHeader} includeBottomInset={false} disableTabletTopInset={isTablet}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={TEXT_SECONDARY} />
        </View>
      </AppScreenShell>
    );
  }

  if (!exampleMode && combinedError && !hasAnyData) {
    return (
      <AppScreenShell
        header={shellHeader}
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        includeBottomInset={false}
        disableTabletTopInset={isTablet}
      >
        <SurfaceCard style={{ marginHorizontal: SPACING_PAGE_H }}>
          <View style={{ gap: 16 }}>
            <AppText style={{ fontSize: 22, fontWeight: '700', color: TEXT_PRIMARY }}>学习报告加载失败</AppText>
            <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: TEXT_SECONDARY }}>
              现在还没有成功取回学习样本，请稍后再试。
            </AppText>
            <AppText style={{ fontSize: 12, color: COLOR_RED }}>{combinedError}</AppText>
            <Pressable
              onPress={() => {
                void refreshNotebook();
                void refreshPlan();
              }}
              style={({ pressed }) => ({
                minHeight: 46,
                borderRadius: 16,
                backgroundColor: BG_CARD_SOFT,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.76 : 1,
              })}
            >
              <AppText style={{ fontSize: FONT_BODY, fontWeight: '600', color: TEXT_PRIMARY }}>重试基础数据</AppText>
            </Pressable>
          </View>
        </SurfaceCard>
      </AppScreenShell>
    );
  }

  return (
    <AppScreenShell
      header={shellHeader}
      contentContainerStyle={{ paddingBottom: 28 }}
      showsVerticalScrollIndicator={false}
      includeBottomInset={false}
      disableTabletTopInset={isTablet}
    >
      <View style={{ width: '100%', maxWidth: isTablet ? TABLET_PAGE_MAX_WIDTH : undefined, alignSelf: 'center' }}>
        <SurfaceCard style={{ marginHorizontal: SPACING_PAGE_H, padding: 20 }}>
          <View style={{ gap: 14 }}>
            <SmallPill label={exampleMode ? '体验报告' : 'AI 阶段总览'} />
            {displayInsight ? (
              <AppText style={{ fontSize: 24, fontWeight: '600', lineHeight: 33, color: TEXT_PRIMARY }}>
                {displayInsight.stageSummary}
              </AppText>
            ) : (
              <View style={{ gap: 8 }}>
                <AppText style={{ fontSize: FONT_BODY, fontWeight: '700', color: TEXT_PRIMARY }}>暂时无法更新报告</AppText>
                <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: TEXT_SECONDARY }}>
                  {insightError ?? '阶段报告还在整理中，先保留阶段数据参考，稍后再更新。'}
                </AppText>
              </View>
            )}
            {displayInsight ? (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {phaseTags.map((tag) => (
                  <SummaryTag key={tag.label} label={tag.label} value={tag.value} tone={tag.tone} />
                ))}
              </View>
            ) : null}
            {exampleMode ? (
              <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: TEXT_SECONDARY }}>
                当前展示的是体验内容，登录并完成学习后可查看你的专属阶段报告。
              </AppText>
            ) : null}
            {insightLoading ? <AppText style={{ fontSize: FONT_CAPTION, color: TEXT_SECONDARY }}>正在整理阶段报告…</AppText> : null}
            {insightRefreshing ? <AppText style={{ fontSize: FONT_CAPTION, color: TEXT_SECONDARY }}>正在更新阶段报告…</AppText> : null}
            {!exampleMode && insightError ? <AppText style={{ fontSize: FONT_CAPTION, color: COLOR_RED }}>{insightError}</AppText> : null}
          </View>
        </SurfaceCard>

        {isTablet ? (
          <View style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-start' }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <SectionTitle title="本阶段主要问题" />
              {displayInsight ? (
                <View style={{ gap: 10, marginBottom: 10 }}>
                  {displayInsight.keyProblems.slice(0, 3).map((item, index) => (
                    <StageCard key={`${item}-${index}`} text={item} tone="problem" />
                  ))}
                </View>
              ) : (
                <AnalysisUnavailableCard title="本阶段主要问题" message="阶段报告还在整理中，稍后再查看本阶段问题判断。" />
              )}

              <SectionTitle title="本阶段做得好的" />
              {displayInsight ? (
                <View style={{ gap: 10, marginBottom: 10 }}>
                  {displayInsight.strengths.slice(0, 3).map((item, index) => (
                    <StageCard key={`${item}-${index}`} text={item} tone="strong" />
                  ))}
                </View>
              ) : (
                <AnalysisUnavailableCard title="本阶段做得好的" message="阶段报告还在整理中，稍后再查看本阶段优势总结。" />
              )}
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <SectionTitle title="AI 建议的下一阶段策略" />
              {strategyActions.length > 0 ? (
                <View style={{ gap: 0, marginBottom: 6 }}>
                  {strategyActions.map((item, index) => (
                    <StrategyCard
                      key={`${item.title}-${index}`}
                      index={index}
                      title={item.title}
                      description={item.description}
                      buttonLabel={item.buttonLabel}
                      onPress={() => (exampleMode ? handleExampleGate() : router.push(item.href as never))}
                    />
                  ))}
                </View>
              ) : (
                <AnalysisUnavailableCard title="AI 建议的下一阶段策略" message="阶段报告还在整理中，稍后再查看下一阶段策略。" />
              )}

              <SectionTitle title="阶段数据参考" />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: SPACING_PAGE_H, paddingBottom: 10 }}>
                {stageStats.map((item) => (
                  <MetricCard key={item.label} label={item.label} value={item.value} />
                ))}
              </View>
            </View>
          </View>
        ) : (
          <>
            <SectionTitle title="本阶段主要问题" />
            {displayInsight ? (
              <View style={{ gap: 10, marginBottom: 10 }}>
                {displayInsight.keyProblems.slice(0, 3).map((item, index) => (
                  <StageCard key={`${item}-${index}`} text={item} tone="problem" />
                ))}
              </View>
            ) : (
              <AnalysisUnavailableCard title="本阶段主要问题" message="阶段报告还在整理中，稍后再查看本阶段问题判断。" />
            )}

            <SectionTitle title="本阶段做得好的" />
            {displayInsight ? (
              <View style={{ gap: 10, marginBottom: 10 }}>
                {displayInsight.strengths.slice(0, 3).map((item, index) => (
                  <StageCard key={`${item}-${index}`} text={item} tone="strong" />
                ))}
              </View>
            ) : (
              <AnalysisUnavailableCard title="本阶段做得好的" message="阶段报告还在整理中，稍后再查看本阶段优势总结。" />
            )}

            <SectionTitle title="AI 建议的下一阶段策略" />
            {strategyActions.length > 0 ? (
              <View style={{ gap: 0, marginBottom: 6 }}>
                {strategyActions.map((item, index) => (
                  <StrategyCard
                    key={`${item.title}-${index}`}
                    index={index}
                    title={item.title}
                    description={item.description}
                    buttonLabel={item.buttonLabel}
                    onPress={() => (exampleMode ? handleExampleGate() : router.push(item.href as never))}
                  />
                ))}
              </View>
            ) : (
              <AnalysisUnavailableCard title="AI 建议的下一阶段策略" message="阶段报告还在整理中，稍后再查看下一阶段策略。" />
            )}

            <SectionTitle title="阶段数据参考" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: SPACING_PAGE_H, paddingBottom: 10 }}>
              {stageStats.map((item) => (
                <MetricCard key={item.label} label={item.label} value={item.value} />
              ))}
            </View>
          </>
        )}

        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: SPACING_PAGE_H, paddingTop: 6, paddingBottom: 4 }}>
          <View style={{ flex: 1 }}>
            <ReportActionButton label={exampleMode ? '登录查看' : '返回今日计划'} tone="secondary" onPress={() => (exampleMode ? handleExampleGate() : router.push('/words/today'))} />
          </View>
          <View style={{ flex: 1 }}>
            <ReportActionButton
              label={exampleMode ? '登录查看' : dueCount > 0 ? '执行建议：清空到期词' : '执行建议：继续学习'}
              tone="secondary"
              onPress={() =>
                exampleMode
                  ? handleExampleGate()
                  : router.push(
                      (dueCount > 0
                        ? `/words/review?mode=review${focusBookSlug ? `&bookSlug=${encodeURIComponent(focusBookSlug)}` : ''}`
                        : `/words/review?mode=learn${focusBookSlug ? `&bookSlug=${encodeURIComponent(focusBookSlug)}` : ''}`) as never,
                    )
              }
            />
          </View>
        </View>

        {partialDataError ? (
          <View style={{ marginHorizontal: SPACING_PAGE_H }}>
            <AppText style={{ fontSize: 12, color: COLOR_RED }}>{partialDataError}</AppText>
          </View>
        ) : null}
      </View>
    </AppScreenShell>
  );
}
