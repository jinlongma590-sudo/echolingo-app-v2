import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { TopRightAvatarButton } from '@/components/ui/TopRightAvatarButton';
import { SCENARIOS } from '@/data/scenarios';
import { useDeviceClass } from '@/hooks/useDeviceClass';
import {
  fetchSpeakingDashboardSummary,
  type SpeakingDashboardLatestScored,
  type SpeakingDashboardSummary,
} from '@/services/api/speakingDashboard';
import type { SpeakingCredits } from '@/services/api/speakingPractice';
import type { SpeakingSession } from '@/services/api/speakingSessions';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import { useAiDataConsent } from '@/services/privacy/AiDataConsentProvider';
import { SpeakingScreenTablet } from '@/screens/SpeakingScreenTablet';
import {
  buildSpeakingAbilityMetricsFromNormalized,
  buildSpeakingAdviceFromSuggestion,
  deriveSpeakingPerformanceLabel,
  type NormalizedSpeakingScore,
} from '@/utils/speakingDashboard';
import {
  BG_CARD,
  BG_PAGE,
  BORDER_SOFT,
  COLOR_BLUE,
  COLOR_GREEN,
  COLOR_RED,
  FONT_CALLOUT,
  FONT_CAPTION,
  SEPARATOR,
  SPACING_PAGE_H,
  TEXT_ON_DARK,
  TEXT_ON_DARK_SOFT,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
} from '@/theme/tokens';
import { useAppTheme } from '@/theme/AppThemeProvider';
import { useThemeColors } from '@/theme/useThemeColors';

function getScenarioMeta(scenarioId?: string | null) {
  if (!scenarioId) return null;
  return SCENARIOS.find((item) => item.id === scenarioId) ?? null;
}

function createCreditsSnapshot(balanceCredits: number): SpeakingCredits {
  return {
    balanceCredits,
    giftedCreditsTotal: 0,
    purchasedCreditsTotal: 0,
    consumedCreditsTotal: 0,
    scenarioTurnsTotal: 0,
    freeChatTurnsTotal: 0,
    scenarioCreditsConsumed: 0,
    freeChatCreditsConsumed: 0,
    turnsUntilNextScenarioDeduct: 10,
    turnsUntilNextFreeChatDeduct: 5,
  };
}

function latestScoredToNormalized(item: SpeakingDashboardLatestScored | null): NormalizedSpeakingScore | null {
  if (!item) return null;
  return {
    sessionId: item.sessionId,
    scenarioId: item.scenarioId,
    startedAt: item.startedAt,
    status: item.status,
    overall: item.score,
    fluency: item.fluency,
    pronunciation: item.pronunciation,
    accuracy: item.accuracy,
    vocabulary: item.vocabulary,
    grammar: item.grammar,
    coherence: item.coherence,
    logic: item.logic,
    suggestion: item.suggestion,
    source: item.source,
  };
}

function summarySessionToSpeakingSession(item: SpeakingDashboardSummary['recentSessions'][number]): SpeakingSession {
  return {
    id: item.sessionId,
    user_id: '',
    scenario_id: item.scenarioId ?? '',
    mode: item.mode === 'v2' ? 'free_chat' : 'scenario',
    status: item.status === 'active' || item.status === 'aborted' || item.status === 'completed'
      ? item.status
      : 'completed',
    turn_count: 0,
    consumed_credits: 0,
    started_at: item.startedAt ?? '',
    ended_at: item.startedAt ?? null,
    score_json: item.score == null ? null : { overall: item.score },
  };
}

function formatShortDate(iso?: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function toGrade(score?: number | null) {
  if (typeof score !== 'number' || Number.isNaN(score)) return null;
  if (score >= 97) return 'A+';
  if (score >= 93) return 'A';
  if (score >= 90) return 'A-';
  if (score >= 87) return 'B+';
  if (score >= 83) return 'B';
  if (score >= 80) return 'B-';
  if (score >= 77) return 'C+';
  if (score >= 73) return 'C';
  if (score >= 70) return 'C-';
  return '继续练习';
}

function toPerformanceLabel(score?: number | null) {
  if (typeof score !== 'number' || Number.isNaN(score)) return null;
  if (score >= 90) return '优秀';
  if (score >= 80) return '良好';
  if (score >= 70) return '稳定';
  if (score >= 60) return '待提升';
  return '需要加强';
}

function getPerformanceTone(value: string) {
  if (value === '优秀') {
    return {
      backgroundColor: 'rgba(10,132,255,0.10)',
      borderColor: 'rgba(10,132,255,0.14)',
      textColor: '#0A84FF',
    };
  }

  if (value === '良好') {
    return {
      backgroundColor: 'rgba(10,132,255,0.075)',
      borderColor: 'rgba(10,132,255,0.10)',
      textColor: '#3A6FB0',
    };
  }

  return {
    backgroundColor: 'rgba(31,32,36,0.06)',
    borderColor: 'rgba(31,32,36,0.08)',
    textColor: TEXT_SECONDARY,
  };
}

function MetricCell({
  label,
  value,
  valueColor,
  showDivider,
  valueVariant = 'number',
}: {
  label: string;
  value: string;
  valueColor?: string;
  showDivider?: boolean;
  valueVariant?: 'number' | 'status';
}) {
  const { theme } = useAppTheme();
  const tone = valueVariant === 'status' ? getPerformanceTone(value) : null;

  return (
    <View style={styles.metricCell}>
      <AppText style={[styles.metricLabel, { color: theme.textSecondary }]}>{label}</AppText>
      <View style={styles.metricValueWrap}>
        {valueVariant === 'status' && tone ? (
          <View
            style={[
              styles.metricStatusPill,
              {
                backgroundColor: tone.backgroundColor,
                borderColor: tone.borderColor,
              },
            ]}
          >
            <AppText style={[styles.metricStatusText, { color: tone.textColor }]}>{value}</AppText>
          </View>
        ) : (
          <AppText style={[styles.metricValue, { color: valueColor ?? theme.textPrimary }]}>{value}</AppText>
        )}
      </View>
      {showDivider ? <View style={[styles.metricDivider, { backgroundColor: theme.separator }]} /> : null}
    </View>
  );
}

export function SpeakingScreen() {
  const { colors, theme } = useThemeColors();
  const { shouldUseTabletLayout } = useDeviceClass();
  const session = useAppSession();
  const aiConsent = useAiDataConsent();
  const isLoggedIn = session.status === 'authenticated';

  const [dashboardSummary, setDashboardSummary] = useState<SpeakingDashboardSummary | null>(null);
  const [creditsLoading, setCreditsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadDashboardRef = useRef<Promise<void> | null>(null);
  const dashboardAbortRef = useRef<AbortController | null>(null);
  const lastDashboardLoadAtRef = useRef(0);
  const hasSkippedInitialFocusRefreshRef = useRef(false);
  const hasSpeakingDashboardDataRef = useRef(false);

  useEffect(() => {
    hasSpeakingDashboardDataRef.current = Boolean(dashboardSummary);
  }, [dashboardSummary]);

  const loadDashboard = useCallback(async (options?: { silent?: boolean; force?: boolean }) => {
    if (!isLoggedIn || !session.session) {
      dashboardAbortRef.current?.abort();
      dashboardAbortRef.current = null;
      setDashboardSummary(null);
      setCreditsLoading(false);
      setError(null);
      return;
    }

    if (loadDashboardRef.current) {
      return loadDashboardRef.current;
    }

    if (
      !options?.force &&
      options?.silent &&
      lastDashboardLoadAtRef.current > 0 &&
      Date.now() - lastDashboardLoadAtRef.current < 5_000
    ) {
      return;
    }

    const task = (async () => {
      const activeSession = session.session;
      if (!activeSession) {
        setCreditsLoading(false);
        return;
      }

      if (!options?.silent || !hasSpeakingDashboardDataRef.current) {
        setCreditsLoading(true);
      }
      setError(null);
      dashboardAbortRef.current?.abort();
      const abortController = new AbortController();
      dashboardAbortRef.current = abortController;
      try {
        console.log('[SpeakingScreen] speaking_dashboard_summary_fetch_start');
        const summaryResponse = await fetchSpeakingDashboardSummary(activeSession, {
          signal: abortController.signal,
        });

        if (abortController.signal.aborted) return;

        setDashboardSummary(summaryResponse);
        lastDashboardLoadAtRef.current = Date.now();
        console.log(
          '[SpeakingScreen] speaking_dashboard_summary_fetch_done',
          JSON.stringify({
            totalSessions: summaryResponse.totalSessions,
            averageScore: summaryResponse.averageScore,
            recentScores: summaryResponse.recentScores.length,
          }),
        );
      } catch (nextError) {
        if (nextError instanceof Error && nextError.name === 'AbortError') return;
        setError(nextError instanceof Error ? nextError.message : '加载口语摘要失败');
      } finally {
        if (dashboardAbortRef.current === abortController) {
          dashboardAbortRef.current = null;
          setCreditsLoading(false);
        }
      }
    })();

    loadDashboardRef.current = task;
    try {
      await task;
    } finally {
      if (loadDashboardRef.current === task) {
        loadDashboardRef.current = null;
      }
    }
  }, [isLoggedIn, session.session]);

  useEffect(() => {
    return () => {
      dashboardAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    void loadDashboard({ force: true });
  }, [loadDashboard]);

  useFocusEffect(
    useCallback(() => {
      if (!hasSkippedInitialFocusRefreshRef.current) {
        hasSkippedInitialFocusRefreshRef.current = true;
        return undefined;
      }

      void loadDashboard({ silent: true });
      return undefined;
    }, [loadDashboard]),
  );

  const latestSession = dashboardSummary?.latestSession ?? null;
  const latestScenario = useMemo(() => getScenarioMeta(latestSession?.scenarioId), [latestSession?.scenarioId]);
  const averageScoreSummary = useMemo(() => ({
    averageScore: dashboardSummary?.averageScore ?? null,
    fallbackScoredCount: dashboardSummary?.fallbackScoredCount ?? 0,
    selectedSource:
      dashboardSummary && dashboardSummary.v2ScoredCount > 0
        ? 'v2'
        : dashboardSummary && dashboardSummary.fallbackScoredCount > 0
          ? 'fallback'
          : 'none',
    totalHistory: dashboardSummary?.totalSessions ?? 0,
    v2ScoredCount: dashboardSummary?.v2ScoredCount ?? 0,
  }), [dashboardSummary]);
  const averageScore = averageScoreSummary.averageScore;
  useEffect(() => {
    if (!dashboardSummary) return;
    console.log(
      '[SpeakingScreen] speaking_dashboard_summary_render',
      JSON.stringify(averageScoreSummary),
    );
  }, [averageScoreSummary, dashboardSummary]);
  const averageGrade = averageScore === null ? null : toPerformanceLabel(averageScore);
  const averageDisplay =
    !dashboardSummary ? '—' : dashboardSummary.totalSessions === 0 ? '暂无' : averageGrade ?? '待评估';

  const recommendedScenario =
    latestScenario
    ?? SCENARIOS.find((item) => item.id === 'coffee-order')
    ?? SCENARIOS.find((item) => item.id === 'hotel-checkin')
    ?? SCENARIOS[0];

  const latestRecordScore = latestSession?.score ?? null;
  const latestRecordGrade = latestRecordScore === null ? null : toGrade(latestRecordScore);
  const latestRecordDate = formatShortDate(latestSession?.startedAt ?? null);
  const latestScoredNormalized = useMemo(
    () => latestScoredToNormalized(dashboardSummary?.latestScored ?? null),
    [dashboardSummary?.latestScored],
  );
  const recentScore = latestScoredNormalized?.overall ?? null;
  const speakingPerformanceLabel = useMemo(
    () => deriveSpeakingPerformanceLabel(recentScore),
    [recentScore],
  );
  const abilityMetrics = useMemo(
    () => buildSpeakingAbilityMetricsFromNormalized(latestScoredNormalized),
    [latestScoredNormalized],
  );
  const learningAdvice = useMemo(
    () => buildSpeakingAdviceFromSuggestion(dashboardSummary?.latestScored?.suggestion ?? dashboardSummary?.suggestion ?? null),
    [dashboardSummary?.latestScored?.suggestion, dashboardSummary?.suggestion],
  );
  const weeklyPracticeCount = dashboardSummary?.weeklyPracticeCount ?? 0;
  const totalTrackedCount = dashboardSummary?.totalSessions ?? 0;
  const credits = useMemo(
    () => (dashboardSummary ? createCreditsSnapshot(dashboardSummary.credits) : null),
    [dashboardSummary],
  );
  const recentScoreSessions = useMemo(
    () => dashboardSummary?.recentSessions?.map(summarySessionToSpeakingSession) ?? [],
    [dashboardSummary?.recentSessions],
  );

  const recentSubtitle = useMemo(() => {
    if (!isLoggedIn) {
      return {
        prefix: null,
        highlight: null,
        suffix: '登录后查看最近练习与表现',
        color: TEXT_SECONDARY,
      };
    }

    if (!dashboardSummary || !latestSession) {
      return {
        prefix: null,
        highlight: null,
        suffix: '还没有练习记录',
        color: TEXT_SECONDARY,
      };
    }

    if (latestRecordGrade) {
      return {
        prefix: '最近表现：',
        highlight: latestRecordGrade,
        suffix: '',
        color: COLOR_GREEN,
      };
    }

    if (latestSession.status === 'active') {
      return {
        prefix: null,
        highlight: null,
        suffix: '最近记录：进行中',
        color: TEXT_SECONDARY,
      };
    }

    if (latestSession.status === 'completed') {
      return {
        prefix: null,
        highlight: null,
        suffix: '最近记录：已完成，待评估',
        color: TEXT_SECONDARY,
      };
    }

    return {
      prefix: null,
      highlight: null,
      suffix: '最近记录：已结束',
      color: TEXT_SECONDARY,
    };
  }, [isLoggedIn, dashboardSummary, latestSession, latestRecordGrade]);

  const balanceValue = isLoggedIn && dashboardSummary ? `${Math.max(dashboardSummary.credits ?? 0, 0)} Credits` : '—';
  const sessionsValue = isLoggedIn && dashboardSummary ? String(dashboardSummary.totalSessions) : '—';
  const recentTitle = latestSession ? latestScenario?.name ?? latestSession.scenarioId ?? '口语练习' : '最近一条练习记录';
  const recentIcon = latestSession ? latestScenario?.icon ?? '💬' : '🕘';
  const recentMeta = latestRecordDate
    ? `${latestRecordDate} · ${latestSession?.status === 'completed' ? '已完成' : latestSession?.status === 'active' ? '进行中' : '已结束'}`
    : isLoggedIn && latestSession
      ? latestSession.status === 'completed'
        ? '已完成'
        : latestSession.status === 'active'
          ? '进行中'
          : '已结束'
      : '进入练习记录页查看详情';

  const handleOpenV1 = async () => {
    const allowed = await aiConsent.requestConsent();
    if (!allowed) return;
    router.push({ pathname: '/speaking/v1', params: { scenarioId: recommendedScenario.id } });
  };

  const handleOpenV2 = async () => {
    const allowed = await aiConsent.requestConsent();
    if (!allowed) return;
    router.push({ pathname: '/speaking/v2', params: { scenarioId: recommendedScenario.id } });
  };

  const handleOpenHistory = () => {
    router.push('/speaking/history');
  };

  const handleOpenMyTab = () => {
    router.navigate('/my');
  };

  if (shouldUseTabletLayout) {
    return (
      <SpeakingScreenTablet
        credits={credits}
        history={recentScoreSessions}
        isLoading={creditsLoading}
        error={error}
        latestScoredSession={null}
        recentScore={recentScore}
        speakingPerformanceLabel={speakingPerformanceLabel}
        abilityMetrics={abilityMetrics}
        learningAdvice={learningAdvice}
        weeklyPracticeCount={weeklyPracticeCount}
        totalTrackedCount={totalTrackedCount}
        onStartV1={handleOpenV1}
        onStartV2={handleOpenV2}
        onOpenHistory={handleOpenHistory}
        onOpenMyTab={handleOpenMyTab}
      />
    );
  }

  return (
    <AppScreenShell
      showsVerticalScrollIndicator={false}
      headerScrollFade
      title="口语中心"
      rightAction={<TopRightAvatarButton onPress={handleOpenMyTab} />}
      backgroundColor={theme.pageBackground}
    >
      <View style={styles.pageContent}>
        <View style={[styles.overviewCard, { backgroundColor: theme.cardBackground, borderColor: theme.border, shadowOpacity: theme.colorScheme === 'dark' ? 0 : 0.04 }]}>
          <MetricCell label="当前口语额度" value={balanceValue} showDivider />
          <MetricCell label="累计练习" value={sessionsValue} showDivider />
          <MetricCell label="平均表现" value={averageDisplay} valueVariant="status" />
        </View>

        {creditsLoading ? (
          <View style={styles.feedbackRow}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
            <AppText style={[styles.feedbackText, { color: colors.textSecondary }]}>正在同步口语数据</AppText>
          </View>
        ) : null}
        {error ? <AppText style={styles.errorText}>{error}</AppText> : null}

        <Pressable
          accessibilityRole="button"
          onPress={handleOpenV2}
          style={({ pressed }) => [styles.v2Card, pressed && styles.cardPressed]}
        >
          <View style={styles.v2GlowBlue} />
          <View style={styles.v2GlowPurple} />
          <View style={styles.v2MidTint} />
          <View style={styles.v2CardContent}>
            <View style={styles.v2CardHeader}>
              <View style={styles.v2IconWrap}>
                <Ionicons name="sparkles" size={24} color="#6FB6FF" />
              </View>
              <View style={styles.v2BadgeStack}>
                <View style={styles.v2Badge}>
                  <View style={styles.v2BadgeDot} />
                  <AppText style={styles.v2BadgeText}>持续进化中</AppText>
                </View>
                <View style={styles.v2TechBadge}>
                  <AppText style={styles.v2TechBadgeText}>OpenAI Realtime 驱动</AppText>
                </View>
              </View>
            </View>

            <AppText style={styles.v2Title}>实时全真通话</AppText>
            <AppText style={styles.v2Description}>
              体验最自然的双向语音交互。无需回合等待，像真实通话一样与 AI 实时对答。
            </AppText>

            <View style={styles.v2CtaRow}>
              <View style={styles.v2CtaIconWrap}>
                <Ionicons name="flash" size={16} color={TEXT_ON_DARK} />
              </View>
              <AppText style={styles.v2CtaText}>抢先体验 (Beta)</AppText>
              <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.72)" />
            </View>
          </View>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={handleOpenV1}
          style={({ pressed }) => [
            styles.v1Card,
            {
              backgroundColor: colors.cardBackground,
              borderColor: colors.border,
              shadowOpacity: colors.isDark ? 0 : 0.05,
              elevation: colors.isDark ? 0 : 2,
            },
            pressed && styles.cardPressed,
          ]}
        >
          <View style={styles.v1CardHeader}>
            <View style={styles.v1IconWrap}>
              <Ionicons name="chatbubble-ellipses" size={24} color={COLOR_BLUE} />
            </View>
            <View style={[styles.v1TopBadge, { backgroundColor: theme.colorScheme === 'dark' ? theme.secondaryCardBackground : 'rgba(255,255,255,0.78)', borderColor: theme.border }]}>
              <AppText style={[styles.v1TopBadgeText, { color: theme.textSecondary }]}>Claude × OpenAI TTS 驱动</AppText>
            </View>
          </View>

          <AppText style={[styles.v1Title, { color: theme.textPrimary }]}>经典情景演练</AppText>
          <AppText style={[styles.v1Description, { color: theme.textSecondary }]}>
            系统化场景训练。逐轮录音作答，获得精准转写、表达润色与细致反馈。
          </AppText>

          <View style={styles.v1PillRow}>
            <View style={[styles.featurePill, { backgroundColor: theme.secondaryCardBackground }]}>
              <AppText style={[styles.featurePillText, { color: theme.textSecondary }]}>选场景</AppText>
            </View>
            <View style={[styles.featurePill, { backgroundColor: theme.secondaryCardBackground }]}>
              <AppText style={[styles.featurePillText, { color: theme.textSecondary }]}>看纠错</AppText>
            </View>
            <View style={[styles.featurePill, { backgroundColor: theme.secondaryCardBackground }]}>
              <AppText style={[styles.featurePillText, { color: theme.textSecondary }]}>抠发音</AppText>
            </View>
          </View>

          <View style={[styles.v1CtaRow, { backgroundColor: theme.primaryBlue }]}>
            <Ionicons name="play-circle" size={18} color={TEXT_ON_DARK} />
            <AppText style={styles.v1CtaText}>进入标准练习</AppText>
          </View>
        </Pressable>

        <View style={styles.historySection}>
          <View style={styles.historyHeader}>
            <AppText style={[styles.historySectionTitle, { color: theme.textPrimary }]}>练习记录</AppText>
            <Pressable accessibilityRole="button" onPress={handleOpenHistory} style={({ pressed }) => pressed && { opacity: 0.7 }}>
              <AppText style={styles.historyLink}>查看全部</AppText>
            </Pressable>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={handleOpenHistory}
            style={({ pressed }) => [styles.historyCard, { backgroundColor: theme.cardBackground, borderColor: theme.border, shadowOpacity: theme.colorScheme === 'dark' ? 0 : 0.04 }, pressed && styles.cardPressed]}
          >
            <View style={styles.historyLeading}>
              <View style={[styles.historyIconWrap, { backgroundColor: theme.secondaryCardBackground }]}>
                <AppText style={styles.historyIcon}>{recentIcon}</AppText>
              </View>
              <View style={styles.historyCopy}>
                <AppText style={[styles.historyCardTitle, { color: theme.textPrimary }]}>{recentTitle}</AppText>
                <AppText style={[styles.historyCardSubtitle, { color: theme.textSecondary }]}>
                  {recentSubtitle.prefix ? <AppText style={[styles.historyCardSubtitle, { color: theme.textSecondary }]}>{recentSubtitle.prefix}</AppText> : null}
                  {recentSubtitle.highlight ? <AppText style={[styles.historyGrade, { color: recentSubtitle.color }]}>{recentSubtitle.highlight}</AppText> : null}
                  {recentSubtitle.suffix ? <AppText style={[styles.historyCardSubtitle, { color: theme.textSecondary }]}>{recentSubtitle.suffix}</AppText> : null}
                </AppText>
                <AppText style={[styles.historyMeta, { color: theme.textTertiary }]}>{recentMeta}</AppText>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
          </Pressable>
        </View>
      </View>
    </AppScreenShell>
  );
}

const styles = StyleSheet.create({
  pageContent: {
    paddingHorizontal: SPACING_PAGE_H,
  },
  overviewCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: 26,
    backgroundColor: BG_CARD,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER_SOFT,
    paddingVertical: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.04,
    shadowRadius: 18,
    elevation: 2,
  },
  metricCell: {
    flex: 1,
    paddingHorizontal: 14,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: TEXT_SECONDARY,
    marginBottom: 8,
    textAlign: 'center',
  },
  metricValueWrap: {
    minHeight: 38,
    justifyContent: 'center',
    alignItems: 'center',
  },
  metricValue: {
    fontSize: 29,
    lineHeight: 31,
    fontWeight: '700',
    letterSpacing: -0.7,
    textAlign: 'center',
  },
  metricStatusPill: {
    minHeight: 32,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricStatusText: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '700',
    textAlign: 'center',
  },
  metricDivider: {
    position: 'absolute',
    top: 2,
    right: 0,
    bottom: 2,
    width: StyleSheet.hairlineWidth,
    backgroundColor: SEPARATOR,
  },
  feedbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 12,
  },
  feedbackText: {
    fontSize: FONT_CAPTION,
    color: TEXT_SECONDARY,
  },
  cardDisabled: {
    opacity: 0.72,
  },
  errorText: {
    paddingTop: 12,
    fontSize: FONT_CAPTION,
    color: COLOR_RED,
  },
  v2Card: {
    marginTop: 24,
    minHeight: 262,
    borderRadius: 32,
    overflow: 'hidden',
    backgroundColor: '#07101D',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.18,
    shadowRadius: 34,
    elevation: 5,
  },
  v2GlowBlue: {
    position: 'absolute',
    top: -72,
    right: -26,
    width: 248,
    height: 248,
    borderRadius: 999,
    backgroundColor: 'rgba(38,107,255,0.28)',
    opacity: 1,
  },
  v2GlowPurple: {
    position: 'absolute',
    bottom: -116,
    left: -54,
    width: 232,
    height: 232,
    borderRadius: 999,
    backgroundColor: 'rgba(86,46,170,0.22)',
    opacity: 1,
  },
  v2MidTint: {
    position: 'absolute',
    top: 52,
    right: 46,
    width: 178,
    height: 178,
    borderRadius: 999,
    backgroundColor: 'rgba(16,42,92,0.18)',
  },
  v2CardContent: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  v2CardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  v2IconWrap: {
    width: 54,
    height: 54,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  v2Badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(40,116,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(64,130,255,0.35)',
  },
  v2BadgeStack: {
    alignItems: 'flex-end',
    gap: 8,
  },
  v2BadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#6CA8FF',
  },
  v2BadgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: '#8DBBFF',
  },
  v2TechBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(33,85,180,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(80,140,255,0.18)',
  },
  v2TechBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    color: 'rgba(173,210,255,0.88)',
  },
  v2Title: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -0.85,
    color: TEXT_ON_DARK,
  },
  v2Description: {
    marginTop: 8,
    alignSelf: 'stretch',
    fontSize: 15,
    lineHeight: 22,
    color: 'rgba(219,229,246,0.74)',
    marginBottom: 12,
  },
  v2CtaRow: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingVertical: 11,
    paddingLeft: 11,
    paddingRight: 16,
  },
  v2CtaIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2F80FF',
  },
  v2CtaText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: TEXT_ON_DARK,
  },
  v1Card: {
    marginTop: 20,
    borderRadius: 30,
    backgroundColor: BG_CARD,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER_SOFT,
    paddingHorizontal: 24,
    paddingVertical: 24,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 22,
    elevation: 2,
  },
  v1CardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  v1IconWrap: {
    width: 50,
    height: 50,
    borderRadius: 18,
    backgroundColor: 'rgba(0,122,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  v1TopBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(20,20,20,0.06)',
  },
  v1TopBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  v1Title: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '700',
    letterSpacing: -0.7,
    color: TEXT_PRIMARY,
  },
  v1Description: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    color: TEXT_SECONDARY,
  },
  v1PillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
    marginBottom: 22,
  },
  featurePill: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: '#F4F4F5',
  },
  featurePillText: {
    fontSize: FONT_CAPTION,
    lineHeight: 16,
    fontWeight: '600',
    color: '#6B7280',
  },
  v1CtaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 20,
    backgroundColor: '#111111',
    paddingVertical: 14,
  },
  v1CtaText: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
    color: TEXT_ON_DARK,
  },
  historySection: {
    marginTop: 28,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  historySectionTitle: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  historyLink: {
    fontSize: FONT_CALLOUT,
    lineHeight: 18,
    fontWeight: '600',
    color: COLOR_BLUE,
  },
  historyCard: {
    borderRadius: 24,
    backgroundColor: BG_CARD,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER_SOFT,
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.04,
    shadowRadius: 18,
    elevation: 2,
  },
  historyLeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
    paddingRight: 12,
  },
  historyIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: '#F8F6EF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyIcon: {
    fontSize: 24,
    lineHeight: 28,
  },
  historyCopy: {
    flex: 1,
  },
  historyCardTitle: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  historyCardSubtitle: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: TEXT_SECONDARY,
  },
  historyGrade: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  historyMeta: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 16,
    color: TEXT_TERTIARY,
  },
  cardPressed: {
    opacity: 0.96,
    transform: [{ scale: 0.992 }],
  },
});
