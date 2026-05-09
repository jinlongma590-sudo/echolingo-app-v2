import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Canvas, Circle, Path, Skia } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { TopRightAvatarButton } from '@/components/ui/TopRightAvatarButton';
import { SCENARIOS } from '@/data/scenarios';
import { useFloatingTabInsets } from '@/hooks/useFloatingTabInsets';
import type { SpeakingCredits } from '@/services/api/speakingPractice';
import type { SpeakingSession } from '@/services/api/speakingSessions';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type {
  SpeakingAbilityMetricsResult,
  SpeakingAdviceResult,
  SpeakingPerformanceLabel,
} from '@/utils/speakingDashboard';
import { normalizeSpeakingScore } from '@/utils/speakingDashboard';

const PAGE_PADDING = 20;
const PAGE_MAX_WIDTH = 1400;
const SECTION_GAP = 12;
const HERO_HEIGHT = 224;
const SECOND_ROW_HEIGHT = 82;
const THIRD_ROW_MIN_HEIGHT = 300;
type SpeakingScreenTabletProps = {
  credits: SpeakingCredits | null;
  history: SpeakingSession[];
  isLoading: boolean;
  error: string | null;
  latestScoredSession: SpeakingSession | null;
  recentScore: number | null;
  speakingPerformanceLabel: SpeakingPerformanceLabel;
  abilityMetrics: SpeakingAbilityMetricsResult;
  learningAdvice: SpeakingAdviceResult;
  weeklyPracticeCount: number;
  totalTrackedCount: number;
  onStartV1: () => void;
  onStartV2: () => void;
  onStartRoastCall: () => void;
  onOpenHistory: () => void;
  onOpenMyTab: () => void;
};

type AdviceData = {
  title: string;
  subtitle: string;
  isFallback: boolean;
};

function getScenarioMeta(scenarioId?: string | null) {
  if (!scenarioId) return null;
  return SCENARIOS.find((item) => item.id === scenarioId) ?? null;
}

function formatScore(value: number | null) {
  return value === null ? '--' : String(Math.round(value));
}

function formatDateLabel(iso?: string | null) {
  if (!iso) return '--';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function getStatusLabel(status: SpeakingSession['status']) {
  if (status === 'completed') return '已完成';
  if (status === 'active') return '进行中';
  return '未完成';
}

function clampScore(value: number | null) {
  if (value === null) return 0;
  return Math.max(0, Math.min(100, value));
}

function RadarChart({
  metrics,
  primaryBlue,
  gridColor,
  axisColor,
  fillColor,
  emptyStrokeColor,
}: {
  metrics: SpeakingAbilityMetricsResult['metrics'];
  primaryBlue: string;
  gridColor: string;
  axisColor: string;
  fillColor: string;
  emptyStrokeColor: string;
}) {
  const size = 210;
  const centerX = 105;
  const centerY = 116;
  const radius = 82;
  const angles = [-90, -18, 54, 126, 198].map((deg) => (deg * Math.PI) / 180);
  const hasRadarData = metrics.some((metric) => metric.value !== null);
  const polygonOpacity = hasRadarData ? 1 : 0.28;
  const normalizedValues = metrics.map((metric) =>
    hasRadarData ? clampScore(metric.value) / 100 : 0.55,
  );

  const levelPaths = useMemo(() => {
    return Array.from({ length: 5 }, (_, index) => {
      const level = (index + 1) / 5;
      const path = Skia.Path.Make();
      angles.forEach((angle, pointIndex) => {
        const x = centerX + Math.cos(angle) * radius * level;
        const y = centerY + Math.sin(angle) * radius * level;
        if (pointIndex === 0) {
          path.moveTo(x, y);
        } else {
          path.lineTo(x, y);
        }
      });
      path.close();
      return path;
    });
  }, [angles]);

  const axisPaths = useMemo(() => {
    return angles.map((angle) => {
      const path = Skia.Path.Make();
      path.moveTo(centerX, centerY);
      path.lineTo(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
      return path;
    });
  }, [angles]);

  const polygonPath = useMemo(() => {
    const path = Skia.Path.Make();
    normalizedValues.forEach((value, index) => {
      const x = centerX + Math.cos(angles[index]) * radius * value;
      const y = centerY + Math.sin(angles[index]) * radius * value;
      if (index === 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    });
    path.close();
    return path;
  }, [angles, normalizedValues]);

  const vertices = normalizedValues.map((value, index) => ({
    x: centerX + Math.cos(angles[index]) * radius * value,
    y: centerY + Math.sin(angles[index]) * radius * value,
  }));

  return (
    <Canvas style={{ width: size, height: size }}>
      {levelPaths.map((path, index) => (
        <Path
          key={`grid-${index}`}
          path={path}
          color={gridColor}
          style="stroke"
          strokeWidth={1}
        />
      ))}
      {axisPaths.map((path, index) => (
        <Path
          key={`axis-${index}`}
          path={path}
          color={axisColor}
          style="stroke"
          strokeWidth={1}
        />
      ))}
      <Path
        path={polygonPath}
        color={fillColor}
        style="fill"
        opacity={polygonOpacity}
      />
      <Path
        path={polygonPath}
        color={hasRadarData ? primaryBlue : emptyStrokeColor}
        style="stroke"
        strokeWidth={2.5}
      />
      {vertices.map((point, index) => (
        <Circle
          key={`point-${index}`}
          cx={point.x}
          cy={point.y}
          r={3}
          color={hasRadarData ? primaryBlue : emptyStrokeColor}
        />
      ))}
    </Canvas>
  );
}

function HeroStatCard({
  icon,
  iconTint,
  label,
  value,
  unit,
  helper,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconTint: string;
  label: string;
  value: string;
  unit?: string;
  helper?: string;
}) {
  const { theme } = useAppTheme();
  const isDark = theme.colorScheme === 'dark';

  return (
    <View
      style={[
        styles.heroStatCard,
        {
          backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.72)',
          borderColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.82)',
          shadowColor: theme.shadowColor,
          shadowOpacity: isDark ? 0.10 : 0.08,
        },
      ]}
    >
      <View style={[styles.heroStatIconBox, { backgroundColor: iconTint }]}>
        <Ionicons name={icon} size={26} color={theme.primaryBlue} />
      </View>
      <View style={styles.heroStatContent}>
        <AppText style={[styles.heroStatLabel, { color: theme.textSecondary }]} numberOfLines={1}>
          {label}
        </AppText>
        <View style={styles.heroStatValueRow}>
          <AppText style={[styles.heroStatValue, { color: theme.textPrimary }]} numberOfLines={1}>
            {value}
          </AppText>
          {unit ? (
            <AppText style={[styles.heroStatUnit, { color: theme.textSecondary }]}>{unit}</AppText>
          ) : null}
        </View>
        {helper ? (
          <AppText style={[styles.heroStatHelper, { color: theme.textSecondary }]} numberOfLines={2}>
            {helper}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

function EntryCard({
  icon,
  iconTint,
  title,
  subtitle,
  onPress,
  trailingVariant,
  trailingLabel,
  badgeLabel,
  iconColor,
  cardStyle,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconTint: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  trailingVariant: 'chevron' | 'pill';
  trailingLabel?: string;
  badgeLabel?: string;
  iconColor?: string;
  cardStyle?: StyleProp<ViewStyle>;
}) {
  const { theme } = useAppTheme();
  const isDark = theme.colorScheme === 'dark';

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.entryCard,
        {
          backgroundColor: theme.cardBackground,
          borderColor: theme.border,
          shadowColor: theme.shadowColor,
          shadowOpacity: isDark ? 0.02 : 0.04,
        },
        cardStyle,
        pressed && styles.cardPressed,
      ]}
    >
      <View
        style={[
          styles.entryIconBox,
          {
            backgroundColor: isDark ? 'rgba(255,255,255,0.07)' : iconTint,
            borderColor: isDark ? 'rgba(255,255,255,0.10)' : 'transparent',
          },
        ]}
      >
        <Ionicons name={icon} size={24} color={iconColor ?? theme.primaryBlue} />
      </View>
      <View style={styles.entryCopy}>
        <View style={styles.entryTitleRow}>
          <AppText style={[styles.entryTitle, { color: theme.textPrimary }]} numberOfLines={1}>
            {title}
          </AppText>
          {badgeLabel ? (
            <View style={styles.entryPrimaryBadge}>
              <AppText style={[styles.entryPrimaryBadgeText, { color: theme.primaryBlue }]}>{badgeLabel}</AppText>
            </View>
          ) : null}
        </View>
        <AppText style={[styles.entrySubtitle, { color: theme.textSecondary }]} numberOfLines={1}>
          {subtitle}
        </AppText>
      </View>
      {trailingVariant === 'chevron' ? (
        <View
          style={[
            styles.entryChevronBox,
            {
              backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.04)',
              borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'transparent',
            },
          ]}
        >
          <Ionicons name="chevron-forward" size={14} color={theme.textTertiary} />
        </View>
      ) : (
        <View
          style={[
            styles.entryMutedBadge,
            {
              backgroundColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.05)',
              borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'transparent',
            },
          ]}
        >
          <AppText style={[styles.entryMutedBadgeText, { color: theme.textSecondary }]}>{trailingLabel}</AppText>
        </View>
      )}
    </Pressable>
  );
}

function AdviceItem({
  item,
}: {
  item: AdviceData;
}) {
  const { theme } = useAppTheme();
  const isDark = theme.colorScheme === 'dark';

  return (
    <View
      style={[
        styles.adviceItem,
        {
          backgroundColor: theme.secondaryCardBackground,
          borderColor: theme.border,
        },
      ]}
    >
      <View
        style={[
          styles.infoIconBox,
          {
            backgroundColor: item.isFallback
              ? isDark
                ? 'rgba(10,132,255,0.18)'
                : 'rgba(10,132,255,0.10)'
              : isDark
                ? 'rgba(0,122,255,0.18)'
                : 'rgba(0,122,255,0.10)',
            borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'transparent',
          },
        ]}
      >
        <Ionicons
          name={item.isFallback ? 'sparkles-outline' : 'bulb-outline'}
          size={20}
          color={theme.primaryBlue}
        />
      </View>
      <View style={styles.infoItemCopy}>
        <AppText style={[styles.infoItemTitle, { color: theme.textPrimary }]} numberOfLines={2}>
          {item.title}
        </AppText>
        <AppText style={[styles.infoItemSubtitle, { color: theme.textSecondary }]} numberOfLines={1}>
          {item.subtitle}
        </AppText>
      </View>
    </View>
  );
}

function RecentPracticeItem({
  item,
}: {
  item: SpeakingSession;
}) {
  const { theme } = useAppTheme();
  const isDark = theme.colorScheme === 'dark';
  const scenario = getScenarioMeta(item.scenario_id);
  const normalized = normalizeSpeakingScore(item);
  const overall = normalized.overall;
  const trailing = overall === null ? getStatusLabel(item.status) : `${Math.round(overall)} 分`;
  const trailingTone =
    overall === null
      ? item.status === 'completed'
        ? {
            backgroundColor: isDark ? 'rgba(52,199,89,0.16)' : 'rgba(52,199,89,0.10)',
            borderColor: isDark ? 'rgba(52,199,89,0.22)' : 'rgba(52,199,89,0.14)',
            textColor: '#34C759',
          }
        : item.status === 'active'
          ? {
              backgroundColor: isDark ? 'rgba(10,132,255,0.18)' : 'rgba(10,132,255,0.10)',
              borderColor: isDark ? 'rgba(10,132,255,0.26)' : 'rgba(10,132,255,0.16)',
              textColor: theme.primaryBlue,
            }
          : {
              backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.05)',
              borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)',
              textColor: theme.textSecondary,
            }
      : null;

  return (
    <View
      style={[
        styles.recentItem,
        {
          backgroundColor: theme.secondaryCardBackground,
          borderColor: theme.border,
        },
      ]}
    >
      <View
        style={[
          styles.infoIconBox,
          {
            backgroundColor: isDark ? 'rgba(0,122,255,0.16)' : 'rgba(0,122,255,0.08)',
            borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'transparent',
          },
        ]}
      >
        <AppText style={styles.recentEmoji}>{scenario?.icon ?? '💬'}</AppText>
      </View>
      <View style={styles.infoItemCopy}>
        <AppText style={[styles.infoItemTitle, { color: theme.textPrimary }]} numberOfLines={1}>
          {scenario?.name ?? '口语练习'}
        </AppText>
        <AppText style={[styles.infoItemSubtitle, { color: theme.textSecondary }]} numberOfLines={1}>
          {`${formatDateLabel(item.started_at)} · ${overall === null ? '待评分' : `${Math.round(overall)} 分`}`}
        </AppText>
      </View>
      {trailingTone ? (
        <View
          style={[
            styles.recentStatusPill,
            {
              backgroundColor: trailingTone.backgroundColor,
              borderColor: trailingTone.borderColor,
            },
          ]}
        >
          <AppText style={[styles.recentStatusText, { color: trailingTone.textColor }]} numberOfLines={1}>
            {trailing}
          </AppText>
        </View>
      ) : (
        <AppText style={[styles.recentTrailing, { color: theme.textSecondary }]} numberOfLines={1}>
          {trailing}
        </AppText>
      )}
    </View>
  );
}

export function SpeakingScreenTablet({
  credits,
  history,
  isLoading,
  error,
  latestScoredSession,
  recentScore,
  speakingPerformanceLabel,
  abilityMetrics,
  learningAdvice,
  weeklyPracticeCount,
  totalTrackedCount,
  onStartV1,
  onStartV2,
  onStartRoastCall,
  onOpenHistory,
  onOpenMyTab,
}: SpeakingScreenTabletProps) {
  const { theme } = useAppTheme();
  const isDark = theme.colorScheme === 'dark';
  const floatingInsets = useFloatingTabInsets();
  const { width, height } = useWindowDimensions();
  const handleComingSoon = React.useCallback(() => {
    Alert.alert(
      '功能打磨中',
      '话题表达训练正在优化，开放后可用于观点表达、思维组织和自由讨论练习。',
      [{ text: '知道了' }],
    );
  }, []);

  const headerTopPadding = Math.max(floatingInsets.top - 42, 52);
  const contentWidth = Math.min(width - PAGE_PADDING * 2, PAGE_MAX_WIDTH);
  const recentItems = history.slice(0, 3);
  const radarMetrics = abilityMetrics.metrics;
  const adviceItems = learningAdvice.items;
  const heroProgress = recentScore === null ? 0 : clampScore(recentScore) / 100;

  const heroBackground = isDark
    ? require('../../assets/images/home/daily_goal_dark.png')
    : require('../../assets/images/home/ipad_daily_goal_bg.png');
  const syncMessage = error ? error : isLoading ? '正在同步口语数据' : null;
  const entryGridColumns = 2;
  const entryGridItemWidth = (contentWidth - SECTION_GAP * (entryGridColumns - 1)) / entryGridColumns;
  const entryGridRows = Math.ceil(4 / entryGridColumns);
  const entryGridHeight = entryGridRows * SECOND_ROW_HEIGHT + (entryGridRows - 1) * SECTION_GAP;
  const thirdRowHeight = Math.max(
    THIRD_ROW_MIN_HEIGHT,
    height - headerTopPadding - 46 - 10 - HERO_HEIGHT - SECTION_GAP - entryGridHeight - SECTION_GAP - 12,
  );
  const pageMinHeight = Math.max(
    height - headerTopPadding - 12,
    HERO_HEIGHT + entryGridHeight + thirdRowHeight + SECTION_GAP * 2,
  );
  const entryCardSize = { width: entryGridItemWidth } as const;

  return (
    <SafeAreaView edges={['left', 'right']} style={[styles.safeArea, { backgroundColor: theme.pageBackground }]}>
      <ScrollView
        style={styles.scroller}
        contentContainerStyle={[styles.scrollContent, { minHeight: height, paddingBottom: 12 }]}
        showsVerticalScrollIndicator={false}
        bounces
      >
        <View style={[styles.page, { paddingTop: headerTopPadding, paddingHorizontal: PAGE_PADDING }]}>
          <View style={[styles.pageInner, { width: contentWidth, minHeight: pageMinHeight }]}>
            <View style={styles.headerRow}>
              <View>
                <AppText style={[styles.headerTitle, { color: theme.textPrimary }]}>口语中心</AppText>
                <AppText style={[styles.headerSubtitle, { color: theme.textSecondary }]}>
                  自信表达，流利开口
                </AppText>
              </View>
              <TopRightAvatarButton onPress={onOpenMyTab} />
            </View>

            <View style={styles.contentStack}>
              <View
                style={[
                  styles.heroCard,
                  {
                    backgroundColor: isDark ? '#182235' : '#DBEAFE',
                    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(191,219,254,0.8)',
                    shadowColor: theme.shadowColor,
                    shadowOpacity: isDark ? 0.16 : 0.08,
                  },
                ]}
              >
                <Image source={heroBackground} style={StyleSheet.absoluteFillObject} contentFit="cover" />
                <View
                  style={[
                    styles.heroOverlay,
                    {
                      backgroundColor: isDark ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.10)',
                    },
                  ]}
                />
                <View style={styles.heroContent}>
                  <View style={styles.heroLeft}>
                    <AppText style={[styles.heroEyebrow, { color: theme.textSecondary }]}>
                      近期综合表现
                    </AppText>
                    <AppText style={[styles.heroLevelTitle, { color: isDark ? '#FFFFFF' : theme.primaryBlue }]} numberOfLines={1}>
                      {speakingPerformanceLabel.title}
                    </AppText>
                    <AppText style={[styles.heroLevelLabel, { color: theme.textSecondary }]}>
                      {speakingPerformanceLabel.subtitle}
                    </AppText>
                    <AppText style={[styles.heroLevelValue, { color: theme.primaryBlue }]}>
                      {speakingPerformanceLabel.scoreText === '--'
                        ? '--'
                        : `${speakingPerformanceLabel.scoreText} 分`}
                    </AppText>

                    <View
                      style={[
                        styles.heroProgressTrack,
                        {
                          backgroundColor:
                            isDark
                              ? 'rgba(255,255,255,0.14)'
                              : 'rgba(15,23,42,0.12)',
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.heroProgressFill,
                          {
                            width: `${heroProgress * 100}%`,
                            backgroundColor: theme.primaryBlue,
                          },
                        ]}
                      />
                    </View>

                    {syncMessage ? (
                      <AppText
                        style={[
                          styles.heroSyncText,
                          { color: error ? theme.destructive : theme.textSecondary },
                        ]}
                        numberOfLines={1}
                      >
                        {syncMessage}
                      </AppText>
                    ) : null}
                  </View>

                  <View style={styles.heroStatsRow}>
                    <HeroStatCard
                      icon="pulse-outline"
                      iconTint="rgba(139,92,246,0.16)"
                      label="本周练习"
                      value={String(weeklyPracticeCount)}
                      unit="次"
                    />
                    <HeroStatCard
                      icon="mic-outline"
                      iconTint="rgba(34,197,94,0.16)"
                      label="练习记录"
                      value={String(totalTrackedCount)}
                      unit="次"
                    />
                    <HeroStatCard
                      icon="speedometer-outline"
                      iconTint="rgba(59,130,246,0.16)"
                      label="最近评分"
                      value={formatScore(recentScore)}
                      unit={recentScore === null ? undefined : '分'}
                    />
                  </View>
                </View>
              </View>

              <View style={[styles.secondRow, { height: entryGridHeight }]}>
                <EntryCard
                  icon="chatbubble-ellipses-outline"
                  iconTint="rgba(139,92,246,0.14)"
                  title="逐句精练"
                  subtitle="一句一练，逐句评分与纠正"
                  onPress={onStartV1}
                  trailingVariant="chevron"
                  cardStyle={entryCardSize}
                />
                <EntryCard
                  icon="call-outline"
                  iconTint="rgba(34,211,238,0.16)"
                  title="实时语音通话"
                  subtitle="低延迟 AI 通话，训练自然交流"
                  onPress={onStartV2}
                  trailingVariant="chevron"
                  badgeLabel="OpenAI 驱动"
                  cardStyle={entryCardSize}
                />
                <EntryCard
                  icon="flame"
                  iconTint="rgba(255,184,107,0.16)"
                  iconColor="#FF9F43"
                  title="LA Bro Voice Coach"
                  subtitle="自由开口练英语，AI 边聊边帮你改。"
                  onPress={onStartRoastCall}
                  trailingVariant="chevron"
                  cardStyle={entryCardSize}
                />
                <EntryCard
                  icon="sparkles-outline"
                  iconTint="rgba(59,130,246,0.14)"
                  title="话题表达"
                  subtitle="自由观点表达，功能打磨中"
                  onPress={handleComingSoon}
                  trailingVariant="pill"
                  trailingLabel="打磨中"
                  cardStyle={entryCardSize}
                />
              </View>

              <View style={[styles.thirdRow, { minHeight: thirdRowHeight }]}>
                <View
                  style={[
                    styles.infoCard,
                    {
                      backgroundColor: theme.cardBackground,
                      borderColor: theme.border,
                      shadowColor: theme.shadowColor,
                      shadowOpacity: isDark ? 0.02 : 0.04,
                    },
                  ]}
                >
                  <AppText style={[styles.cardTitle, { color: theme.textPrimary }]}>口语能力雷达</AppText>
                  <AppText style={[styles.cardCaption, { color: theme.textSecondary }]}>
                    {abilityMetrics.subtitle}
                  </AppText>
                  <View style={styles.radarChartWrapper}>
                    <View style={styles.radarLabelTop}>
                      <AppText style={[styles.radarLabel, { color: theme.textSecondary }]}>流利度</AppText>
                      <AppText style={[styles.radarValue, { color: theme.textPrimary }]}>{formatScore(radarMetrics[0].value)}</AppText>
                    </View>
                    <View style={styles.radarLabelUpperRight}>
                      <AppText style={[styles.radarLabel, { color: theme.textSecondary }]}>发音</AppText>
                      <AppText style={[styles.radarValue, { color: theme.textPrimary }]}>{formatScore(radarMetrics[1].value)}</AppText>
                    </View>
                    <View style={styles.radarLabelLowerRight}>
                      <AppText style={[styles.radarLabel, { color: theme.textSecondary }]}>词汇</AppText>
                      <AppText style={[styles.radarValue, { color: theme.textPrimary }]}>{formatScore(radarMetrics[2].value)}</AppText>
                    </View>
                    <View style={styles.radarLabelLowerLeft}>
                      <AppText style={[styles.radarLabel, { color: theme.textSecondary }]}>语法</AppText>
                      <AppText style={[styles.radarValue, { color: theme.textPrimary }]}>{formatScore(radarMetrics[3].value)}</AppText>
                    </View>
                    <View style={styles.radarLabelUpperLeft}>
                      <AppText style={[styles.radarLabel, { color: theme.textSecondary }]}>逻辑</AppText>
                      <AppText style={[styles.radarValue, { color: theme.textPrimary }]}>{formatScore(radarMetrics[4].value)}</AppText>
                    </View>
                    <View style={styles.radarCanvasWrap}>
                      <RadarChart
                        metrics={radarMetrics}
                        primaryBlue={theme.primaryBlue}
                        gridColor={isDark ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.08)'}
                        axisColor={isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.06)'}
                        fillColor={isDark ? 'rgba(10,132,255,0.24)' : 'rgba(0,122,255,0.16)'}
                        emptyStrokeColor={isDark ? 'rgba(120,190,255,0.34)' : 'rgba(0,122,255,0.28)'}
                      />
                    </View>
                  </View>
                  {abilityMetrics.isEmpty ? (
                    <AppText style={[styles.cardFootnote, { color: theme.textTertiary }]}>
                      完成一次练习后，这里会显示最近一次可用评分对应的能力画像。
                    </AppText>
                  ) : null}
                </View>

                <View
                  style={[
                    styles.infoCard,
                    {
                      backgroundColor: theme.cardBackground,
                      borderColor: theme.border,
                      shadowColor: theme.shadowColor,
                      shadowOpacity: isDark ? 0.02 : 0.04,
                    },
                  ]}
                >
                  <AppText style={[styles.cardTitle, { color: theme.textPrimary }]}>学习建议</AppText>
                  <AppText style={[styles.cardCaption, { color: theme.textSecondary }]}>
                    {learningAdvice.isFallback ? '当前暂无可用建议' : '来自最近一次可用评分'}
                  </AppText>
                  <View style={styles.infoList}>
                    {adviceItems.slice(0, 3).map((item, index) => (
                      <AdviceItem key={`${item.title}-${index}`} item={item} />
                    ))}
                  </View>
                </View>

                <View
                  style={[
                    styles.infoCard,
                    {
                      backgroundColor: theme.cardBackground,
                      borderColor: theme.border,
                      shadowColor: theme.shadowColor,
                      shadowOpacity: isDark ? 0.02 : 0.04,
                    },
                  ]}
                >
                  <View style={styles.cardHeaderRow}>
                    <AppText style={[styles.cardTitle, { color: theme.textPrimary }]}>最近练习</AppText>
                    <Pressable
                      accessibilityRole="button"
                      onPress={onOpenHistory}
                      style={({ pressed }) => pressed && { opacity: 0.7 }}
                    >
                      <AppText style={[styles.cardLink, { color: theme.primaryBlue }]}>查看全部</AppText>
                    </Pressable>
                  </View>
                  {recentItems.length > 0 ? (
                    <View style={styles.infoList}>
                      {recentItems.map((item) => (
                        <RecentPracticeItem key={item.id} item={item} />
                      ))}
                    </View>
                  ) : (
                    <View
                      style={[
                        styles.emptyStateWrap,
                        {
                          backgroundColor: theme.secondaryCardBackground,
                          borderColor: theme.border,
                        },
                      ]}
                    >
                      <AppText style={[styles.emptyStateText, { color: theme.textSecondary }]}>
                        暂无练习记录，完成一次练习后会显示在这里。
                      </AppText>
                    </View>
                  )}
                </View>
              </View>
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
  scroller: {
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
  },
  page: {
    width: '100%',
    alignItems: 'center',
  },
  pageInner: {
    maxWidth: PAGE_MAX_WIDTH,
  },
  headerRow: {
    height: 46,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
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
  contentStack: {
    flex: 1,
    gap: SECTION_GAP,
  },
  heroCard: {
    height: HERO_HEIGHT,
    borderRadius: 26,
    paddingHorizontal: 28,
    paddingVertical: 26,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 28,
    elevation: 3,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  heroContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroLeft: {
    width: 420,
    justifyContent: 'center',
  },
  heroEyebrow: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
    marginBottom: 8,
  },
  heroLevelTitle: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  heroLevelLabel: {
    marginTop: 12,
    fontSize: 13,
    lineHeight: 18,
  },
  heroLevelValue: {
    marginTop: 2,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
  },
  heroProgressTrack: {
    width: 340,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(15,23,42,0.12)',
    marginTop: 12,
    overflow: 'hidden',
  },
  heroProgressFill: {
    height: '100%',
    borderRadius: 4,
  },
  heroButton: {
    width: 188,
    height: 42,
    borderRadius: 21,
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 20,
    elevation: 2,
  },
  heroButtonText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  heroSyncText: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 16,
  },
  heroStatsRow: {
    marginLeft: 'auto',
    marginRight: 8,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 18,
  },
  heroStatCard: {
    width: 116,
    height: 120,
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 14,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18,
  },
  heroStatIconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  heroStatContent: {
    flex: 1,
  },
  heroStatLabel: {
    fontSize: 13,
    lineHeight: 18,
  },
  heroStatValueRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    marginTop: 8,
  },
  heroStatValue: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  heroStatUnit: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 3,
  },
  heroStatHelper: {
    marginTop: 6,
    fontSize: 11,
    lineHeight: 15,
  },
  secondRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SECTION_GAP,
  },
  entryCard: {
    height: SECOND_ROW_HEIGHT,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    shadowOffset: { width: 0, height: 5 },
    shadowRadius: 10,
    elevation: 0,
  },
  entryIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    marginRight: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  entryCopy: {
    flex: 1,
    minWidth: 0,
  },
  entryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  entryTitle: {
    fontSize: 18,
    lineHeight: 20,
    fontWeight: '800',
    letterSpacing: -0.45,
    flexShrink: 1,
    minWidth: 0,
  },
  entrySubtitle: {
    marginTop: 1,
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '700',
  },
  entryPrimaryBadge: {
    height: 18,
    paddingHorizontal: 7,
    borderRadius: 9,
    backgroundColor: 'rgba(0,122,255,0.10)',
    borderColor: 'rgba(0,122,255,0.18)',
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  entryPrimaryBadgeText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '800',
  },
  entryChevronBox: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  entryMutedBadge: {
    height: 18,
    paddingHorizontal: 7,
    borderRadius: 9,
    borderWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
    flexShrink: 0,
  },
  entryMutedBadgeText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '800',
  },
  thirdRow: {
    flexDirection: 'row',
    gap: SECTION_GAP,
  },
  infoCard: {
    flex: 1,
    borderRadius: 24,
    padding: 20,
    overflow: 'hidden',
    borderWidth: 1,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 24,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '800',
    marginBottom: 6,
  },
  cardCaption: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 10,
  },
  cardFootnote: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  cardLink: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  radarChartWrapper: {
    height: 230,
    marginTop: 4,
    position: 'relative',
    alignItems: 'center',
  },
  radarCanvasWrap: {
    position: 'absolute',
    top: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  radarValue: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    marginTop: 2,
  },
  radarLabelTop: {
    position: 'absolute',
    top: 0,
    alignItems: 'center',
  },
  radarLabelUpperRight: {
    position: 'absolute',
    top: 34,
    right: 6,
    alignItems: 'center',
  },
  radarLabelLowerRight: {
    position: 'absolute',
    right: 8,
    bottom: 34,
    alignItems: 'center',
  },
  radarLabelLowerLeft: {
    position: 'absolute',
    left: 8,
    bottom: 34,
    alignItems: 'center',
  },
  radarLabelUpperLeft: {
    position: 'absolute',
    top: 34,
    left: 6,
    alignItems: 'center',
  },
  infoList: {
    gap: 10,
  },
  adviceItem: {
    height: 64,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 0,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  recentItem: {
    height: 64,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoIconBox: {
    width: 42,
    height: 42,
    borderRadius: 14,
    marginRight: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  infoItemCopy: {
    flex: 1,
    minWidth: 0,
  },
  infoItemTitle: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '800',
  },
  infoItemSubtitle: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 16,
  },
  recentEmoji: {
    fontSize: 18,
    lineHeight: 20,
  },
  recentTrailing: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    marginLeft: 10,
  },
  recentStatusPill: {
    marginLeft: 10,
    minWidth: 62,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentStatusText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  emptyStateWrap: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  emptyStateText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  cardPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.992 }],
  },
});
