import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Canvas, Circle, Path, RoundedRect, Skia } from '@shopify/react-native-skia';
import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type DimensionValue,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { TopRightAvatarButton } from '@/components/ui/TopRightAvatarButton';
import { useFloatingTabInsets } from '@/hooks/useFloatingTabInsets';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { LibraryLearningOverview, LibrarySortMode, LibraryViewMode } from '@/types/libraryDashboard';
import type { EpisodeStub } from '@/types/echolingo';
import { sortEpisodes } from '@/utils/libraryDashboard';

type LibraryScreenTabletProps = {
  episodes: EpisodeStub[];
  filteredEpisodes: EpisodeStub[];
  recommended: EpisodeStub | null;
  totalEpisodes: number;
  dashboardOverview: LibraryLearningOverview;
  dashboardLoading: boolean;
  dashboardError: string | null;
  recommendationList: EpisodeStub[];
  loading: boolean;
  error: string | null;
  query: string;
  diffFilter: string;
  activeFilterCount: number;
  hasMore: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  loadMore: () => Promise<void> | void;
  refresh: () => Promise<void> | void;
  onOpenFilters: () => void;
  onResetFilters: () => void;
  onOpenMyTab: () => void;
  onOpenEpisode: (episodeId: string) => void;
  onResumeEpisode: (episodeId: string, sentenceId?: number | null) => void;
  onPrefetchEpisode: (episodeId: string) => void;
};

const IPAD_LIBRARY = {
  pagePaddingX: 20,
  gap: 12,
  mainSidebarGap: 18,
  sidebarWidth: 300,
  heroHeight: 286,
  heroPadding: 14,
  heroMainHeight: 190,
  heroBottomHeight: 54,
  heroCoverWidth: 330,
  heroCoverHeight: 190,
  statCardWidth: 112,
  statCardHeight: 54,
  statCardRadius: 13,
  heroActionHeight: 54,
  filterMinWidth: 210,
  startButtonWidth: 230,
  episodeCardHeight: 118,
  episodeCoverWidth: 132,
  episodeCoverHeight: 82,
  sidebarContinueHeight: 142,
  sidebarProgressHeight: 210,
  sidebarAbilityHeight: 176,
  sidebarAiHeight: 160,
  sidebarGap: 10,
  sparklineWidth: 96,
  sparklineHeight: 42,
  progressRingSize: 54,
} as const;

function difficultyStars(level: string) {
  if (level === 'Advanced') return 5;
  if (level === 'Intermediate') return 4;
  if (level === 'Beginner') return 2;
  return 3;
}

function formatIssueLabel(episode: EpisodeStub | null) {
  if (!episode?.display_issue_number) return '精选单集';
  return `第 ${String(episode.display_issue_number).padStart(2, '0')} 期`;
}

function getHeroMeta(episode: EpisodeStub | null) {
  if (!episode) return '精选单集 · 沉浸式精听学习';
  const tagText = (episode.tags ?? []).slice(0, 2).join(' / ');
  return `${formatIssueLabel(episode)} · ${episode.duration}${tagText ? ` · ${tagText}` : ''}`;
}

function formatStudyTimeLabel(value?: string | null) {
  if (!value) return '继续上次进度';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '继续上次进度';
  const now = new Date();
  const sameDay =
    now.getFullYear() === date.getFullYear() &&
    now.getMonth() === date.getMonth() &&
    now.getDate() === date.getDate();
  const timeText = `${`${date.getHours()}`.padStart(2, '0')}:${`${date.getMinutes()}`.padStart(2, '0')}`;
  if (sameDay) return `上次学习：今天 ${timeText}`;
  return `上次学习：${date.getMonth() + 1}/${date.getDate()} ${timeText}`;
}

function trendColor(direction: 'up' | 'flat' | 'down', theme: ReturnType<typeof useAppTheme>['theme']) {
  if (direction === 'up') return '#34C759';
  if (direction === 'down') return '#FF453A';
  return theme.textSecondary;
}

function trendIcon(direction: 'up' | 'flat' | 'down') {
  if (direction === 'up') return 'trending-up';
  if (direction === 'down') return 'trending-down';
  return 'remove';
}

function CoverThumb({
  cover,
  width,
  height,
  radius,
  iconSize = 24,
}: {
  cover?: string | null;
  width: DimensionValue;
  height: number;
  radius: number;
  iconSize?: number;
}) {
  const { theme } = useAppTheme();

  if (cover) {
    return (
      <Image
        source={cover}
        style={{ width, height, borderRadius: radius, backgroundColor: theme.secondaryCardBackground }}
        contentFit="cover"
        cachePolicy="disk"
        transition={0}
      />
    );
  }

  return (
    <View
      style={{
        width,
        height,
        borderRadius: radius,
        backgroundColor: theme.secondaryCardBackground,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name="headset" size={iconSize} color={theme.textSecondary} />
    </View>
  );
}

function DifficultyStars({
  level,
  compact = false,
}: {
  level: string;
  compact?: boolean;
}) {
  const { theme } = useAppTheme();
  const stars = difficultyStars(level);

  return (
    <View style={[styles.starsRow, compact && styles.starsRowCompact]}>
      {Array.from({ length: 5 }).map((_, index) => (
        <Ionicons
          key={`${level}-${index}`}
          name={index < stars ? 'star' : 'star-outline'}
          size={compact ? 12 : 13}
          color={index < stars ? '#FF9F0A' : theme.border}
        />
      ))}
      <AppText
        style={[styles.starsLabel, compact && styles.starsLabelCompact, { color: theme.textSecondary }]}
        numberOfLines={1}
      >
        {level}
      </AppText>
    </View>
  );
}

function SidebarCard({
  title,
  children,
  style,
}: {
  title: string;
  children: React.ReactNode;
  style?: object;
}) {
  const { theme } = useAppTheme();
  const isDark = theme.colorScheme === 'dark';

  return (
    <View
      style={[
        styles.sidebarCard,
        {
          backgroundColor: theme.cardBackground,
          borderColor: theme.border,
          shadowColor: theme.shadowColor,
          shadowOpacity: isDark ? 0.12 : 0.06,
        },
        style,
      ]}
    >
      <AppText style={[styles.sidebarTitle, { color: theme.textPrimary }]}>{title}</AppText>
      {children}
    </View>
  );
}

function HeroStatTile({
  label,
  value,
  width,
}: {
  label: string;
  value: string;
  width: number;
}) {
  const { theme } = useAppTheme();

  return (
    <View
      style={[
        styles.heroStatTile,
        {
          width,
          backgroundColor: theme.secondaryCardBackground,
          borderColor: theme.border,
        },
      ]}
    >
      <AppText style={[styles.heroStatLabel, { color: theme.textSecondary }]}>{label}</AppText>
      <AppText style={[styles.heroStatValue, { color: theme.textPrimary }]}>{value}</AppText>
    </View>
  );
}

function SidebarSparkline({
  color,
  series,
}: {
  color: string;
  series: number[];
}) {
  const safeSeries = series.length > 0 ? series : [0, 0, 0, 0, 0, 0, 0];
  const maxValue = Math.max(...safeSeries, 1);
  const width = IPAD_LIBRARY.sparklineWidth;
  const height = IPAD_LIBRARY.sparklineHeight;
  const step = safeSeries.length > 1 ? (width - 6) / (safeSeries.length - 1) : 0;
  const points = safeSeries.map((value, index) => ({
    x: 3 + step * index,
    y: height - 10 - (value / maxValue) * 20,
  }));
  const curve = useMemo(() => {
    const path = Skia.Path.Make();
    const [firstPoint, ...restPoints] = points;
    if (!firstPoint) return path;
    path.moveTo(firstPoint.x, firstPoint.y);
    restPoints.forEach((point, index) => {
      const previous = points[index];
      const controlX = (previous.x + point.x) / 2;
      path.cubicTo(controlX, previous.y, controlX, point.y, point.x, point.y);
    });
    return path;
  }, [points]);

  return (
    <Canvas style={styles.sidebarSparkline}>
      {points.map((point) => (
        <RoundedRect
          key={`glow-wide-${point.x}`}
          x={Math.max(0, Math.min(90, point.x - 3))}
          y={point.y + 4}
          width={6}
          height={Math.max(0, height - 8 - point.y)}
          r={3}
          color="rgba(0,122,255,0.10)"
        />
      ))}
      {points.map((point) => (
        <RoundedRect
          key={`glow-narrow-${point.x}`}
          x={Math.max(0, Math.min(93, point.x - 1.5))}
          y={point.y + 6}
          width={3}
          height={Math.max(0, height - 10 - point.y)}
          r={2}
          color="rgba(0,122,255,0.08)"
        />
      ))}
      <Path path={curve} color={color} style="stroke" strokeWidth={2.4} strokeCap="round" strokeJoin="round" />
      {points.map((point) => (
        <Circle key={`outer-${point.x}`} cx={point.x} cy={point.y} r={5} color="rgba(0,122,255,0.14)" />
      ))}
      {points.map((point) => (
        <Circle key={`fill-${point.x}`} cx={point.x} cy={point.y} r={3.2} color={color} />
      ))}
    </Canvas>
  );
}

function ListControl({
  icon,
  active = false,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  active?: boolean;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  const isDark = theme.colorScheme === 'dark';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.listControl,
        {
          backgroundColor: active ? `${theme.primaryBlue}14` : theme.cardBackground,
          borderColor: active ? `${theme.primaryBlue}22` : theme.border,
          shadowColor: theme.shadowColor,
          shadowOpacity: isDark ? 0.08 : 0.04,
          opacity: pressed ? 0.74 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={16} color={active ? theme.primaryBlue : theme.textSecondary} />
    </Pressable>
  );
}

function LibraryProgressRing({ label }: { label: string }) {
  const { theme } = useAppTheme();

  return (
    <View
      style={[
        styles.progressRing,
        {
          borderColor: `${theme.primaryBlue}28`,
        },
      ]}
    >
      <View style={[styles.progressRingInner, { backgroundColor: theme.pageBackground }]}>
        <AppText style={[styles.progressRingValue, { color: theme.primaryBlue }]}>{label}</AppText>
      </View>
    </View>
  );
}

function MetricBar({ height }: { height: number }) {
  const { theme } = useAppTheme();

  return (
    <View
      style={[
        styles.metricBar,
        {
          height,
          backgroundColor: `${theme.primaryBlue}D4`,
        },
      ]}
    />
  );
}

function EpisodeGridCard({
  episode,
  width,
  onOpenEpisode,
  onPrefetchEpisode,
}: {
  episode: EpisodeStub;
  width: number;
  onOpenEpisode: (episodeId: string) => void;
  onPrefetchEpisode: (episodeId: string) => void;
}) {
  const { theme } = useAppTheme();
  const isDark = theme.colorScheme === 'dark';
  const tags = (episode.tags ?? []).slice(0, 2);

  return (
    <Pressable
      onPress={() => onOpenEpisode(episode.id)}
      onPressIn={() => onPrefetchEpisode(episode.id)}
      style={({ pressed }) => [
        styles.episodeCard,
        {
          width,
          backgroundColor: theme.cardBackground,
          borderColor: theme.border,
          shadowColor: theme.shadowColor,
          shadowOpacity: isDark ? 0.12 : 0.05,
        },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.episodeCardMedia}>
        <CoverThumb
          cover={episode.cover}
          width={IPAD_LIBRARY.episodeCoverWidth}
          height={IPAD_LIBRARY.episodeCoverHeight}
          radius={12}
          iconSize={20}
        />
      </View>

      <View style={styles.episodeCardCopy}>
        <View style={styles.episodeCardTopRow}>
          <View style={styles.episodeCardTitleWrap}>
            <AppText numberOfLines={2} style={[styles.episodeCardTitle, { color: theme.textPrimary }]}>
              {episode.title}
            </AppText>
            <AppText style={[styles.episodeCardMeta, { color: theme.textSecondary }]}>
              {formatIssueLabel(episode)} · {episode.duration}
            </AppText>
          </View>
        </View>

        <View style={styles.episodeCardBottom}>
          {tags.length > 0 ? (
            <View style={styles.episodeTagRow}>
              {tags.map((tag) => (
                <View key={`${episode.id}-${tag}`} style={[styles.episodeTag, { backgroundColor: theme.secondaryCardBackground }]}>
                  <AppText style={[styles.episodeTagText, { color: theme.textSecondary }]}>{tag}</AppText>
                </View>
              ))}
            </View>
          ) : null}
          <DifficultyStars level={episode.difficulty} compact />
        </View>
      </View>
    </Pressable>
  );
}

export function LibraryScreenTablet({
  episodes,
  filteredEpisodes,
  recommended,
  totalEpisodes,
  dashboardOverview,
  dashboardLoading,
  dashboardError,
  recommendationList,
  loading,
  error,
  query,
  diffFilter,
  activeFilterCount,
  hasMore,
  loadingMore,
  refreshing,
  loadMore,
  refresh,
  onOpenFilters,
  onResetFilters,
  onOpenMyTab,
  onOpenEpisode,
  onResumeEpisode,
  onPrefetchEpisode,
}: LibraryScreenTabletProps) {
  const { theme } = useAppTheme();
  const floatingInsets = useFloatingTabInsets();
  const { width, height } = useWindowDimensions();
  const [sortMode, setSortMode] = useState<LibrarySortMode>('latest');
  const [viewMode, setViewMode] = useState<LibraryViewMode>('grid');
  const isDark = theme.colorScheme === 'dark';
  const pagePadding = IPAD_LIBRARY.pagePaddingX;
  const contentGap = IPAD_LIBRARY.mainSidebarGap;
  const sidebarWidth = width >= 1100 ? IPAD_LIBRARY.sidebarWidth : Math.min(width - pagePadding * 2, 420);
  const stackedSidebar = width < 1100;
  const contentWidth = Math.min(width - pagePadding * 2, 1440);
  const mainWidth = stackedSidebar
    ? contentWidth
    : width - pagePadding * 2 - IPAD_LIBRARY.sidebarWidth - IPAD_LIBRARY.mainSidebarGap;
  const heroHeight = IPAD_LIBRARY.heroHeight;
  const compactMain = mainWidth < 980;
  const heroImageWidth = stackedSidebar
    ? Math.min(IPAD_LIBRARY.heroCoverWidth, Math.max(304, mainWidth * 0.42))
    : compactMain
      ? 312
      : IPAD_LIBRARY.heroCoverWidth;
  const heroImageHeight = IPAD_LIBRARY.heroCoverHeight;
  const sortedEpisodes = useMemo(
    () => sortEpisodes(filteredEpisodes, sortMode),
    [filteredEpisodes, sortMode],
  );
  const episodeColumns = viewMode === 'list' ? 1 : mainWidth >= 700 ? 2 : 1;
  const listGap = IPAD_LIBRARY.gap;
  const episodeCardWidth =
    episodeColumns === 2 ? Math.floor((mainWidth - listGap) / 2) : mainWidth;
  const topPadding = Math.max(floatingInsets.top - 42, 52);
  const listHeight = Math.max(260, height - topPadding - 48 - IPAD_LIBRARY.heroHeight - 42 - 12 - 12 - 16);
  const compactHeroBottom = mainWidth < 940;
  const heroStatWidth = compactHeroBottom ? 104 : IPAD_LIBRARY.statCardWidth;
  const heroSecondaryWidth = compactHeroBottom ? 192 : IPAD_LIBRARY.filterMinWidth;
  const heroPrimaryWidth = compactHeroBottom ? 210 : IPAD_LIBRARY.startButtonWidth;
  const heroTags =
    (recommended?.tags ?? []).slice(0, 3);
  const heroStats = [
    { label: '全部单集', value: String(totalEpisodes || episodes.length) },
    {
      label: '已学完',
      value: dashboardLoading ? '读取中' : dashboardError ? '暂不可用' : String(dashboardOverview.completedCount),
    },
    {
      label: '当前进度',
      value: dashboardLoading ? '读取中' : dashboardError ? '暂不可用' : String(dashboardOverview.inProgressCount),
    },
  ];
  const resumeEpisode = dashboardOverview.lastLearningRecord?.episode ?? null;
  const resumeProgressRatio = dashboardOverview.lastProgressRatio;
  const sortLabel =
    sortMode === 'latest'
      ? '最新发布'
      : sortMode === 'duration'
        ? '时长优先'
        : '难度优先';
  const progressMetricCards = [
    { label: '今日学习单集', value: `${dashboardOverview.episodesTouchedToday} 集` },
    { label: '本周学习天数', value: `${dashboardOverview.activeDaysLast7} 天` },
    { label: '累计学习单集', value: `${dashboardOverview.cumulativeEpisodes} 集` },
  ];
  const weeklyMax = Math.max(...dashboardOverview.weeklySeries, 1);
  const coverageLabel = totalEpisodes > 0
    ? `${dashboardOverview.cumulativeEpisodes}/${totalEpisodes}`
    : `${dashboardOverview.cumulativeEpisodes}`;
  const coverageRatio =
    totalEpisodes > 0
      ? Math.min(1, dashboardOverview.cumulativeEpisodes / totalEpisodes)
      : 0;
  const trendTint = trendColor(dashboardOverview.trend, theme);
  const hasResumeRecord = Boolean(resumeEpisode && dashboardOverview.lastLearningRecord);
  const canLoadMore = hasMore && !loadingMore && !loading;

  const renderEpisodeItem = ({
    item,
  }: {
    item: EpisodeStub;
  }) => (
    <View style={styles.episodeListItem}>
      <EpisodeGridCard
        episode={item}
        width={episodeCardWidth}
        onOpenEpisode={onOpenEpisode}
        onPrefetchEpisode={onPrefetchEpisode}
      />
    </View>
  );

  const listFooter = (
    <View style={styles.listFooter}>
      {loadingMore ? (
        <>
          <Ionicons name="sync-outline" size={18} color={theme.textSecondary} />
          <AppText style={[styles.listFooterText, { color: theme.textSecondary }]}>正在加载更多</AppText>
        </>
      ) : sortedEpisodes.length > 0 ? (
        <>
          <Ionicons name="checkmark-circle-outline" size={18} color={theme.textSecondary} />
          <AppText style={[styles.listFooterText, { color: theme.textSecondary }]}>
            {hasMore
              ? `已加载 ${episodes.length}/${totalEpisodes || episodes.length} 条`
              : `已加载全部 ${episodes.length}/${totalEpisodes || episodes.length} 条`}
          </AppText>
        </>
      ) : null}
    </View>
  );

  const listEmpty = (
    <View
      style={[
        styles.messageCard,
        {
          backgroundColor: theme.cardBackground,
          borderColor: theme.border,
        },
      ]}
    >
      {loading ? (
        <>
          <Ionicons name="sync-outline" size={18} color={theme.textSecondary} />
          <AppText style={[styles.messageText, { color: theme.textSecondary }]}>正在加载内容…</AppText>
        </>
      ) : error ? (
        <>
          <Ionicons name="alert-circle-outline" size={18} color="#FF453A" />
          <AppText style={[styles.messageText, { color: '#FF453A' }]}>{error}</AppText>
        </>
      ) : (
        <>
          <Ionicons name="search-outline" size={18} color={theme.textSecondary} />
          <AppText style={[styles.messageText, { color: theme.textSecondary }]}>没有匹配的单集</AppText>
        </>
      )}
    </View>
  );

  const mainContent = (
    <View style={{ width: mainWidth, flex: stackedSidebar ? 0 : 1, minHeight: 0 }}>
      <Pressable
        onPress={() => (recommended ? onOpenEpisode(recommended.id) : undefined)}
        onPressIn={() => (recommended ? onPrefetchEpisode(recommended.id) : undefined)}
        disabled={!recommended}
        style={({ pressed }) => [
          styles.heroCard,
          {
            height: heroHeight,
            backgroundColor: theme.cardBackground,
            borderColor: theme.border,
            shadowColor: theme.shadowColor,
            shadowOpacity: isDark ? 0.12 : 0.06,
          },
          pressed && recommended ? styles.pressed : null,
        ]}
      >
        <View style={styles.heroUpper}>
          <CoverThumb cover={recommended?.cover} width={heroImageWidth} height={heroImageHeight} radius={18} iconSize={42} />

          <View style={styles.heroCopy}>
            <View style={[styles.heroPill, { backgroundColor: theme.secondaryCardBackground }]}>
              <AppText style={[styles.heroPillText, { color: theme.textSecondary }]}>每日推荐</AppText>
            </View>

            <AppText numberOfLines={2} style={[styles.heroTitle, { color: theme.textPrimary }]}>
              {recommended?.title ?? (loading ? '正在载入推荐内容' : '今日暂无可推荐单集')}
            </AppText>
            <AppText style={[styles.heroMeta, { color: theme.textSecondary }]}>
              {getHeroMeta(recommended)}
            </AppText>
            <DifficultyStars level={recommended?.difficulty ?? 'Intermediate'} />

            {heroTags.length > 0 ? (
              <View style={styles.heroTagsRow}>
                {heroTags.map((tag) => (
                  <View key={tag} style={[styles.heroTag, { backgroundColor: theme.secondaryCardBackground }]}>
                    <AppText style={[styles.heroTagText, { color: theme.textSecondary }]}>{tag}</AppText>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.heroBottom}>
          <View style={styles.heroStatsRow}>
            {heroStats.map((item) => (
              <HeroStatTile key={item.label} label={item.label} value={item.value} width={heroStatWidth} />
            ))}
          </View>

          <View style={styles.heroActions}>
            <Pressable
              onPress={onOpenFilters}
              style={({ pressed }) => [
                styles.heroSecondaryAction,
                { width: heroSecondaryWidth, minWidth: heroSecondaryWidth, flex: 1 },
                {
                  backgroundColor: theme.secondaryCardBackground,
                  borderColor: theme.border,
                },
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="funnel-outline" size={18} color={theme.textSecondary} />
              <AppText style={[styles.heroSecondaryActionText, { color: theme.textPrimary }]}>
                {activeFilterCount > 0 ? `筛选 · ${activeFilterCount}` : '筛选'}
              </AppText>
            </Pressable>

            <Pressable
              onPress={() => (recommended ? onOpenEpisode(recommended.id) : undefined)}
              onPressIn={() => (recommended ? onPrefetchEpisode(recommended.id) : undefined)}
              disabled={!recommended}
              style={({ pressed }) => [
                styles.heroPrimaryAction,
                { width: heroPrimaryWidth },
                {
                  backgroundColor: theme.primaryBlue,
                },
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="play" size={20} color="#FFFFFF" />
              <AppText style={styles.heroPrimaryActionText} disableAndroidDarkTextOverride>进入学习</AppText>
            </Pressable>
          </View>
        </View>
      </Pressable>

      <View style={styles.listSection}>
        <View style={styles.listHeader}>
          <View style={styles.listHeaderCopy}>
            <AppText style={[styles.listTitle, { color: theme.textPrimary }]}>单集列表</AppText>
            {(query.trim().length > 0 || diffFilter !== '全部') ? (
              <Pressable onPress={onResetFilters}>
                <AppText style={[styles.activeFiltersText, { color: theme.textSecondary }]}>
                  {query.trim().length > 0 ? `“${query.trim()}”` : diffFilter} · 已加载 {filteredEpisodes.length}/{totalEpisodes || episodes.length} 条 · 重置
                </AppText>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.listHeaderActions}>
            <Pressable
              onPress={() =>
                setSortMode((prev) =>
                  prev === 'latest' ? 'duration' : prev === 'duration' ? 'difficulty' : 'latest',
                )
              }
              style={[
                styles.sortButton,
                {
                  backgroundColor: theme.cardBackground,
                  borderColor: theme.border,
                },
              ]}
            >
              <AppText style={[styles.sortButtonText, { color: theme.textPrimary }]}>{sortLabel}</AppText>
              <Ionicons name="chevron-down" size={14} color={theme.textSecondary} />
            </Pressable>
            <ListControl icon="grid" active={viewMode === 'grid'} onPress={() => setViewMode('grid')} />
            <ListControl icon="reorder-three-outline" active={viewMode === 'list'} onPress={() => setViewMode('list')} />
          </View>
        </View>

        <FlatList
          key={`library-${viewMode}-${episodeColumns}`}
          data={sortedEpisodes}
          renderItem={renderEpisodeItem}
          keyExtractor={(item) => item.id}
          numColumns={episodeColumns}
          style={[styles.episodeListScroller, { height: listHeight, maxHeight: listHeight }]}
          contentContainerStyle={styles.episodeListContent}
          columnWrapperStyle={episodeColumns > 1 ? styles.episodeColumnWrap : undefined}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          updateCellsBatchingPeriod={50}
          removeClippedSubviews={Platform.OS === 'android'}
          onEndReachedThreshold={0.6}
          onEndReached={canLoadMore ? () => void loadMore() : undefined}
          ListEmptyComponent={listEmpty}
          ListFooterComponent={listFooter}
          refreshing={refreshing}
          onRefresh={() => {
            void refresh();
          }}
        />
      </View>
    </View>
  );

  const sidebarContent = (
    <View
      style={{
        width: sidebarWidth,
        gap: IPAD_LIBRARY.sidebarGap,
        alignSelf: 'stretch',
        flexShrink: 0,
        height:
          IPAD_LIBRARY.sidebarContinueHeight +
          IPAD_LIBRARY.sidebarProgressHeight +
          IPAD_LIBRARY.sidebarAbilityHeight +
          IPAD_LIBRARY.sidebarAiHeight +
          IPAD_LIBRARY.sidebarGap * 3,
        maxHeight:
          IPAD_LIBRARY.sidebarContinueHeight +
          IPAD_LIBRARY.sidebarProgressHeight +
          IPAD_LIBRARY.sidebarAbilityHeight +
          IPAD_LIBRARY.sidebarAiHeight +
          IPAD_LIBRARY.sidebarGap * 3,
      }}
    >
      <SidebarCard title="继续上次学习" style={{ height: IPAD_LIBRARY.sidebarContinueHeight }}>
        <View style={styles.resumeTopRow}>
          <CoverThumb cover={resumeEpisode?.cover ?? null} width={64} height={46} radius={10} iconSize={16} />
          <View style={styles.resumeCopy}>
            <AppText numberOfLines={2} style={[styles.resumeTitle, { color: theme.textPrimary }]}>
              {hasResumeRecord ? resumeEpisode?.title ?? '继续上次学习' : '还没有学习记录'}
            </AppText>
            <AppText numberOfLines={1} style={[styles.resumeMeta, { color: theme.textSecondary }]}>
              {dashboardLoading
                ? '正在读取学习记录'
                : dashboardError
                  ? '学习记录暂时无法读取'
                  : hasResumeRecord
                    ? `${formatStudyTimeLabel(dashboardOverview.lastLearningRecord?.lastReviewedAt)}${resumeEpisode?.duration ? ` · ${resumeEpisode.duration}` : ''}`
                    : '开始每日推荐，系统会在学习后自动记录进度'}
            </AppText>
          </View>
        </View>

        <View style={[styles.resumeTrack, { backgroundColor: theme.secondaryCardBackground }]}>
          <View
            style={[
              styles.resumeFill,
              {
                width: `${Math.round((resumeProgressRatio ?? 0) * 100)}%`,
                backgroundColor: theme.primaryBlue,
              },
            ]}
          />
        </View>

        <Pressable
          onPress={() =>
            hasResumeRecord && dashboardOverview.lastLearningRecord
              ? onResumeEpisode(
                  dashboardOverview.lastLearningRecord.episode.id,
                  dashboardOverview.lastLearningRecord.lastSentenceId,
                )
              : recommended
                ? onOpenEpisode(recommended.id)
                : undefined
          }
          onPressIn={() =>
            hasResumeRecord
              ? onPrefetchEpisode(dashboardOverview.lastLearningRecord!.episode.id)
              : recommended
                ? onPrefetchEpisode(recommended.id)
                : undefined
          }
          disabled={!hasResumeRecord && !recommended}
          style={({ pressed }) => [
            styles.sidebarPrimaryButton,
            {
              backgroundColor: theme.secondaryCardBackground,
              borderColor: theme.border,
            },
            pressed && styles.pressed,
          ]}
        >
          <AppText style={[styles.sidebarPrimaryButtonText, { color: theme.textPrimary }]}>
            {hasResumeRecord ? '继续播放' : '开始每日推荐'}
          </AppText>
        </Pressable>
      </SidebarCard>

      <SidebarCard title="学习进度" style={{ height: IPAD_LIBRARY.sidebarProgressHeight }}>
        {dashboardLoading ? (
          <View style={styles.progressEmptyState}>
            <Ionicons name="sync-outline" size={18} color={theme.textSecondary} />
            <AppText style={[styles.aiEmptyText, { color: theme.textSecondary }]}>正在读取学习记录</AppText>
          </View>
        ) : dashboardError ? (
          <View style={styles.progressEmptyState}>
            <Ionicons name="cloud-offline-outline" size={18} color={theme.textSecondary} />
            <AppText style={[styles.aiEmptyText, { color: theme.textSecondary }]}>学习记录暂时不可用</AppText>
          </View>
        ) : (
          <View style={styles.progressSummaryRow}>
            <View style={styles.progressMetricList}>
              {progressMetricCards.map((metric) => (
                <View key={metric.label} style={styles.progressMetricBlock}>
                  <AppText style={[styles.progressMetricLabel, { color: theme.textSecondary }]}>{metric.label}</AppText>
                  <AppText style={[styles.progressMetricValueText, { color: theme.textPrimary }]}>{metric.value}</AppText>
                </View>
              ))}
            </View>

            <View style={styles.progressChartsArea}>
              <View style={styles.progressRingWrap}>
                <LibraryProgressRing label={`${Math.round(dashboardOverview.completionRatio * 100)}%`} />
              </View>
              <View style={styles.progressBars}>
                <View style={styles.progressBarsRow}>
                  {dashboardOverview.weeklySeries.map((value, index) => (
                    <MetricBar
                      key={index}
                      height={value > 0 ? 10 + (value / weeklyMax) * 32 : 8}
                    />
                  ))}
                </View>
              </View>
              <View style={styles.progressSparkline}>
                <SidebarSparkline color={theme.primaryBlue} series={dashboardOverview.weeklySeries} />
              </View>
            </View>
          </View>
        )}
      </SidebarCard>

      <SidebarCard title="难度与能力" style={{ height: IPAD_LIBRARY.sidebarAbilityHeight }}>
        <View style={styles.abilityGrid}>
          <View style={styles.abilityMetricRow}>
            <View style={[styles.abilityMetricBox, { backgroundColor: theme.secondaryCardBackground, borderColor: theme.border }]}>
              <AppText numberOfLines={1} style={[styles.abilityMetricLabel, { color: theme.textTertiary }]}>
                {dashboardOverview.currentDifficultyLabel}
              </AppText>
              <AppText numberOfLines={1} style={[styles.abilityMetricValue, { color: theme.textPrimary }]}>
                {dashboardOverview.currentDifficulty ?? '暂无记录'}
              </AppText>
            </View>

            <View style={[styles.abilityMetricBox, { backgroundColor: theme.secondaryCardBackground, borderColor: theme.border }]}>
              <AppText numberOfLines={1} style={[styles.abilityMetricLabel, { color: theme.textTertiary }]}>学习覆盖</AppText>
              <AppText numberOfLines={1} style={[styles.abilityMetricValue, { color: theme.textPrimary }]}>
                {dashboardLoading ? '读取中' : dashboardError ? '暂不可用' : coverageLabel}
              </AppText>
              <View style={[styles.abilityTrack, { backgroundColor: theme.cardBackground }]}>
                <View
                  style={[
                    styles.abilityFill,
                    {
                      width: `${Math.round((dashboardLoading || dashboardError ? 0 : coverageRatio) * 100)}%`,
                      backgroundColor: theme.primaryBlue,
                    },
                  ]}
                />
              </View>
            </View>
          </View>

          <View
            style={[
              styles.abilityTileWide,
              {
                backgroundColor: theme.secondaryCardBackground,
                borderColor: theme.border,
              },
            ]}
          >
            <View>
              <AppText numberOfLines={1} style={[styles.abilityMetricLabel, { color: theme.textTertiary }]}>学习状态</AppText>
              <AppText numberOfLines={1} style={[styles.abilityMetricValue, { color: theme.textPrimary }]}>
                {dashboardLoading ? '正在同步' : dashboardError ? '暂不可用' : dashboardOverview.learningStateLabel}
              </AppText>
            </View>
            <Ionicons
              name={dashboardLoading || dashboardError ? 'remove' : trendIcon(dashboardOverview.trend)}
              size={24}
              color={dashboardLoading || dashboardError ? theme.textSecondary : trendTint}
            />
          </View>
        </View>
      </SidebarCard>

      <SidebarCard title="每日推荐" style={{ height: IPAD_LIBRARY.sidebarAiHeight }}>
        <View style={styles.aiList}>
          {recommendationList.length > 0 ? (
            recommendationList.slice(0, 2).map((episode) => (
              <Pressable
                key={episode.id}
                onPress={() => onOpenEpisode(episode.id)}
                onPressIn={() => onPrefetchEpisode(episode.id)}
                style={({ pressed }) => [styles.aiItem, pressed && styles.pressed]}
              >
                <CoverThumb cover={episode.cover} width={56} height={36} radius={9} iconSize={16} />
                <View style={styles.aiItemCopy}>
                  <AppText numberOfLines={2} style={[styles.aiItemTitle, { color: theme.textPrimary }]}>
                    {episode.title}
                  </AppText>
                  <AppText numberOfLines={1} style={[styles.aiItemSubtitle, { color: theme.textSecondary }]}>
                    {(episode.tags ?? []).slice(0, 2).join(' / ') || `${formatIssueLabel(episode)} · ${episode.duration}`}
                  </AppText>
                </View>
              </Pressable>
            ))
          ) : (
            <View style={styles.aiEmptyState}>
              <Ionicons name="sparkles-outline" size={18} color={theme.textSecondary} />
              <AppText style={[styles.aiEmptyText, { color: theme.textSecondary }]}>今日暂无可推荐内容</AppText>
            </View>
          )}
        </View>
      </SidebarCard>
    </View>
  );

  return (
    <SafeAreaView edges={['left', 'right']} style={[styles.safeArea, { backgroundColor: theme.pageBackground }]}>
      <ScrollView
        style={styles.outerScroller}
        contentContainerStyle={[styles.outerContent, { minHeight: height }]}
        bounces
        alwaysBounceVertical
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.page,
            {
              paddingTop: topPadding,
              paddingHorizontal: pagePadding,
              paddingBottom: 12,
            },
          ]}
        >
          <View style={[styles.pageInner, { width: contentWidth }]}>
            <View style={styles.headerRow}>
              <View>
                <AppText style={[styles.pageTitle, { color: theme.textPrimary }]}>精听库</AppText>
                <AppText style={[styles.pageSubtitle, { color: theme.textSecondary }]}>
                  精选内容，沉浸式精听学习
                </AppText>
              </View>
              <TopRightAvatarButton onPress={onOpenMyTab} />
            </View>

            <View
              style={[
                styles.contentRow,
                {
                  flexDirection: stackedSidebar ? 'column' : 'row',
                  gap: stackedSidebar ? contentGap : 18,
                },
              ]}
            >
              {mainContent}
              {sidebarContent}
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
  outerScroller: {
    flex: 1,
  },
  outerContent: {
    paddingBottom: 0,
  },
  page: {
    flex: 1,
    alignItems: 'center',
  },
  pageInner: {
    flex: 1,
    maxWidth: 1440,
  },
  headerRow: {
    marginTop: 0,
    marginBottom: 10,
    height: 46,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  pageTitle: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  pageSubtitle: {
    marginTop: 2,
    fontSize: 14,
    lineHeight: 18,
  },
  contentRow: {
    flex: 1,
    alignItems: 'flex-start',
    minHeight: 0,
  },
  heroCard: {
    borderRadius: 26,
    padding: IPAD_LIBRARY.heroPadding,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  heroUpper: {
    height: IPAD_LIBRARY.heroMainHeight,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 22,
    marginBottom: 10,
  },
  heroCopy: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    paddingTop: 4,
  },
  heroPill: {
    alignSelf: 'flex-start',
    height: 24,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 0,
  },
  heroPillText: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '700',
  },
  heroTitle: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -0.9,
    marginTop: 10,
  },
  heroMeta: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 18,
  },
  starsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 10,
    height: 18,
    overflow: 'hidden',
  },
  starsRowCompact: {
    marginTop: 3,
    height: 18,
  },
  starsLabel: {
    marginLeft: 6,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
  },
  starsLabelCompact: {
    marginLeft: 4,
    fontSize: 12,
    lineHeight: 15,
  },
  heroTagsRow: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  heroTag: {
    minHeight: 26,
    paddingHorizontal: 10,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTagText: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '600',
  },
  heroBottom: {
    height: IPAD_LIBRARY.heroBottomHeight,
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    gap: 10,
  },
  heroStatsRow: {
    flexDirection: 'row',
    gap: 8,
    flexShrink: 1,
    alignItems: 'stretch',
    height: IPAD_LIBRARY.heroBottomHeight,
  },
  heroStatTile: {
    width: IPAD_LIBRARY.statCardWidth,
    height: IPAD_LIBRARY.statCardHeight,
    borderRadius: IPAD_LIBRARY.statCardRadius,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  heroStatLabel: {
    fontSize: 11,
    lineHeight: 14,
  },
  heroStatValue: {
    marginTop: 1,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  heroActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    flex: 1,
    height: IPAD_LIBRARY.heroBottomHeight,
  },
  heroSecondaryAction: {
    height: IPAD_LIBRARY.heroActionHeight,
    borderRadius: IPAD_LIBRARY.statCardRadius,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  heroSecondaryActionText: {
    fontSize: 16,
    lineHeight: 19,
    fontWeight: '600',
  },
  heroPrimaryAction: {
    height: IPAD_LIBRARY.heroActionHeight,
    borderRadius: IPAD_LIBRARY.statCardRadius,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  heroPrimaryActionText: {
    fontSize: 17,
    lineHeight: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  listSection: {
    marginTop: 14,
    flex: 1,
    minHeight: 0,
  },
  listHeader: {
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 10,
    flexShrink: 0,
  },
  listHeaderCopy: {
    flex: 1,
  },
  listTitle: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  activeFiltersText: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '600',
  },
  listHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sortButton: {
    minWidth: 110,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
  },
  sortButtonText: {
    fontSize: 14,
    lineHeight: 16,
    fontWeight: '600',
  },
  listControl: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageCard: {
    minHeight: 132,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 18,
  },
  episodeListScroller: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  episodeListContent: {
    paddingBottom: 20,
  },
  episodeColumnWrap: {
    columnGap: IPAD_LIBRARY.gap,
  },
  episodeListItem: {
    marginBottom: 10,
  },
  episodeCard: {
    height: IPAD_LIBRARY.episodeCardHeight,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    overflow: 'hidden',
  },
  episodeCardMedia: {
    position: 'relative',
  },
  episodeCardCopy: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    alignSelf: 'stretch',
    justifyContent: 'space-between',
    paddingVertical: 0,
  },
  episodeCardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  episodeCardTitleWrap: {
    flex: 1,
  },
  episodeCardTitle: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  episodeCardMeta: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 15,
  },
  episodeCardBottom: {
    gap: 2,
  },
  episodeTagRow: {
    height: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    overflow: 'hidden',
  },
  episodeTag: {
    height: 18,
    borderRadius: 999,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  episodeTagText: {
    fontSize: 10.5,
    lineHeight: 12,
    fontWeight: '600',
  },
  listFooter: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  listFooterText: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '600',
  },
  sidebarCard: {
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 13,
    overflow: 'hidden',
  },
  sidebarTitle: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginBottom: 10,
  },
  resumeTopRow: {
    height: 46,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  resumeCopy: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
  },
  resumeTitle: {
    fontSize: 12.5,
    lineHeight: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  resumeMeta: {
    fontSize: 11.5,
    lineHeight: 13,
    marginTop: 2,
  },
  resumeTrack: {
    marginTop: 6,
    marginBottom: 7,
    height: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  resumeFill: {
    height: '100%',
    borderRadius: 999,
  },
  sidebarPrimaryButton: {
    marginTop: 0,
    height: 28,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarPrimaryButtonText: {
    fontSize: 12.5,
    lineHeight: 15,
    fontWeight: '700',
  },
  progressSummaryRow: {
    height: 152,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
  },
  progressEmptyState: {
    height: 152,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  progressMetricList: {
    width: 98,
    justifyContent: 'space-between',
    paddingBottom: 2,
  },
  progressMetricBlock: {
    marginBottom: 0,
  },
  progressMetricLabel: {
    fontSize: 11.5,
    lineHeight: 14,
  },
  progressMetricValueText: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '800',
    marginTop: 2,
    letterSpacing: -0.2,
  },
  progressChartsArea: {
    width: 138,
    height: 142,
    marginLeft: 'auto',
    marginRight: 4,
    position: 'relative',
    flexShrink: 0,
    overflow: 'hidden',
  },
  progressRingWrap: {
    position: 'absolute',
    top: 0,
    right: 0,
  },
  progressRing: {
    width: IPAD_LIBRARY.progressRingSize,
    height: IPAD_LIBRARY.progressRingSize,
    borderRadius: IPAD_LIBRARY.progressRingSize / 2,
    borderWidth: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressRingInner: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressRingValue: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '700',
  },
  progressBars: {
    position: 'absolute',
    top: 62,
    right: 8,
    width: 96,
    height: 42,
  },
  progressBarsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 7,
    minHeight: 42,
    height: 42,
  },
  metricBar: {
    width: 7,
    borderRadius: 5,
  },
  progressSparkline: {
    position: 'absolute',
    right: 8,
    bottom: 0,
    width: 96,
    height: 40,
  },
  sidebarSparkline: {
    width: 96,
    height: 40,
  },
  abilityGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  abilityMetricRow: {
    flexDirection: 'row',
    gap: 8,
    height: 58,
    marginBottom: 8,
    width: '100%',
  },
  abilityMetricBox: {
    flex: 1,
    minWidth: 0,
    height: 58,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 13,
    overflow: 'hidden',
    justifyContent: 'center',
    borderWidth: 1,
  },
  abilityTile: {
    flex: 1,
    borderRadius: 13,
  },
  abilityTileWide: {
    width: '100%',
    height: 50,
    borderRadius: 13,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  abilityMetricLabel: {
    fontSize: 10.5,
    lineHeight: 13,
  },
  abilityMetricValue: {
    marginTop: 3,
    fontSize: 13.5,
    lineHeight: 17,
    fontWeight: '800',
  },
  abilityTrack: {
    marginTop: 5,
    height: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  abilityFill: {
    height: '100%',
    borderRadius: 999,
  },
  aiList: {
    gap: 7,
  },
  aiItem: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 50,
    gap: 9,
  },
  aiItemCopy: {
    flex: 1,
    gap: 3,
  },
  aiItemTitle: {
    fontSize: 12.5,
    lineHeight: 14.5,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  aiItemSubtitle: {
    fontSize: 10.5,
    lineHeight: 12.5,
    marginTop: 2,
  },
  aiEmptyState: {
    minHeight: 80,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  aiEmptyText: {
    fontSize: 14,
    lineHeight: 17,
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.995 }],
  },
});
