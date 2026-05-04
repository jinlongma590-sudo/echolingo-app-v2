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
  fetchVocabularyAnalysisInsight,
  isVocabularyAuthError,
  type VocabularyAnalysisInsight,
} from '@/services/api/vocabulary';
import { getVocabularyUserErrorMessage } from '@/services/api/vocabularyErrorCopy';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import {
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
  FONT_TITLE,
  RADIUS_CARD,
  SPACING_PAGE_H,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from '@/theme/tokens';
import { useAppTheme } from '@/theme/AppThemeProvider';

const TABLET_PAGE_MAX_WIDTH = 1220;

type SignalTone = 'weak' | 'strong';

type StrategyAction = {
  title: string;
  description: string;
  buttonLabel: string;
  href: string;
};

const ANALYSIS_LABELS = [
  '抽象形容词',
  '学术动词',
  '连接副词',
  '具象名词',
  '词根词缀',
  '高频短语',
  '日常表达',
  '语义辨析词',
  '近义混淆词',
  '核心口语表达',
  '固定搭配',
  '场景表达',
  '功能词',
  '高频词汇',
] as const;

const EXAMPLE_INSIGHT: VocabularyAnalysisInsight = {
  summary:
    '你目前已完成基础词汇积累，但复习回收明显弱于新词输入，记忆曲线存在断点风险。当前更值得优先处理的是把待复习与错词压力压回可控区间。',
  weakPatterns: [
    '抽象形容词理解偏弱，近期更容易在这类词上反复出错。',
    '学术动词回收节奏偏慢，复习队列里这部分词更容易积压。',
    '连接副词辨析不够稳定，说明语义边界还需要继续拉清。',
  ],
  strongPatterns: [
    '具象名词掌握更稳，说明你在有画面感的词汇上吸收效率更高。',
    '词根词缀迁移效果更好，适合继续作为主攻扩展方式。',
  ],
  nextStrategies: [
    { action: '先回收到期复习，再继续推进新词', reason: '先把当前记忆断点补齐，会比继续堆输入更快提升整体稳定度。' },
    { action: '安排一轮错词纠偏', reason: '集中处理反复出错的词，会比零散查看更容易把风险压下去。' },
    { action: '继续沿主攻词书做稳定输入', reason: '在风险回收后维持连续输入，才能让当前优势继续转成长期积累。' },
  ],
  isSample: true,
};

const EXAMPLE_DIAGNOSTICS = [
  { label: '掌握率', value: '55%', note: '基础框架已经建立。', tint: 'green' as const },
  { label: '待复习', value: '36', note: '当前仍有一批到期词待回收。', tint: 'amber' as const },
  { label: '错词', value: '12', note: '高频错词仍需集中纠偏。', tint: 'red' as const },
  { label: '近 7 天学习', value: '5 天', note: '最近节奏还能维持。', tint: 'neutral' as const },
];

const EXAMPLE_BEHAVIOR_ITEMS = [
  { title: '最近学习稳定性', detail: '近 7 天保持 5 天学习，节奏基本连贯，但复习回收仍慢于新词输入。' },
  { title: '当前复习压力', detail: '待复习词仍有积压，先清理当前到期词会比继续加新词更稳。' },
  { title: '主攻词书推进', detail: '主攻词书已经进入稳定推进阶段，但需要把复习和输入重新拉回同一节奏。' },
  { title: '近期高频问题', detail: '高频问题主要集中在抽象形容词和学术动词，这两类更适合先做专项强化。' },
];

const EXAMPLE_STRUCTURE = {
  mastered: 214,
  due: 36,
  mistake: 12,
};

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function dayKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function normalizePatternLabel(pattern: string) {
  const normalized = pattern.trim();
  for (const label of ANALYSIS_LABELS) {
    if (normalized.startsWith(label)) return label;
  }

  const head = normalized.slice(0, 12);
  for (const label of ANALYSIS_LABELS) {
    if (head.includes(label)) return label;
  }

  return normalized;
}

function normalizePatternDescription(pattern: string, label: string) {
  const trimmed = pattern.trim();
  if (trimmed.startsWith(label)) {
    const next = trimmed.slice(label.length).replace(/^[\s,，:：]+/, '').trim();
    return next || `${label}是当前更需要继续观察的一块。`;
  }
  return trimmed;
}

function rankProgress(index: number, tone: SignalTone) {
  const values = tone === 'weak' ? [78, 60, 44] : [76, 58, 42];
  return values[index] ?? 36;
}

function rankTag(index: number, tone: SignalTone) {
  if (tone === 'weak') {
    if (index === 0) return '需优先补强';
    if (index === 1) return '继续回收';
    return '继续观察';
  }

  if (index === 0) return '较稳定';
  if (index === 1) return '在延续';
  return '可继续放大';
}

function buildPatternSignals(patterns: string[], tone: SignalTone) {
  return patterns.slice(0, 3).map((pattern, index) => {
    const label = normalizePatternLabel(pattern);
    return {
      title: label,
      description: normalizePatternDescription(pattern, label),
      progress: rankProgress(index, tone),
      tag: rankTag(index, tone),
      tone,
    };
  });
}

function buildStrategyTarget(index: number, focusBookSlug: string, dueCount: number, mistakeCount: number) {
  if (index === 0) {
    if (dueCount > 0) {
      return {
        buttonLabel: '去复习到期词',
        href: `/words/review?mode=review${focusBookSlug ? `&bookSlug=${encodeURIComponent(focusBookSlug)}` : ''}`,
      };
    }
    if (mistakeCount > 0) {
      return {
        buttonLabel: '去专项复习',
        href: '/words/review?mode=mistake',
      };
    }
    return {
      buttonLabel: '去开始学习',
      href: `/words/review?mode=learn${focusBookSlug ? `&bookSlug=${encodeURIComponent(focusBookSlug)}` : ''}`,
    };
  }

  if (index === 1) {
    if (mistakeCount > 0) {
      return {
        buttonLabel: '去专项复习',
        href: '/words/review?mode=mistake',
      };
    }
    return {
      buttonLabel: '看今日计划',
      href: '/words/today',
    };
  }

  return {
    buttonLabel: '去开始学习',
    href: `/words/review?mode=learn${focusBookSlug ? `&bookSlug=${encodeURIComponent(focusBookSlug)}` : ''}`,
  };
}

function buildExampleStrategies() {
  return EXAMPLE_INSIGHT.nextStrategies.map((item, index) => ({
    title: item.action,
    description: item.reason,
    buttonLabel: '登录查看',
    href: `/analysis-example-${index}`,
  }));
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
  return <ChromeIconButton icon="refresh-outline" onPress={onPress} accessibilityLabel="更新分析" loading={loading} />;
}

function AnalysisHeader({
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
      {exampleMode ? <SmallPill label="体验洞察" /> : null}
    </View>
  );
}

function AnalysisActionButton({
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
        minHeight: compact ? 32 : 40,
        borderRadius: compact ? 12 : 14,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: compact ? 10 : 14,
        backgroundColor: tone === 'primary' ? theme.primaryBlue : theme.secondaryCardBackground,
        borderWidth: 1,
        borderColor: tone === 'primary' ? theme.primaryBlue : theme.border,
        opacity: pressed ? 0.76 : 1,
      })}
    >
      <AppText style={{ fontSize: compact ? FONT_MICRO : FONT_CAPTION, fontWeight: '600', color: tone === 'primary' ? '#FFFFFF' : theme.textPrimary }}>{label}</AppText>
    </Pressable>
  );
}

function MetricCard({
  label,
  value,
  note,
  tint = 'neutral',
}: {
  label: string;
  value: string;
  note: string;
  tint?: 'neutral' | 'amber' | 'red' | 'green';
}) {
  const { theme } = useAppTheme();
  const palette =
    tint === 'red'
      ? { bg: theme.secondaryCardBackground, chip: theme.colorScheme === 'dark' ? 'rgba(255,69,58,0.14)' : COLOR_RED_BG, fg: theme.destructive }
      : tint === 'amber'
        ? { bg: theme.secondaryCardBackground, chip: theme.colorScheme === 'dark' ? 'rgba(255,159,10,0.16)' : COLOR_AMBER_BG, fg: theme.warning }
        : tint === 'green'
          ? { bg: theme.secondaryCardBackground, chip: theme.colorScheme === 'dark' ? 'rgba(48,209,88,0.14)' : COLOR_GREEN_BG, fg: theme.success }
          : { bg: theme.secondaryCardBackground, chip: theme.colorScheme === 'dark' ? 'rgba(10,132,255,0.16)' : COLOR_BLUE_BG, fg: theme.primaryBlue };

  return (
    <View
      style={{
        width: '48%',
        borderRadius: RADIUS_CARD,
        backgroundColor: palette.bg,
        borderWidth: 1,
        borderColor: theme.border,
        padding: 14,
        gap: 8,
      }}
    >
      <View
        style={{
          alignSelf: 'flex-start',
          borderRadius: 999,
          paddingHorizontal: 8,
          paddingVertical: 4,
          backgroundColor: palette.chip,
        }}
      >
        <AppText style={{ fontSize: FONT_MICRO, color: palette.fg }}>{label}</AppText>
      </View>
      <AppText style={{ fontSize: 24, fontWeight: '700', letterSpacing: -0.4, color: theme.textPrimary }}>{value}</AppText>
      <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 17, color: theme.textSecondary }}>{note}</AppText>
    </View>
  );
}

function SignalRow({
  title,
  description,
  progress,
  tag,
  tone,
}: {
  title: string;
  description: string;
  progress: number;
  tag: string;
  tone: SignalTone;
}) {
  const { theme } = useAppTheme();
  const palette =
    tone === 'strong'
      ? { bg: theme.colorScheme === 'dark' ? 'rgba(48,209,88,0.14)' : 'rgba(52,199,89,0.08)', bar: theme.success, fg: theme.success }
      : { bg: theme.colorScheme === 'dark' ? 'rgba(255,159,10,0.16)' : 'rgba(245,166,35,0.08)', bar: theme.warning, fg: theme.warning };

  return (
    <View
      style={{
        marginHorizontal: SPACING_PAGE_H,
        marginBottom: 10,
        borderRadius: 18,
        paddingHorizontal: 16,
        paddingVertical: 14,
        backgroundColor: tone === 'strong' ? theme.secondaryCardBackground : theme.elevatedCardBackground,
        borderWidth: 1,
        borderColor: theme.border,
      }}
    >
      <View style={{ gap: 9 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <AppText style={{ fontSize: FONT_BODY, fontWeight: '600', color: TEXT_PRIMARY }}>{title}</AppText>
            <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: TEXT_SECONDARY }}>{description}</AppText>
          </View>
          <View
            style={{
              borderRadius: 999,
              paddingHorizontal: 8,
              paddingVertical: 4,
              backgroundColor: palette.bg,
            }}
          >
            <AppText style={{ fontSize: 10, color: palette.fg }}>{tag}</AppText>
          </View>
        </View>

        <View
          style={{
            height: 5,
            borderRadius: 999,
            backgroundColor: theme.fillPrimary,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: `${Math.max(8, Math.min(100, progress))}%`,
              height: '100%',
              borderRadius: 999,
              backgroundColor: palette.bar,
            }}
          />
        </View>
      </View>
    </View>
  );
}

function StructureStrip({
  mastered,
  due,
  mistake,
}: {
  mastered: number;
  due: number;
  mistake: number;
}) {
  const { theme } = useAppTheme();
  const total = Math.max(mastered + due + mistake, 1);
  const masteredWidth = (mastered / total) * 100;
  const dueWidth = (due / total) * 100;
  const mistakeWidth = (mistake / total) * 100;

  const rows = [
    { label: '已掌握', value: mastered, tint: COLOR_GREEN_BG, fg: '#2D8F4E' },
    { label: '待复习', value: due, tint: COLOR_AMBER_BG, fg: '#B9770E' },
    { label: '错词', value: mistake, tint: COLOR_RED_BG, fg: COLOR_RED },
  ];

  return (
    <SurfaceCard style={{ marginHorizontal: SPACING_PAGE_H, padding: 18 }}>
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', height: 12, borderRadius: 999, overflow: 'hidden', backgroundColor: theme.fillPrimary }}>
          <View style={{ width: `${masteredWidth}%`, backgroundColor: theme.success }} />
          <View style={{ width: `${dueWidth}%`, backgroundColor: theme.warning }} />
          <View style={{ width: `${mistakeWidth}%`, backgroundColor: theme.destructive }} />
        </View>

        <View style={{ gap: 10 }}>
          {rows.map((item) => (
            <View key={item.label} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: item.fg, opacity: 0.6 }} />
                <AppText style={{ fontSize: FONT_CALLOUT, color: TEXT_PRIMARY }}>{item.label}</AppText>
              </View>
              <View
                style={{
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  backgroundColor: item.tint,
                }}
              >
                <AppText style={{ fontSize: FONT_MICRO, fontWeight: '600', color: item.fg }}>{item.value}</AppText>
              </View>
            </View>
          ))}
        </View>
      </View>
    </SurfaceCard>
  );
}

function BehaviorRow({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <View style={{ gap: 4, paddingVertical: 12 }}>
      <AppText style={{ fontSize: FONT_CAPTION, color: TEXT_SECONDARY }}>{title}</AppText>
      <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: TEXT_PRIMARY }}>{detail}</AppText>
    </View>
  );
}

function SuggestionCard({
  title,
  description,
  buttonLabel,
  onPress,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  onPress: () => void;
}) {
  return (
    <SurfaceCard style={{ marginHorizontal: SPACING_PAGE_H, marginBottom: 10, padding: 16 }}>
      <View style={{ gap: 10 }}>
        <View style={{ gap: 4 }}>
          <AppText style={{ fontSize: FONT_BODY, fontWeight: '700', color: TEXT_PRIMARY }}>{title}</AppText>
          <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: TEXT_SECONDARY }}>{description}</AppText>
        </View>
        <View style={{ width: 122 }}>
          <AnalysisActionButton label={buttonLabel} onPress={onPress} compact />
        </View>
      </View>
    </SurfaceCard>
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

export function WordsAnalysisScreen() {
  const { theme } = useAppTheme();
  const { isTablet } = useDeviceClass();
  const session = useAppSession();
  const { guardEntry } = useEntitlementGuard();
  const { status: mobileMeStatus, data: mobileMe } = useMobileMe();
  const { dashboard, loading: dashboardLoading, error: dashboardError, authRequired: dashboardAuthRequired } = useVocabularyDashboardData();
  const { plan, loading: planLoading, error: planError, authRequired: planAuthRequired, refresh: refreshPlan } = useVocabularyTodayPlanData();
  const { data, loading: notebookLoading, error: notebookError, authRequired: notebookAuthRequired, refresh: refreshNotebook } = useVocabularyNotebookData();
  const [insight, setInsight] = useState<VocabularyAnalysisInsight | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightRefreshing, setInsightRefreshing] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);

  const isLoggedIn = session.status === 'authenticated';
  const exampleMode = !isLoggedIn;
  const vocabularyInsightAccessResolved =
    !isLoggedIn || mobileMeStatus === 'ready' || (mobileMeStatus === 'sync_failed' && Boolean(mobileMe));
  const vocabularyInsightLocked =
    isLoggedIn && vocabularyInsightAccessResolved && mobileMe?.entitlements.canUseVocabulary === false;
  const hasAnyData = Boolean(dashboard || plan || data);
  const combinedError = dashboardError || planError || notebookError;

  const words = data?.words ?? [];
  const totalStudied = words.length;
  const masteredCount = data?.stats.mastered ?? plan?.summary.backlog.masteredCount ?? 0;
  const dueCount = plan?.summary.backlog.dueCount ?? data?.stats.due ?? dashboard?.todayDueCount ?? 0;
  const dueNowCount = plan?.summary.backlog.dueNowCount ?? dashboard?.todayDueCount ?? dueCount;
  const mistakeCount = plan?.summary.backlog.mistakeCount ?? data?.stats.mistake ?? dashboard?.mistakeWordsCount ?? 0;
  const masteryRate = totalStudied > 0 ? clampPercent((masteredCount / totalStudied) * 100) : dashboard?.masteryRate ?? 0;
  const focusBookTitle = plan?.summary.focusBook.title ?? dashboard?.books[0]?.title ?? '当前词书';
  const focusBookSlug = plan?.summary.focusBook.slug ?? dashboard?.books[0]?.slug ?? '';
  const focusBookProgress = plan?.summary.focusBook.percentage ?? 0;

  const studyDays = useMemo(() => {
    const now = Date.now();
    const recentDays = new Set<string>();
    for (const word of words) {
      const source = word.lastReviewedAt || word.nextReviewAt;
      if (!source) continue;
      const diff = now - new Date(source).getTime();
      if (diff <= 7 * 24 * 60 * 60 * 1000) {
        recentDays.add(dayKey(source));
      }
    }
    return recentDays.size;
  }, [words]);

  const topMistakeWords = useMemo(
    () =>
      [...words]
        .filter((word) => word.status === 'mistake' || (word.mistakeCount ?? 0) > 0)
        .sort((a, b) => (b.mistakeCount ?? 0) - (a.mistakeCount ?? 0))
        .slice(0, 5)
        .map((word) => word.word),
    [words],
  );

  const analysisSignals = useMemo(() => {
    const patternCounts = new Map<string, { mistakes: number; mastered: number }>();

    words.forEach((word) => {
      if (!word.pattern) return;
      const current = patternCounts.get(word.pattern) ?? { mistakes: 0, mastered: 0 };
      if (word.status === 'mistake' || (word.mistakeCount ?? 0) > 0) current.mistakes += 1;
      if (word.status === 'mastered') current.mastered += 1;
      patternCounts.set(word.pattern, current);
    });

    return {
      patternMistakes: Array.from(patternCounts.entries())
        .filter(([, value]) => value.mistakes > 0)
        .sort((a, b) => b[1].mistakes - a[1].mistakes)
        .slice(0, 3)
        .map(([pattern, value]) => [pattern, value.mistakes] as [string, number]),
      patternMastered: Array.from(patternCounts.entries())
        .filter(([, value]) => value.mastered > 0 && value.mistakes === 0)
        .sort((a, b) => b[1].mastered - a[1].mastered)
        .slice(0, 3)
        .map(([pattern]) => pattern),
    };
  }, [words]);

  const insightKey = useMemo(
    () =>
      JSON.stringify({
        totalStudied,
        masteredCount,
        mistakeCount,
        dueCount,
        patternMistakes: analysisSignals.patternMistakes,
        patternMastered: analysisSignals.patternMastered,
        topMistakeWords,
      }),
    [analysisSignals.patternMastered, analysisSignals.patternMistakes, dueCount, masteredCount, mistakeCount, topMistakeWords, totalStudied],
  );

  useEffect(() => {
    const currentSession = session.session;
    if (!currentSession || !isLoggedIn || !hasAnyData || vocabularyInsightLocked || !vocabularyInsightAccessResolved) {
      setInsight(null);
      setInsightError(null);
      setInsightLoading(false);
      setInsightRefreshing(false);
      return;
    }

    let cancelled = false;

    async function loadRealInsight(forceRefresh: boolean, activeSession: NonNullable<typeof currentSession>) {
      if (totalStudied <= 0) {
        if (!cancelled) {
          setInsight(null);
          setInsightError('你的学习样本还不够，继续学习后再更新分析。');
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
        const next = await fetchVocabularyAnalysisInsight(activeSession, {
          totalStudied,
          masteredCount,
          mistakeCount,
          dueCount,
          patternMistakes: analysisSignals.patternMistakes,
          patternMastered: analysisSignals.patternMastered,
          topMistakeWords,
          refresh: forceRefresh,
        });

        if (cancelled) return;

        if (next.isSample) {
          setInsight(null);
          setInsightError('学习解读暂时无法更新，请稍后重试。');
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
            void loadRealInsight(forceRefresh, refreshedSession);
            return;
          }
          setInsight(null);
          setInsightError(getVocabularyUserErrorMessage(err, 'analysis_update'));
          return;
        }

        setInsight(null);
        setInsightError(getVocabularyUserErrorMessage(err, 'analysis_update'));
      } finally {
        if (!cancelled) {
          setInsightLoading(false);
          setInsightRefreshing(false);
        }
      }
    }

    void loadRealInsight(false, currentSession);
    return () => {
      cancelled = true;
    };
  }, [
    analysisSignals.patternMastered,
    analysisSignals.patternMistakes,
    dueCount,
    hasAnyData,
    insightKey,
    isLoggedIn,
    masteredCount,
    mistakeCount,
    session,
    session.session,
    topMistakeWords,
    totalStudied,
    vocabularyInsightAccessResolved,
    vocabularyInsightLocked,
  ]);

  function handleExampleGate() {
    router.push('/auth/sign-in');
  }

  async function handleRefreshAnalysis() {
    const ok = await guardEntry('premium_library');
    if (!ok) return;

    if (!session.session || insightLoading || insightRefreshing) return;
    if (totalStudied <= 0) {
      setInsight(null);
      setInsightError('你的学习样本还不够，继续学习后再更新分析。');
      return;
    }

    setInsightRefreshing(true);
    setInsightError(null);

    try {
      const next = await fetchVocabularyAnalysisInsight(session.session, {
        totalStudied,
        masteredCount,
        mistakeCount,
        dueCount,
        patternMistakes: analysisSignals.patternMistakes,
        patternMastered: analysisSignals.patternMastered,
        topMistakeWords,
        refresh: true,
      });

      if (next.isSample) {
        setInsightError('学习解读暂时无法更新，请稍后重试。');
        return;
      }

      setInsight(next);
      setInsightError(null);
    } catch (err) {
      if (isVocabularyAuthError(err)) {
        const refreshedSession = await session.refreshSession();
        if (refreshedSession) {
          try {
            const retry = await fetchVocabularyAnalysisInsight(refreshedSession, {
              totalStudied,
              masteredCount,
              mistakeCount,
              dueCount,
              patternMistakes: analysisSignals.patternMistakes,
              patternMastered: analysisSignals.patternMastered,
              topMistakeWords,
              refresh: true,
            });
            if (retry.isSample) {
              setInsightError('学习解读暂时无法更新，请稍后重试。');
            } else {
              setInsight(retry);
              setInsightError(null);
            }
          } catch (retryError) {
            setInsightError(getVocabularyUserErrorMessage(retryError, 'analysis_update'));
          }
        } else {
          setInsightError(getVocabularyUserErrorMessage(err, 'analysis_update'));
        }
      } else {
        setInsightError(getVocabularyUserErrorMessage(err, 'analysis_update'));
      }
    } finally {
      setInsightRefreshing(false);
    }
  }

  const allLoading = dashboardLoading || planLoading || notebookLoading;
  const authRequired = (!hasAnyData && (dashboardAuthRequired || planAuthRequired || notebookAuthRequired)) || false;
  const realModeReady = Boolean(insight && insight.isSample === false);
  const displayInsight = exampleMode ? EXAMPLE_INSIGHT : realModeReady ? insight : null;
  const currentAction = useMemo<StrategyAction | null>(() => {
    if (exampleMode) return buildExampleStrategies()[0] ?? null;
    if (!displayInsight?.nextStrategies?.[0]) return null;
    const target = buildStrategyTarget(0, focusBookSlug, dueCount, mistakeCount);
    return {
      title: displayInsight.nextStrategies[0].action,
      description: displayInsight.nextStrategies[0].reason,
      ...target,
    };
  }, [displayInsight, dueCount, exampleMode, focusBookSlug, mistakeCount]);

  const moreSuggestions = useMemo(() => {
    if (exampleMode) return buildExampleStrategies().slice(1, 3);
    if (!displayInsight) return [];
    return displayInsight.nextStrategies.slice(1, 3).map((item, index) => {
      const target = buildStrategyTarget(index + 1, focusBookSlug, dueCount, mistakeCount);
      return {
        title: item.action,
        description: item.reason,
        ...target,
      };
    });
  }, [displayInsight, dueCount, exampleMode, focusBookSlug, mistakeCount]);

  const weakSignals = useMemo(() => buildPatternSignals(displayInsight?.weakPatterns ?? [], 'weak'), [displayInsight]);
  const strongSignals = useMemo(() => buildPatternSignals(displayInsight?.strongPatterns ?? [], 'strong'), [displayInsight]);
  const topPattern = analysisSignals.patternMistakes[0]?.[0] ?? null;

  const diagnostics = exampleMode
    ? EXAMPLE_DIAGNOSTICS
    : [
        {
          label: '掌握率',
          value: `${masteryRate}%`,
          note: masteryRate >= 55 ? '当前基础框架已经建立。' : '当前掌握框架还在继续搭建。',
          tint: masteryRate >= 55 ? ('green' as const) : ('amber' as const),
        },
        {
          label: '待复习',
          value: String(dueCount),
          note: dueNowCount > 0 ? `其中 ${dueNowCount} 个已经到期。` : '当前待复习压力相对平稳。',
          tint: dueCount > 0 ? ('amber' as const) : ('neutral' as const),
        },
        {
          label: '错词',
          value: String(mistakeCount),
          note: mistakeCount > 0 ? '当前仍有高频错词需要单独回收。' : '当前错词池压力较轻。',
          tint: mistakeCount > 0 ? ('red' as const) : ('neutral' as const),
        },
        {
          label: '近 7 天学习',
          value: `${studyDays} 天`,
          note: studyDays >= 5 ? '最近节奏比较稳定。' : studyDays >= 3 ? '最近节奏还能维持。' : '最近节奏还需要拉回连续状态。',
          tint: studyDays >= 5 ? ('green' as const) : ('amber' as const),
        },
      ];

  const structure = exampleMode
    ? EXAMPLE_STRUCTURE
    : {
        mastered: masteredCount,
        due: dueCount,
        mistake: mistakeCount,
      };

  const behaviorItems = exampleMode
    ? EXAMPLE_BEHAVIOR_ITEMS
    : [
        {
          title: '最近学习稳定性',
          detail:
            studyDays >= 5
              ? `近 7 天学习 ${studyDays} 天，整体节奏比较稳。`
              : studyDays >= 3
                ? `近 7 天学习 ${studyDays} 天，节奏还能维持，但还不够连续。`
                : '最近学习记录偏少，更需要先把节奏重新拉起来。',
        },
        {
          title: '当前复习压力',
          detail:
            dueNowCount > 0
              ? `当前有 ${dueNowCount} 个词已经到期，先清理这部分积压会更稳。`
              : dueCount > 0
                ? `当前还有 ${dueCount} 个待复习词，复习压力仍需要继续回收。`
                : '当前待复习压力较轻，可以继续维持现在的节奏。',
        },
        {
          title: '主攻词书推进',
          detail:
            focusBookProgress > 0
              ? `${focusBookTitle} 当前进度 ${focusBookProgress}% ，处理完当前复习压力后继续推进会更稳。`
              : `${focusBookTitle} 已经进入学习流，下一步适合把复习和新词推进放回同一节奏里。`,
        },
        {
          title: '近期高频问题',
          detail: topPattern
            ? `当前高频问题更集中在 ${topPattern}，这也是下一轮更值得优先补强的方向。`
            : '当前高频问题还不够集中，继续累积样本后再看分析会更准确。',
        },
      ];

  const aiCardLabel = exampleMode ? '体验洞察' : 'AI 学习解读';
  const aiCardSummary = displayInsight?.summary ?? null;
  const showInsightDependentSections = exampleMode || realModeReady;
  const refreshBusy = insightLoading || insightRefreshing;
  const partialDataError = combinedError && hasAnyData ? combinedError : null;
  const shellHeader = <AnalysisHeader exampleMode={exampleMode} loading={refreshBusy} onRefresh={handleRefreshAnalysis} />;

  if (!exampleMode && !vocabularyInsightAccessResolved) {
    return (
      <AppScreenShell
        header={shellHeader}
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        includeBottomInset={false}
        disableTabletTopInset={isTablet}
      >
        <AnalysisUnavailableCard title="正在同步完整学习权益" message="权益确认完成后，才会继续生成你的 AI 学习分析。" />
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
          title="开通后查看 AI 学习分析"
          message="单词 AI 学习分析属于完整学习权益。开通后可基于你的学习记录生成个性化解读。"
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
        <AnalysisUnavailableCard title="登录后继续查看学习解读" message="当前登录状态不可用，请重新登录后再更新你的学习分析。" />
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
            <AppText style={{ fontSize: 22, fontWeight: '700', color: TEXT_PRIMARY }}>学习分析加载失败</AppText>
            <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: TEXT_SECONDARY }}>
              现在还没有成功取回学习数据，请稍后再试。
            </AppText>
            <AppText style={{ fontSize: 12, color: COLOR_RED }}>{combinedError}</AppText>
            <Pressable
              onPress={() => {
                void refreshPlan();
                void refreshNotebook();
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
          <View style={{ gap: 12 }}>
            <SmallPill label={aiCardLabel} />
            {aiCardSummary ? (
              <View style={{ gap: 9 }}>
                {aiCardSummary
                  .split(/(?<=[。！？])/)
                  .map((part) => part.trim())
                  .filter(Boolean)
                  .map((part, index) => (
                    <AppText
                      key={`${part}-${index}`}
                      style={{ fontSize: 19, fontWeight: '500', lineHeight: 29, color: TEXT_PRIMARY }}
                    >
                      {part}
                    </AppText>
                  ))}
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                <AppText style={{ fontSize: FONT_BODY, fontWeight: '700', color: TEXT_PRIMARY }}>暂时无法更新分析</AppText>
                <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: TEXT_SECONDARY }}>
                  {insightError ?? '学习解读还在整理中，先保留基础统计区，稍后再更新。'}
                </AppText>
              </View>
            )}
            {exampleMode ? (
              <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: TEXT_SECONDARY }}>
                当前展示的是体验内容，登录并完成学习后可查看你的专属学习解读。
              </AppText>
            ) : null}
            {insightLoading ? <AppText style={{ fontSize: FONT_CAPTION, color: TEXT_SECONDARY }}>正在读取学习解读…</AppText> : null}
            {insightRefreshing ? <AppText style={{ fontSize: FONT_CAPTION, color: TEXT_SECONDARY }}>正在更新学习解读…</AppText> : null}
            {!exampleMode && insightError ? <AppText style={{ fontSize: FONT_CAPTION, color: COLOR_RED }}>{insightError}</AppText> : null}
          </View>
        </SurfaceCard>

        <SectionTitle title="四个核心诊断指标" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: SPACING_PAGE_H, paddingBottom: 10 }}>
          {diagnostics.map((item) => (
            <MetricCard key={item.label} label={item.label} value={item.value} note={item.note} tint={item.tint} />
          ))}
        </View>

        {isTablet ? (
          <View style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-start' }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <SectionTitle title="当前最该做什么" />
              {showInsightDependentSections && currentAction ? (
                <SurfaceCard style={{ marginHorizontal: SPACING_PAGE_H, padding: 16, backgroundColor: theme.secondaryCardBackground }}>
                  <View style={{ gap: 6 }}>
                    <AppText style={{ fontSize: FONT_MICRO, color: TEXT_SECONDARY }}>{exampleMode ? '体验推荐动作' : '当前最优先动作'}</AppText>
                    <AppText style={{ fontSize: 18, fontWeight: '600', lineHeight: 23, color: TEXT_PRIMARY }}>{currentAction.title}</AppText>
                    <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: TEXT_SECONDARY }}>{currentAction.description}</AppText>
                    <View style={{ width: 116, marginTop: 2 }}>
                      <AnalysisActionButton
                        label={exampleMode ? '登录查看' : currentAction.buttonLabel}
                        onPress={() => (exampleMode ? handleExampleGate() : router.push(currentAction.href as never))}
                        tone="primary"
                        compact
                      />
                    </View>
                  </View>
                </SurfaceCard>
              ) : (
                <AnalysisUnavailableCard title="当前最该做什么" message="学习解读还在整理中，稍后再查看优先动作。" />
              )}

              <SectionTitle title="当前薄弱项" />
              {showInsightDependentSections && weakSignals.length > 0 ? (
                <View style={{ paddingBottom: 2 }}>
                  {weakSignals.map((item) => (
                    <SignalRow
                      key={`${item.title}-${item.description}`}
                      title={item.title}
                      description={item.description}
                      progress={item.progress}
                      tag={item.tag}
                      tone={item.tone}
                    />
                  ))}
                </View>
              ) : (
                <AnalysisUnavailableCard title="当前薄弱项" message="学习解读还在整理中，稍后再查看薄弱项判断。" />
              )}

              <SectionTitle title="当前优势项" />
              {showInsightDependentSections && strongSignals.length > 0 ? (
                <View style={{ paddingBottom: 2 }}>
                  {strongSignals.map((item) => (
                    <SignalRow
                      key={`${item.title}-${item.description}`}
                      title={item.title}
                      description={item.description}
                      progress={item.progress}
                      tag={item.tag}
                      tone={item.tone}
                    />
                  ))}
                </View>
              ) : (
                <AnalysisUnavailableCard title="当前优势项" message="学习解读还在整理中，稍后再查看优势项判断。" />
              )}
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <SectionTitle title="学习结构" />
              <StructureStrip mastered={structure.mastered} due={structure.due} mistake={structure.mistake} />

              <SectionTitle title="学习行为分析" />
              <SurfaceCard style={{ marginHorizontal: SPACING_PAGE_H, padding: 18 }}>
                <View>
                  {behaviorItems.map((item, index) => (
                    <View
                      key={item.title}
                      style={{
                        borderBottomWidth: index === behaviorItems.length - 1 ? 0 : 0.5,
                        borderBottomColor: BORDER_SOFT,
                      }}
                    >
                      <BehaviorRow title={item.title} detail={item.detail} />
                    </View>
                  ))}
                </View>
              </SurfaceCard>

              <SectionTitle title="更多建议" />
              {showInsightDependentSections && moreSuggestions.length > 0 ? (
                <View style={{ paddingBottom: 4 }}>
                  {moreSuggestions.map((item) => (
                    <SuggestionCard
                      key={`${item.title}-${item.href}`}
                      title={item.title}
                      description={item.description}
                      buttonLabel={exampleMode ? '登录查看' : item.buttonLabel}
                      onPress={() => (exampleMode ? handleExampleGate() : router.push(item.href as never))}
                    />
                  ))}
                </View>
              ) : (
                <AnalysisUnavailableCard title="更多建议" message="学习解读还在整理中，稍后再查看后续建议。" />
              )}
            </View>
          </View>
        ) : (
          <>
            <SectionTitle title="当前最该做什么" />
            {showInsightDependentSections && currentAction ? (
              <SurfaceCard style={{ marginHorizontal: SPACING_PAGE_H, padding: 16, backgroundColor: theme.secondaryCardBackground }}>
                <View style={{ gap: 6 }}>
                  <AppText style={{ fontSize: FONT_MICRO, color: TEXT_SECONDARY }}>{exampleMode ? '体验推荐动作' : '当前最优先动作'}</AppText>
                  <AppText style={{ fontSize: 18, fontWeight: '600', lineHeight: 23, color: TEXT_PRIMARY }}>{currentAction.title}</AppText>
                  <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: TEXT_SECONDARY }}>{currentAction.description}</AppText>
                  <View style={{ width: 116, marginTop: 2 }}>
                    <AnalysisActionButton
                      label={exampleMode ? '登录查看' : currentAction.buttonLabel}
                      onPress={() => (exampleMode ? handleExampleGate() : router.push(currentAction.href as never))}
                      tone="primary"
                      compact
                    />
                  </View>
                </View>
              </SurfaceCard>
            ) : (
              <AnalysisUnavailableCard title="当前最该做什么" message="学习解读还在整理中，稍后再查看优先动作。" />
            )}

            <SectionTitle title="当前薄弱项" />
            {showInsightDependentSections && weakSignals.length > 0 ? (
              <View style={{ paddingBottom: 2 }}>
                {weakSignals.map((item) => (
                  <SignalRow
                    key={`${item.title}-${item.description}`}
                    title={item.title}
                    description={item.description}
                    progress={item.progress}
                    tag={item.tag}
                    tone={item.tone}
                  />
                ))}
              </View>
            ) : (
              <AnalysisUnavailableCard title="当前薄弱项" message="学习解读还在整理中，稍后再查看薄弱项判断。" />
            )}

            <SectionTitle title="当前优势项" />
            {showInsightDependentSections && strongSignals.length > 0 ? (
              <View style={{ paddingBottom: 2 }}>
                {strongSignals.map((item) => (
                  <SignalRow
                    key={`${item.title}-${item.description}`}
                    title={item.title}
                    description={item.description}
                    progress={item.progress}
                    tag={item.tag}
                    tone={item.tone}
                  />
                ))}
              </View>
            ) : (
              <AnalysisUnavailableCard title="当前优势项" message="学习解读还在整理中，稍后再查看优势项判断。" />
            )}

            <SectionTitle title="学习结构" />
            <StructureStrip mastered={structure.mastered} due={structure.due} mistake={structure.mistake} />

            <SectionTitle title="学习行为分析" />
            <SurfaceCard style={{ marginHorizontal: SPACING_PAGE_H, padding: 18 }}>
              <View>
                {behaviorItems.map((item, index) => (
                  <View
                    key={item.title}
                    style={{
                      borderBottomWidth: index === behaviorItems.length - 1 ? 0 : 0.5,
                      borderBottomColor: BORDER_SOFT,
                    }}
                  >
                    <BehaviorRow title={item.title} detail={item.detail} />
                  </View>
                ))}
              </View>
            </SurfaceCard>

            <SectionTitle title="更多建议" />
            {showInsightDependentSections && moreSuggestions.length > 0 ? (
              <View style={{ paddingBottom: 4 }}>
                {moreSuggestions.map((item) => (
                  <SuggestionCard
                    key={`${item.title}-${item.href}`}
                    title={item.title}
                    description={item.description}
                    buttonLabel={exampleMode ? '登录查看' : item.buttonLabel}
                    onPress={() => (exampleMode ? handleExampleGate() : router.push(item.href as never))}
                  />
                ))}
              </View>
            ) : (
              <AnalysisUnavailableCard title="更多建议" message="学习解读还在整理中，稍后再查看后续建议。" />
            )}
          </>
        )}

        {partialDataError ? (
          <View style={{ marginHorizontal: SPACING_PAGE_H }}>
            <AppText style={{ fontSize: 12, color: COLOR_RED }}>{partialDataError}</AppText>
          </View>
        ) : null}
      </View>
    </AppScreenShell>
  );
}
