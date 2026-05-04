import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { Canvas, Circle, DashPathEffect, Path, Skia } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { TopRightAvatarButton } from '@/components/ui/TopRightAvatarButton';
import { useFloatingTabInsets } from '@/hooks/useFloatingTabInsets';
import { useAppTheme } from '@/theme/AppThemeProvider';

export type WordsScreenTabletRecentWord = {
  word: string;
  phonetic?: string;
  meaning?: string;
  lastReviewedAt?: string;
  nextReviewAt?: string;
};

export type WordsScreenTabletInsightItem = {
  title: string;
  detail?: string;
};

export type WordsScreenTabletProps = {
  showGuestState: boolean;
  hasAnyData: boolean;
  initialLoading: boolean;
  combinedError: string | null;
  focusBookTitle: string;
  todayNewCompleted: number;
  todayNewPlanned: number;
  masteryRate: number;
  dueNowCount: number;
  remainingReviewToComplete: number;
  mistakeCount: number;
  todayReviewCompleted: number;
  todayReviewPlanned: number;
  todayMistakeCompleted: number;
  todayMistakePlanned: number;
  totalTodayPlanned: number;
  totalTodayCompleted: number;
  nextReviewAt: string | null;
  insightItems: WordsScreenTabletInsightItem[];
  insightIsFallback: boolean;
  weakTags: string[];
  strongTags: string[];
  recentWords?: WordsScreenTabletRecentWord[];
  onContinueLearning: () => void;
  onOpenTodayPlan: () => void;
  onOpenAnalysis: () => void;
  onOpenBooks: () => void;
  onOpenNotebook: () => void;
  onOpenPlanSettings: () => void;
  onOpenMistakes: () => void;
  onOpenMyTab: () => void;
};

const PAGE_PADDING = 20;
const PAGE_MAX_WIDTH = 1440;
const GRID_GAP = 12;
const HERO_HEIGHT = 210;
const SECOND_ROW_HEIGHT = 176;
const THIRD_ROW_HEIGHT = 204;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatShortProgress(current: number, total: number) {
  if (!total) return '--';
  return `${current} / ${total}`;
}

function formatNextReview(value: string | null) {
  if (!value) return '待安排';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '待安排';

  if (date.getTime() <= Date.now()) return '现在到期';

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRecentWordMeta(word: WordsScreenTabletRecentWord) {
  const parts = [word.phonetic, word.meaning].filter(Boolean);
  if (parts.length > 0) return parts.join(' · ');
  return '暂无释义';
}

function ReviewScheduleCurve({ chartWidth }: { chartWidth: number }) {
  const chartHeight = 92;
  const { backgroundPath, dashedPath, p2, p3 } = useMemo(() => {
    const w = chartWidth;
    const h = chartHeight;
    const p0: [number, number] = [w * 0.045, 60];
    const p2Point: [number, number] = [w * 0.352, 38];
    const p3Point: [number, number] = [w * 0.557, 70];
    const p5: [number, number] = [w * 0.955, 20];

    const mainPath = Skia.Path.Make();
    mainPath.moveTo(p0[0], p0[1]);
    mainPath.cubicTo(w * 0.09, 56, w * 0.24, 36, p2Point[0], p2Point[1]);
    mainPath.cubicTo(w * 0.43, 38, w * 0.49, 68, p3Point[0], p3Point[1]);
    mainPath.cubicTo(w * 0.64, 74, w * 0.82, 40, p5[0], p5[1]);

    return {
      backgroundPath: mainPath,
      dashedPath: mainPath,
      p2: p2Point,
      p3: p3Point,
    };
  }, [chartWidth]);

  return (
    <Canvas style={[styles.reviewCanvas, { width: chartWidth }]}>
      <Path
        path={backgroundPath}
        color="rgba(139,92,246,0.08)"
        style="stroke"
        strokeWidth={5}
        strokeCap="round"
        strokeJoin="round"
      />
      <Path
        path={dashedPath}
        color="rgba(139,92,246,0.52)"
        style="stroke"
        strokeWidth={1.9}
        strokeCap="round"
        strokeJoin="round"
      >
        <DashPathEffect intervals={[6, 8]} />
      </Path>
      <Circle cx={p2[0]} cy={p2[1]} r={5} color="rgba(139,92,246,0.12)" />
      <Circle cx={p2[0]} cy={p2[1]} r={3.6} color="#FFFFFF" />
      <Circle cx={p2[0]} cy={p2[1]} r={3.6} color="#8B5CF6" style="stroke" strokeWidth={2} />
      <Circle cx={p3[0]} cy={p3[1]} r={5} color="rgba(139,92,246,0.14)" />
      <Circle cx={p3[0]} cy={p3[1]} r={4} color="#8B5CF6" />
    </Canvas>
  );
}

function HeroMasteryRing({ percent }: { percent: number }) {
  const { theme } = useAppTheme();
  const size = 48;
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const rect = {
    x: strokeWidth / 2,
    y: strokeWidth / 2,
    width: size - strokeWidth,
    height: size - strokeWidth,
  };
  const progressPath = useMemo(() => {
    const path = Skia.Path.Make();
    path.addArc(rect, -90, (360 * clamp(percent, 0, 100)) / 100);
    return path;
  }, [percent]);

  return (
    <View style={styles.masteryRingWrap}>
      <Canvas style={styles.masteryRingCanvas}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          color={theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(59,130,246,0.16)'}
          style="stroke"
          strokeWidth={strokeWidth}
        />
        <Path
          path={progressPath}
          color={theme.primaryBlue}
          style="stroke"
          strokeWidth={strokeWidth}
          strokeCap="round"
        />
      </Canvas>
      <View pointerEvents="none" style={styles.masteryRingCenter}>
        <AppText style={[styles.masteryRingText, { color: theme.colorScheme === 'dark' ? '#FFFFFF' : '#0F172A' }]}>
          {percent}%
        </AppText>
      </View>
    </View>
  );
}

function HeroStatCard({
  icon,
  label,
  value,
  unit,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  unit?: string;
}) {
  const { theme } = useAppTheme();

  return (
    <View
      style={[
        styles.heroStatCard,
        {
          backgroundColor: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.58)',
          borderColor: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(60,60,67,0.10)',
        },
      ]}
    >
      <Ionicons name={icon} size={20} color={theme.primaryBlue} />
      <AppText style={[styles.heroStatLabel, { color: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.72)' : 'rgba(15,23,42,0.58)' }]}>
        {label}
      </AppText>
      <View style={styles.heroStatValueRow}>
        <AppText style={[styles.heroStatValue, { color: theme.colorScheme === 'dark' ? '#FFFFFF' : '#0F172A' }]}>
          {value}
        </AppText>
        {unit ? (
          <AppText style={[styles.heroStatUnit, { color: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.72)' : 'rgba(15,23,42,0.58)' }]}>
            {unit}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

function SectionCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: object;
}) {
  const { theme } = useAppTheme();

  return (
    <View
      style={[
        styles.sectionCard,
        {
          backgroundColor: theme.cardBackground,
          borderColor: theme.border,
          shadowColor: theme.shadowColor,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

function TaskMetricRow({
  label,
  value,
  isLast = false,
}: {
  label: string;
  value: string;
  isLast?: boolean;
}) {
  const { theme } = useAppTheme();

  return (
    <View style={[styles.taskMetricRow, { borderBottomColor: theme.border, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth }]}>
      <AppText style={[styles.taskMetricLabel, { color: theme.textSecondary }]} numberOfLines={1}>
        {label}
      </AppText>
      <View style={styles.taskMetricValueWrap}>
        <AppText style={[styles.taskMetricValue, { color: theme.textPrimary }]} numberOfLines={1}>
          {value}
        </AppText>
      </View>
    </View>
  );
}

function EntryButton({
  icon,
  title,
  subtitle,
  onPress,
  width,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
  onPress: () => void;
  width: number;
}) {
  const { theme } = useAppTheme();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.entryButton,
        {
          width,
          backgroundColor: theme.secondaryCardBackground,
          borderColor: theme.border,
          opacity: pressed ? 0.82 : 1,
        },
      ]}
    >
      <View style={[styles.entryIconWrap, { backgroundColor: theme.colorScheme === 'dark' ? 'rgba(10,132,255,0.18)' : 'rgba(10,132,255,0.10)' }]}>
        <Ionicons name={icon} size={18} color={theme.primaryBlue} />
      </View>
      <View style={styles.entryCopy}>
        <AppText style={[styles.entryTitle, { color: theme.textPrimary }]}>{title}</AppText>
        <AppText style={[styles.entrySubtitle, { color: theme.textSecondary }]}>{subtitle}</AppText>
      </View>
    </Pressable>
  );
}

export function WordsScreenTablet({
  showGuestState,
  hasAnyData,
  initialLoading,
  combinedError,
  focusBookTitle,
  todayNewCompleted,
  todayNewPlanned,
  masteryRate,
  dueNowCount,
  remainingReviewToComplete,
  mistakeCount,
  todayReviewCompleted,
  todayReviewPlanned,
  todayMistakeCompleted,
  todayMistakePlanned,
  totalTodayPlanned,
  totalTodayCompleted,
  nextReviewAt,
  insightItems,
  insightIsFallback,
  weakTags,
  strongTags,
  recentWords = [],
  onContinueLearning,
  onOpenTodayPlan,
  onOpenAnalysis,
  onOpenBooks,
  onOpenNotebook,
  onOpenPlanSettings,
  onOpenMistakes,
  onOpenMyTab,
}: WordsScreenTabletProps) {
  const { theme } = useAppTheme();
  const { width, height } = useWindowDimensions();
  const floatingInsets = useFloatingTabInsets();
  const contentWidth = Math.min(width - PAGE_PADDING * 2, PAGE_MAX_WIDTH - PAGE_PADDING * 2);
  const topPadding = Math.max(floatingInsets.top - 42, 52);
  const pageMinHeight = height;
  const thirdCardWidth = (contentWidth - GRID_GAP) / 2;
  const secondRowAvailableWidth = contentWidth - GRID_GAP * 2;
  const secondRowUnit = secondRowAvailableWidth / 3.25;
  const reviewCardWidth = secondRowUnit * 0.9;
  const chartWidth = Math.min(176, Math.max(148, reviewCardWidth - 30 - 90 - 8));
  const moreEntryCardWidth = Math.floor((thirdCardWidth - 15 * 2 - 10 * 2) / 3);
  const taskProgress = totalTodayPlanned > 0 ? clamp(Math.round((totalTodayCompleted / totalTodayPlanned) * 100), 0, 100) : 0;
  const insightList = insightItems.slice(0, 3);
  const suggestionCount = insightItems.length;
  const heroBackground = theme.colorScheme === 'dark'
    ? require('../../assets/images/home/daily_goal_dark.png')
    : require('../../assets/images/home/ipad_daily_goal_bg.png');
  const aiBrainImage = require('../../assets/images/words/danciai_brain_cutout.png');
  const weakDisplayTags = (weakTags.length ? weakTags : ['待生成']).slice(0, 3);
  const strongDisplayTags = (strongTags.length ? strongTags : ['待生成']).slice(0, 3);
  const recentDisplayWords = recentWords.slice(0, 3);
  const moreEntries = [
    {
      key: 'books',
      icon: 'library-outline' as const,
      title: '词书管理',
      subtitle: '切换与查看',
      onPress: onOpenBooks,
    },
    {
      key: 'notebook',
      icon: 'bookmark-outline' as const,
      title: '生词本',
      subtitle: '我的词库',
      onPress: onOpenNotebook,
    },
    {
      key: 'plan',
      icon: 'calendar-outline' as const,
      title: '学习计划',
      subtitle: '目标与安排',
      onPress: onOpenPlanSettings,
    },
    {
      key: 'mistakes',
      icon: 'warning-outline' as const,
      title: '错词分析',
      subtitle: '高频问题',
      onPress: onOpenMistakes,
    },
    {
      key: 'report',
      icon: 'document-text-outline' as const,
      title: 'AI 学习报告',
      subtitle: '阶段总结',
      onPress: () => router.push('/words/report'),
    },
    {
      key: 'analysis',
      icon: 'analytics-outline' as const,
      title: 'AI 学习分析',
      subtitle: '节奏解读',
      onPress: onOpenAnalysis,
    },
  ];

  if (showGuestState) {
    return (
      <SafeAreaView edges={['left', 'right']} style={[styles.safeArea, { backgroundColor: theme.pageBackground }]}>
        <ScrollView
          bounces
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scrollContent, { minHeight: pageMinHeight }]}
        >
          <View style={[styles.page, { paddingTop: topPadding, paddingHorizontal: PAGE_PADDING }]}>
            <View style={[styles.pageInner, { width: contentWidth }]}>
              <View style={styles.headerRow}>
                <View style={styles.headerCopy}>
                  <AppText style={[styles.headerTitle, { color: theme.textPrimary }]}>单词中心</AppText>
                  <AppText style={[styles.headerSubtitle, { color: theme.textSecondary }]}>AI 记忆，高效掌握</AppText>
                </View>
                <TopRightAvatarButton onPress={onOpenMyTab} />
              </View>

              <SectionCard style={styles.guestCard}>
                <AppText style={[styles.guestTitle, { color: theme.textPrimary }]}>
                  登录后查看 iPad 单词中心
                </AppText>
                <AppText style={[styles.guestSubtitle, { color: theme.textSecondary }]}>
                  登录后即可同步词书进度、今日计划和 AI 洞察。
                </AppText>
                <Pressable
                  onPress={() => router.push('/auth/sign-in')}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    { backgroundColor: theme.primaryBlue, opacity: pressed ? 0.84 : 1 },
                  ]}
                >
                  <AppText style={styles.primaryButtonText}>去登录</AppText>
                </Pressable>
              </SectionCard>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (initialLoading && !hasAnyData) {
    return (
      <SafeAreaView edges={['left', 'right']} style={[styles.safeArea, { backgroundColor: theme.pageBackground }]}>
        <View style={[styles.loadingWrap, { paddingTop: topPadding }]}>
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      </SafeAreaView>
    );
  }

  if (combinedError && !hasAnyData) {
    return (
      <SafeAreaView edges={['left', 'right']} style={[styles.safeArea, { backgroundColor: theme.pageBackground }]}>
        <ScrollView
          bounces
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scrollContent, { minHeight: pageMinHeight }]}
        >
          <View style={[styles.page, { paddingTop: topPadding, paddingHorizontal: PAGE_PADDING }]}>
            <View style={[styles.pageInner, { width: contentWidth }]}>
              <View style={styles.headerRow}>
                <View style={styles.headerCopy}>
                  <AppText style={[styles.headerTitle, { color: theme.textPrimary }]}>单词中心</AppText>
                  <AppText style={[styles.headerSubtitle, { color: theme.textSecondary }]}>AI 记忆，高效掌握</AppText>
                </View>
                <TopRightAvatarButton onPress={onOpenMyTab} />
              </View>

              <SectionCard style={styles.errorCard}>
                <AppText style={[styles.errorTitle, { color: theme.textPrimary }]}>首页数据暂时不可用</AppText>
                <AppText style={[styles.errorSubtitle, { color: theme.textSecondary }]}>
                  当前暂时无法加载单词数据，请稍后重试。
                </AppText>
                <AppText style={[styles.errorDetail, { color: theme.textSecondary }]}>{combinedError}</AppText>
              </SectionCard>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['left', 'right']} style={[styles.safeArea, { backgroundColor: theme.pageBackground }]}>
      <ScrollView
        bounces
        alwaysBounceVertical
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { minHeight: pageMinHeight }]}
      >
        <View style={[styles.page, { paddingTop: topPadding, paddingHorizontal: PAGE_PADDING }]}>
          <View style={[styles.pageInner, { width: contentWidth }]}>
            <View style={styles.headerRow}>
              <View style={styles.headerCopy}>
                <AppText style={[styles.headerTitle, { color: theme.textPrimary }]}>单词中心</AppText>
                <AppText style={[styles.headerSubtitle, { color: theme.textSecondary }]}>AI 记忆，高效掌握</AppText>
              </View>
              <TopRightAvatarButton onPress={onOpenMyTab} />
            </View>

            <View style={styles.dashboardContent}>
              <Pressable
                onPress={onContinueLearning}
                style={({ pressed }) => [
                  styles.heroCard,
                  {
                    backgroundColor: theme.colorScheme === 'dark' ? '#182235' : '#FFFFFF',
                    borderColor: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(10,132,255,0.20)',
                    shadowColor: theme.shadowColor,
                    opacity: pressed ? 0.96 : 1,
                  },
                ]}
              >
                <Image source={heroBackground} style={styles.heroImage} contentFit="cover" />
                <View
                  pointerEvents="none"
                  style={[
                    styles.heroOverlay,
                    {
                      backgroundColor: theme.colorScheme === 'dark' ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.06)',
                    },
                  ]}
                />
                <View style={styles.heroContent}>
                  <View style={styles.heroLeft}>
                    <AppText
                      numberOfLines={1}
                      style={[styles.heroEyebrow, { color: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.84)' : '#0F172A' }]}
                    >
                      当前词书
                    </AppText>
                    <AppText style={[styles.heroTitle, { color: theme.colorScheme === 'dark' ? '#FFFFFF' : '#0F172A' }]} numberOfLines={1}>
                      {focusBookTitle || '当前词书'}
                    </AppText>
                    <View style={styles.heroStatsSummaryRow}>
                      <View style={styles.heroMetricBlock}>
                        <AppText style={[styles.heroMetricLabel, { color: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.72)' : 'rgba(15,23,42,0.62)' }]}>
                          今日新词
                        </AppText>
                        <AppText
                          numberOfLines={1}
                          style={[styles.heroMetricValue, { color: theme.colorScheme === 'dark' ? '#FFFFFF' : '#0F172A' }]}
                        >
                          {formatShortProgress(todayNewCompleted, todayNewPlanned)}
                        </AppText>
                      </View>
                      <View
                        style={[
                          styles.heroMetricBlock,
                          styles.heroMetricDividerBlock,
                          {
                            borderLeftColor: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.12)',
                          },
                        ]}
                      >
                        <AppText style={[styles.heroMetricLabel, { color: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.72)' : 'rgba(15,23,42,0.62)' }]}>
                          掌握率
                        </AppText>
                        <AppText
                          numberOfLines={1}
                          style={[styles.heroMetricValue, { color: theme.colorScheme === 'dark' ? '#FFFFFF' : '#0F172A' }]}
                        >
                          {masteryRate}%
                        </AppText>
                      </View>
                      <HeroMasteryRing percent={masteryRate} />
                    </View>
                    <Pressable
                      onPress={onContinueLearning}
                      style={({ pressed }) => [
                        styles.primaryButton,
                        {
                          backgroundColor: theme.primaryBlue,
                          opacity: pressed ? 0.84 : 1,
                        },
                      ]}
                    >
                      <AppText style={styles.primaryButtonText}>继续学习</AppText>
                      <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
                    </Pressable>
                  </View>

                  <View style={styles.heroRight}>
                    <View style={styles.heroStatsRow}>
                      <HeroStatCard icon="time-outline" label="今日计划" value={totalTodayPlanned > 0 ? `${totalTodayPlanned}` : '--'} unit="词" />
                      <HeroStatCard icon="refresh-outline" label="记忆状态" value={remainingReviewToComplete > 0 ? `${remainingReviewToComplete}` : `${dueNowCount}`} unit="词" />
                      <HeroStatCard icon="sparkles-outline" label="AI 复习建议" value={mistakeCount > 0 ? `${mistakeCount}` : suggestionCount > 0 ? `${suggestionCount}` : '--'} unit={mistakeCount > 0 || suggestionCount > 0 ? '条' : undefined} />
                    </View>
                  </View>
                </View>
              </Pressable>

              <View style={styles.secondRow}>
                <SectionCard style={[styles.secondRowCard, styles.todayTaskCard]}>
                  <View style={[styles.cardHeader, styles.compactCardHeader]}>
                    <Ionicons name="checkmark-circle-outline" size={22} color={theme.primaryBlue} />
                    <AppText style={[styles.cardTitle, { color: theme.textPrimary }]}>今日任务</AppText>
                  </View>
                  <View style={styles.taskList}>
                    <TaskMetricRow label="学习新词" value={formatShortProgress(todayNewCompleted, todayNewPlanned)} />
                    <TaskMetricRow label="复习旧词" value={formatShortProgress(todayReviewCompleted, todayReviewPlanned)} />
                    <TaskMetricRow label="错词强化" value={formatShortProgress(todayMistakeCompleted, todayMistakePlanned)} isLast />
                  </View>
                  <View style={styles.progressWrap}>
                    <View style={styles.progressMetaRow}>
                      <AppText style={[styles.progressLabel, { color: theme.textSecondary }]}>任务进度</AppText>
                      <AppText style={[styles.progressLabel, { color: theme.textSecondary }]}>{taskProgress}%</AppText>
                    </View>
                    <View style={[styles.progressTrack, { backgroundColor: theme.fillSecondary }]}>
                      <View style={[styles.progressFill, { width: `${taskProgress}%`, backgroundColor: theme.primaryBlue }]} />
                    </View>
                  </View>
                </SectionCard>

                <SectionCard style={[styles.secondRowCard, styles.reviewCard]}>
                  <View style={[styles.cardHeader, styles.compactCardHeader]}>
                    <Ionicons name="git-compare-outline" size={22} color={theme.primaryBlue} />
                    <AppText style={[styles.cardTitle, { color: theme.textPrimary }]}>复习安排</AppText>
                  </View>
                  <View style={styles.reviewContent}>
                    <View style={styles.reviewInfo}>
                      <View style={styles.reviewMetricBlock}>
                        <AppText style={[styles.reviewMetricLabel, { color: theme.textSecondary }]}>今日复习</AppText>
                        <View style={styles.reviewValueRow}>
                          <AppText style={[styles.reviewMetricValue, { color: theme.textPrimary }]}>
                            {remainingReviewToComplete > 0 ? `${remainingReviewToComplete}` : `${dueNowCount}`}
                          </AppText>
                          <AppText style={[styles.reviewMetricUnit, { color: theme.textSecondary }]}>词</AppText>
                        </View>
                      </View>
                      <View style={[styles.reviewMetricBlock, styles.reviewMetricBlockSecondary]}>
                        <AppText style={[styles.reviewMetricLabel, { color: theme.textSecondary }]}>下次复习</AppText>
                        <AppText style={[styles.reviewSecondaryValue, { color: theme.textPrimary }]} numberOfLines={1} ellipsizeMode="tail">
                          {formatNextReview(nextReviewAt)}
                        </AppText>
                      </View>
                    </View>
                    <View style={styles.reviewCurveWrap}>
                      <ReviewScheduleCurve chartWidth={chartWidth} />
                    </View>
                  </View>
                </SectionCard>

                <SectionCard style={[styles.secondRowCard, styles.insightCard, styles.aiInsightCard]}>
                  <Image
                    source={aiBrainImage}
                    style={styles.aiBrainDecoration}
                    contentFit="contain"
                  />
                  <View style={styles.aiInsightContent}>
                    <View style={[styles.cardHeader, styles.aiInsightHeader]}>
                      <Ionicons name="sparkles-outline" size={22} color={theme.primaryBlue} />
                      <AppText style={[styles.cardTitle, { color: theme.textPrimary }]}>AI 洞察</AppText>
                    </View>
                    {insightList.length ? (
                      <View style={styles.insightList}>
                        {insightList.map((item, index) => (
                          <View key={`${item.title}-${index}`} style={styles.insightRow}>
                            <View style={[styles.insightDot, { backgroundColor: index === 0 ? '#34C759' : index === 1 ? '#8B5CF6' : theme.primaryBlue }]} />
                            <View style={styles.insightCopy}>
                              <AppText style={[styles.insightTitle, { color: theme.textPrimary }]} numberOfLines={2}>
                                {item.title}
                              </AppText>
                              {item.detail ? (
                                <AppText style={[styles.insightDetail, { color: theme.textSecondary }]} numberOfLines={2}>
                                  {item.detail}
                                </AppText>
                              ) : null}
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <View style={styles.emptyCardWrap}>
                        <AppText style={[styles.emptyCardText, { color: theme.textSecondary }]}>
                          暂无足够样本生成 AI 洞察，继续学习后会自动更新。
                        </AppText>
                      </View>
                    )}
                    {insightIsFallback ? (
                      <AppText style={[styles.fallbackCaption, { color: theme.textTertiary }]}>暂无足够样本生成完整建议</AppText>
                    ) : null}
                  </View>
                </SectionCard>
              </View>

              <View style={styles.row}>
                <SectionCard style={[styles.thirdRowCard, { width: thirdCardWidth }]}>
                  <View style={styles.cardHeader}>
                    <Ionicons name="analytics-outline" size={18} color={theme.primaryBlue} />
                    <AppText style={[styles.cardTitle, { color: theme.textPrimary }]}>AI 分析</AppText>
                  </View>
                  <View style={styles.analysisRow}>
                    <View style={[styles.analysisBucket, { backgroundColor: theme.secondaryCardBackground, borderColor: theme.border }]}>
                      <AppText style={[styles.analysisBucketLabel, { color: theme.textSecondary }]}>薄弱项</AppText>
                      <View style={styles.analysisTagWrap}>
                        {weakDisplayTags.map((item) => (
                          <View key={`weak-${item}`} style={[styles.analysisTag, { backgroundColor: theme.colorScheme === 'dark' ? 'rgba(255,69,58,0.16)' : 'rgba(255,59,48,0.08)' }]}>
                            <AppText style={[styles.analysisTagText, { color: theme.colorScheme === 'dark' ? '#FFB4AE' : '#C53A31' }]} numberOfLines={1}>
                              {item}
                            </AppText>
                          </View>
                        ))}
                      </View>
                    </View>
                    <View style={[styles.analysisBucket, { backgroundColor: theme.secondaryCardBackground, borderColor: theme.border }]}>
                      <AppText style={[styles.analysisBucketLabel, { color: theme.textSecondary }]}>掌握较好</AppText>
                      <View style={styles.analysisTagWrap}>
                        {strongDisplayTags.map((item) => (
                          <View key={`strong-${item}`} style={[styles.analysisTag, { backgroundColor: theme.colorScheme === 'dark' ? 'rgba(48,209,88,0.16)' : 'rgba(52,199,89,0.10)' }]}>
                            <AppText style={[styles.analysisTagText, { color: theme.colorScheme === 'dark' ? '#A8F0B6' : '#228A46' }]} numberOfLines={1}>
                              {item}
                            </AppText>
                          </View>
                        ))}
                      </View>
                    </View>
                  </View>
                  <Pressable
                    onPress={onOpenAnalysis}
                    style={({ pressed }) => [
                      styles.secondaryAction,
                      {
                        backgroundColor: theme.primaryBlue,
                        opacity: pressed ? 0.86 : 1,
                      },
                    ]}
                  >
                    <AppText style={styles.secondaryActionText}>去学习分析</AppText>
                  </Pressable>
                </SectionCard>

                <SectionCard style={[styles.thirdRowCard, { width: thirdCardWidth }]}>
                  <View style={styles.cardHeader}>
                    <Ionicons name="grid-outline" size={18} color={theme.primaryBlue} />
                    <AppText style={[styles.cardTitle, { color: theme.textPrimary }]}>更多入口</AppText>
                  </View>
                  <View style={styles.entryGrid}>
                    {moreEntries.map((item) => (
                      <EntryButton
                        key={item.key}
                        icon={item.icon}
                        title={item.title}
                        subtitle={item.subtitle}
                        onPress={item.onPress}
                        width={moreEntryCardWidth}
                      />
                    ))}
                  </View>
                </SectionCard>
              </View>

              <SectionCard style={styles.recentWordsCard}>
                <View style={styles.recentWordsHeader}>
                  <Ionicons name="book-outline" size={22} color={theme.primaryBlue} />
                  <AppText style={[styles.recentWordsTitle, { color: theme.textPrimary }]}>最近学习</AppText>
                </View>

                <View style={styles.recentWordsList}>
                  {recentDisplayWords.length > 0 ? (
                    recentDisplayWords.map((item, index) => (
                      <View
                        key={`${item.word}-${index}`}
                        style={[
                          styles.recentWordItem,
                          {
                            backgroundColor: theme.colorScheme === 'dark' ? theme.secondaryCardBackground : 'rgba(255,255,255,0.58)',
                            borderColor: theme.border,
                          },
                        ]}
                      >
                        <View style={styles.recentWordCopy}>
                          <AppText style={[styles.recentWordText, { color: theme.textPrimary }]} numberOfLines={1}>
                            {item.word}
                          </AppText>
                          <AppText style={[styles.recentWordMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                            {formatRecentWordMeta(item)}
                          </AppText>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} />
                      </View>
                    ))
                  ) : (
                    <View
                      style={[
                        styles.recentWordItem,
                        styles.recentWordEmptyItem,
                        {
                          backgroundColor: theme.colorScheme === 'dark' ? theme.secondaryCardBackground : 'rgba(255,255,255,0.58)',
                          borderColor: theme.border,
                        },
                      ]}
                    >
                      <AppText style={[styles.recentWordEmptyText, { color: theme.textSecondary }]}>
                        暂无最近学习单词，完成一次复习后会显示在这里。
                      </AppText>
                    </View>
                  )}
                </View>
              </SectionCard>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 8,
  },
  page: {
    flex: 1,
    alignItems: 'center',
  },
  pageInner: {
    flex: 1,
    maxWidth: PAGE_MAX_WIDTH,
  },
  dashboardContent: {
    flex: 1,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRow: {
    height: 46,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
    marginTop: 0,
  },
  headerCopy: {
    flex: 1,
    gap: 0,
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
  heroCard: {
    height: HERO_HEIGHT,
    borderRadius: 26,
    borderWidth: 1,
    overflow: 'hidden',
    paddingHorizontal: 28,
    paddingVertical: 18,
    justifyContent: 'center',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    marginBottom: 12,
  },
  heroImage: {
    ...StyleSheet.absoluteFillObject,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  heroContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: '100%',
  },
  heroLeft: {
    width: 470,
    justifyContent: 'center',
    minWidth: 0,
  },
  heroEyebrow: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  heroTitle: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  heroStatsSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 20,
    height: 48,
  },
  heroMetricBlock: {
    width: 86,
    height: 48,
    justifyContent: 'center',
  },
  heroMetricDividerBlock: {
    width: 78,
    height: 48,
    borderLeftWidth: StyleSheet.hairlineWidth,
    paddingLeft: 16,
  },
  heroMetricLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  heroMetricValue: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
    includeFontPadding: false,
  },
  masteryRingWrap: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  masteryRingCanvas: {
    width: 48,
    height: 48,
  },
  masteryRingCenter: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  masteryRingText: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '700',
  },
  primaryButton: {
    marginTop: 12,
    width: 184,
    height: 38,
    borderRadius: 19,
    paddingHorizontal: 18,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 14,
    lineHeight: 17,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  heroRight: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  heroStatsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    alignSelf: 'flex-end',
    alignItems: 'center',
  },
  heroStatCard: {
    width: 100,
    height: 108,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 11,
    gap: 8,
    justifyContent: 'space-between',
  },
  heroStatLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  heroStatValueRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
  },
  heroStatValue: {
    fontSize: 23,
    lineHeight: 27,
    fontWeight: '800',
  },
  heroStatUnit: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    gap: GRID_GAP,
  },
  secondRow: {
    flexDirection: 'row',
    gap: GRID_GAP,
    alignItems: 'stretch',
    marginBottom: 12,
  },
  secondRowCard: {
    height: SECOND_ROW_HEIGHT,
  },
  todayTaskCard: {
    flex: 1.05,
    padding: 15,
    overflow: 'hidden',
  },
  reviewCard: {
    flex: 0.88,
    padding: 15,
    overflow: 'hidden',
  },
  insightCard: {
    flex: 1.32,
    padding: 15,
  },
  sectionCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
    shadowOpacity: 0.05,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  compactCardHeader: {
    height: 23,
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
  },
  taskList: {
    flexShrink: 0,
  },
  taskMetricRow: {
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 0,
  },
  taskMetricLabel: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 16,
  },
  taskMetricValueWrap: {
    minWidth: 76,
    alignItems: 'flex-end',
  },
  taskMetricValue: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: '600',
    textAlign: 'right',
  },
  progressWrap: {
    marginTop: 7,
  },
  progressMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 15,
  },
  progressTrack: {
    marginTop: 5,
    height: 5,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  progressLabel: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '600',
  },
  reviewContent: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: 116,
  },
  reviewInfo: {
    width: 90,
    flexShrink: 0,
    justifyContent: 'flex-start',
  },
  reviewMetricBlock: {
    gap: 4,
  },
  reviewMetricBlockSecondary: {
    marginTop: 12,
  },
  reviewMetricLabel: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '500',
  },
  reviewValueRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
  },
  reviewMetricValue: {
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '800',
  },
  reviewMetricUnit: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  reviewSecondaryValue: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '600',
  },
  reviewCurveWrap: {
    flex: 1,
    minWidth: 0,
    height: 96,
    marginLeft: 8,
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'flex-end',
    overflow: 'hidden',
  },
  reviewCanvas: {
    height: 92,
  },
  aiInsightCard: {
    position: 'relative',
    overflow: 'hidden',
  },
  aiBrainDecoration: {
    position: 'absolute',
    right: -8,
    top: 10,
    width: 230,
    height: 150,
    opacity: 0.72,
    zIndex: 0,
  },
  aiInsightContent: {
    position: 'relative',
    zIndex: 2,
    width: '68%',
  },
  aiInsightHeader: {
    height: 24,
    marginBottom: 0,
  },
  insightList: {
    marginTop: 12,
    gap: 8,
  },
  insightRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 28,
  },
  insightDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginTop: 5,
    marginRight: 8,
    flexShrink: 0,
  },
  insightCopy: {
    flex: 1,
  },
  insightTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  insightDetail: {
    fontSize: 13,
    lineHeight: 18,
  },
  emptyCardWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  emptyCardText: {
    fontSize: 14,
    lineHeight: 20,
  },
  fallbackCaption: {
    marginTop: 8,
    fontSize: 11,
    lineHeight: 14,
  },
  thirdRowCard: {
    height: THIRD_ROW_HEIGHT,
    padding: 15,
  },
  analysisRow: {
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  analysisBucket: {
    flex: 1,
    height: 62,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
    overflow: 'hidden',
  },
  analysisBucketLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  analysisTagWrap: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 8,
    overflow: 'hidden',
  },
  analysisTag: {
    borderRadius: 999,
    paddingHorizontal: 10,
    height: 21,
    maxWidth: 86,
    alignItems: 'center',
    justifyContent: 'center',
  },
  analysisTagText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
  },
  secondaryAction: {
    height: 44,
    borderRadius: 17,
    marginTop: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: {
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  entryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 10,
    columnGap: 10,
    flex: 1,
  },
  entryButton: {
    height: 62,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  entryIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  entryCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  entryTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  entrySubtitle: {
    fontSize: 11,
    lineHeight: 14,
  },
  recentWordsCard: {
    height: 76,
    marginTop: 12,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  recentWordsHeader: {
    width: 128,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recentWordsTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
  },
  recentWordsList: {
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  recentWordItem: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  recentWordCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  recentWordText: {
    fontSize: 13.5,
    lineHeight: 17,
    fontWeight: '700',
  },
  recentWordMeta: {
    fontSize: 11,
    lineHeight: 14,
  },
  recentWordEmptyItem: {
    justifyContent: 'center',
  },
  recentWordEmptyText: {
    fontSize: 11,
    lineHeight: 14,
  },
  guestCard: {
    minHeight: 220,
    justifyContent: 'center',
    gap: 14,
  },
  guestTitle: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
  },
  guestSubtitle: {
    fontSize: 15,
    lineHeight: 22,
  },
  errorCard: {
    minHeight: 180,
    justifyContent: 'center',
    gap: 10,
  },
  errorTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
  },
  errorSubtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  errorDetail: {
    fontSize: 12,
    lineHeight: 18,
  },
});
