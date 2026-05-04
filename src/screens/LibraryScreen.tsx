import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { ActionButton, SearchField, SegmentButton, SurfaceCard } from '@/components/ui/ApplePrimitives';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { TopRightAvatarButton } from '@/components/ui/TopRightAvatarButton';
import { useLibraryDashboard } from '@/hooks/useLibraryDashboard';
import { useLibraryData } from '@/hooks/useLibraryData';
import { useDeviceClass } from '@/hooks/useDeviceClass';
import { prefetchEpisodeDetail } from '@/hooks/useEpisodeDetailData';
import { useFloatingTabInsets } from '@/hooks/useFloatingTabInsets';
import { LibraryScreenTablet } from '@/screens/LibraryScreenTablet';
import {
  ACCENT,
  BG_HERO,
  BG_HERO_BTN_SEC,
  BG_HERO_PILL,
  BG_OVERLAY,
  COLOR_AMBER_BG,
  COLOR_RED,
  FONT_BODY,
  FONT_CALLOUT,
  FONT_CAPTION,
  FONT_LARGE_TITLE,
  FONT_MICRO,
  FONT_TITLE,
  RADIUS_BTN,
  RADIUS_CARD,
  RADIUS_HERO,
  RADIUS_PILL,
  SEPARATOR_DARK,
  SPACING_PAGE_H,
  TEXT_ON_DARK,
  TEXT_ON_DARK_DIM,
} from '@/theme/tokens';
import { useThemeColors } from '@/theme/useThemeColors';
import { sortEpisodes } from '@/utils/libraryDashboard';
import type { EpisodeStub } from '@/types/echolingo';

const DIFFICULTIES = ['全部', 'Beginner', 'Intermediate', 'Advanced'] as const;
type DifficultyFilter = (typeof DIFFICULTIES)[number];

function difficultyStars(level: string) {
  if (level === 'Advanced') return 5;
  if (level === 'Intermediate') return 4;
  if (level === 'Beginner') return 2;
  return 3;
}

function DifficultyStars({
  level,
  onDark = false,
  showLabel = false,
}: {
  level: string;
  onDark?: boolean;
  showLabel?: boolean;
}) {
  const { colors } = useThemeColors();
  const stars = difficultyStars(level);
  const activeColor = ACCENT;
  const inactiveColor = onDark ? 'rgba(255,255,255,0.18)' : colors.divider;

  return (
    <View style={styles.starsRow}>
      <View style={styles.starsIconsRow}>
        {Array.from({ length: 5 }).map((_, index) => (
          <Ionicons
            key={`${level}-${index}`}
            name={index < stars ? 'star' : 'star-outline'}
            size={12}
            color={index < stars ? activeColor : inactiveColor}
          />
        ))}
      </View>
      {showLabel ? (
        <AppText
          style={{
            fontSize: FONT_MICRO,
            fontWeight: '600',
            color: onDark ? TEXT_ON_DARK_DIM : colors.textSecondary,
          }}
        >
          {level}
        </AppText>
      ) : null}
    </View>
  );
}

function PhoneEpisodeCard({
  episode,
  onOpenEpisode,
  onPrefetchEpisode,
}: {
  episode: EpisodeStub;
  onOpenEpisode: (episodeId: string) => void;
  onPrefetchEpisode: (episodeId: string) => void;
}) {
  const { colors } = useThemeColors();

  return (
    <View style={styles.episodeCardWrap}>
      <SurfaceCard padded={false} style={styles.episodeCard}>
        <Pressable
          onPress={() => onOpenEpisode(episode.id)}
          onPressIn={() => onPrefetchEpisode(episode.id)}
        >
          <Image
            source={episode.cover}
            style={styles.episodeCover}
            contentFit="cover"
            cachePolicy="disk"
            transition={0}
          />

          <View style={styles.episodeBody}>
            <View style={styles.episodeHeaderRow}>
              <View style={styles.episodeTitleWrap}>
                <AppText
                  numberOfLines={2}
                  style={[styles.episodeTitle, { color: colors.textPrimary }]}
                >
                  {episode.title}
                </AppText>
                <View style={styles.episodeMetaRow}>
                  <AppText style={[styles.episodeMeta, { color: colors.textSecondary }]}>
                    {episode.display_issue_number ? `第 ${String(episode.display_issue_number).padStart(2, '0')} 期` : '单集'} · {episode.duration}
                  </AppText>
                  <DifficultyStars level={episode.difficulty} />
                </View>
              </View>
              <View style={[styles.episodeArrowBadge, { backgroundColor: colors.pressableBackground, borderColor: colors.border }]}>
                <Ionicons name="arrow-forward" size={15} color={colors.textSecondary} />
              </View>
            </View>

            {(episode.tags ?? []).length > 0 ? (
              <View style={styles.episodeTagRow}>
                {episode.tags!.slice(0, 3).map((tag) => (
                  <View
                    key={tag}
                    style={[styles.episodeTag, { backgroundColor: colors.isDark ? 'rgba(245,158,11,0.18)' : COLOR_AMBER_BG }]}
                  >
                    <AppText style={[styles.episodeTagText, { color: colors.isDark ? '#FBBF24' : colors.textPrimary }]}>
                      {tag}
                    </AppText>
                  </View>
                ))}
              </View>
            ) : null}

            <AppText style={[styles.episodeHint, { color: colors.textMuted }]}>点击进入本集精听</AppText>
          </View>
        </Pressable>
      </SurfaceCard>
    </View>
  );
}

function PhoneLibraryHeader({
  recommended,
  recommendedStatCards,
  loading,
  error,
  dashboardError,
  query,
  diffFilter,
  filteredCount,
  totalCount,
  activeFilterCount,
  onOpenFilters,
  onResetFilters,
  onOpenMyTab,
}: {
  recommended: EpisodeStub | null;
  recommendedStatCards: Array<{ label: string; value: string }>;
  loading: boolean;
  error: string | null;
  dashboardError: string | null;
  query: string;
  diffFilter: DifficultyFilter;
  filteredCount: number;
  totalCount: number;
  activeFilterCount: number;
  onOpenFilters: () => void;
  onResetFilters: () => void;
  onOpenMyTab: () => void;
}) {
  const { colors } = useThemeColors();

  return (
    <>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <AppText style={[styles.headerTitle, { color: colors.textPrimary }]}>精听库</AppText>
          </View>
          <View style={styles.headerAction}>
            <TopRightAvatarButton onPress={onOpenMyTab} />
          </View>
        </View>
      </View>

      {recommended ? (
        <View style={styles.heroCard}>
          <View style={styles.heroTop}>
            <AppText style={styles.heroEyebrow}>
              每日推荐
            </AppText>

            <View style={styles.heroCopy}>
              <AppText style={styles.heroTitle}>
                {recommended.title}
              </AppText>
              <AppText style={styles.heroMeta}>
                {recommended.display_issue_number ? `第 ${String(recommended.display_issue_number).padStart(2, '0')} 期` : '精选单集'} ·{' '}
                {recommended.duration}
                {(recommended.tags ?? []).length > 0 ? ` · ${(recommended.tags ?? []).slice(0, 2).join(' / ')}` : ''}
              </AppText>
              <DifficultyStars level={recommended.difficulty} onDark showLabel />
            </View>

            <View style={styles.heroStatsRow}>
              {recommendedStatCards.map((stat) => (
                <View
                  key={stat.label}
                  style={styles.heroStatCard}
                >
                  <AppText style={styles.heroStatLabel}>{stat.label}</AppText>
                  <AppText style={styles.heroStatValue}>{stat.value}</AppText>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.heroActionsRow}>
            <Pressable
              onPress={onOpenFilters}
              style={({ pressed }) => [
                styles.heroSecondaryButton,
                pressed && styles.pressed,
              ]}
            >
              <AppText style={styles.heroSecondaryButtonText}>
                {activeFilterCount > 0 ? `筛选 · ${activeFilterCount}` : '筛选'}
              </AppText>
            </Pressable>

            <Pressable
              onPress={() => router.push({ pathname: '/episode/[id]', params: { id: recommended.id } })}
              onPressIn={() => prefetchEpisodeDetail(recommended.id)}
              style={({ pressed }) => [
                styles.heroPrimaryButton,
                pressed && styles.pressed,
              ]}
            >
              <AppText style={styles.heroPrimaryButtonText} disableAndroidDarkTextOverride>
                进入学习
              </AppText>
            </Pressable>
          </View>
        </View>
      ) : !loading && !error ? (
        <View style={styles.horizontalPad}>
          <SurfaceCard>
            <AppText style={{ fontSize: FONT_CALLOUT, color: colors.textSecondary }}>今日暂无可推荐单集</AppText>
          </SurfaceCard>
        </View>
      ) : null}

      {!loading && !error && dashboardError ? (
        <View style={styles.horizontalPad}>
          <SurfaceCard>
            <AppText style={{ fontSize: FONT_CAPTION, color: colors.textSecondary }}>
              学习记录暂时无法更新，推荐与列表内容仍可正常使用。
            </AppText>
          </SurfaceCard>
        </View>
      ) : null}

      <SectionHeader title="单集列表" />

      {(query.trim().length > 0 || diffFilter !== '全部') ? (
        <View style={styles.activeFiltersRow}>
          <AppText style={[styles.activeFiltersText, { color: colors.textSecondary }]}>
            {query.trim().length > 0 ? `“${query.trim()}” · ` : ''}
            {diffFilter !== '全部' ? `${diffFilter} · ` : ''}
            已加载 {filteredCount} / 共 {totalCount} 条
          </AppText>
          <Pressable onPress={onResetFilters}>
            <AppText style={[styles.activeFiltersReset, { color: colors.textSecondary }]}>重置</AppText>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

export function LibraryScreen() {
  const { colors, theme } = useThemeColors();
  const insets = useSafeAreaInsets();
  const floatingInsets = useFloatingTabInsets();
  const { shouldUseTabletLayout } = useDeviceClass();
  const {
    episodes,
    loading,
    refreshing,
    loadingMore,
    error,
    totalEpisodes,
    hasMore,
    loadMore,
    refresh,
  } = useLibraryData({ consumer: 'library' });
  const [query, setQuery] = useState('');
  const [diffFilter, setDiffFilter] = useState<DifficultyFilter>('全部');
  const [filterOpen, setFilterOpen] = useState(false);
  const {
    loading: dashboardLoading,
    error: dashboardError,
    snapshot: dashboard,
  } = useLibraryDashboard(episodes, totalEpisodes);

  const filtered = useMemo(() => {
    const kw = query.trim().toLowerCase();
    return episodes.filter((ep) => {
      if (diffFilter !== '全部' && ep.difficulty !== diffFilter) return false;
      if (!kw) return true;
      return (
        ep.title.toLowerCase().includes(kw) ||
        ep.difficulty.toLowerCase().includes(kw) ||
        (ep.tags ?? []).some((tag) => tag.toLowerCase().includes(kw))
      );
    });
  }, [episodes, query, diffFilter]);

  const sortedEpisodes = useMemo(
    () => sortEpisodes(filtered, 'latest'),
    [filtered],
  );

  const activeFilterCount = Number(query.trim().length > 0) + Number(diffFilter !== '全部');
  const recommended = dashboard.recommendedEpisode;
  const recommendedStatCards = useMemo(
    () => [
      { label: '全部单集', value: String(totalEpisodes || episodes.length) },
      {
        label: '已学完',
        value: dashboardLoading ? '读取中' : dashboardError ? '暂不可用' : String(dashboard.overview.completedCount),
      },
      {
        label: '当前进度',
        value: dashboardLoading ? '读取中' : dashboardError ? '暂不可用' : String(dashboard.overview.inProgressCount),
      },
    ],
    [dashboard.overview.completedCount, dashboard.overview.inProgressCount, dashboardError, dashboardLoading, episodes.length, totalEpisodes],
  );

  const resetFilters = useCallback(() => {
    setQuery('');
    setDiffFilter('全部');
  }, []);

  const handleOpenMyTab = useCallback(() => {
    router.navigate('/my');
  }, []);

  const handleOpenEpisode = useCallback((episodeId: string) => {
    router.push({ pathname: '/episode/[id]', params: { id: episodeId } });
  }, []);

  const handleResumeEpisode = useCallback((episodeId: string, sentenceId?: number | null) => {
    router.push({
      pathname: '/episode/[id]',
      params: sentenceId ? { id: episodeId, sentence: String(sentenceId) } : { id: episodeId },
    });
  }, []);

  const handleLoadMore = useCallback(() => {
    if (loadingMore || !hasMore) {
      return;
    }
    void loadMore();
  }, [hasMore, loadMore, loadingMore]);

  const renderEpisodeItem = useCallback(
    ({ item }: { item: EpisodeStub }) => (
      <PhoneEpisodeCard
        episode={item}
        onOpenEpisode={handleOpenEpisode}
        onPrefetchEpisode={prefetchEpisodeDetail}
      />
    ),
    [handleOpenEpisode],
  );

  const listHeader = useMemo(
    () => (
      <PhoneLibraryHeader
        recommended={recommended}
        recommendedStatCards={recommendedStatCards}
        loading={loading}
        error={error}
        dashboardError={dashboardError}
        query={query}
        diffFilter={diffFilter}
        filteredCount={sortedEpisodes.length}
        totalCount={totalEpisodes || episodes.length}
        activeFilterCount={activeFilterCount}
        onOpenFilters={() => setFilterOpen(true)}
        onResetFilters={resetFilters}
        onOpenMyTab={handleOpenMyTab}
      />
    ),
    [
      activeFilterCount,
      dashboardError,
      diffFilter,
      error,
      handleOpenMyTab,
      loading,
      query,
      recommended,
      recommendedStatCards,
      resetFilters,
      sortedEpisodes.length,
    ],
  );

  const listEmpty = useMemo(() => {
    if (loading && sortedEpisodes.length === 0) {
      return (
        <View style={styles.horizontalPad}>
          <SurfaceCard>
            <View style={styles.feedbackCardContent}>
              <ActivityIndicator color={colors.textSecondary} />
              <AppText style={{ fontSize: FONT_CALLOUT, color: colors.textSecondary }}>正在加载内容…</AppText>
            </View>
          </SurfaceCard>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.horizontalPad}>
          <SurfaceCard>
            <AppText style={{ fontSize: FONT_CALLOUT, color: COLOR_RED }}>{error}</AppText>
          </SurfaceCard>
        </View>
      );
    }

    return (
      <View style={styles.horizontalPad}>
        <SurfaceCard>
          <AppText style={{ fontSize: FONT_CALLOUT, color: colors.textSecondary }}>没有匹配的单集</AppText>
        </SurfaceCard>
      </View>
    );
  }, [colors.textSecondary, error, loading, sortedEpisodes.length]);

  const listFooter = useMemo(() => (
    <View style={styles.listFooterWrap}>
      {loadingMore ? (
        <View style={styles.listFooterLoading}>
          <ActivityIndicator color={colors.textSecondary} />
          <AppText style={[styles.listFooterText, { color: colors.textSecondary }]}>正在加载更多单集…</AppText>
        </View>
      ) : sortedEpisodes.length > 0 ? (
        <AppText style={[styles.listFooterText, { color: colors.textSecondary }]}>
          已加载 {episodes.length}/{totalEpisodes || episodes.length} 条
        </AppText>
      ) : null}
      <View style={{ height: floatingInsets.bottom + 24 }} />
    </View>
  ), [colors.textSecondary, episodes.length, floatingInsets.bottom, loadingMore, sortedEpisodes.length, totalEpisodes]);

  const screen = shouldUseTabletLayout ? (
    <LibraryScreenTablet
      episodes={episodes}
      filteredEpisodes={filtered}
      recommended={recommended}
      totalEpisodes={totalEpisodes || episodes.length}
      dashboardOverview={dashboard.overview}
      dashboardLoading={dashboardLoading}
      dashboardError={dashboardError}
      recommendationList={dashboard.recommendationList}
      loading={loading}
      error={error}
      query={query}
      diffFilter={diffFilter}
      activeFilterCount={activeFilterCount}
      hasMore={hasMore}
      loadingMore={loadingMore}
      refreshing={refreshing}
      loadMore={loadMore}
      refresh={refresh}
      onOpenFilters={() => setFilterOpen(true)}
      onResetFilters={resetFilters}
      onOpenMyTab={handleOpenMyTab}
      onOpenEpisode={handleOpenEpisode}
      onResumeEpisode={handleResumeEpisode}
      onPrefetchEpisode={prefetchEpisodeDetail}
    />
  ) : (
    <SafeAreaView edges={['left', 'right']} style={[styles.safeArea, { backgroundColor: theme.pageBackground }]}>
      <FlatList
        data={sortedEpisodes}
        renderItem={renderEpisodeItem}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        ListFooterComponent={listFooter}
        style={{ backgroundColor: theme.pageBackground }}
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: 0,
        }}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={7}
        updateCellsBatchingPeriod={50}
        removeClippedSubviews={Platform.OS === 'android'}
        refreshing={refreshing}
        onRefresh={() => {
          void refresh();
        }}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.6}
      />
    </SafeAreaView>
  );

  return (
    <>
      {screen}

      <Modal
        transparent
        animationType="fade"
        visible={filterOpen}
        onRequestClose={() => setFilterOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setFilterOpen(false)} />

          <View style={[styles.sheet, { backgroundColor: colors.pageBackground }]}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.divider }]} />

            <View style={styles.sheetHeader}>
              <AppText style={[styles.sheetTitle, { color: colors.textPrimary }]}>
                搜索与筛选
              </AppText>
              <Pressable onPress={resetFilters}>
                <AppText style={[styles.sheetClear, { color: colors.textSecondary }]}>清除</AppText>
              </Pressable>
            </View>

            <SearchField
              value={query}
              onChangeText={setQuery}
              placeholder="搜索标题、难度、标签"
            />

            <View style={styles.sheetSection}>
              <AppText style={[styles.sheetSectionTitle, { color: colors.textSecondary }]}>
                难度
              </AppText>
              <View style={[styles.sheetFilterCard, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
                <View style={styles.sheetChipsWrap}>
                  {DIFFICULTIES.map((item) => (
                    <SegmentButton key={item} label={item} active={diffFilter === item} onPress={() => setDiffFilter(item)} />
                  ))}
                </View>
              </View>
            </View>

            <View style={styles.sheetActions}>
              <View style={styles.sheetActionRow}>
                <ActionButton label="收起面板" variant="secondary" onPress={() => setFilterOpen(false)} />
                <ActionButton
                  label={`查看已加载 ${sortedEpisodes.length} / 共 ${totalEpisodes || episodes.length} 条`}
                  variant="dark"
                  onPress={() => setFilterOpen(false)}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    paddingHorizontal: SPACING_PAGE_H,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerCopy: {
    flex: 1,
  },
  headerTitle: {
    fontSize: FONT_LARGE_TITLE,
    lineHeight: 41,
    fontWeight: '700',
    letterSpacing: -0.8,
  },
  headerAction: {
    alignSelf: 'flex-start',
  },
  heroCard: {
    marginHorizontal: SPACING_PAGE_H,
    borderRadius: RADIUS_HERO,
    overflow: 'hidden',
    backgroundColor: BG_HERO,
  },
  heroTop: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 18,
  },
  heroEyebrow: {
    fontSize: FONT_MICRO,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: TEXT_ON_DARK_DIM,
    marginBottom: 10,
  },
  heroCopy: {
    gap: 8,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.7,
    lineHeight: 31,
    color: TEXT_ON_DARK,
  },
  heroMeta: {
    fontSize: FONT_CAPTION,
    lineHeight: 18,
    color: TEXT_ON_DARK_DIM,
  },
  heroStatsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 18,
  },
  heroStatCard: {
    flex: 1,
    borderRadius: RADIUS_PILL,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: BG_HERO_PILL,
    borderWidth: 0.5,
    borderColor: SEPARATOR_DARK,
  },
  heroStatLabel: {
    fontSize: FONT_MICRO,
    color: TEXT_ON_DARK_DIM,
    marginBottom: 4,
  },
  heroStatValue: {
    fontSize: 21,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: TEXT_ON_DARK,
  },
  heroActionsRow: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    flexDirection: 'row',
    gap: 10,
    backgroundColor: BG_HERO,
  },
  heroSecondaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: RADIUS_BTN,
    backgroundColor: BG_HERO_BTN_SEC,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroSecondaryButtonText: {
    fontSize: FONT_BODY,
    fontWeight: '600',
    letterSpacing: -0.2,
    color: TEXT_ON_DARK,
  },
  heroPrimaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: RADIUS_BTN,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPrimaryButtonText: {
    fontSize: FONT_BODY,
    fontWeight: '600',
    letterSpacing: -0.2,
    color: '#111827',
  },
  pressed: {
    opacity: 0.76,
  },
  horizontalPad: {
    paddingHorizontal: SPACING_PAGE_H,
  },
  activeFiltersRow: {
    paddingHorizontal: SPACING_PAGE_H,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  activeFiltersText: {
    fontSize: FONT_CAPTION,
  },
  activeFiltersReset: {
    fontSize: FONT_CAPTION,
    fontWeight: '600',
  },
  episodeCardWrap: {
    paddingHorizontal: SPACING_PAGE_H,
    paddingBottom: 16,
  },
  episodeCard: {
    borderWidth: 0.5,
    overflow: 'hidden',
  },
  episodeCover: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: 'rgba(148,163,184,0.18)',
  },
  episodeBody: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    gap: 10,
  },
  episodeHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start',
  },
  episodeTitleWrap: {
    flex: 1,
    gap: 6,
  },
  episodeTitle: {
    fontSize: FONT_TITLE,
    fontWeight: '700',
    lineHeight: 25,
  },
  episodeMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  episodeMeta: {
    flex: 1,
    fontSize: FONT_CAPTION,
  },
  episodeArrowBadge: {
    width: 30,
    height: 30,
    borderRadius: 999,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  episodeTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  episodeTag: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: COLOR_AMBER_BG,
  },
  episodeTagText: {
    fontSize: FONT_MICRO,
    fontWeight: '600',
  },
  episodeHint: {
    fontSize: FONT_CAPTION,
  },
  starsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  starsIconsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  feedbackCardContent: {
    alignItems: 'center',
    paddingVertical: 18,
    gap: 10,
  },
  listFooterWrap: {
    paddingTop: 4,
  },
  listFooterLoading: {
    alignItems: 'center',
    gap: 10,
    paddingTop: 8,
  },
  listFooterText: {
    textAlign: 'center',
    fontSize: FONT_CAPTION,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: BG_OVERLAY,
  },
  modalBackdrop: {
    flex: 1,
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 10,
    paddingBottom: 24,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 999,
    marginBottom: 14,
  },
  sheetHeader: {
    paddingHorizontal: SPACING_PAGE_H,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sheetTitle: {
    fontSize: FONT_TITLE,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  sheetClear: {
    fontSize: FONT_CAPTION,
    fontWeight: '600',
  },
  sheetSection: {
    paddingHorizontal: SPACING_PAGE_H,
    paddingBottom: 10,
  },
  sheetSectionTitle: {
    fontSize: FONT_CAPTION,
    fontWeight: '600',
    marginBottom: 10,
  },
  sheetFilterCard: {
    borderRadius: RADIUS_CARD,
    padding: 12,
    gap: 10,
    borderWidth: 0.5,
  },
  sheetChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  sheetActions: {
    paddingHorizontal: SPACING_PAGE_H,
    paddingTop: 8,
  },
  sheetActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
});
