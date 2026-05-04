import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { ChromeIconButton } from '@/components/ui/ApplePrimitives';
import { SCENARIOS } from '@/data/scenarios';
import { useDeviceClass } from '@/hooks/useDeviceClass';
import {
  fetchSpeakingHistory,
  fetchSpeakingSessionDetail,
  type SpeakingSession,
} from '@/services/api/speakingSessions';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import { useAiDataConsent } from '@/services/privacy/AiDataConsentProvider';
import { SpeakingHistoryScreenTablet } from '@/screens/SpeakingHistoryScreenTablet';
import { useAppTheme } from '@/theme/AppThemeProvider';

type TranscriptLine = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp?: number | string | null;
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}

function formatDuration(startIso: string, endIso: string | null) {
  if (!endIso) return '进行中';
  const secs = Math.max(
    0,
    Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000),
  );
  const mins = Math.floor(secs / 60);
  const remain = secs % 60;
  return `${mins}m ${String(remain).padStart(2, '0')}s`;
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

function extractOverallScore(scoreJson: unknown): number | null {
  if (!scoreJson || typeof scoreJson !== 'object') return null;

  const payload = scoreJson as Record<string, unknown>;
  const scoreSummary =
    payload.scoreSummary && typeof payload.scoreSummary === 'object'
      ? (payload.scoreSummary as Record<string, unknown>)
      : null;
  const summary =
    payload.summary && typeof payload.summary === 'object' ? (payload.summary as Record<string, unknown>) : null;

  const candidates = [
    payload.overall,
    scoreSummary?.overall,
    summary?.overall,
    payload.finalScore,
    payload.score,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0 && candidate <= 100) {
      return candidate;
    }
  }

  return null;
}

function toPerformanceLabel(score?: number | null) {
  if (typeof score !== 'number' || Number.isNaN(score)) return null;
  if (score >= 90) return '优秀';
  if (score >= 80) return '良好';
  if (score >= 70) return '稳定';
  if (score >= 60) return '待提升';
  return '需要加强';
}

function getPerformanceDisplay(recordCount: number, score?: number | null) {
  if (recordCount <= 0) return '暂无';
  return toPerformanceLabel(score) ?? '待评估';
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
    textColor: '#6B7280',
  };
}

function getScenarioMeta(scenarioId: string) {
  return SCENARIOS.find((item) => item.id === scenarioId) ?? null;
}

function getStatusMeta(status: SpeakingSession['status']) {
  switch (status) {
    case 'completed':
      return {
        label: '已完成',
        bg: 'rgba(52,199,89,0.12)',
        text: '#22863A',
        icon: 'checkmark-circle' as const,
      };
    case 'aborted':
      return {
        label: '已结束',
        bg: 'rgba(255,159,10,0.14)',
        text: '#B86E00',
        icon: 'pause-circle' as const,
      };
    default:
      return {
        label: '进行中',
        bg: 'rgba(10,132,255,0.12)',
        text: '#0A84FF',
        icon: 'radio-button-on' as const,
      };
  }
}

function buildFeedback(item: SpeakingSession) {
  if (item.status !== 'completed') {
    return '当前会话尚未结束，继续练习以获取评估摘要。';
  }

  return item.score_json?.suggestion?.trim() || '本次对话已完成，可进入详情页查看完整语音评估与对话记录。';
}

function extractTranscriptLines(transcriptJson: unknown): TranscriptLine[] {
  if (!Array.isArray(transcriptJson)) return [];

  return transcriptJson.reduce<TranscriptLine[]>((lines, item, index) => {
    if (!item || typeof item !== 'object') return lines;
    const row = item as Record<string, unknown>;
    const rawRole = typeof row.role === 'string' ? row.role : '';
    const role = rawRole === 'assistant' || rawRole === 'ai' ? 'assistant' : rawRole === 'user' ? 'user' : null;
    const text =
      typeof row.text === 'string'
        ? row.text.trim()
        : typeof row.content === 'string'
          ? row.content.trim()
          : '';

    if (!role || !text) return lines;

    lines.push({
      id: typeof row.id === 'string' ? row.id : `line_${index}`,
      role,
      text,
      timestamp:
        typeof row.timestamp === 'number' || typeof row.timestamp === 'string'
          ? row.timestamp
          : null,
    });

    return lines;
  }, []);
}

function HistoryCard({
  item,
  onReopenPractice,
}: {
  item: SpeakingSession;
  onReopenPractice: (scenarioId: string) => void;
}) {
  const { theme } = useAppTheme();
  const scenario = getScenarioMeta(item.scenario_id);
  const status = getStatusMeta(item.status);
  const score = extractOverallScore(item.score_json);
  const performanceDisplay = getPerformanceDisplay(1, score);
  const performanceTone = getPerformanceTone(performanceDisplay);
  const feedback = buildFeedback(item);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.push({
          pathname: '/speaking/history-detail/[sessionId]',
          params: { sessionId: item.id },
        })
      }
      style={({ pressed }) => [
        historyStyles.recordCard,
        { backgroundColor: theme.cardBackground, borderColor: theme.border, shadowOpacity: theme.colorScheme === 'dark' ? 0 : 0.03 },
        pressed && { opacity: 0.92, transform: [{ scale: 0.995 }] },
      ]}
    >
      <View style={historyStyles.recordHeader}>
        <View style={historyStyles.recordHeaderLeft}>
          <View style={[historyStyles.recordIconWrap, { backgroundColor: theme.secondaryCardBackground }]}>
            <AppText style={historyStyles.recordIcon}>{scenario?.icon ?? '💬'}</AppText>
          </View>

          <View style={historyStyles.recordTitleWrap}>
            <AppText style={[historyStyles.recordTitle, { color: theme.textPrimary }]}>{scenario?.name ?? item.scenario_id}</AppText>
            <View style={historyStyles.recordMetaRow}>
              <Ionicons name="calendar-outline" size={13} color={theme.textTertiary} />
              <AppText style={[historyStyles.recordMetaText, { color: theme.textSecondary }]}>{formatDate(item.started_at)}</AppText>
              <View style={historyStyles.dot} />
              <Ionicons name="time-outline" size={13} color={theme.textTertiary} />
              <AppText style={[historyStyles.recordMetaText, { color: theme.textSecondary }]}>
                {item.status === 'active' ? '进行中' : formatDuration(item.started_at, item.ended_at)}
              </AppText>
            </View>
          </View>
        </View>

        <View style={[historyStyles.statusPill, { backgroundColor: status.bg }]}>
          <Ionicons name={status.icon} size={13} color={status.text} />
          <AppText style={[historyStyles.statusText, { color: status.text }]}>{status.label}</AppText>
        </View>
      </View>

      <View style={[historyStyles.summaryBox, { backgroundColor: theme.secondaryCardBackground, borderColor: theme.border }]}>
        <View style={historyStyles.summaryTitleRow}>
          <AppText style={[historyStyles.summaryTitle, { color: theme.textPrimary }]}>综合表现</AppText>
          <View
            style={[
              historyStyles.gradePill,
              {
                backgroundColor: performanceTone.backgroundColor,
                borderColor: performanceTone.borderColor,
              },
            ]}
          >
            <AppText style={[historyStyles.gradeText, { color: performanceTone.textColor }]}>{performanceDisplay}</AppText>
          </View>
        </View>
        <AppText style={[historyStyles.summaryBody, { color: theme.textSecondary }]}>{feedback}</AppText>
      </View>

      <View style={[historyStyles.recordActions, item.status !== 'completed' && { justifyContent: 'flex-start' }]}>
        <Pressable
          accessibilityRole="button"
          onPress={(event) => {
            event.stopPropagation();
            onReopenPractice(item.scenario_id);
          }}
          style={({ pressed }) => [historyStyles.primaryAction, { backgroundColor: theme.primaryBlue, shadowOpacity: theme.colorScheme === 'dark' ? 0 : 0.08 }, pressed && { opacity: 0.86 }]}
        >
          <Ionicons name="play-circle-outline" size={16} color="#FFFFFF" />
          <AppText style={historyStyles.primaryActionText}>
            {item.status === 'completed' ? '再练一次' : '继续练习'}
          </AppText>
        </Pressable>

        {item.status === 'completed' ? (
          <Pressable
            accessibilityRole="button"
            onPress={(event) => {
              event.stopPropagation();
              router.push({
                pathname: '/speaking/history-detail/[sessionId]',
                params: { sessionId: item.id },
              });
            }}
            style={({ pressed }) => [historyStyles.secondaryAction, { backgroundColor: theme.secondaryCardBackground, borderColor: theme.border }, pressed && { opacity: 0.8 }]}
          >
            <Ionicons name="bar-chart-outline" size={16} color={theme.textSecondary} />
            <AppText style={[historyStyles.secondaryActionText, { color: theme.textPrimary }]}>查看报告</AppText>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

export function SpeakingHistoryScreen() {
  const { theme } = useAppTheme();
  const aiConsent = useAiDataConsent();
  const { isTablet } = useDeviceClass();
  const session = useAppSession();
  const isLoggedIn = session.status === 'authenticated';
  const [sessions, setSessions] = useState<SpeakingSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoggedIn || !session.session) return;
    const abortController = new AbortController();
    setLoading(true);
    setError(null);
    fetchSpeakingHistory(session.session, { limit: 50, signal: abortController.signal })
      .then((rows) => {
        if (!abortController.signal.aborted) {
          setSessions(rows);
        }
      })
      .catch((e) => {
        if (e instanceof Error && e.name === 'AbortError') return;
        setError(e instanceof Error ? e.message : '加载练习记录失败');
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      });
    return () => {
      abortController.abort();
    };
  }, [isLoggedIn, session.session]);

  const summary = useMemo(() => {
    const completed = sessions.filter((item) => item.status === 'completed');
    const scored = completed
      .map((item) => extractOverallScore(item.score_json))
      .filter((item): item is number => item !== null);
    const averageScore =
      scored.length > 0 ? Math.round(scored.reduce((sum, item) => sum + item, 0) / scored.length) : null;

    return {
      total: sessions.length,
      completed: completed.length,
      averageGrade: getPerformanceDisplay(sessions.length, averageScore),
    };
  }, [sessions]);

  const reopenPractice = async (scenarioId: string) => {
    const consented = await aiConsent.requestConsent();
    if (!consented) return;
    router.push({ pathname: '/speaking/v1/practice', params: { scenarioId } });
  };

  if (isTablet) {
    return (
      <SpeakingHistoryScreenTablet
        sessions={sessions}
        loading={loading}
        error={error}
        isLoggedIn={isLoggedIn}
        summary={summary}
      />
    );
  }

  return (
    <AppScreenShell
      contentContainerStyle={historyStyles.scrollContent}
      showsVerticalScrollIndicator={false}
      backgroundColor={theme.pageBackground}
      includeBottomInset={false}
    >
        <View style={historyStyles.navBar}>
          <ChromeIconButton icon="chevron-back" onPress={() => router.back()} accessibilityLabel="口语" />
        </View>

        <View style={historyStyles.headerBlock}>
          <AppText style={[historyStyles.title, { color: theme.textPrimary }]}>练习记录</AppText>
          <AppText style={[historyStyles.subtitle, { color: theme.textSecondary }]}>
            回顾你的每一次对话。温故而知新，在这里查看详细的语音评估与改进建议。
          </AppText>
        </View>

        {!isLoggedIn ? (
          <View style={[historyStyles.emptyCard, { backgroundColor: theme.cardBackground, borderColor: theme.border }]}>
            <AppText style={[historyStyles.emptyTitle, { color: theme.textPrimary }]}>登录后查看你的练习记录</AppText>
            <AppText style={[historyStyles.emptyBody, { color: theme.textSecondary }]}>
              完整的对话历史、评估结果和对话记录会在登录后自动同步到这里。
            </AppText>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/auth/sign-in')}
              style={({ pressed }) => [historyStyles.primaryAction, historyStyles.loginButton, { backgroundColor: theme.primaryBlue, shadowOpacity: theme.colorScheme === 'dark' ? 0 : 0.08 }, pressed && { opacity: 0.86 }]}
            >
              <Ionicons name="person-circle-outline" size={16} color="#FFFFFF" />
              <AppText style={historyStyles.primaryActionText}>去登录</AppText>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={historyStyles.summaryRow}>
              <View style={[historyStyles.summaryCard, { backgroundColor: theme.cardBackground, borderColor: theme.border, shadowOpacity: theme.colorScheme === 'dark' ? 0 : 0.025 }]}>
                <AppText style={[historyStyles.summaryValue, { color: theme.textPrimary }]}>{summary.total}</AppText>
                <AppText style={[historyStyles.summaryLabel, { color: theme.textTertiary }]}>总练习（次）</AppText>
              </View>
              <View style={[historyStyles.summaryCard, { backgroundColor: theme.cardBackground, borderColor: theme.border, shadowOpacity: theme.colorScheme === 'dark' ? 0 : 0.025 }]}>
                <AppText style={[historyStyles.summaryValue, { color: theme.textPrimary }]}>{summary.completed}</AppText>
                <AppText style={[historyStyles.summaryLabel, { color: theme.textTertiary }]}>已完成</AppText>
              </View>
              <View style={[historyStyles.summaryCard, { backgroundColor: theme.cardBackground, borderColor: theme.border, shadowOpacity: theme.colorScheme === 'dark' ? 0 : 0.025 }]}>
                <View
                  style={[
                    historyStyles.summaryStatusPill,
                    {
                      backgroundColor: getPerformanceTone(summary.averageGrade).backgroundColor,
                      borderColor: getPerformanceTone(summary.averageGrade).borderColor,
                    },
                  ]}
                >
                  <AppText
                    style={[
                      historyStyles.summaryStatusText,
                      { color: getPerformanceTone(summary.averageGrade).textColor },
                    ]}
                  >
                    {summary.averageGrade}
                  </AppText>
                </View>
                <AppText style={[historyStyles.summaryLabel, { color: theme.textTertiary }]}>平均表现</AppText>
              </View>
            </View>

            <View style={historyStyles.sectionHeader}>
              <AppText style={[historyStyles.sectionHeaderText, { color: theme.textTertiary }]}>近期记录</AppText>
            </View>

            {loading ? (
              <View style={historyStyles.stateWrap}>
                <ActivityIndicator color={theme.textSecondary} />
              </View>
            ) : error ? (
              <View style={[historyStyles.emptyCard, { backgroundColor: theme.cardBackground, borderColor: theme.border }]}>
                <AppText style={[historyStyles.emptyTitle, { color: theme.textPrimary }]}>加载失败</AppText>
                <AppText style={[historyStyles.emptyBody, { color: theme.destructive }]}>{error}</AppText>
              </View>
            ) : sessions.length === 0 ? (
              <View style={[historyStyles.emptyCard, { backgroundColor: theme.cardBackground, borderColor: theme.border }]}>
                <AppText style={[historyStyles.emptyTitle, { color: theme.textPrimary }]}>还没有练习记录</AppText>
                <AppText style={[historyStyles.emptyBody, { color: theme.textSecondary }]}>
                  开始一次新的口语对练后，这里会自动出现你的记录与评估摘要。
                </AppText>
              </View>
            ) : (
              <View style={historyStyles.recordList}>
                {sessions.map((item) => (
                  <HistoryCard key={item.id} item={item} onReopenPractice={(scenarioId) => void reopenPractice(scenarioId)} />
                ))}
              </View>
            )}
          </>
        )}
    </AppScreenShell>
  );
}

export function SpeakingHistoryDetailScreen() {
  const { theme } = useAppTheme();
  const aiConsent = useAiDataConsent();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const sessionId = Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId;
  const session = useAppSession();
  const isLoggedIn = session.status === 'authenticated';
  const [record, setRecord] = useState<SpeakingSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoggedIn || !session.session || !sessionId) return;
    setLoading(true);
    setError(null);
    fetchSpeakingSessionDetail(session.session, sessionId)
      .then(setRecord)
      .catch((e) => setError(e instanceof Error ? e.message : '加载记录详情失败'))
      .finally(() => setLoading(false));
  }, [isLoggedIn, session.session, sessionId]);

  const scenario = record ? getScenarioMeta(record.scenario_id) : null;
  const score = extractOverallScore(record?.score_json);
  const performanceDisplay = record ? getPerformanceDisplay(1, score) : '暂无';
  const transcriptLines = extractTranscriptLines(record?.transcript_json);
  const status = record ? getStatusMeta(record.status) : null;
  const reopenPractice = async (scenarioId: string) => {
    const consented = await aiConsent.requestConsent();
    if (!consented) return;
    router.push({ pathname: '/speaking/v1/practice', params: { scenarioId } });
  };

  return (
    <AppScreenShell
      contentContainerStyle={historyStyles.scrollContent}
      showsVerticalScrollIndicator={false}
      backgroundColor={theme.pageBackground}
      includeBottomInset={false}
    >
        <View style={historyStyles.navBar}>
          <ChromeIconButton icon="chevron-back" onPress={() => router.back()} accessibilityLabel="记录" />
        </View>

        {loading ? (
          <View style={historyStyles.stateWrap}>
            <ActivityIndicator color={theme.textSecondary} />
          </View>
        ) : !isLoggedIn ? (
          <View style={[historyStyles.emptyCard, { backgroundColor: theme.cardBackground, borderColor: theme.border }]}>
            <AppText style={[historyStyles.emptyTitle, { color: theme.textPrimary }]}>请先登录</AppText>
            <AppText style={[historyStyles.emptyBody, { color: theme.textSecondary }]}>登录后才能查看练习详情与对话记录。</AppText>
          </View>
        ) : error ? (
          <View style={[historyStyles.emptyCard, { backgroundColor: theme.cardBackground, borderColor: theme.border }]}>
            <AppText style={[historyStyles.emptyTitle, { color: theme.textPrimary }]}>加载失败</AppText>
            <AppText style={[historyStyles.emptyBody, { color: theme.destructive }]}>{error}</AppText>
          </View>
        ) : !record ? (
          <View style={[historyStyles.emptyCard, { backgroundColor: theme.cardBackground, borderColor: theme.border }]}>
            <AppText style={[historyStyles.emptyTitle, { color: theme.textPrimary }]}>未找到这条记录</AppText>
            <AppText style={[historyStyles.emptyBody, { color: theme.textSecondary }]}>这次练习可能已被移除，或当前账号没有查看权限。</AppText>
          </View>
        ) : (
          <>
            <View style={historyStyles.headerBlock}>
              <AppText style={[historyStyles.title, { color: theme.textPrimary }]}>{scenario?.name ?? record.scenario_id}</AppText>
              <AppText style={[historyStyles.subtitle, { color: theme.textSecondary }]}>
                {formatDate(record.started_at)} · {record.status === 'active' ? '进行中' : formatDuration(record.started_at, record.ended_at)}
              </AppText>
            </View>

            <View style={[historyStyles.detailMetaCard, { backgroundColor: theme.cardBackground, borderColor: theme.border }]}>
              <View style={historyStyles.detailMetaRow}>
                <DetailMeta label="场景" value={scenario?.name ?? record.scenario_id} />
                <DetailMeta label="状态" value={status?.label ?? '暂无'} />
              </View>
              <View style={historyStyles.detailMetaRow}>
                <DetailMeta label="时长" value={record.status === 'active' ? '进行中' : formatDuration(record.started_at, record.ended_at)} />
                <DetailMeta label="综合表现" value={performanceDisplay} />
              </View>
            </View>

            <View style={historyStyles.sectionHeader}>
              <AppText style={[historyStyles.sectionHeaderText, { color: theme.textTertiary }]}>对话记录</AppText>
            </View>

            <View style={[historyStyles.detailTranscriptCard, { backgroundColor: theme.cardBackground, borderColor: theme.border }]}>
              {transcriptLines.length === 0 ? (
                <AppText style={[historyStyles.emptyBody, { color: theme.textSecondary }]}>当前这条记录暂无可读对话内容。</AppText>
              ) : (
                <View style={historyStyles.transcriptList}>
                  {transcriptLines.map((line) => (
                    <View
                      key={line.id}
                      style={[
                        historyStyles.transcriptBubble,
                        line.role === 'user'
                          ? [historyStyles.userBubble, { backgroundColor: theme.colorScheme === 'dark' ? 'rgba(10,132,255,0.18)' : 'rgba(10,132,255,0.08)' }]
                          : [historyStyles.aiBubble, { backgroundColor: theme.secondaryCardBackground }],
                      ]}
                    >
                      <AppText style={[historyStyles.transcriptRole, { color: theme.textSecondary }]}>
                        {line.role === 'user' ? '你' : `${scenario?.aiName ?? 'AI'}`}
                      </AppText>
                      <AppText style={[historyStyles.transcriptText, { color: theme.textPrimary }]}>{line.text}</AppText>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View style={historyStyles.detailActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => void reopenPractice(record.scenario_id)}
                style={({ pressed }) => [historyStyles.primaryAction, { backgroundColor: theme.primaryBlue, shadowOpacity: theme.colorScheme === 'dark' ? 0 : 0.08 }, pressed && { opacity: 0.86 }]}
              >
                <Ionicons name="play-circle-outline" size={16} color="#FFFFFF" />
                <AppText style={historyStyles.primaryActionText}>再练一次</AppText>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                onPress={() => router.back()}
                style={({ pressed }) => [historyStyles.secondaryAction, { backgroundColor: theme.secondaryCardBackground, borderColor: theme.border }, pressed && { opacity: 0.8 }]}
              >
                <Ionicons name="list-outline" size={16} color={theme.textSecondary} />
                <AppText style={[historyStyles.secondaryActionText, { color: theme.textPrimary }]}>返回记录</AppText>
              </Pressable>
            </View>
          </>
        )}
    </AppScreenShell>
  );
}

function DetailMeta({ label, value }: { label: string; value: string }) {
  const { theme } = useAppTheme();
  return (
    <View style={historyStyles.detailMetaItem}>
      <AppText style={[historyStyles.detailMetaLabel, { color: theme.textTertiary }]}>{label}</AppText>
      <AppText style={[historyStyles.detailMetaValue, { color: theme.textPrimary }]}>{value}</AppText>
    </View>
  );
}

const historyStyles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 34,
  },
  navBar: {
    paddingTop: 10,
    paddingBottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  headerBlock: {
    marginBottom: 30,
  },
  title: {
    fontSize: 34,
    lineHeight: 40,
    color: '#111111',
    fontWeight: '800',
    letterSpacing: -0.9,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: '#6B7280',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 30,
  },
  summaryCard: {
    flex: 1,
    minHeight: 120,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(17,17,17,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#111111',
    shadowOpacity: 0.025,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
    paddingHorizontal: 10,
    gap: 8,
  },
  summaryValue: {
    fontSize: 31,
    lineHeight: 36,
    color: '#111111',
    fontWeight: '800',
    marginBottom: 6,
    letterSpacing: -0.8,
    textAlign: 'center',
  },
  summaryStatusPill: {
    minHeight: 32,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  summaryStatusText: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '700',
    textAlign: 'center',
  },
  summaryLabel: {
    fontSize: 11,
    lineHeight: 15,
    color: '#8E8E93',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '700',
    textAlign: 'center',
  },
  sectionHeader: {
    marginBottom: 10,
  },
  sectionHeaderText: {
    marginLeft: 4,
    fontSize: 13,
    lineHeight: 18,
    color: '#8E8E93',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    fontWeight: '700',
  },
  recordList: {
    gap: 16,
  },
  recordCard: {
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(17,17,17,0.05)',
    padding: 18,
    shadowColor: '#111111',
    shadowOpacity: 0.03,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
    gap: 16,
  },
  recordHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  recordHeaderLeft: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
  },
  recordIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: '#F4F4F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordIcon: {
    fontSize: 22,
    lineHeight: 24,
  },
  recordTitleWrap: {
    flex: 1,
    gap: 5,
  },
  recordTitle: {
    fontSize: 17,
    lineHeight: 22,
    color: '#111111',
    fontWeight: '700',
  },
  recordMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexWrap: 'wrap',
  },
  recordMetaText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#8E8E93',
    fontWeight: '500',
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D4D4D8',
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  summaryBox: {
    borderRadius: 20,
    backgroundColor: 'rgba(244,244,245,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(228,228,231,0.9)',
    padding: 14,
    gap: 8,
  },
  summaryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  summaryTitle: {
    fontSize: 14,
    lineHeight: 18,
    color: '#111111',
    fontWeight: '700',
  },
  gradePill: {
    minHeight: 28,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gradeText: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
  },
  summaryBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#52525B',
  },
  recordActions: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryAction: {
    flex: 1,
    minHeight: 50,
    borderRadius: 18,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    shadowColor: '#111111',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  primaryActionText: {
    fontSize: 15,
    lineHeight: 20,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  secondaryAction: {
    flex: 1,
    minHeight: 50,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(17,17,17,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  secondaryActionText: {
    fontSize: 15,
    lineHeight: 20,
    color: '#111111',
    fontWeight: '700',
  },
  emptyCard: {
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(17,17,17,0.05)',
    padding: 20,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 18,
    lineHeight: 24,
    color: '#111111',
    fontWeight: '700',
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#6B7280',
  },
  loginButton: {
    marginTop: 8,
  },
  stateWrap: {
    paddingVertical: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailMetaCard: {
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(17,17,17,0.05)',
    padding: 18,
    gap: 12,
    marginBottom: 28,
  },
  detailMetaRow: {
    flexDirection: 'row',
    gap: 12,
  },
  detailMetaItem: {
    flex: 1,
    gap: 4,
  },
  detailMetaLabel: {
    fontSize: 12,
    lineHeight: 16,
    color: '#8E8E93',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '700',
  },
  detailMetaValue: {
    fontSize: 16,
    lineHeight: 22,
    color: '#111111',
    fontWeight: '700',
  },
  detailTranscriptCard: {
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(17,17,17,0.05)',
    padding: 18,
    marginBottom: 28,
  },
  transcriptList: {
    gap: 12,
  },
  transcriptBubble: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  userBubble: {
    backgroundColor: 'rgba(10,132,255,0.08)',
  },
  aiBubble: {
    backgroundColor: 'rgba(244,244,245,0.92)',
  },
  transcriptRole: {
    fontSize: 12,
    lineHeight: 16,
    color: '#8E8E93',
    fontWeight: '700',
  },
  transcriptText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#111111',
  },
  detailActions: {
    flexDirection: 'row',
    gap: 10,
    paddingBottom: 12,
  },
});
