import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { SCENARIOS } from '@/data/scenarios';
import { useFloatingTabInsets } from '@/hooks/useFloatingTabInsets';
import {
  fetchSpeakingSessionDetail,
  type SpeakingSession,
} from '@/services/api/speakingSessions';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import { useAppTheme } from '@/theme/AppThemeProvider';

const PAGE_PADDING = 24;
const PAGE_MAX_WIDTH = 1400;
const COLUMN_GAP = 14;
const HEADER_HEIGHT = 46;
const HEADER_MARGIN_BOTTOM = 14;

type SpeakingHistoryScreenTabletProps = {
  sessions: SpeakingSession[];
  loading: boolean;
  error: string | null;
  isLoggedIn: boolean;
  summary: {
    total: number;
    completed: number;
    averageGrade: string;
  };
};

type TranscriptLine = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp?: number | string | null;
};

function cardShadow(colorScheme: 'light' | 'dark', shadowColor: string, opacity = 0.05) {
  return {
    shadowColor,
    shadowOpacity: colorScheme === 'dark' ? 0.16 : opacity,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: colorScheme === 'dark' ? 0 : 3,
  } as const;
}

function formatDate(iso: string) {
  const date = new Date(iso);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
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

function getScenarioMeta(scenarioId: string) {
  return SCENARIOS.find((item) => item.id === scenarioId) ?? null;
}

function extractOverallScore(scoreJson: unknown): number | null {
  if (!scoreJson || typeof scoreJson !== 'object') return null;

  const payload = scoreJson as Record<string, unknown>;
  const scoreSummary =
    payload.scoreSummary && typeof payload.scoreSummary === 'object'
      ? (payload.scoreSummary as Record<string, unknown>)
      : null;
  const summary =
    payload.summary && typeof payload.summary === 'object'
      ? (payload.summary as Record<string, unknown>)
      : null;

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

function extractScoreMetric(scoreJson: unknown, key: 'overall' | 'fluency' | 'accuracy' | 'vocabulary') {
  if (!scoreJson || typeof scoreJson !== 'object') return null;

  const payload = scoreJson as Record<string, unknown>;
  const scoreSummary =
    payload.scoreSummary && typeof payload.scoreSummary === 'object'
      ? (payload.scoreSummary as Record<string, unknown>)
      : null;
  const summary =
    payload.summary && typeof payload.summary === 'object'
      ? (payload.summary as Record<string, unknown>)
      : null;

  const candidates = [payload[key], scoreSummary?.[key], summary?.[key]];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0 && candidate <= 100) {
      return candidate;
    }
  }

  return null;
}

function extractSuggestion(scoreJson: unknown) {
  if (!scoreJson || typeof scoreJson !== 'object') return null;

  const payload = scoreJson as Record<string, unknown>;
  const candidates = [
    payload.suggestion,
    payload.feedback,
    payload.advice,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }

  return null;
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

function scorePillLabel(item: SpeakingSession) {
  if (item.status === 'active') return '进行中';
  const overall = extractOverallScore(item.score_json);
  if (typeof overall === 'number') return `${Math.round(overall)}分`;
  return item.status === 'completed' ? '待评估' : '已结束';
}

function actionLabel(item: SpeakingSession) {
  return item.status === 'active' ? '继续练习' : '重新练习';
}

export function SpeakingHistoryScreenTablet({
  sessions,
  loading,
  error,
  isLoggedIn,
  summary,
}: SpeakingHistoryScreenTabletProps) {
  const { theme } = useAppTheme();
  const appSession = useAppSession();
  const floatingInsets = useFloatingTabInsets();
  const safeInsets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(sessions[0]?.id ?? null);
  const [detail, setDetail] = useState<SpeakingSession | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const topPadding = Math.max(floatingInsets.top - 42, 52);
  const contentWidth = Math.min(width - PAGE_PADDING * 2, PAGE_MAX_WIDTH);
  const leftWidth = Math.min(455, Math.max(390, Math.round((contentWidth - COLUMN_GAP) * 0.34)));
  const bodyHeight = Math.max(height - topPadding - HEADER_HEIGHT - HEADER_MARGIN_BOTTOM - 24, 640);
  const bottomPadding = Math.max(safeInsets.bottom, 18);

  useEffect(() => {
    if (sessions.length === 0) {
      setSelectedSessionId(null);
      return;
    }

    setSelectedSessionId((current) =>
      current && sessions.some((item) => item.id === current) ? current : sessions[0].id,
    );
  }, [sessions]);

  useEffect(() => {
    let cancelled = false;

    if (!isLoggedIn || !appSession.session || !selectedSessionId) {
      setDetail(null);
      setDetailLoading(false);
      setDetailError(null);
      return () => {
        cancelled = true;
      };
    }

    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);

    fetchSpeakingSessionDetail(appSession.session, selectedSessionId)
      .then((nextDetail) => {
        if (!cancelled) setDetail(nextDetail);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setDetailError(nextError instanceof Error ? nextError.message : '加载记录详情失败');
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [appSession.session, isLoggedIn, selectedSessionId]);

  const selectedSummaryItem = useMemo(
    () => sessions.find((item) => item.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );
  const activeRecord = detail ?? selectedSummaryItem;
  const scenario = activeRecord ? getScenarioMeta(activeRecord.scenario_id) : null;
  const status = activeRecord ? getStatusMeta(activeRecord.status) : null;
  const overallScore = activeRecord ? extractOverallScore(activeRecord.score_json) : null;
  const scoreMetrics = activeRecord
    ? [
        { label: 'Overall', value: extractScoreMetric(activeRecord.score_json, 'overall') },
        { label: 'Fluency', value: extractScoreMetric(activeRecord.score_json, 'fluency') },
        { label: 'Accuracy', value: extractScoreMetric(activeRecord.score_json, 'accuracy') },
        { label: 'Vocabulary', value: extractScoreMetric(activeRecord.score_json, 'vocabulary') },
      ]
    : [];
  const suggestion = activeRecord ? extractSuggestion(activeRecord.score_json) : null;
  const transcriptLines = useMemo(
    () => extractTranscriptLines(detail?.transcript_json).slice(-8),
    [detail?.transcript_json],
  );

  return (
    <SafeAreaView edges={['left', 'right']} style={[styles.safeArea, { backgroundColor: theme.pageBackground }]}>
      <View style={[styles.page, { paddingTop: topPadding, paddingHorizontal: PAGE_PADDING }]}>
        <View style={[styles.pageInner, { width: contentWidth }]}>
          <View style={[styles.headerRow, { marginBottom: HEADER_MARGIN_BOTTOM }]}>
            <View style={styles.headerCopy}>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.back()}
                style={({ pressed }) => [
                  styles.backButton,
                  {
                    backgroundColor: theme.colorScheme === 'dark' ? theme.secondaryCardBackground : 'rgba(255,255,255,0.96)',
                    borderColor: 'rgba(15,23,42,0.06)',
                    ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
                  },
                  pressed && styles.buttonPressed,
                ]}
              >
                <Ionicons name="chevron-back" size={24} color={theme.textPrimary} />
              </Pressable>

              <View style={styles.headerTextWrap}>
                <AppText style={[styles.headerTitle, { color: theme.textPrimary }]}>练习记录</AppText>
                <AppText style={[styles.headerSubtitle, { color: theme.textSecondary }]}>
                  回顾每一次口语训练，查看评分与改进建议
                </AppText>
              </View>
            </View>

            <View style={styles.headerSpacer} />
          </View>

          {!isLoggedIn ? (
            <View
              style={[
                styles.loginCard,
                {
                  backgroundColor: theme.cardBackground,
                  borderColor: 'rgba(15,23,42,0.06)',
                  ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
                },
              ]}
            >
              <AppText style={[styles.stateTitle, { color: theme.textPrimary }]}>登录后查看练习记录</AppText>
              <AppText style={[styles.stateBody, { color: theme.textSecondary }]}>
                你的口语练习历史、评分结果和对话记录会在登录后同步显示在这里。
              </AppText>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/auth/sign-in')}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: theme.primaryBlue, ...cardShadow(theme.colorScheme, theme.shadowColor, 0.08) },
                  pressed && styles.buttonPressed,
                ]}
              >
                <Ionicons name="person-circle-outline" size={18} color="#FFFFFF" />
                <AppText style={styles.primaryButtonText}>去登录</AppText>
              </Pressable>
            </View>
          ) : (
            <View style={[styles.contentRow, { height: bodyHeight }]}>
              <View style={[styles.leftColumn, { width: leftWidth }]}>
                <View
                  style={[
                    styles.statsCard,
                    {
                      backgroundColor: theme.cardBackground,
                      borderColor: 'rgba(15,23,42,0.06)',
                      ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
                    },
                  ]}
                >
                  <View style={styles.statsRow}>
                    <View style={styles.statItem}>
                      <AppText style={[styles.statValue, { color: theme.textPrimary }]}>{summary.total}</AppText>
                      <AppText style={[styles.statLabel, { color: theme.textSecondary }]}>总练习</AppText>
                    </View>
                    <View style={[styles.statDivider, { backgroundColor: theme.border }]} />
                    <View style={styles.statItem}>
                      <AppText style={[styles.statValue, { color: theme.textPrimary }]}>{summary.completed}</AppText>
                      <AppText style={[styles.statLabel, { color: theme.textSecondary }]}>已完成</AppText>
                    </View>
                    <View style={[styles.statDivider, { backgroundColor: theme.border }]} />
                    <View style={styles.statItem}>
                      <AppText style={[styles.statValue, { color: theme.textPrimary }]} numberOfLines={1}>
                        {summary.averageGrade}
                      </AppText>
                      <AppText style={[styles.statLabel, { color: theme.textSecondary }]}>平均表现</AppText>
                    </View>
                  </View>
                </View>

                <AppText style={[styles.listHeading, { color: theme.textPrimary }]}>最近记录</AppText>

                <View
                  style={[
                    styles.listCard,
                    {
                      backgroundColor: theme.cardBackground,
                      borderColor: 'rgba(15,23,42,0.06)',
                      ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
                    },
                  ]}
                >
                  {loading ? (
                    <View style={styles.panelState}>
                      <ActivityIndicator color={theme.textSecondary} />
                    </View>
                  ) : error ? (
                    <View style={styles.panelState}>
                      <AppText style={[styles.stateTitle, { color: theme.textPrimary }]}>加载失败</AppText>
                      <AppText style={[styles.stateBody, { color: theme.destructive }]}>{error}</AppText>
                    </View>
                  ) : sessions.length === 0 ? (
                    <View style={styles.panelState}>
                      <AppText style={[styles.stateTitle, { color: theme.textPrimary }]}>还没有练习记录</AppText>
                      <AppText style={[styles.stateBody, { color: theme.textSecondary }]}>
                        开始一次新的口语训练后，这里会显示你的最近记录。
                      </AppText>
                    </View>
                  ) : (
                    <ScrollView
                      showsVerticalScrollIndicator={false}
                      contentContainerStyle={{ paddingBottom: 4 }}
                    >
                      {sessions.map((item) => {
                        const itemScenario = getScenarioMeta(item.scenario_id);
                        const selected = item.id === selectedSessionId;
                        const itemStatus = getStatusMeta(item.status);
                        return (
                          <Pressable
                            key={item.id}
                            accessibilityRole="button"
                            onPress={() => setSelectedSessionId(item.id)}
                            style={({ pressed }) => [
                              styles.recordRow,
                              {
                                backgroundColor: selected
                                  ? theme.colorScheme === 'dark'
                                    ? 'rgba(10,132,255,0.16)'
                                    : '#EAF3FF'
                                  : theme.cardBackground,
                                borderColor: selected ? '#8EC5FF' : 'rgba(15,23,42,0.08)',
                              },
                              pressed && styles.buttonPressed,
                            ]}
                          >
                            <View
                              style={[
                                styles.recordIconWrap,
                                {
                                  backgroundColor:
                                    theme.colorScheme === 'dark'
                                      ? theme.secondaryCardBackground
                                      : '#F4F7FB',
                                },
                              ]}
                            >
                              <AppText style={styles.recordIcon}>{itemScenario?.icon ?? '💬'}</AppText>
                            </View>

                            <View style={styles.recordCopy}>
                              <AppText style={[styles.recordTitle, { color: theme.textPrimary }]} numberOfLines={1}>
                                {itemScenario?.name ?? item.scenario_id}
                              </AppText>
                              <AppText style={[styles.recordMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                                {formatDate(item.started_at)} · {itemStatus.label}
                              </AppText>
                            </View>

                            <View
                              style={[
                                styles.recordPill,
                                { backgroundColor: itemStatus.bg },
                              ]}
                            >
                              <AppText style={[styles.recordPillText, { color: itemStatus.text }]} numberOfLines={1}>
                                {scorePillLabel(item)}
                              </AppText>
                            </View>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  )}
                </View>
              </View>

              <View style={styles.rightColumn}>
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  style={styles.detailScroller}
                  contentContainerStyle={[styles.detailContent, { paddingBottom: bottomPadding }]}
                >
                  {loading && sessions.length === 0 ? (
                    <View
                      style={[
                        styles.emptyDetailCard,
                        {
                          backgroundColor: theme.cardBackground,
                          borderColor: 'rgba(15,23,42,0.06)',
                          ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
                        },
                      ]}
                    >
                      <ActivityIndicator color={theme.textSecondary} />
                    </View>
                  ) : error && sessions.length === 0 ? (
                    <View
                      style={[
                        styles.emptyDetailCard,
                        {
                          backgroundColor: theme.cardBackground,
                          borderColor: 'rgba(15,23,42,0.06)',
                          ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
                        },
                      ]}
                    >
                      <AppText style={[styles.stateTitle, { color: theme.textPrimary }]}>练习记录加载失败</AppText>
                      <AppText style={[styles.stateBody, { color: theme.destructive }]}>{error}</AppText>
                    </View>
                  ) : sessions.length === 0 && !loading && !error ? (
                    <View
                      style={[
                        styles.emptyDetailCard,
                        {
                          backgroundColor: theme.cardBackground,
                          borderColor: 'rgba(15,23,42,0.06)',
                          ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
                        },
                      ]}
                    >
                      <AppText style={[styles.stateTitle, { color: theme.textPrimary }]}>等待第一条练习记录</AppText>
                      <AppText style={[styles.stateBody, { color: theme.textSecondary }]}>
                        完成一次口语练习后，这里会展示评分概览、改进建议和对话回放。
                      </AppText>
                    </View>
                  ) : detailLoading || (selectedSessionId && !activeRecord) ? (
                    <View
                      style={[
                        styles.emptyDetailCard,
                        {
                          backgroundColor: theme.cardBackground,
                          borderColor: 'rgba(15,23,42,0.06)',
                          ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
                        },
                      ]}
                    >
                      <ActivityIndicator color={theme.textSecondary} />
                    </View>
                  ) : detailError ? (
                    <View
                      style={[
                        styles.emptyDetailCard,
                        {
                          backgroundColor: theme.cardBackground,
                          borderColor: 'rgba(15,23,42,0.06)',
                          ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
                        },
                      ]}
                    >
                      <AppText style={[styles.stateTitle, { color: theme.textPrimary }]}>记录详情加载失败</AppText>
                      <AppText style={[styles.stateBody, { color: theme.destructive }]}>{detailError}</AppText>
                    </View>
                  ) : activeRecord ? (
                    <>
                      <View
                        style={[
                          styles.heroCard,
                          {
                            backgroundColor: theme.cardBackground,
                            borderColor: 'rgba(134,181,255,0.18)',
                            ...cardShadow(theme.colorScheme, theme.shadowColor, 0.05),
                          },
                        ]}
                      >
                        <View style={[styles.heroGlow, styles.heroGlowA, { backgroundColor: 'rgba(10,132,255,0.08)' }]} />
                        <View style={[styles.heroGlow, styles.heroGlowB, { backgroundColor: 'rgba(112,174,255,0.08)' }]} />

                        <View style={styles.heroMainRow}>
                          <View style={styles.heroLeft}>
                            <View
                              style={[
                                styles.heroIconWrap,
                                {
                                  backgroundColor:
                                    theme.colorScheme === 'dark'
                                      ? theme.secondaryCardBackground
                                      : 'rgba(244,247,251,0.92)',
                                },
                              ]}
                            >
                              <AppText style={styles.heroIcon}>{scenario?.icon ?? '💬'}</AppText>
                            </View>

                            <View style={styles.heroCopy}>
                              <AppText style={[styles.heroTitle, { color: theme.textPrimary }]} numberOfLines={1}>
                                {scenario?.name ?? activeRecord.scenario_id}
                              </AppText>
                              <AppText style={[styles.heroMeta, { color: theme.textSecondary }]} numberOfLines={2}>
                                {formatDate(activeRecord.started_at)} · {status?.label ?? '暂无状态'} ·{' '}
                                {activeRecord.status === 'active'
                                  ? '进行中'
                                  : formatDuration(activeRecord.started_at, activeRecord.ended_at)}
                              </AppText>
                            </View>
                          </View>

                          <View style={styles.heroRight}>
                            {status ? (
                              <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
                                <Ionicons name={status.icon} size={14} color={status.text} />
                                <AppText style={[styles.statusPillText, { color: status.text }]}>
                                  {status.label}
                                </AppText>
                              </View>
                            ) : null}

                            <AppText style={[styles.heroScore, { color: theme.textPrimary }]}>
                              {typeof overallScore === 'number' ? `${Math.round(overallScore)}` : '待评估'}
                            </AppText>
                            <AppText style={[styles.heroScoreLabel, { color: theme.textSecondary }]}>
                              {typeof overallScore === 'number' ? '综合得分' : '当前未生成评分'}
                            </AppText>
                          </View>
                        </View>
                      </View>

                      <View
                        style={[
                          styles.sectionCard,
                          {
                            backgroundColor: theme.cardBackground,
                            borderColor: 'rgba(15,23,42,0.06)',
                            ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
                          },
                        ]}
                      >
                        <AppText style={[styles.sectionTitle, { color: theme.textPrimary }]}>评分概览</AppText>
                        {activeRecord.score_json ? (
                          <View style={styles.scoreGrid}>
                            {scoreMetrics.map((item) => (
                              <View
                                key={item.label}
                                style={[
                                  styles.scoreTile,
                                  {
                                    backgroundColor: theme.secondaryCardBackground,
                                    borderColor: theme.border,
                                  },
                                ]}
                              >
                                <AppText style={[styles.scoreTileLabel, { color: theme.textSecondary }]}>
                                  {item.label}
                                </AppText>
                                <AppText style={[styles.scoreTileValue, { color: theme.textPrimary }]}>
                                  {typeof item.value === 'number' ? Math.round(item.value) : '--'}
                                </AppText>
                              </View>
                            ))}
                          </View>
                        ) : (
                          <View style={styles.inlineEmpty}>
                            <AppText style={[styles.stateTitle, { color: theme.textPrimary }]}>当前会话尚未生成评分</AppText>
                            <AppText style={[styles.stateBody, { color: theme.textSecondary }]}>
                              完成练习后，这里会显示综合表现、流利度、准确度和词汇表现。
                            </AppText>
                          </View>
                        )}
                      </View>

                      <View
                        style={[
                          styles.sectionCard,
                          {
                            backgroundColor: theme.cardBackground,
                            borderColor: 'rgba(15,23,42,0.06)',
                            ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
                          },
                        ]}
                      >
                        <AppText style={[styles.sectionTitle, { color: theme.textPrimary }]}>改进建议</AppText>
                        {suggestion ? (
                          <AppText style={[styles.suggestionText, { color: theme.textPrimary }]}>
                            {suggestion}
                          </AppText>
                        ) : (
                          <View style={styles.inlineEmpty}>
                            <AppText style={[styles.stateTitle, { color: theme.textPrimary }]}>当前还没有建议</AppText>
                            <AppText style={[styles.stateBody, { color: theme.textSecondary }]}>
                              评分生成后，这里会展示真实的改进建议。
                            </AppText>
                          </View>
                        )}
                      </View>

                      <View
                        style={[
                          styles.sectionCard,
                          {
                            backgroundColor: theme.cardBackground,
                            borderColor: 'rgba(15,23,42,0.06)',
                            ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
                          },
                        ]}
                      >
                        <AppText style={[styles.sectionTitle, { color: theme.textPrimary }]}>对话回放</AppText>
                        {transcriptLines.length > 0 ? (
                          <View style={styles.transcriptList}>
                            {transcriptLines.map((line) => (
                              <View
                                key={line.id}
                                style={[
                                  styles.transcriptRow,
                                  line.role === 'user' ? styles.transcriptRowUser : styles.transcriptRowAssistant,
                                ]}
                              >
                                <View
                                  style={[
                                    styles.transcriptBubble,
                                    {
                                      alignSelf: line.role === 'user' ? 'flex-end' : 'flex-start',
                                      backgroundColor:
                                        line.role === 'user'
                                          ? theme.colorScheme === 'dark'
                                            ? 'rgba(10,132,255,0.16)'
                                            : 'rgba(10,132,255,0.08)'
                                          : theme.secondaryCardBackground,
                                      borderColor:
                                        line.role === 'user'
                                          ? 'rgba(10,132,255,0.14)'
                                          : theme.border,
                                    },
                                  ]}
                                >
                                  <AppText style={[styles.transcriptRole, { color: theme.textSecondary }]}>
                                    {line.role === 'user' ? '你' : scenario?.aiName ?? 'AI'}
                                  </AppText>
                                  <AppText style={[styles.transcriptText, { color: theme.textPrimary }]}>
                                    {line.text}
                                  </AppText>
                                </View>
                              </View>
                            ))}
                          </View>
                        ) : (
                          <View style={styles.inlineEmpty}>
                            <AppText style={[styles.stateTitle, { color: theme.textPrimary }]}>暂无对话记录</AppText>
                            <AppText style={[styles.stateBody, { color: theme.textSecondary }]}>
                              这条记录当前没有可展示的 transcript。
                            </AppText>
                          </View>
                        )}
                      </View>

                      <View style={styles.actionRow}>
                        <Pressable
                          accessibilityRole="button"
                          onPress={() =>
                            router.push({
                              pathname: '/speaking/v1/practice',
                              params: { scenarioId: activeRecord.scenario_id },
                            })
                          }
                          style={({ pressed }) => [
                            activeRecord.status === 'active' ? styles.primaryButton : styles.secondaryButton,
                            activeRecord.status === 'active'
                              ? {
                                  backgroundColor: theme.primaryBlue,
                                  ...cardShadow(theme.colorScheme, theme.shadowColor, 0.08),
                                }
                              : {
                                  backgroundColor: theme.cardBackground,
                                  borderColor: theme.border,
                                },
                            pressed && styles.buttonPressed,
                          ]}
                        >
                          <Ionicons
                            name={activeRecord.status === 'active' ? 'play-circle-outline' : 'refresh-outline'}
                            size={18}
                            color={activeRecord.status === 'active' ? '#FFFFFF' : theme.textPrimary}
                          />
                          <AppText
                            style={
                              activeRecord.status === 'active'
                                ? styles.primaryButtonText
                                : [styles.secondaryButtonText, { color: theme.textPrimary }]
                            }
                          >
                            {actionLabel(activeRecord)}
                          </AppText>
                        </Pressable>
                      </View>
                    </>
                  ) : (
                    <View
                      style={[
                        styles.emptyDetailCard,
                        {
                          backgroundColor: theme.cardBackground,
                          borderColor: 'rgba(15,23,42,0.06)',
                          ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
                        },
                      ]}
                    >
                      <AppText style={[styles.stateTitle, { color: theme.textPrimary }]}>请选择一条记录</AppText>
                      <AppText style={[styles.stateBody, { color: theme.textSecondary }]}>
                        左侧选中记录后，右侧会显示这次练习的评分、建议和对话内容。
                      </AppText>
                    </View>
                  )}
                </ScrollView>
              </View>
            </View>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  page: {
    flex: 1,
    paddingBottom: 24,
  },
  pageInner: {
    flex: 1,
    alignSelf: 'center',
  },
  headerRow: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerCopy: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  backButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextWrap: {
    marginLeft: 16,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 14,
    lineHeight: 18,
  },
  headerSpacer: {
    width: 52,
  },
  contentRow: {
    flexDirection: 'row',
    gap: COLUMN_GAP,
    minHeight: 0,
  },
  leftColumn: {
    minWidth: 390,
    maxWidth: 455,
    minHeight: 0,
  },
  statsCard: {
    height: 126,
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
  },
  statsRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
  },
  statValue: {
    fontSize: 26,
    lineHeight: 31,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  statLabel: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 16,
  },
  listHeading: {
    marginTop: 14,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
  },
  listCard: {
    flex: 1,
    marginTop: 10,
    borderRadius: 24,
    borderWidth: 1,
    padding: 14,
    minHeight: 0,
  },
  recordRow: {
    height: 92,
    borderRadius: 20,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  recordIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordIcon: {
    fontSize: 22,
    lineHeight: 24,
  },
  recordCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
  },
  recordTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
  },
  recordMeta: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 16,
  },
  recordPill: {
    minHeight: 32,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  recordPillText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  rightColumn: {
    flex: 1,
    minWidth: 0,
  },
  detailScroller: {
    flex: 1,
  },
  detailContent: {
    gap: 12,
  },
  heroCard: {
    height: 178,
    borderRadius: 26,
    borderWidth: 1,
    paddingHorizontal: 26,
    paddingVertical: 22,
    overflow: 'hidden',
  },
  heroGlow: {
    position: 'absolute',
    borderRadius: 999,
  },
  heroGlowA: {
    width: 220,
    height: 220,
    right: -40,
    top: -80,
  },
  heroGlowB: {
    width: 180,
    height: 180,
    left: -60,
    bottom: -90,
  },
  heroMainRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 20,
  },
  heroLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroIcon: {
    fontSize: 30,
    lineHeight: 34,
  },
  heroCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 16,
  },
  heroTitle: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  heroMeta: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 18,
  },
  heroRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  statusPill: {
    minHeight: 30,
    borderRadius: 999,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusPillText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  heroScore: {
    marginTop: 12,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  heroScoreLabel: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
  },
  sectionCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
    marginBottom: 12,
  },
  scoreGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  scoreTile: {
    flexBasis: '48%',
    minWidth: 0,
    height: 76,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  scoreTileLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  scoreTileValue: {
    marginTop: 6,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
  },
  suggestionText: {
    fontSize: 15,
    lineHeight: 24,
  },
  transcriptList: {
    gap: 10,
  },
  transcriptRow: {
    flexDirection: 'row',
  },
  transcriptRowUser: {
    justifyContent: 'flex-end',
  },
  transcriptRowAssistant: {
    justifyContent: 'flex-start',
  },
  transcriptBubble: {
    maxWidth: '72%',
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  transcriptRole: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  transcriptText: {
    fontSize: 15,
    lineHeight: 22,
  },
  actionRow: {
    paddingTop: 2,
  },
  primaryButton: {
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  primaryButtonText: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  secondaryButton: {
    height: 52,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  secondaryButtonText: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
  },
  emptyDetailCard: {
    minHeight: 180,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loginCard: {
    borderRadius: 28,
    borderWidth: 1,
    padding: 24,
    gap: 12,
  },
  panelState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  inlineEmpty: {
    gap: 6,
  },
  stateTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  stateBody: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  buttonPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.995 }],
  },
});
