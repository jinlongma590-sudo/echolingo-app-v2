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
import { useVocabularyNotebookData } from '@/hooks/useVocabularyNotebookData';
import { safeBack } from '@/navigation/safeBack';
import {
  fetchVocabularyErrorInsight,
  isVocabularyAuthError,
  type NotebookWord,
  type VocabularyErrorInsight,
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

const EXAMPLE_INSIGHT: VocabularyErrorInsight = {
  errorSummary:
    '当前错词更集中在抽象语义词和少量表达辨析词。现阶段更适合先处理高频错词，再围绕高风险词类做一轮更有针对性的专项训练。',
  rootCauses: [
    '抽象语义映射偏弱，容易在相近词义间混淆。',
    '语境切换时判断不稳，缺少稳定的例句支撑。',
    '高频词理解不够精确，容易出现偏义理解。',
  ],
  riskCategories: ['抽象形容词', '学术动词', '高频词汇', '词根词缀'],
  reinforcementPlan: [
    { action: '先清理高频错词', reason: '先把近期最容易反复出错的词处理掉。' },
    { action: '回到复习流做一轮巩固', reason: '复习能最快拉稳近期记忆曲线。' },
    { action: '补一轮专项练习', reason: '在风险回收后再继续推进，会更稳。' },
  ],
  isSample: true,
};

const EXAMPLE_WORDS: NotebookWord[] = [
  {
    word: 'perseverance',
    phonetic: '/ˌpɜːrsəˈvɪrəns/',
    meaning: '坚持不懈',
    english: 'continued effort to do something despite difficulties',
    example: 'Perseverance is often the key to long-term progress.',
    exampleZh: '坚持不懈往往是长期进步的关键。',
    book: '四级核心词汇',
    bookSlug: 'cet4-core',
    status: 'mistake',
    nextReview: '今天复习',
    reviewCount: 4,
    mistakeCount: 3,
    pattern: '抽象形容词',
  },
  {
    word: 'ambiguous',
    phonetic: '/æmˈbɪɡjuəs/',
    meaning: '模棱两可的',
    english: 'not clear or exact',
    example: 'The statement remained ambiguous to most readers.',
    exampleZh: '这句话对大多数读者来说仍然模棱两可。',
    book: '四级核心词汇',
    bookSlug: 'cet4-core',
    status: 'mistake',
    nextReview: '今天复习',
    reviewCount: 3,
    mistakeCount: 2,
    pattern: '抽象形容词',
  },
  {
    word: 'require',
    phonetic: '/rɪˈkwaɪər/',
    meaning: '需要',
    english: 'to need something or make it necessary',
    example: 'The task requires careful analysis.',
    exampleZh: '这项任务需要细致分析。',
    book: '四级核心词汇',
    bookSlug: 'cet4-core',
    status: 'mistake',
    nextReview: '今天复习',
    reviewCount: 5,
    mistakeCount: 2,
    pattern: '学术动词',
  },
  {
    word: 'derive',
    phonetic: '/dɪˈraɪv/',
    meaning: '推导；获得',
    english: 'to get something from a source',
    example: 'Many words derive from Latin roots.',
    exampleZh: '许多词源自拉丁词根。',
    book: '四级核心词汇',
    bookSlug: 'cet4-core',
    status: 'mistake',
    nextReview: '今天复习',
    reviewCount: 2,
    mistakeCount: 1,
    pattern: '词根词缀',
  },
];

const EXAMPLE_METRICS = [
  { label: '错词总数', value: '12', note: '当前仍有错词待专项回收。' },
  { label: '累计出错', value: '28', note: '高频错词仍需先做集中纠偏。' },
  { label: '高风险词类数', value: '4', note: '风险更集中，适合做专项训练。' },
  { label: '代表样本词', value: '4', note: '这里保留了可优先处理的样本词。' },
];

function buildPlanHref(index: number) {
  if (index === 0) return '/words/review?mode=mistake';
  if (index === 1) return '/words/review?mode=review';
  return '/words/review?mode=learn';
}

function buildPlanButton(index: number) {
  if (index === 0) return '去专项复习';
  if (index === 1) return '去复习';
  return '开始学习';
}

function buildFooterHref(index: number) {
  if (index === 0) return '/words/my-words?tab=mistake';
  return '/words/today';
}

function getCauseTone(index: number) {
  if (index === 0) return { bg: COLOR_RED_BG, fg: COLOR_RED, tag: '高影响' };
  if (index === 1) return { bg: COLOR_AMBER_BG, fg: '#B9770E', tag: '需要关注' };
  return { bg: COLOR_BLUE_BG, fg: '#336FA8', tag: '继续优化' };
}

function deriveCauseTitle(text: string) {
  if (text.includes('抽象')) return '抽象语义映射';
  if (text.includes('语境') || text.includes('场景')) return '语境切换易混';
  if (text.includes('动词')) return '学术动词辨析';
  if (text.includes('形容词')) return '抽象形容词理解';
  if (text.includes('词根') || text.includes('词缀')) return '词形线索不稳';
  if (text.includes('记忆')) return '记忆提取不稳';
  return '理解偏差';
}

function buildMainConclusion(insight: VocabularyErrorInsight | null, topPattern: string | null) {
  if (insight?.rootCauses?.[0]) {
    return `当前最需要强化的是${deriveCauseTitle(insight.rootCauses[0])}`;
  }
  if (topPattern && topPattern !== '未分类错因') {
    return `当前最需要强化的是${topPattern}`;
  }
  return '当前最需要先清理高频错词';
}

function buildSummaryParagraph({
  insight,
  topWords,
  riskCategories,
}: {
  insight: VocabularyErrorInsight | null;
  topWords: NotebookWord[];
  riskCategories: string[];
}) {
  const summary = insight?.errorSummary?.trim();
  const examples = topWords
    .slice(0, 4)
    .map((word) => word.word)
    .filter(Boolean)
    .join('、');
  const categories = riskCategories.slice(0, 2).join('和');

  if (summary && examples && categories) {
    return `${summary} 特别是像 ${examples} 这类词，最近更容易在${categories}上反复出错，建议先做专项强化，再回到复习流稳定记忆。`;
  }
  if (summary && examples) {
    return `${summary} 特别是像 ${examples} 这类词，建议先集中回收，再继续推进后续学习。`;
  }
  if (summary) return summary;
  return '你目前的错词更集中在抽象语义理解和语境切换上，建议先做专项纠偏，再回到复习流稳定近期记忆。';
}

function buildRiskHint(pattern: string, sampleWord?: NotebookWord) {
  if (sampleWord?.meaning) return `近期常在「${sampleWord.meaning}」这类词义上暴露错误。`;
  if (pattern === '未分类错因') return '当前还有一部分错词需要继续归类。';
  return '这一类词最近更容易反复出错。';
}

function buildPrimaryActionDescription(action: { action: string; reason: string }, topWords: NotebookWord[]) {
  const examples = topWords
    .slice(0, 2)
    .map((word) => word.word)
    .filter(Boolean)
    .join('、');
  if (examples) return `${action.action}，例如 ${examples}`;
  return action.action;
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

function MistakesHeader({
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

function MistakeActionButton({
  label,
  onPress,
  tone = 'secondary',
  compact = false,
  subtle = false,
}: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'secondary';
  compact?: boolean;
  subtle?: boolean;
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
        backgroundColor:
          tone === 'primary'
            ? subtle
              ? theme.colorScheme === 'dark'
                ? 'rgba(10,132,255,0.18)'
                : 'rgba(10,132,255,0.10)'
              : theme.primaryBlue
            : theme.secondaryCardBackground,
        borderWidth: 1,
        borderColor:
          tone === 'primary'
            ? subtle
              ? theme.colorScheme === 'dark'
                ? 'rgba(10,132,255,0.28)'
                : 'rgba(10,132,255,0.18)'
              : theme.primaryBlue
            : theme.border,
        opacity: pressed ? 0.76 : 1,
      })}
    >
      <AppText
        style={{
          fontSize: compact ? FONT_CAPTION : FONT_CALLOUT,
          fontWeight: '600',
          color: tone === 'primary' ? (subtle ? theme.primaryBlue : '#FFFFFF') : theme.textPrimary,
        }}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

function SummaryPill({
  label,
  value,
  tint,
}: {
  label: string;
  value: string;
  tint: 'risk' | 'pressure' | 'stability';
}) {
  const palette =
    tint === 'risk'
      ? { bg: COLOR_RED_BG, fg: COLOR_RED }
      : tint === 'pressure'
        ? { bg: COLOR_AMBER_BG, fg: '#B9770E' }
        : { bg: COLOR_GREEN_BG, fg: '#2D8F4E' };

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
      <AppText numberOfLines={2} style={{ fontSize: FONT_CAPTION, fontWeight: '700', lineHeight: 17, color: TEXT_PRIMARY }}>
        {value}
      </AppText>
    </View>
  );
}

function MetricCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
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
      <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 17, color: theme.textSecondary }}>{note}</AppText>
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

export function WordsMistakesScreen() {
  const { theme } = useAppTheme();
  const { isTablet } = useDeviceClass();
  const session = useAppSession();
  const { guardEntry } = useEntitlementGuard();
  const { status: mobileMeStatus, data: mobileMe } = useMobileMe();
  const { data, loading, error, authRequired, refresh } = useVocabularyNotebookData();
  const [insight, setInsight] = useState<VocabularyErrorInsight | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightRefreshing, setInsightRefreshing] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);
  const isLoggedIn = session.status === 'authenticated';
  const exampleMode = !isLoggedIn;
  const vocabularyInsightAccessResolved =
    !isLoggedIn || mobileMeStatus === 'ready' || (mobileMeStatus === 'sync_failed' && Boolean(mobileMe));
  const vocabularyInsightLocked =
    isLoggedIn && vocabularyInsightAccessResolved && mobileMe?.entitlements.canUseVocabulary === false;

  const words = data?.words ?? [];
  const mistakeWords = useMemo(
    () => words.filter((word) => word.status === 'mistake' || (word.mistakeCount ?? 0) > 0),
    [words],
  );
  const totalMistakeEvents = useMemo(
    () => mistakeWords.reduce((sum, word) => sum + Math.max(word.mistakeCount ?? 0, 1), 0),
    [mistakeWords],
  );

  const patternMistakes = useMemo(() => {
    const bucket = new Map<string, { count: number; sampleWord?: NotebookWord }>();
    for (const word of mistakeWords) {
      const key = word.pattern || '未分类错因';
      const current = bucket.get(key) ?? { count: 0, sampleWord: word };
      current.count += Math.max(word.mistakeCount ?? 0, 1);
      current.sampleWord = current.sampleWord ?? word;
      bucket.set(key, current);
    }
    return Array.from(bucket.entries()).sort((a, b) => b[1].count - a[1].count);
  }, [mistakeWords]);

  const topWords = useMemo(
    () => [...mistakeWords].sort((a, b) => (b.mistakeCount ?? 0) - (a.mistakeCount ?? 0)).slice(0, 6),
    [mistakeWords],
  );
  const topWordsForDisplay = exampleMode ? EXAMPLE_WORDS : topWords;

  const bookMistakeCounts = useMemo(() => {
    const bucket = new Map<string, number>();
    mistakeWords.forEach((word) => {
      const key = word.bookSlug ?? word.book;
      bucket.set(key, (bucket.get(key) ?? 0) + 1);
    });
    return Array.from(bucket.entries());
  }, [mistakeWords]);

  async function requestErrorInsight(currentSession: NonNullable<typeof session.session>, forceRefresh = false) {
    return fetchVocabularyErrorInsight(currentSession, {
      totalStudied: words.length,
      mistakeCount: mistakeWords.length,
      totalMistakeEvents,
      patternMistakes: patternMistakes.map(([pattern, value]) => [pattern, value.count]),
      topMistakeWords: topWords.map((word) => word.word),
      ...(forceRefresh ? { refresh: true } : {}),
    });
  }

  useEffect(() => {
    const currentSession = session.session;
    if (!currentSession || !isLoggedIn || vocabularyInsightLocked || !vocabularyInsightAccessResolved) {
      setInsight(null);
      setInsightError(null);
      setInsightLoading(false);
      setInsightRefreshing(false);
      return;
    }

    let cancelled = false;

    async function loadRealInsight(forceRefresh: boolean, activeSession: NonNullable<typeof currentSession>) {
      if (!data) {
        if (!cancelled) {
          setInsight(null);
          setInsightError(null);
          setInsightLoading(false);
          setInsightRefreshing(false);
        }
        return;
      }

      if (mistakeWords.length === 0) {
        if (!cancelled) {
          setInsight(null);
          setInsightError('当前还没有足够错词样本，继续学习后再更新分析。');
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
        const next = await requestErrorInsight(activeSession, forceRefresh);
        if (cancelled) return;

        if (next.isSample) {
          setInsight(null);
          setInsightError('错词解读暂时无法更新，请稍后重试。');
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
          setInsightError(getVocabularyUserErrorMessage(err, 'mistakes_update'));
          return;
        }

        setInsight(null);
        setInsightError(getVocabularyUserErrorMessage(err, 'mistakes_update'));
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
    data,
    isLoggedIn,
    mistakeWords,
    patternMistakes,
    session,
    session.session,
    topWords,
    totalMistakeEvents,
    vocabularyInsightAccessResolved,
    vocabularyInsightLocked,
    words.length,
  ]);

  function handleExampleGate() {
    router.push('/auth/sign-in');
  }

  async function handleRefreshAnalysis() {
    const ok = await guardEntry('premium_library');
    if (!ok) return;

    if (!session.session || insightLoading || insightRefreshing) return;
    if (mistakeWords.length === 0) {
      setInsight(null);
      setInsightError('当前还没有足够错词样本，继续学习后再更新分析。');
      return;
    }

    setInsightRefreshing(true);
    setInsightError(null);

    try {
      const next = await requestErrorInsight(session.session, true);
      if (next.isSample) {
        setInsight(null);
        setInsightError('错词解读暂时无法更新，请稍后重试。');
        return;
      }

      setInsight(next);
      setInsightError(null);
    } catch (err) {
      if (isVocabularyAuthError(err)) {
        const refreshedSession = await session.refreshSession();
        if (refreshedSession) {
          try {
            const retry = await requestErrorInsight(refreshedSession, true);
            if (retry.isSample) {
              setInsight(null);
              setInsightError('错词解读暂时无法更新，请稍后重试。');
            } else {
              setInsight(retry);
              setInsightError(null);
            }
          } catch (retryError) {
            setInsight(null);
            setInsightError(getVocabularyUserErrorMessage(retryError, 'mistakes_update'));
          }
        } else {
          setInsight(null);
          setInsightError(getVocabularyUserErrorMessage(err, 'mistakes_update'));
        }
      } else {
        setInsight(null);
        setInsightError(getVocabularyUserErrorMessage(err, 'mistakes_update'));
      }
    } finally {
      setInsightRefreshing(false);
    }
  }

  const realModeReady = Boolean(insight && insight.isSample === false);
  const displayInsight = exampleMode ? EXAMPLE_INSIGHT : realModeReady ? insight : null;
  const topPattern = patternMistakes[0]?.[0] ?? null;
  const riskCategories = displayInsight?.riskCategories?.length
    ? displayInsight.riskCategories.slice(0, 4)
    : exampleMode
      ? EXAMPLE_INSIGHT.riskCategories.slice(0, 4)
      : [];
  const mainConclusion = displayInsight ? buildMainConclusion(displayInsight, topPattern) : null;
  const summaryParagraph = displayInsight
    ? buildSummaryParagraph({ insight: displayInsight, topWords: topWordsForDisplay, riskCategories })
    : null;
  const primaryAction = displayInsight?.reinforcementPlan[0] ?? null;
  const planItems = displayInsight?.reinforcementPlan.slice(0, 3) ?? [];
  const causeItems = displayInsight?.rootCauses.slice(0, 3) ?? [];
  const summaryPills = displayInsight
    ? [
        { label: '主要错因', value: deriveCauseTitle(causeItems[0] ?? '理解偏差'), tint: 'risk' as const },
        { label: '高风险词类', value: riskCategories[0] ?? '抽象形容词', tint: 'pressure' as const },
        { label: '当前建议方向', value: primaryAction?.action ?? '先清理高频错词', tint: 'stability' as const },
      ]
    : [];

  const metricCards = exampleMode
    ? EXAMPLE_METRICS
    : [
        {
          label: '错词总数',
          value: String(mistakeWords.length),
          note: mistakeWords.length > 0 ? '当前仍有错词待专项回收。' : '当前错词池压力较轻。',
        },
        {
          label: '累计出错',
          value: String(totalMistakeEvents),
          note: '累计出错越高，越需要先做高频纠偏。',
        },
        {
          label: '高风险词类数',
          value: String(Math.max(patternMistakes.length, 0)),
          note: patternMistakes.length > 0 ? '错误越集中，越适合做专项训练。' : '当前还没有明显集中的高风险词类。',
        },
        {
          label: '代表样本词',
          value: String(topWords.length),
          note: topWords.length > 0 ? '保留样本词可直接进入后续处理。' : '当前还没有可展示的样本词。',
        },
      ];

  const refreshBusy = insightLoading || insightRefreshing;
  const shellHeader = <MistakesHeader exampleMode={exampleMode} loading={refreshBusy} onRefresh={handleRefreshAnalysis} />;

  if (!exampleMode && !vocabularyInsightAccessResolved) {
    return (
      <AppScreenShell
        header={shellHeader}
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        includeBottomInset={false}
        disableTabletTopInset={isTablet}
      >
        <AnalysisUnavailableCard title="正在同步完整学习权益" message="权益确认完成后，才会继续生成你的 AI 错词分析。" />
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
          title="开通后查看 AI 错词分析"
          message="单词 AI 错词分析属于完整学习权益。开通后可基于你的错词记录生成专项解读。"
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
        <AnalysisUnavailableCard title="登录后继续查看错词解读" message="当前登录状态不可用，请重新登录后再更新你的错词分析。" />
      </AppScreenShell>
    );
  }

  if (!exampleMode && loading && !data) {
    return (
      <AppScreenShell scrollable={false} header={shellHeader} includeBottomInset={false} disableTabletTopInset={isTablet}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={TEXT_SECONDARY} />
        </View>
      </AppScreenShell>
    );
  }

  if (!exampleMode && error && !data) {
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
            <AppText style={{ fontSize: 22, fontWeight: '700', color: TEXT_PRIMARY }}>错词数据加载失败</AppText>
            <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: TEXT_SECONDARY }}>
              现在还没有成功取回错词内容，请稍后再试。
            </AppText>
            <AppText style={{ fontSize: 12, color: COLOR_RED }}>{error}</AppText>
            <Pressable
              onPress={() => void refresh()}
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
            <SmallPill label={exampleMode ? '体验洞察' : 'AI 错因总览'} />
            {displayInsight && mainConclusion && summaryParagraph ? (
              <>
                <AppText style={{ fontSize: 29, fontWeight: '700', lineHeight: 35, color: TEXT_PRIMARY }}>{mainConclusion}</AppText>
                <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: TEXT_SECONDARY }}>{summaryParagraph}</AppText>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {summaryPills.map((item) => (
                    <SummaryPill key={item.label} label={item.label} value={item.value} tint={item.tint} />
                  ))}
                </View>
              </>
            ) : (
              <View style={{ gap: 8 }}>
                <AppText style={{ fontSize: FONT_BODY, fontWeight: '700', color: TEXT_PRIMARY }}>暂时无法更新分析</AppText>
                <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: TEXT_SECONDARY }}>
                  {insightError ?? '错词解读还在整理中，先保留基础统计区和样本词，稍后再更新。'}
                </AppText>
              </View>
            )}

            {exampleMode ? (
              <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: TEXT_SECONDARY }}>
                当前展示的是体验内容，登录并完成学习后可查看你的专属错词解读。
              </AppText>
            ) : null}
            {insightLoading ? <AppText style={{ fontSize: FONT_CAPTION, color: TEXT_SECONDARY }}>正在整理错因结论…</AppText> : null}
            {insightRefreshing ? <AppText style={{ fontSize: FONT_CAPTION, color: TEXT_SECONDARY }}>正在更新错词解读…</AppText> : null}
            {!exampleMode && insightError ? <AppText style={{ fontSize: FONT_CAPTION, color: COLOR_RED }}>{insightError}</AppText> : null}
          </View>
        </SurfaceCard>

        <SectionTitle title="4 个核心指标" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: SPACING_PAGE_H, paddingBottom: 6 }}>
          {metricCards.map((card) => (
            <MetricCard key={card.label} label={card.label} value={card.value} note={card.note} />
          ))}
        </View>

        {isTablet ? (
          <View style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-start' }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <SectionTitle title="当前最该先纠偏什么" />
              {displayInsight && primaryAction ? (
                <SurfaceCard style={{ marginHorizontal: SPACING_PAGE_H, padding: 16, backgroundColor: theme.secondaryCardBackground }}>
                  <View style={{ gap: 6 }}>
                    <AppText style={{ fontSize: FONT_MICRO, color: TEXT_SECONDARY }}>{exampleMode ? '体验推荐动作' : '当前最优先动作'}</AppText>
                    <AppText style={{ fontSize: 20, fontWeight: '600', lineHeight: 27, color: TEXT_PRIMARY }}>
                      {buildPrimaryActionDescription(primaryAction, topWordsForDisplay)}
                    </AppText>
                    <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: TEXT_SECONDARY }}>{primaryAction.reason}</AppText>
                    <View style={{ width: 114, marginTop: 2 }}>
                      <MistakeActionButton
                        label={exampleMode ? '登录查看' : buildPlanButton(0)}
                        tone="primary"
                        compact
                        subtle
                        onPress={() => (exampleMode ? handleExampleGate() : router.push(buildPlanHref(0) as never))}
                      />
                    </View>
                  </View>
                </SurfaceCard>
              ) : (
                <AnalysisUnavailableCard title="当前最该先纠偏什么" message="错词解读还在整理中，稍后再查看优先动作。" />
              )}

              <SectionTitle title="主要错因" />
              {causeItems.length > 0 ? (
                <View style={{ gap: 10, marginBottom: 10 }}>
                  {causeItems.map((item, index) => {
                    const tone = getCauseTone(index);
                    return (
                      <SurfaceCard key={`${item}-${index}`} style={{ marginHorizontal: SPACING_PAGE_H, marginBottom: 0, padding: 14 }}>
                        <View style={{ gap: 10 }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                            <View style={{ flex: 1, gap: 4 }}>
                              <AppText style={{ fontSize: FONT_BODY, fontWeight: '700', color: TEXT_PRIMARY }}>{deriveCauseTitle(item)}</AppText>
                              <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: TEXT_SECONDARY }}>{item}</AppText>
                            </View>
                            <View
                              style={{
                                borderRadius: 999,
                                paddingHorizontal: 8,
                                paddingVertical: 4,
                                backgroundColor: tone.bg,
                              }}
                            >
                              <AppText style={{ fontSize: FONT_MICRO, fontWeight: '600', color: tone.fg }}>{tone.tag}</AppText>
                            </View>
                          </View>
                        </View>
                      </SurfaceCard>
                    );
                  })}
                </View>
              ) : (
                <AnalysisUnavailableCard title="主要错因" message="错词解读还在整理中，稍后再查看错因判断。" />
              )}

              <SectionTitle title="下一步强化方案" />
              {planItems.length > 0 ? (
                <SurfaceCard style={{ marginHorizontal: SPACING_PAGE_H, padding: 0 }}>
                  <View>
                    {planItems.map((item, index) => (
                      <View
                        key={`${item.action}-${index}`}
                        style={{
                          paddingHorizontal: 16,
                          paddingVertical: 16,
                          borderTopWidth: index === 0 ? 0 : 1,
                          borderColor: theme.separator,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 12,
                        }}
                      >
                        <View
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 16,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: index === 0 ? COLOR_AMBER_BG : index === 1 ? COLOR_BLUE_BG : COLOR_GREEN_BG,
                          }}
                        >
                          <AppText style={{ fontSize: FONT_MICRO, fontWeight: '700', color: TEXT_PRIMARY }}>{index + 1}</AppText>
                        </View>

                        <View style={{ flex: 1, gap: 4 }}>
                          <AppText style={{ fontSize: FONT_BODY, fontWeight: '700', color: TEXT_PRIMARY }}>{item.action}</AppText>
                          <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: TEXT_SECONDARY }}>{item.reason}</AppText>
                        </View>

                        <View style={{ width: 94 }}>
                          <MistakeActionButton
                            label={exampleMode ? '登录查看' : buildPlanButton(index)}
                            onPress={() => (exampleMode ? handleExampleGate() : router.push(buildPlanHref(index) as never))}
                            compact
                          />
                        </View>
                      </View>
                    ))}
                  </View>
                </SurfaceCard>
              ) : (
                <AnalysisUnavailableCard title="下一步强化方案" message="错词解读还在整理中，稍后再查看强化方案。" />
              )}
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <SectionTitle title="高风险词类" />
              {displayInsight && riskCategories.length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: SPACING_PAGE_H, paddingBottom: 10 }}>
                  {riskCategories.slice(0, 4).map((category, index) => {
                    const matched = patternMistakes.find(([pattern]) => pattern === category);
                    const count = matched?.[1].count ?? (exampleMode ? index + 2 : 1);
                    const level = index === 0 ? '高影响' : index === 1 ? '需要关注' : '可专项训练';
                    return (
                      <View
                        key={category}
                        style={{
                          width: '48%',
                          borderRadius: RADIUS_CARD,
                          backgroundColor: theme.secondaryCardBackground,
                          borderWidth: 1,
                          borderColor: theme.border,
                          padding: 14,
                          gap: 6,
                        }}
                      >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                          <AppText style={{ flex: 1, fontSize: FONT_BODY, fontWeight: '700', color: TEXT_PRIMARY }}>{category}</AppText>
                          <View style={{ borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: index === 0 ? COLOR_RED_BG : index === 1 ? COLOR_AMBER_BG : COLOR_BLUE_BG }}>
                            <AppText style={{ fontSize: FONT_MICRO, fontWeight: '600', color: index === 0 ? COLOR_RED : index === 1 ? '#B9770E' : '#336FA8' }}>{level}</AppText>
                          </View>
                        </View>
                        <AppText style={{ fontSize: FONT_CALLOUT, fontWeight: '600', color: TEXT_PRIMARY }}>{count} 次暴露</AppText>
                        <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 17, color: TEXT_SECONDARY }}>
                          {buildRiskHint(category, matched?.[1].sampleWord ?? (exampleMode ? topWordsForDisplay[index] : undefined))}
                        </AppText>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <AnalysisUnavailableCard title="高风险词类" message="错词解读还在整理中，稍后再查看高风险词类判断。" />
              )}

              <SectionTitle title="代表错词样本" />
              {topWordsForDisplay.length > 0 ? (
                topWordsForDisplay.slice(0, 4).map((word) => (
                  <SurfaceCard key={`${word.book}-${word.word}`} style={{ marginHorizontal: SPACING_PAGE_H, marginBottom: 12, padding: 16 }}>
                    <View style={{ gap: 12 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                        <View style={{ flex: 1, gap: 4 }}>
                          <AppText style={{ fontSize: 22, fontWeight: '700', color: TEXT_PRIMARY }}>{word.word}</AppText>
                          <AppText style={{ fontSize: FONT_CALLOUT, color: TEXT_PRIMARY }}>{word.meaning}</AppText>
                          <AppText style={{ fontSize: FONT_CAPTION, color: TEXT_SECONDARY }}>
                            错误 {word.mistakeCount ?? 0} 次 · {word.pattern || '未分类'}
                          </AppText>
                        </View>
                        <View
                          style={{
                            borderRadius: 999,
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            backgroundColor: COLOR_RED_BG,
                          }}
                        >
                          <AppText style={{ fontSize: FONT_MICRO, fontWeight: '600', color: COLOR_RED }}>{word.pattern || '高风险样本'}</AppText>
                        </View>
                      </View>

                      <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: TEXT_SECONDARY }}>{word.book}</AppText>

                      <View style={{ width: 92 }}>
                        <MistakeActionButton
                          label={exampleMode ? '登录查看' : '去处理'}
                          tone="secondary"
                          compact
                          onPress={() =>
                            exampleMode
                              ? handleExampleGate()
                              : router.push({
                                  pathname: '/words/review',
                                  params: word.bookSlug ? { mode: 'review', bookSlug: word.bookSlug } : { mode: 'review' },
                                })
                          }
                        />
                      </View>
                    </View>
                  </SurfaceCard>
                ))
              ) : (
                <SurfaceCard style={{ marginHorizontal: SPACING_PAGE_H }}>
                  <AppText style={{ fontSize: FONT_CALLOUT, color: TEXT_SECONDARY }}>当前还没有可展示的错词样本，继续保持。</AppText>
                </SurfaceCard>
              )}
            </View>
          </View>
        ) : (
          <>
            <SectionTitle title="当前最该先纠偏什么" />
            {displayInsight && primaryAction ? (
              <SurfaceCard style={{ marginHorizontal: SPACING_PAGE_H, padding: 16, backgroundColor: theme.secondaryCardBackground }}>
                <View style={{ gap: 6 }}>
                  <AppText style={{ fontSize: FONT_MICRO, color: TEXT_SECONDARY }}>{exampleMode ? '体验推荐动作' : '当前最优先动作'}</AppText>
                  <AppText style={{ fontSize: 20, fontWeight: '600', lineHeight: 27, color: TEXT_PRIMARY }}>
                    {buildPrimaryActionDescription(primaryAction, topWordsForDisplay)}
                  </AppText>
                  <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: TEXT_SECONDARY }}>{primaryAction.reason}</AppText>
                  <View style={{ width: 114, marginTop: 2 }}>
                    <MistakeActionButton
                      label={exampleMode ? '登录查看' : buildPlanButton(0)}
                      tone="primary"
                      compact
                      subtle
                      onPress={() => (exampleMode ? handleExampleGate() : router.push(buildPlanHref(0) as never))}
                    />
                  </View>
                </View>
              </SurfaceCard>
            ) : (
              <AnalysisUnavailableCard title="当前最该先纠偏什么" message="错词解读还在整理中，稍后再查看优先动作。" />
            )}

            <SectionTitle title="主要错因" />
            {causeItems.length > 0 ? (
              <View style={{ gap: 10, marginBottom: 10 }}>
                {causeItems.map((item, index) => {
                  const tone = getCauseTone(index);
                  return (
                    <SurfaceCard key={`${item}-${index}`} style={{ marginHorizontal: SPACING_PAGE_H, marginBottom: 0, padding: 14 }}>
                      <View style={{ gap: 10 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                          <View style={{ flex: 1, gap: 4 }}>
                            <AppText style={{ fontSize: FONT_BODY, fontWeight: '700', color: TEXT_PRIMARY }}>{deriveCauseTitle(item)}</AppText>
                            <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: TEXT_SECONDARY }}>{item}</AppText>
                          </View>
                          <View
                            style={{
                              borderRadius: 999,
                              paddingHorizontal: 8,
                              paddingVertical: 4,
                              backgroundColor: tone.bg,
                            }}
                          >
                            <AppText style={{ fontSize: FONT_MICRO, fontWeight: '600', color: tone.fg }}>{tone.tag}</AppText>
                          </View>
                        </View>
                      </View>
                    </SurfaceCard>
                  );
                })}
              </View>
            ) : (
              <AnalysisUnavailableCard title="主要错因" message="错词解读还在整理中，稍后再查看错因判断。" />
            )}

            <SectionTitle title="高风险词类" />
            {displayInsight && riskCategories.length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: SPACING_PAGE_H, paddingBottom: 10 }}>
                {riskCategories.slice(0, 4).map((category, index) => {
                  const matched = patternMistakes.find(([pattern]) => pattern === category);
                  const count = matched?.[1].count ?? (exampleMode ? index + 2 : 1);
                  const level = index === 0 ? '高影响' : index === 1 ? '需要关注' : '可专项训练';
                  return (
                    <View
                      key={category}
                      style={{
                        width: '48%',
                        borderRadius: RADIUS_CARD,
                        backgroundColor: theme.secondaryCardBackground,
                        borderWidth: 1,
                        borderColor: theme.border,
                        padding: 14,
                        gap: 6,
                      }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                        <AppText style={{ flex: 1, fontSize: FONT_BODY, fontWeight: '700', color: TEXT_PRIMARY }}>{category}</AppText>
                        <View style={{ borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: index === 0 ? COLOR_RED_BG : index === 1 ? COLOR_AMBER_BG : COLOR_BLUE_BG }}>
                          <AppText style={{ fontSize: FONT_MICRO, fontWeight: '600', color: index === 0 ? COLOR_RED : index === 1 ? '#B9770E' : '#336FA8' }}>{level}</AppText>
                        </View>
                      </View>
                      <AppText style={{ fontSize: FONT_CALLOUT, fontWeight: '600', color: TEXT_PRIMARY }}>{count} 次暴露</AppText>
                      <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 17, color: TEXT_SECONDARY }}>
                        {buildRiskHint(category, matched?.[1].sampleWord ?? (exampleMode ? topWordsForDisplay[index] : undefined))}
                      </AppText>
                    </View>
                  );
                })}
              </View>
            ) : (
              <AnalysisUnavailableCard title="高风险词类" message="错词解读还在整理中，稍后再查看高风险词类判断。" />
            )}

            <SectionTitle title="下一步强化方案" />
            {planItems.length > 0 ? (
              <SurfaceCard style={{ marginHorizontal: SPACING_PAGE_H, padding: 0 }}>
                <View>
                  {planItems.map((item, index) => (
                    <View
                      key={`${item.action}-${index}`}
                      style={{
                        paddingHorizontal: 16,
                        paddingVertical: 16,
                        borderTopWidth: index === 0 ? 0 : 1,
                        borderColor: theme.separator,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                      }}
                    >
                      <View
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 16,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: index === 0 ? COLOR_AMBER_BG : index === 1 ? COLOR_BLUE_BG : COLOR_GREEN_BG,
                        }}
                      >
                        <AppText style={{ fontSize: FONT_MICRO, fontWeight: '700', color: TEXT_PRIMARY }}>{index + 1}</AppText>
                      </View>

                      <View style={{ flex: 1, gap: 4 }}>
                        <AppText style={{ fontSize: FONT_BODY, fontWeight: '700', color: TEXT_PRIMARY }}>{item.action}</AppText>
                        <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: TEXT_SECONDARY }}>{item.reason}</AppText>
                      </View>

                      <View style={{ width: 94 }}>
                        <MistakeActionButton
                          label={exampleMode ? '登录查看' : buildPlanButton(index)}
                          onPress={() => (exampleMode ? handleExampleGate() : router.push(buildPlanHref(index) as never))}
                          compact
                        />
                      </View>
                    </View>
                  ))}
                </View>
              </SurfaceCard>
            ) : (
              <AnalysisUnavailableCard title="下一步强化方案" message="错词解读还在整理中，稍后再查看强化方案。" />
            )}

            <SectionTitle title="代表错词样本" />
            {topWordsForDisplay.length > 0 ? (
              topWordsForDisplay.slice(0, 4).map((word) => (
                <SurfaceCard key={`${word.book}-${word.word}`} style={{ marginHorizontal: SPACING_PAGE_H, marginBottom: 12, padding: 16 }}>
                  <View style={{ gap: 12 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                      <View style={{ flex: 1, gap: 4 }}>
                        <AppText style={{ fontSize: 22, fontWeight: '700', color: TEXT_PRIMARY }}>{word.word}</AppText>
                        <AppText style={{ fontSize: FONT_CALLOUT, color: TEXT_PRIMARY }}>{word.meaning}</AppText>
                        <AppText style={{ fontSize: FONT_CAPTION, color: TEXT_SECONDARY }}>
                          错误 {word.mistakeCount ?? 0} 次 · {word.pattern || '未分类'}
                        </AppText>
                      </View>
                      <View
                        style={{
                          borderRadius: 999,
                          paddingHorizontal: 8,
                          paddingVertical: 4,
                          backgroundColor: COLOR_RED_BG,
                        }}
                      >
                        <AppText style={{ fontSize: FONT_MICRO, fontWeight: '600', color: COLOR_RED }}>{word.pattern || '高风险样本'}</AppText>
                      </View>
                    </View>

                    <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: TEXT_SECONDARY }}>{word.book}</AppText>

                    <View style={{ width: 92 }}>
                      <MistakeActionButton
                        label={exampleMode ? '登录查看' : '去处理'}
                        tone="secondary"
                        compact
                        onPress={() =>
                          exampleMode
                            ? handleExampleGate()
                            : router.push({
                                pathname: '/words/review',
                                params: word.bookSlug ? { mode: 'review', bookSlug: word.bookSlug } : { mode: 'review' },
                              })
                        }
                      />
                    </View>
                  </View>
                </SurfaceCard>
              ))
            ) : (
              <SurfaceCard style={{ marginHorizontal: SPACING_PAGE_H }}>
                <AppText style={{ fontSize: FONT_CALLOUT, color: TEXT_SECONDARY }}>当前还没有可展示的错词样本，继续保持。</AppText>
              </SurfaceCard>
            )}

            <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: SPACING_PAGE_H, paddingTop: 6, paddingBottom: 4 }}>
              <View style={{ flex: 1 }}>
                <MistakeActionButton label={exampleMode ? '登录查看' : '查看全部错词'} tone="secondary" onPress={() => (exampleMode ? handleExampleGate() : router.push(buildFooterHref(0) as never))} />
              </View>
              <View style={{ flex: 1 }}>
                <MistakeActionButton label={exampleMode ? '登录查看' : '返回今日计划'} tone="secondary" onPress={() => (exampleMode ? handleExampleGate() : router.push(buildFooterHref(1) as never))} />
              </View>
            </View>
          </>
        )}

        {!exampleMode && error && data ? (
          <View style={{ marginHorizontal: SPACING_PAGE_H }}>
            <AppText style={{ fontSize: 12, color: COLOR_RED }}>{error}</AppText>
          </View>
        ) : null}
      </View>
    </AppScreenShell>
  );
}
