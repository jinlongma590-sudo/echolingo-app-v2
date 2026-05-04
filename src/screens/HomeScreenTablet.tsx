import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import React, { useMemo } from 'react';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { TopRightAvatarButton } from '@/components/ui/TopRightAvatarButton';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { HomeDashboard } from '@/types/homeDashboard';

export type HomeScreenTabletFeatureItem = {
  title: string;
  subtitle: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tint: string;
  bg: string;
  route?: '/speaking' | '/library' | '/words';
  locked?: boolean;
};

export type HomeScreenTabletProps = {
  greeting: string;
  subtitle: string;
  dashboard: HomeDashboard;
  features: HomeScreenTabletFeatureItem[];
  onOpenGoalSheet: () => void;
  onFeaturePress: (item: HomeScreenTabletFeatureItem) => void;
  onOpenLearningRecords: () => void;
  onRotateRecommendations: () => void;
};

function DashboardStatTag({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  const { theme } = useAppTheme();

  return (
    <View style={styles.dashboardTagRow}>
      <View style={[styles.dashboardTagDot, { backgroundColor: color }]} />
      <AppText style={[styles.dashboardTagLabel, { color: theme.textSecondary }]}>
        {label}
      </AppText>
      <AppText style={[styles.dashboardTagValue, { color: theme.textPrimary }]}>
        {value}
      </AppText>
    </View>
  );
}

function TabletSparkline({
  color,
  series,
}: {
  color: string;
  series: number[];
}) {
  const curve = useMemo(() => {
    const safeSeries = series.length > 0 ? series : [0, 0, 0, 0, 0, 0, 0];
    const maxValue = Math.max(...safeSeries, 1);
    const step = safeSeries.length > 1 ? 154 / (safeSeries.length - 1) : 0;
    const points = safeSeries.map((value, index) => ({
      x: index * step,
      y: 28 - (value / maxValue) * 17,
    }));
    const path = Skia.Path.Make();
    path.moveTo(points[0]!.x, points[0]!.y);

    for (let index = 0; index < points.length - 1; index += 1) {
      const previous = points[index - 1] ?? points[index]!;
      const current = points[index]!;
      const next = points[index + 1]!;
      const afterNext = points[index + 2] ?? next;

      const controlPoint1X = current.x + (next.x - previous.x) / 6;
      const controlPoint1Y = current.y + (next.y - previous.y) / 6;
      const controlPoint2X = next.x - (afterNext.x - current.x) / 6;
      const controlPoint2Y = next.y - (afterNext.y - current.y) / 6;

      path.cubicTo(controlPoint1X, controlPoint1Y, controlPoint2X, controlPoint2Y, next.x, next.y);
    }

    return path;
  }, [series]);

  const baseline = useMemo(() => {
    const path = Skia.Path.Make();
    path.moveTo(0, 28);
    path.cubicTo(42, 28, 84, 28, 124, 28);
    path.cubicTo(138, 28, 146, 28, 154, 28);
    return path;
  }, []);

  return (
    <Canvas style={styles.sparklineCanvas}>
      <Path path={baseline} color={color} style="stroke" strokeWidth={2} opacity={0.10} />
      <Path path={curve} color={color} style="stroke" strokeWidth={2.5} strokeCap="round" strokeJoin="round" />
    </Canvas>
  );
}

function TabletGoalHero({
  completedValue,
  progress,
  goalSubtitle,
  goalProgressText,
  onPress,
}: {
  completedValue: number;
  progress: number;
  goalSubtitle: string;
  goalProgressText: string;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  const isDark = theme.colorScheme === 'dark';
  const goalBackground = isDark
    ? require('../../assets/images/home/daily_goal_dark.png')
    : require('../../assets/images/home/ipad_daily_goal_bg.png');

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.heroCard,
        {
          backgroundColor: isDark ? '#182235' : '#FFFFFF',
          borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(10,132,255,0.20)',
          shadowColor: theme.shadowColor,
          shadowOpacity: isDark ? 0.14 : 0.08,
        },
        pressed && styles.pressed,
      ]}
    >
      <Image source={goalBackground} style={styles.heroImage} contentFit="cover" />
      <View
        pointerEvents="none"
        style={[
          styles.heroOverlay,
          {
            backgroundColor: isDark ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.06)',
          },
        ]}
      />

      {isDark ? (
        <View
          pointerEvents="none"
          style={[
            styles.heroGlow,
            {
              backgroundColor: 'rgba(10,132,255,0.18)',
            },
          ]}
        />
      ) : null}

      <View style={styles.heroInner}>
        <View style={styles.heroMain}>
          <View
            style={[
              styles.heroBadge,
              {
                backgroundColor: isDark ? 'rgba(10,132,255,0.16)' : 'rgba(10,132,255,0.08)',
                borderColor: isDark ? 'rgba(10,132,255,0.24)' : 'rgba(10,132,255,0.12)',
              },
            ]}
          >
            <Ionicons name="sparkles" size={24} color={theme.primaryBlue} />
          </View>

          <AppText
            style={[
              styles.heroHeading,
              { color: isDark ? '#FFFFFF' : '#0F172A' },
            ]}
          >
            每日目标
          </AppText>
          <AppText
            style={[
              styles.heroSubheading,
              { color: isDark ? theme.textSecondary : '#6B7280' },
            ]}
          >
            {goalSubtitle}
          </AppText>

          <View style={styles.heroProgressBlock}>
            <AppText
              style={[
                styles.heroProgressNumber,
                { color: isDark ? theme.primaryBlue : '#156FF7' },
              ]}
            >
              {completedValue}
            </AppText>
            <AppText
              style={[
                styles.heroProgressTotal,
                { color: isDark ? theme.textSecondary : '#6B7280' },
              ]}
            >
              {goalProgressText}
            </AppText>
          </View>

          <View
            style={[
              styles.heroTrack,
              {
                backgroundColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.10)',
              },
            ]}
          >
            <View
              style={[
                styles.heroFill,
                {
                  width: `${Math.round(Math.min(progress, 1) * 100)}%`,
                  backgroundColor: theme.primaryBlue,
                },
              ]}
            />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function FeatureCard({
  item,
  onPress,
  compact,
}: {
  item: HomeScreenTabletFeatureItem;
  onPress: () => void;
  compact: boolean;
}) {
  const { theme } = useAppTheme();
  const isDark = theme.colorScheme === 'dark';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.featureCard,
        compact && styles.featureCardCompact,
        {
          backgroundColor: isDark ? theme.cardBackground : 'rgba(255,255,255,0.92)',
          borderColor: theme.border,
          shadowColor: theme.shadowColor,
          shadowOpacity: isDark ? 0.10 : 0.05,
        },
        pressed && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.featureIconWrap,
          {
            backgroundColor: isDark ? `${item.tint}18` : item.bg,
          },
        ]}
      >
        <Ionicons name={item.icon} size={24} color={item.tint} />
      </View>

      <View style={styles.featureCopy}>
        <View style={styles.featureTitleRow}>
          <AppText style={[styles.featureTitle, compact && styles.featureTitleCompact]}>
            {item.title}
          </AppText>
          {item.locked ? (
            <View
              style={[
                styles.featureSoonPill,
                {
                  backgroundColor: isDark ? `${item.tint}18` : '#FFF4DB',
                },
              ]}
            >
              <AppText style={[styles.featureSoonText, { color: item.tint }]}>即将开放</AppText>
            </View>
          ) : null}
        </View>
        <AppText
          numberOfLines={1}
          style={[
            styles.featureSubtitle,
            compact && styles.featureSubtitleCompact,
            { color: theme.textSecondary },
          ]}
        >
          {item.subtitle}
        </AppText>
      </View>

      <View
        style={[
          styles.featureArrow,
          {
            backgroundColor: isDark ? theme.secondaryCardBackground : '#F4F6FA',
          },
        ]}
      >
        <Ionicons name="chevron-forward" size={14} color={theme.textTertiary} />
      </View>
    </Pressable>
  );
}

function DashboardCard({
  title,
  action,
  children,
  style,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  style?: object;
}) {
  const { theme } = useAppTheme();

  return (
    <View
      style={[
        styles.dashboardCard,
        {
          backgroundColor: theme.cardBackground,
          borderColor: theme.border,
          shadowColor: theme.shadowColor,
          shadowOpacity: theme.colorScheme === 'dark' ? 0.10 : 0.05,
        },
        style,
      ]}
    >
      <View style={styles.dashboardHeader}>
        <AppText style={styles.dashboardTitle}>{title}</AppText>
        {action}
      </View>
      {children}
    </View>
  );
}

function RecommendationThumbnail({
  cover,
  size = 'small',
}: {
  cover?: string | null;
  size?: 'small' | 'wide';
}) {
  const { theme } = useAppTheme();
  const thumbStyle = size === 'wide' ? styles.recommendWideThumb : styles.recommendThumb;

  if (cover) {
    return <Image source={cover} style={thumbStyle} contentFit="cover" />;
  }

  return (
    <View
      style={[
        thumbStyle,
        {
          backgroundColor: theme.secondaryCardBackground,
          alignItems: 'center',
          justifyContent: 'center',
        },
      ]}
    >
      <Ionicons name="headset" size={size === 'wide' ? 24 : 18} color={theme.textSecondary} />
    </View>
  );
}

export function HomeScreenTablet({
  greeting,
  subtitle,
  dashboard,
  features,
  onOpenGoalSheet,
  onFeaturePress,
  onOpenLearningRecords,
  onRotateRecommendations,
}: HomeScreenTabletProps) {
  const { theme } = useAppTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isWide = width >= 1100;
  const isMedium = width >= 850 && width < 1100;
  const horizontalPadding = 16;
  const cardGap = 10;
  const topHeaderOffset = insets.top + 4;
  const topHeaderHeight = 60;
  const welcomeHeight = 58;
  const dashboardHeight = 230;
  const welcomeSubtitle = subtitle || '多听一句，多懂一点';
  const contentWidth = Math.min(width - horizontalPadding * 2, 1440 - horizontalPadding * 2);
  const dashboardAvailableWidth = contentWidth - cardGap * 3;
  const progressWidth = Math.floor(dashboardAvailableWidth * 0.27);
  const miniWidth = Math.floor(dashboardAvailableWidth * 0.16);
  const recentWidth = Math.floor(dashboardAvailableWidth * 0.32);
  const recommendWidth =
    dashboardAvailableWidth - progressWidth - miniWidth - recentWidth;

  const primaryRecommendation = dashboard.recommendations[0] ?? null;
  const recentItems = dashboard.recentLearning;
  const weeklySeriesValues = dashboard.weekly.series.map((item) => item.total);
  const dashboardMode = useMemo<'wide' | 'medium' | 'stack'>(
    () => (isWide ? 'wide' : isMedium ? 'medium' : 'stack'),
    [isMedium, isWide],
  );
  const openHref = (href: string) => {
    router.push(href as never);
  };
  const hasTargetMinutes = dashboard.goal.targetMinutes > 0;
  const heroSubtitle = hasTargetMinutes
    ? `完成 ${dashboard.goal.targetMinutes} 分钟学习`
    : '今日目标待设置';
  const heroProgressText = hasTargetMinutes
    ? `/ ${dashboard.goal.targetMinutes} 分钟`
    : '/ 未设置';
  const progressFooterText = hasTargetMinutes
    ? `目标 ${dashboard.goal.targetMinutes} 分钟`
    : '今日目标待设置';

  return (
    <SafeAreaView
      edges={['left', 'right']}
      style={[styles.safeArea, { backgroundColor: theme.pageBackground }]}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          {
            minHeight: height,
            paddingBottom: 0,
          },
        ]}
      >
        <View
          style={[
            styles.container,
            {
              minHeight: height - insets.bottom,
              paddingHorizontal: horizontalPadding,
            },
          ]}
        >
          <View
            style={[
              styles.topHeaderRow,
              {
                marginTop: topHeaderOffset,
                height: topHeaderHeight,
              },
            ]}
          >
            <View style={styles.welcomeCopy}>
              <AppText style={[styles.greeting, { color: theme.textPrimary }]}>
                {greeting}
              </AppText>
              <AppText style={[styles.headerSubtitle, { color: theme.textSecondary }]}>
                {welcomeSubtitle}
              </AppText>
            </View>

            <View style={styles.avatarWrap}>
              <TopRightAvatarButton consumer="home_tablet" onPress={() => router.navigate('/my')} />
            </View>
          </View>

          <View style={{ marginBottom: 12 }}>
            <TabletGoalHero
              completedValue={dashboard.goal.completedUnits}
              progress={dashboard.goal.progressRatio}
              goalSubtitle={heroSubtitle}
              goalProgressText={heroProgressText}
              onPress={onOpenGoalSheet}
            />
          </View>

          <View style={[styles.featureGrid, { gap: cardGap, marginBottom: 12 }]}>
            {features.map((item) => (
              <FeatureCard
                key={item.title}
                item={item}
                onPress={() => onFeaturePress(item)}
                compact={width < 1000}
              />
            ))}
          </View>

          {dashboardMode === 'wide' ? (
            <View style={[styles.dashboardFillRegion, { minHeight: dashboardHeight }]}>
              <View style={[styles.dashboardWideRow, { gap: cardGap }]}>
                <DashboardCard title="今日进度" style={[styles.progressCardWide, { width: progressWidth }]}>
                  <View style={styles.progressCardBody}>
                    <View
                      style={[
                        styles.progressRing,
                        {
                          borderColor:
                            theme.colorScheme === 'dark'
                              ? 'rgba(10,132,255,0.46)'
                              : 'rgba(10,132,255,0.20)',
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.progressRingInner,
                          {
                            backgroundColor: theme.colorScheme === 'dark' ? '#111318' : '#FFFFFF',
                          },
                        ]}
                      >
                        <AppText style={[styles.progressRingValue, { color: theme.textPrimary }]}>
                          {dashboard.todayProgress.totalUnits}
                        </AppText>
                        <AppText style={[styles.progressRingLabel, { color: theme.textSecondary }]}>
                          学习项
                        </AppText>
                      </View>
                    </View>

                    <View style={styles.progressMeta}>
                      <DashboardStatTag color="#8B5CF6" label="精听" value={`${dashboard.todayProgress.listeningCount} 集`} />
                      <DashboardStatTag
                        color="#0A84FF"
                        label="口语"
                        value={
                          dashboard.todayProgress.speakingAvailable
                            ? `${dashboard.todayProgress.speakingCount ?? 0} 次`
                            : '暂无记录'
                        }
                      />
                      <DashboardStatTag color="#22C55E" label="单词" value={`${dashboard.todayProgress.vocabularyCount} 词`} />
                    </View>
                  </View>

                  <View
                    style={[
                      styles.progressFooter,
                      {
                        borderTopColor: theme.border,
                        borderTopWidth: StyleSheet.hairlineWidth,
                      },
                    ]}
                  >
                    <AppText style={[styles.progressFooterText, { color: theme.textSecondary }]}>
                      {progressFooterText}
                    </AppText>
                    <Pressable
                      onPress={onOpenLearningRecords}
                      style={[
                        styles.detailButton,
                        {
                          backgroundColor: theme.secondaryCardBackground,
                        },
                      ]}
                    >
                      <AppText style={[styles.detailButtonText, { color: theme.textPrimary }]}>
                        查看详情
                      </AppText>
                    </Pressable>
                  </View>
                </DashboardCard>

                <View style={[styles.miniColumn, { width: miniWidth, gap: cardGap }]}>
                  <DashboardCard title="本周学习活跃" style={styles.miniCard}>
                    <View>
                      <AppText style={[styles.weekMetricValue, { color: theme.textPrimary }]}>
                        {dashboard.weekly.activeDays} 天
                      </AppText>
                      <AppText style={[styles.weekMetricNote, { color: theme.textSecondary }]}>
                        {dashboard.weekly.label}
                      </AppText>
                    </View>
                    <View style={styles.sparklineWrap}>
                      <TabletSparkline color={theme.primaryBlue} series={weeklySeriesValues} />
                    </View>
                  </DashboardCard>

                  <DashboardCard title="连续打卡" style={styles.miniCard}>
                    <View style={styles.streakRow}>
                      <View style={styles.streakCopy}>
                        <AppText style={[styles.streakValue, { color: theme.textPrimary }]}>
                          {dashboard.streak.days} 天
                        </AppText>
                        <AppText style={[styles.weekMetricNote, { color: theme.textSecondary }]}>
                          {dashboard.streak.days > 0 ? '保持当前节奏' : '开始一次学习就会累计'}
                        </AppText>
                      </View>
                      <Ionicons name="flame" size={30} color="#FF9F0A" style={styles.streakFlame} />
                    </View>
                  </DashboardCard>
                </View>

                <DashboardCard
                  title="最近学习"
                  action={(
                    <Pressable onPress={onOpenLearningRecords}>
                      <AppText style={[styles.linkText, { color: theme.primaryBlue }]}>查看全部</AppText>
                    </Pressable>
                  )}
                  style={[styles.recentCardWide, { width: recentWidth }]}
                >
                  <View style={styles.recentList}>
                    {recentItems.length > 0 ? (
                      recentItems.map((item, index) => (
                        <Pressable
                          key={item.id}
                          onPress={() => openHref(item.href)}
                          style={[
                            styles.recentRow,
                            index < recentItems.length - 1 && {
                              borderBottomColor: theme.border,
                              borderBottomWidth: StyleSheet.hairlineWidth,
                            },
                          ]}
                        >
                          <RecommendationThumbnail cover={item.imageUrl ?? null} />
                          <View style={styles.recentText}>
                            <AppText numberOfLines={1} style={[styles.recentTitle, { color: theme.textPrimary }]}>
                              {item.title}
                            </AppText>
                            <AppText style={[styles.recentMeta, { color: theme.textSecondary }]}>
                              {item.subtitle}
                            </AppText>
                          </View>
                          <View
                            style={[
                              styles.statusPill,
                              {
                                backgroundColor:
                                  item.statusLabel === '学习中'
                                    ? theme.colorScheme === 'dark'
                                      ? 'rgba(10,132,255,0.18)'
                                      : 'rgba(10,132,255,0.10)'
                                    : theme.secondaryCardBackground,
                              },
                            ]}
                          >
                            <AppText
                              style={[
                                styles.statusPillText,
                                { color: item.statusLabel === '学习中' ? theme.primaryBlue : theme.textSecondary },
                              ]}
                            >
                              {item.statusLabel}
                            </AppText>
                          </View>
                        </Pressable>
                      ))
                    ) : (
                      <AppText style={[styles.emptyText, { color: theme.textSecondary }]}>
                        {dashboard.loading ? '正在读取最近学习记录…' : '暂时还没有最近学习记录，完成一次学习后会显示在这里。'}
                      </AppText>
                    )}
                  </View>
                </DashboardCard>

                <DashboardCard
                  title="为你推荐"
                  action={(
                    <Pressable
                      disabled={dashboard.recommendationPoolSize <= 1}
                      onPress={onRotateRecommendations}
                    >
                      <AppText
                        style={[
                          styles.linkText,
                          {
                            color:
                              dashboard.recommendationPoolSize > 1
                                ? theme.primaryBlue
                                : theme.textTertiary,
                          },
                        ]}
                      >
                        换一换
                      </AppText>
                    </Pressable>
                  )}
                  style={[styles.recommendCardWide, { width: recommendWidth }]}
                >
                  <Pressable
                    style={styles.recommendCardBody}
                    onPress={() => {
                      if (primaryRecommendation) {
                        openHref(primaryRecommendation.href);
                        return;
                      }
                      router.push('/library');
                    }}
                  >
                    <View style={styles.recommendHeroMedia}>
                      <RecommendationThumbnail cover={primaryRecommendation?.imageUrl ?? null} size="wide" />
                      <View style={styles.playButton}>
                        <Ionicons name="play" size={14} color="#FFFFFF" />
                      </View>
                    </View>
                    <AppText
                      numberOfLines={2}
                      style={[styles.recommendTitleLarge, { color: theme.textPrimary }]}
                    >
                      {primaryRecommendation?.title ?? (dashboard.loading ? '正在载入推荐内容' : '今日暂无推荐内容')}
                    </AppText>
                    {primaryRecommendation ? (
                      <>
                        <AppText style={[styles.recommendMeta, { color: theme.textSecondary }]}>
                          {primaryRecommendation.subtitle}
                        </AppText>
                        <View style={styles.recommendTagRow}>
                          {(primaryRecommendation.tags.length > 0
                            ? primaryRecommendation.tags
                            : [primaryRecommendation.difficulty].filter(Boolean)
                          ).slice(0, 3).map((tag) => (
                            <View
                              key={`${primaryRecommendation.id}-${tag}`}
                              style={[
                                styles.recommendTag,
                                { backgroundColor: theme.secondaryCardBackground },
                              ]}
                            >
                              <AppText style={[styles.recommendTagText, { color: theme.textSecondary }]}>
                                {tag}
                              </AppText>
                            </View>
                          ))}
                        </View>
                      </>
                    ) : null}
                  </Pressable>
                </DashboardCard>
              </View>
            </View>
          ) : dashboardMode === 'medium' ? (
            <View style={[styles.dashboardTwoCol, { gap: 10 }]}>
              <DashboardCard title="今日进度" style={styles.twoColCard}>
                <AppText style={[styles.bigValue, { color: theme.primaryBlue }]}>
                  {dashboard.todayProgress.totalUnits}
                  <AppText style={[styles.bigValueSuffix, { color: theme.textSecondary }]}> 项</AppText>
                </AppText>
                <AppText style={[styles.cardNote, { color: theme.textSecondary }]}>
                  {dashboard.goal.helperText}
                </AppText>
                <View style={styles.tagList}>
                  <DashboardStatTag color="#8B5CF6" label="精听" value={`${dashboard.todayProgress.listeningCount} 集`} />
                  <DashboardStatTag color="#22C55E" label="单词" value={`${dashboard.todayProgress.vocabularyCount} 词`} />
                </View>
              </DashboardCard>

              <DashboardCard title="本周学习活跃" style={styles.twoColCard}>
                <AppText style={[styles.bigValue, { color: theme.textPrimary }]}>{dashboard.weekly.activeDays} 天</AppText>
                <AppText style={[styles.cardNote, { color: theme.textSecondary }]}>
                  {dashboard.weekly.label}
                </AppText>
              </DashboardCard>

              <DashboardCard
                title="最近学习"
                action={(
                  <Pressable onPress={onOpenLearningRecords}>
                    <AppText style={[styles.linkText, { color: theme.primaryBlue }]}>查看全部</AppText>
                  </Pressable>
                )}
                style={styles.twoColCard}
              >
                <View style={styles.recentListCompact}>
                  {recentItems.length > 0 ? (
                    recentItems.slice(0, 2).map((item) => (
                      <Pressable
                        key={item.id}
                        onPress={() => openHref(item.href)}
                        style={styles.recentCompactRow}
                      >
                        <RecommendationThumbnail cover={item.imageUrl ?? null} />
                        <AppText numberOfLines={1} style={[styles.recentCompactTitle, { color: theme.textPrimary }]}>
                          {item.title}
                        </AppText>
                      </Pressable>
                    ))
                  ) : (
                    <AppText style={[styles.emptyText, { color: theme.textSecondary }]}>
                      {dashboard.loading ? '正在读取最近学习记录…' : '暂时还没有最近学习记录。'}
                    </AppText>
                  )}
                </View>
              </DashboardCard>

              <DashboardCard
                title="为你推荐"
                action={(
                  <Pressable
                    disabled={dashboard.recommendationPoolSize <= 1}
                    onPress={onRotateRecommendations}
                  >
                    <AppText
                      style={[
                        styles.linkText,
                        {
                          color:
                            dashboard.recommendationPoolSize > 1
                              ? theme.primaryBlue
                              : theme.textTertiary,
                        },
                      ]}
                    >
                      换一换
                    </AppText>
                  </Pressable>
                )}
                style={styles.twoColCard}
              >
                <Pressable
                  onPress={() =>
                    primaryRecommendation ? openHref(primaryRecommendation.href) : router.push('/library')
                  }
                >
                  <RecommendationThumbnail cover={primaryRecommendation?.imageUrl ?? null} size="wide" />
                  <AppText style={[styles.recommendTitleLarge, { color: theme.textPrimary }]}>
                    {primaryRecommendation?.title ?? (dashboard.loading ? '正在载入推荐内容' : '今日暂无推荐内容')}
                  </AppText>
                  {primaryRecommendation ? (
                    <AppText style={[styles.recommendMeta, { color: theme.textSecondary }]}>
                      {primaryRecommendation.subtitle}
                    </AppText>
                  ) : null}
                </Pressable>
              </DashboardCard>
            </View>
          ) : (
            <View style={[styles.dashboardStack, { gap: 10 }]}>
              <DashboardCard title="今日进度">
                <AppText style={[styles.bigValue, { color: theme.primaryBlue }]}>
                  {dashboard.todayProgress.totalUnits}
                  <AppText style={[styles.bigValueSuffix, { color: theme.textSecondary }]}> 项</AppText>
                </AppText>
                <AppText style={[styles.cardNote, { color: theme.textSecondary }]}>
                  {dashboard.goal.helperText}
                </AppText>
              </DashboardCard>

              <DashboardCard title="本周学习活跃">
                <AppText style={[styles.bigValue, { color: theme.textPrimary }]}>{dashboard.weekly.activeDays} 天</AppText>
                <AppText style={[styles.cardNote, { color: theme.textSecondary }]}>
                  {dashboard.weekly.label}
                </AppText>
              </DashboardCard>

              <DashboardCard
                title="最近学习"
                action={(
                  <Pressable onPress={onOpenLearningRecords}>
                    <AppText style={[styles.linkText, { color: theme.primaryBlue }]}>查看全部</AppText>
                  </Pressable>
                )}
              >
                <View style={styles.recentListCompact}>
                  {recentItems.length > 0 ? (
                    recentItems.map((item) => (
                      <Pressable
                        key={item.id}
                        onPress={() => openHref(item.href)}
                        style={styles.recentCompactRow}
                      >
                        <RecommendationThumbnail cover={item.imageUrl ?? null} />
                        <AppText numberOfLines={1} style={[styles.recentCompactTitle, { color: theme.textPrimary }]}>
                          {item.title}
                        </AppText>
                      </Pressable>
                    ))
                  ) : (
                    <AppText style={[styles.emptyText, { color: theme.textSecondary }]}>
                      {dashboard.loading ? '正在读取最近学习记录…' : '暂时还没有最近学习记录。'}
                    </AppText>
                  )}
                </View>
              </DashboardCard>

              <DashboardCard
                title="为你推荐"
                action={(
                  <Pressable
                    disabled={dashboard.recommendationPoolSize <= 1}
                    onPress={onRotateRecommendations}
                  >
                    <AppText
                      style={[
                        styles.linkText,
                        {
                          color:
                            dashboard.recommendationPoolSize > 1
                              ? theme.primaryBlue
                              : theme.textTertiary,
                        },
                      ]}
                    >
                      换一换
                    </AppText>
                  </Pressable>
                )}
              >
                <Pressable
                  onPress={() =>
                    primaryRecommendation ? openHref(primaryRecommendation.href) : router.push('/library')
                  }
                >
                  <RecommendationThumbnail cover={primaryRecommendation?.imageUrl ?? null} size="wide" />
                  <AppText style={[styles.recommendTitleLarge, { color: theme.textPrimary }]}>
                    {primaryRecommendation?.title ?? (dashboard.loading ? '正在载入推荐内容' : '今日暂无推荐内容')}
                  </AppText>
                  {primaryRecommendation ? (
                    <AppText style={[styles.recommendMeta, { color: theme.textSecondary }]}>
                      {primaryRecommendation.subtitle}
                    </AppText>
                  ) : null}
                </Pressable>
              </DashboardCard>
            </View>
          )}

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
    flexGrow: 1,
  },
  container: {
    width: '100%',
    maxWidth: 1440,
    alignSelf: 'center',
  },
  topHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
  },
  avatarWrap: {
    marginTop: 2,
    transform: [{ scale: 0.95 }],
  },
  welcomeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    marginBottom: 8,
  },
  welcomeCopy: {
    flex: 1,
  },
  greeting: {
    fontSize: 36,
    lineHeight: 38,
    fontWeight: '900',
    letterSpacing: -1.15,
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '700',
  },
  heroCard: {
    height: 210,
    borderRadius: 26,
    overflow: 'hidden',
    borderWidth: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 0,
  },
  heroImage: {
    ...StyleSheet.absoluteFillObject,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  heroGlow: {
    position: 'absolute',
    right: -40,
    top: -20,
    width: '46%',
    height: '120%',
    borderRadius: 220,
  },
  heroInner: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'stretch',
    paddingHorizontal: 30,
    paddingVertical: 24,
    gap: 16,
  },
  heroMain: {
    flex: 1,
    maxWidth: 620,
  },
  heroBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroHeading: {
    marginTop: 12,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '900',
    letterSpacing: -1.15,
  },
  heroSubheading: {
    marginTop: 6,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  heroProgressBlock: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  heroProgressNumber: {
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '900',
    letterSpacing: -0.9,
  },
  heroProgressTotal: {
    fontSize: 17,
    lineHeight: 20,
    fontWeight: '700',
  },
  heroTrack: {
    marginTop: 10,
    height: 5,
    borderRadius: 999,
    overflow: 'hidden',
    maxWidth: 440,
  },
  heroFill: {
    height: '100%',
    borderRadius: 999,
  },
  featureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  featureCard: {
    width: '49.2%',
    height: 82,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 0,
  },
  featureCardCompact: {
    height: 82,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  featureIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureCopy: {
    flex: 1,
  },
  featureTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  featureTitle: {
    fontSize: 18,
    lineHeight: 20,
    fontWeight: '800',
    letterSpacing: -0.45,
  },
  featureTitleCompact: {
    fontSize: 18,
    lineHeight: 20,
  },
  featureSubtitle: {
    marginTop: 1,
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '700',
  },
  featureSubtitleCompact: {
    fontSize: 12,
    lineHeight: 14,
  },
  featureSoonPill: {
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureSoonText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '800',
  },
  featureArrow: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dashboardWideRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    width: '100%',
  },
  dashboardFillRegion: {
    flex: 1,
  },
  progressCardWide: {
    height: '100%',
  },
  miniColumn: {
    height: '100%',
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  recentCardWide: {
    height: '100%',
  },
  recommendCardWide: {
    height: '100%',
  },
  dashboardTwoCol: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dashboardStack: {
    flexDirection: 'column',
  },
  twoColCard: {
    width: '48.9%',
  },
  dashboardCard: {
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 0,
  },
  miniCard: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  dashboardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 24,
  },
  dashboardTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  progressCardBody: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  progressRing: {
    width: 128,
    height: 128,
    borderRadius: 64,
    borderWidth: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressRingInner: {
    width: 98,
    height: 98,
    borderRadius: 49,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressRingValue: {
    fontSize: 34,
    lineHeight: 36,
    fontWeight: '900',
    letterSpacing: -1,
  },
  progressRingLabel: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '700',
  },
  progressMeta: {
    flex: 1,
    gap: 10,
    paddingRight: 2,
  },
  dashboardTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dashboardTagDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  dashboardTagLabel: {
    flex: 1,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '700',
  },
  dashboardTagValue: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '800',
  },
  progressFooter: {
    marginTop: 'auto',
    paddingTop: 10,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressFooterText: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '700',
  },
  detailButton: {
    width: 88,
    height: 30,
    borderRadius: 14,
    paddingHorizontal: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailButtonText: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '800',
  },
  weekMetricValue: {
    marginTop: 6,
    fontSize: 24,
    lineHeight: 26,
    fontWeight: '900',
    letterSpacing: -0.6,
  },
  weekMetricNote: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '700',
  },
  sparklineCanvas: {
    width: 122,
    height: 36,
  },
  sparklineWrap: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 10,
  },
  streakRow: {
    marginTop: 6,
    flex: 1,
    position: 'relative',
  },
  streakCopy: {
    paddingRight: 64,
  },
  streakValue: {
    fontSize: 28,
    lineHeight: 30,
    fontWeight: '900',
  },
  streakFlame: {
    position: 'absolute',
    right: 18,
    bottom: 18,
    opacity: 0.95,
  },
  linkText: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '800',
  },
  recentList: {
    marginTop: 10,
  },
  recentRow: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  recentText: {
    flex: 1,
  },
  recentTitle: {
    fontSize: 13.5,
    lineHeight: 17,
    fontWeight: '800',
  },
  recentMeta: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
  },
  statusPill: {
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPillText: {
    fontSize: 10.5,
    lineHeight: 12,
    fontWeight: '800',
  },
  emptyText: {
    marginTop: 14,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  recommendThumb: {
    width: 42,
    height: 42,
    borderRadius: 12,
  },
  recommendWideThumb: {
    width: '100%',
    height: 92,
    borderRadius: 12,
  },
  recommendHeroMedia: {
    position: 'relative',
  },
  recommendCardBody: {
    flex: 1,
  },
  playButton: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.30)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recommendTitleLarge: {
    marginTop: 8,
    fontSize: 16,
    lineHeight: 19,
    fontWeight: '800',
  },
  recommendMeta: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
  },
  recommendTagRow: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  recommendTag: {
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recommendTagText: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '700',
  },
  ratingRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 16,
  },
  ratingStars: {
    fontSize: 12,
    lineHeight: 16,
    color: '#F59E0B',
    letterSpacing: 0.6,
  },
  ratingText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  bigValue: {
    marginTop: 16,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '900',
  },
  bigValueSuffix: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
  },
  cardNote: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  tagList: {
    marginTop: 16,
    gap: 10,
  },
  recentListCompact: {
    marginTop: 14,
    gap: 12,
  },
  recentCompactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  recentCompactTitle: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.84,
  },
});
