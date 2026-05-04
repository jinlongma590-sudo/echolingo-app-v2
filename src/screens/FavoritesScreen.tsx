import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { AppText } from '@/components/AppText';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { ChromeIconButton, SurfaceCard } from '@/components/ui/ApplePrimitives';
import { safeBack } from '@/navigation/safeBack';
import {
  fetchFavoriteDetails,
  fetchUserFavorites,
  removeFavoriteByTarget,
  type FavoriteDetailsBundle,
  type FavoriteItem,
  type FavoriteType,
} from '@/services/api/favorites';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import { useAppTheme } from '@/theme/AppThemeProvider';
import {
  BG_CARD,
  BG_CARD_SOFT,
  BORDER_SOFT,
  FONT_BODY,
  FONT_CALLOUT,
  FONT_CAPTION,
  FONT_MICRO,
  SPACING_PAGE_H,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
} from '@/theme/tokens';

type FavoriteFilter = 'all' | FavoriteType;

const EMPTY_DETAILS: FavoriteDetailsBundle = {
  episodes: new Map(),
  sentences: new Map(),
  phrases: new Map(),
};

function extractErrorText(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error ?? '');
}

function isExpiredSessionError(error: unknown) {
  const message = extractErrorText(error).toLowerCase();
  return (
    message.includes('jwt expired') ||
    message.includes('pgrst303') ||
    message.includes('401') ||
    message.includes('auth session missing') ||
    message.includes('invalid jwt') ||
    message.includes('unauthorized')
  );
}

function openEpisodeTarget(episodeId: string, sentenceId?: number | null) {
  router.push({
    pathname: '/episode/[id]',
    params: sentenceId ? { id: episodeId, sentence: String(sentenceId) } : { id: episodeId },
  });
}

function formatDateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚收藏';

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}.${month}.${day}`;
}

function formatTimecode(seconds?: number | null) {
  if (!Number.isFinite(seconds)) return null;
  const safe = Math.max(0, Math.floor(Number(seconds)));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${`${secs}`.padStart(2, '0')}`;
}

function buildSentenceTimeRange(start?: number | null, end?: number | null) {
  const left = formatTimecode(start);
  const right = formatTimecode(end);
  if (!left || !right) return null;
  return `${left} - ${right}`;
}

function SummaryMetric({
  label,
  value,
  note,
}: {
  label: string;
  value: string | number;
  note: string;
}) {
  const { theme } = useAppTheme();

  return (
    <View
      style={[
        styles.metricCard,
        {
          backgroundColor: theme.secondaryCardBackground,
          borderColor: theme.border,
        },
      ]}
    >
      <AppText style={styles.metricLabel}>{label}</AppText>
      <AppText style={styles.metricValue}>{value}</AppText>
      <AppText style={[styles.metricNote, { color: theme.textSecondary }]}>{note}</AppText>
    </View>
  );
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterChip,
        {
          backgroundColor: active ? theme.primaryBlue : theme.secondaryCardBackground,
          borderColor: active ? theme.primaryBlue : theme.border,
        },
        pressed && styles.pressed,
      ]}
    >
      <AppText style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</AppText>
    </Pressable>
  );
}

function TypePill({
  label,
  tone,
}: {
  label: string;
  tone: 'episode' | 'sentence' | 'phrase';
}) {
  return (
    <View
      style={[
        styles.typePill,
        tone === 'episode' ? styles.typePillEpisode : null,
        tone === 'sentence' ? styles.typePillSentence : null,
        tone === 'phrase' ? styles.typePillPhrase : null,
      ]}
    >
      <AppText
        style={[
          styles.typePillText,
          tone === 'episode' ? styles.typePillTextEpisode : null,
          tone === 'sentence' ? styles.typePillTextSentence : null,
          tone === 'phrase' ? styles.typePillTextPhrase : null,
        ]}
      >
        {label}
      </AppText>
    </View>
  );
}

function FavoriteActionButton({
  label,
  icon,
  variant = 'primary',
  disabled = false,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        variant === 'primary'
          ? [
              styles.actionButtonPrimary,
              {
                backgroundColor: theme.colorScheme === 'dark' ? theme.primaryBlue : theme.textPrimary,
                borderColor: theme.colorScheme === 'dark' ? theme.primaryBlue : theme.textPrimary,
              },
            ]
          : [
              styles.actionButtonSecondary,
              {
                backgroundColor: theme.secondaryCardBackground,
                borderColor: theme.border,
              },
            ],
        disabled && styles.actionButtonDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={15} color={variant === 'primary' ? '#FFFFFF' : theme.textSecondary} />
      <AppText
        style={[
          styles.actionButtonText,
          variant === 'primary'
            ? styles.actionButtonTextPrimary
            : styles.actionButtonTextSecondary,
        ]}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

function StateCard({
  icon,
  title,
  subtitle,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  const { theme } = useAppTheme();

  return (
    <SurfaceCard style={styles.stateCard}>
      <View
        style={[
          styles.stateIconWrap,
          {
            backgroundColor: theme.fillTertiary,
            borderColor: theme.border,
          },
        ]}
      >
        <Ionicons name={icon} size={18} color={theme.textSecondary} />
      </View>
      <AppText style={styles.stateTitle}>{title}</AppText>
      <AppText style={styles.stateSubtitle}>{subtitle}</AppText>

      {primaryLabel || secondaryLabel ? (
        <View style={styles.stateActions}>
          {primaryLabel && onPrimary ? (
            <Pressable
              onPress={onPrimary}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: theme.colorScheme === 'dark' ? theme.primaryBlue : theme.textPrimary,
                },
                pressed && styles.pressed,
              ]}
            >
              <AppText style={styles.primaryButtonText}>{primaryLabel}</AppText>
            </Pressable>
          ) : null}

          {secondaryLabel && onSecondary ? (
            <Pressable
              onPress={onSecondary}
              style={({ pressed }) => [
                styles.secondaryButton,
                {
                  backgroundColor: theme.secondaryCardBackground,
                  borderColor: theme.border,
                },
                pressed && styles.pressed,
              ]}
            >
              <AppText style={styles.secondaryButtonText}>{secondaryLabel}</AppText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </SurfaceCard>
  );
}

export function FavoritesScreen() {
  const session = useAppSession();
  const { theme } = useAppTheme();
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [details, setDetails] = useState<FavoriteDetailsBundle>(EMPTY_DETAILS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FavoriteFilter>('all');
  const [removingId, setRemovingId] = useState<number | null>(null);

  const isLoggedIn = session.status === 'authenticated';
  const sessionExpired = session.authStateReason === 'expired';

  const load = useCallback(async () => {
    const currentSession = session.session;
    if (!currentSession) return;

    setLoading(true);
    setLoadError(false);

    try {
      const raw = await fetchUserFavorites(currentSession);
      const nextDetails = await fetchFavoriteDetails(currentSession, raw);
      setFavorites(raw);
      setDetails(nextDetails);
    } catch (error) {
      if (isExpiredSessionError(error)) {
        setFavorites([]);
        setDetails(EMPTY_DETAILS);
        await session.invalidateSession();
        return;
      }
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (!isLoggedIn) {
      setFavorites([]);
      setDetails(EMPTY_DETAILS);
      setLoading(false);
      setRemovingId(null);
      if (!sessionExpired) {
        setLoadError(false);
      }
      return;
    }

    void load();
  }, [isLoggedIn, load, sessionExpired]);

  const counts = useMemo(
    () => ({
      all: favorites.length,
      episode: favorites.filter((item) => item.target_type === 'episode').length,
      sentence: favorites.filter((item) => item.target_type === 'sentence').length,
      phrase: favorites.filter((item) => item.target_type === 'phrase').length,
    }),
    [favorites],
  );

  const filteredFavorites = useMemo(() => {
    if (activeFilter === 'all') return favorites;
    return favorites.filter((item) => item.target_type === activeFilter);
  }, [activeFilter, favorites]);

  const resolveEmptyTitle = useMemo(() => {
    switch (activeFilter) {
      case 'episode':
        return '暂无单集收藏';
      case 'sentence':
        return '暂无句子收藏';
      case 'phrase':
        return '暂无词卡收藏';
      default:
        return '暂无收藏';
    }
  }, [activeFilter]);

  const resolveEmptySubtitle = useMemo(() => {
    switch (activeFilter) {
      case 'episode':
        return '收藏单集后，会在这里继续接住你的学习进度。';
      case 'sentence':
        return '在精听页收藏句子后，会集中显示在这里。';
      case 'phrase':
        return '收藏词卡后，会在这里保留来源与回看入口。';
      default:
        return '在精听、句子或词卡中点击收藏后，会显示在这里。';
    }
  }, [activeFilter]);

  const jumpToFavorite = useCallback(
    (item: FavoriteItem) => {
      if (item.target_type === 'episode') {
        openEpisodeTarget(item.target_id);
        return;
      }

      if (item.target_type === 'sentence') {
        const detail = details.sentences.get(item.target_id);
        const sentence = detail?.sentence ?? null;
        const episodeId = detail?.episode?.id ?? sentence?.episode_id ?? null;
        if (!episodeId || !sentence) return;
        openEpisodeTarget(episodeId, sentence.id);
        return;
      }

      const detail = details.phrases.get(item.target_id);
      const sentence = detail?.sentence ?? null;
      const phrase = detail?.phrase ?? null;
      const episodeId = detail?.episode?.id ?? sentence?.episode_id ?? phrase?.episode_id ?? null;

      if (!episodeId) return;

      openEpisodeTarget(episodeId, sentence?.id ?? phrase?.sentence_id ?? null);
    },
    [details],
  );

  const handleRemove = useCallback(
    async (item: FavoriteItem) => {
      const currentSession = session.session;
      if (!currentSession) return;

      setRemovingId(item.id);
      try {
        await removeFavoriteByTarget(currentSession, item.target_type, item.target_id);
        setFavorites((prev) => prev.filter((favorite) => favorite.id !== item.id));
      } catch (error) {
        if (isExpiredSessionError(error)) {
          setFavorites([]);
          setDetails(EMPTY_DETAILS);
          await session.invalidateSession();
          return;
        }

        Alert.alert('取消收藏失败', '请稍后再试。');
      } finally {
        setRemovingId(null);
      }
    },
    [session],
  );

  const confirmRemove = useCallback(
    (item: FavoriteItem) => {
      Alert.alert('取消收藏？', '取消后将从收藏中心移除。', [
        { text: '保留', style: 'cancel' },
        {
          text: '取消收藏',
          style: 'destructive',
          onPress: () => {
            void handleRemove(item);
          },
        },
      ]);
    },
    [handleRemove],
  );

  const header = (
    <View style={styles.header}>
      <View style={styles.backRow}>
        <ChromeIconButton icon="chevron-back" onPress={() => safeBack('/my')} accessibilityLabel="返回我的" />
      </View>
    </View>
  );

  if (!isLoggedIn && !sessionExpired) {
    return (
      <AppScreenShell
        header={header}
        contentContainerStyle={styles.pageContent}
        showsVerticalScrollIndicator={false}
      >
        <StateCard
          icon="bookmark-outline"
          title="登录后查看收藏"
          subtitle="登录后可以集中管理单集、句子和词卡收藏。"
          primaryLabel="去登录"
          onPrimary={() => router.push('/auth/sign-in')}
        />
      </AppScreenShell>
    );
  }

  if (sessionExpired) {
    return (
      <AppScreenShell
        header={header}
        contentContainerStyle={styles.pageContent}
        showsVerticalScrollIndicator={false}
      >
        <StateCard
          icon="shield-checkmark-outline"
          title="登录状态已失效"
          subtitle="请重新登录后查看收藏。"
          primaryLabel="去登录"
          onPrimary={() => router.push('/auth/sign-in')}
          secondaryLabel="返回我的"
          onSecondary={() => router.back()}
        />
      </AppScreenShell>
    );
  }

  if (loadError && !loading && favorites.length === 0) {
    return (
      <AppScreenShell
        header={header}
        contentContainerStyle={styles.pageContent}
        showsVerticalScrollIndicator={false}
      >
        <StateCard
          icon="cloud-offline-outline"
          title="收藏加载失败"
          subtitle="请稍后重试。"
          primaryLabel="重新加载"
          onPrimary={() => {
            void load();
          }}
        />
      </AppScreenShell>
    );
  }

  const renderEpisodeCard = (item: FavoriteItem) => {
    const episode = details.episodes.get(item.target_id) ?? null;
    const episodeMeta = [episode?.difficulty, episode?.duration].filter(Boolean).join(' · ');

    return (
      <SurfaceCard key={item.id} style={styles.favoriteCard}>
        <View style={styles.cardTopRow}>
          <TypePill label="单集" tone="episode" />
          <AppText style={styles.cardDate}>收藏于 {formatDateLabel(item.created_at)}</AppText>
        </View>

        <AppText style={styles.cardTitle}>{episode?.title ?? `单集 ${item.target_id}`}</AppText>

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Ionicons name="albums-outline" size={14} color={TEXT_SECONDARY} />
            <AppText style={styles.metaText}>{episodeMeta || '内容信息暂未同步'}</AppText>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="bookmark-outline" size={14} color={TEXT_SECONDARY} />
            <AppText style={styles.metaText}>可继续回到单集学习页</AppText>
          </View>
        </View>

        <View style={styles.cardActions}>
          <FavoriteActionButton
            label="回到单集"
            icon="play-circle-outline"
            onPress={() => jumpToFavorite(item)}
          />
          <FavoriteActionButton
            label={removingId === item.id ? '取消中…' : '取消收藏'}
            icon="trash-outline"
            variant="secondary"
            disabled={removingId === item.id}
            onPress={() => confirmRemove(item)}
          />
        </View>
      </SurfaceCard>
    );
  };

  const renderSentenceCard = (item: FavoriteItem) => {
    const detail = details.sentences.get(item.target_id);
    const sentence = detail?.sentence ?? null;
    const episode = detail?.episode ?? null;
    const timeRange = buildSentenceTimeRange(sentence?.start, sentence?.end);
    const canOpen = Boolean(sentence && (episode?.id ?? sentence.episode_id));

    return (
      <SurfaceCard key={item.id} style={styles.favoriteCard}>
        <View style={styles.cardTopRow}>
          <TypePill label="句子" tone="sentence" />
          <AppText style={styles.cardDate}>收藏于 {formatDateLabel(item.created_at)}</AppText>
        </View>

        <AppText style={styles.quoteEnglish}>{sentence?.en ?? `句子 #${item.target_id}`}</AppText>
        {sentence?.zh ? <AppText style={styles.quoteChinese}>{sentence.zh}</AppText> : null}

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Ionicons name="headset-outline" size={14} color={TEXT_SECONDARY} />
            <AppText style={styles.metaText}>{episode?.title ?? '来源单集暂未同步'}</AppText>
          </View>
          {timeRange ? (
            <View style={styles.metaItem}>
              <Ionicons name="time-outline" size={14} color={TEXT_SECONDARY} />
              <AppText style={styles.metaText}>{timeRange}</AppText>
            </View>
          ) : null}
        </View>

        <View style={styles.cardActions}>
          <FavoriteActionButton
            label="回到原句"
            icon="return-up-forward-outline"
            disabled={!canOpen}
            onPress={() => jumpToFavorite(item)}
          />
          <FavoriteActionButton
            label={removingId === item.id ? '取消中…' : '取消收藏'}
            icon="trash-outline"
            variant="secondary"
            disabled={removingId === item.id}
            onPress={() => confirmRemove(item)}
          />
        </View>
      </SurfaceCard>
    );
  };

  const renderPhraseCard = (item: FavoriteItem) => {
    const detail = details.phrases.get(item.target_id);
    const phrase = detail?.phrase ?? null;
    const sentence = detail?.sentence ?? null;
    const episode = detail?.episode ?? null;
    const canOpen = Boolean(episode?.id ?? sentence?.episode_id ?? phrase?.episode_id);

    return (
      <SurfaceCard key={item.id} style={styles.favoriteCard}>
        <View style={styles.cardTopRow}>
          <View style={styles.cardPillRow}>
            <TypePill label="词卡" tone="phrase" />
            {phrase?.tag ? <TypePill label={phrase.tag} tone="episode" /> : null}
          </View>
          <AppText style={styles.cardDate}>收藏于 {formatDateLabel(item.created_at)}</AppText>
        </View>

        <AppText style={styles.cardTitle}>{phrase?.phrase ?? `词卡 ${item.target_id}`}</AppText>
        {phrase?.zh ? <AppText style={styles.quoteChinese}>{phrase.zh}</AppText> : null}
        {sentence?.en ? <AppText style={styles.sourceSnippet}>来源句：{sentence.en}</AppText> : null}

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Ionicons name="book-outline" size={14} color={TEXT_SECONDARY} />
            <AppText style={styles.metaText}>{episode?.title ?? '来源单集暂未同步'}</AppText>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="sparkles-outline" size={14} color={TEXT_SECONDARY} />
            <AppText style={styles.metaText}>保留词卡与来源入口</AppText>
          </View>
        </View>

        <View style={styles.cardActions}>
          <FavoriteActionButton
            label="回到来源"
            icon="arrow-forward-circle-outline"
            disabled={!canOpen}
            onPress={() => jumpToFavorite(item)}
          />
          <FavoriteActionButton
            label={removingId === item.id ? '取消中…' : '取消收藏'}
            icon="trash-outline"
            variant="secondary"
            disabled={removingId === item.id}
            onPress={() => confirmRemove(item)}
          />
        </View>
      </SurfaceCard>
    );
  };

  return (
    <AppScreenShell
      header={header}
      contentContainerStyle={styles.pageContent}
      showsVerticalScrollIndicator={false}
      headerScrollFade
    >
      <SurfaceCard style={styles.heroCard}>
        <View style={styles.heroTopRow}>
          <View style={{ flex: 1, gap: 6 }}>
            <AppText style={styles.heroEyebrow}>收藏中心</AppText>
            <AppText style={styles.heroTitle}>我的收藏</AppText>
            <AppText style={styles.heroSubtitle}>把单集、句子和词卡收藏集中在这里。</AppText>
          </View>
          <View
            style={[
              styles.heroBadge,
              {
                backgroundColor: theme.fillTertiary,
                borderColor: theme.border,
              },
            ]}
          >
            <Ionicons name="bookmark-outline" size={18} color={theme.textPrimary} />
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingOverview}>
            <ActivityIndicator size="small" color={TEXT_SECONDARY} />
            <AppText style={styles.loadingText}>正在整理你的收藏内容…</AppText>
          </View>
        ) : (
          <View style={[styles.metricGrid, { borderTopColor: theme.border }]}>
            <SummaryMetric label="全部" value={counts.all} note="已保存的内容" />
            <SummaryMetric label="单集" value={counts.episode} note="回到单集继续学习" />
            <SummaryMetric label="句子" value={counts.sentence} note="可直接回到原句" />
            <SummaryMetric label="词卡" value={counts.phrase} note="可回到来源内容" />
          </View>
        )}
      </SurfaceCard>

      <View style={[styles.filterSection, { backgroundColor: theme.secondaryCardBackground, borderColor: theme.border }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterScrollContent}
        >
          <FilterChip label="全部" active={activeFilter === 'all'} onPress={() => setActiveFilter('all')} />
          <FilterChip
            label="单集"
            active={activeFilter === 'episode'}
            onPress={() => setActiveFilter('episode')}
          />
          <FilterChip
            label="句子"
            active={activeFilter === 'sentence'}
            onPress={() => setActiveFilter('sentence')}
          />
          <FilterChip
            label="词卡"
            active={activeFilter === 'phrase'}
            onPress={() => setActiveFilter('phrase')}
          />
        </ScrollView>
      </View>

      {!loading && filteredFavorites.length === 0 ? (
        <StateCard
          icon={activeFilter === 'all' ? 'bookmark-outline' : 'albums-outline'}
          title={resolveEmptyTitle}
          subtitle={resolveEmptySubtitle}
        />
      ) : null}

      {!loading
        ? filteredFavorites.map((item) => {
            if (item.target_type === 'episode') return renderEpisodeCard(item);
            if (item.target_type === 'sentence') return renderSentenceCard(item);
            return renderPhraseCard(item);
          })
        : null}
    </AppScreenShell>
  );
}

const styles = StyleSheet.create({
  pageContent: {
    paddingHorizontal: SPACING_PAGE_H,
    paddingBottom: 28,
    gap: 12,
  },
  header: {
    paddingTop: 4,
    paddingBottom: 0,
  },
  backRow: {
    paddingHorizontal: SPACING_PAGE_H,
    paddingTop: 2,
    paddingBottom: 4,
  },
  heroCard: {
    padding: 22,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  heroEyebrow: {
    fontSize: FONT_MICRO,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 1.1,
    color: TEXT_TERTIARY,
  },
  heroTitle: {
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '800',
    letterSpacing: -0.7,
    color: TEXT_PRIMARY,
  },
  heroSubtitle: {
    fontSize: FONT_CALLOUT,
    lineHeight: 20,
    color: TEXT_SECONDARY,
  },
  heroBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
  },
  loadingOverview: {
    minHeight: 106,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingTop: 14,
  },
  loadingText: {
    fontSize: FONT_BODY,
    color: TEXT_SECONDARY,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 0.5,
  },
  metricCard: {
    width: '48%',
    minHeight: 104,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 0.5,
    gap: 6,
  },
  metricLabel: {
    fontSize: FONT_CAPTION,
    lineHeight: 16,
    color: TEXT_SECONDARY,
  },
  metricValue: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: TEXT_PRIMARY,
  },
  metricNote: {
    marginTop: 'auto',
    fontSize: FONT_CAPTION,
    lineHeight: 16,
  },
  filterSection: {
    marginTop: -2,
    marginBottom: 12,
    padding: 4,
    borderRadius: 20,
    backgroundColor: BG_CARD_SOFT,
    borderWidth: 0.5,
    borderColor: BORDER_SOFT,
  },
  filterScrollContent: {
    gap: 10,
  },
  filterChip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 0.5,
  },
  filterChipText: {
    fontSize: FONT_CAPTION,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  favoriteCard: {
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    flex: 1,
  },
  cardDate: {
    fontSize: FONT_CAPTION,
    lineHeight: 16,
    color: TEXT_TERTIARY,
  },
  typePill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  typePillEpisode: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 0.5,
    borderColor: 'rgba(245, 158, 11, 0.18)',
  },
  typePillSentence: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderWidth: 0.5,
    borderColor: 'rgba(59, 130, 246, 0.18)',
  },
  typePillPhrase: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 0.5,
    borderColor: 'rgba(16, 185, 129, 0.18)',
  },
  typePillText: {
    fontSize: FONT_CAPTION,
    fontWeight: '600',
  },
  typePillTextEpisode: {
    color: '#9A6700',
  },
  typePillTextSentence: {
    color: '#2563EB',
  },
  typePillTextPhrase: {
    color: '#0F766E',
  },
  cardTitle: {
    marginTop: 14,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '800',
    letterSpacing: -0.45,
    color: TEXT_PRIMARY,
  },
  quoteEnglish: {
    marginTop: 14,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '700',
    letterSpacing: -0.35,
    color: TEXT_PRIMARY,
  },
  quoteChinese: {
    marginTop: 8,
    fontSize: FONT_BODY,
    lineHeight: 22,
    color: TEXT_SECONDARY,
  },
  sourceSnippet: {
    marginTop: 10,
    fontSize: FONT_CAPTION,
    lineHeight: 18,
    color: TEXT_TERTIARY,
  },
  metaRow: {
    gap: 10,
    marginTop: 14,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaText: {
    flex: 1,
    fontSize: FONT_CAPTION,
    lineHeight: 18,
    color: TEXT_SECONDARY,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  actionButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  actionButtonPrimary: {
    borderWidth: 1,
  },
  actionButtonSecondary: {
    borderWidth: 0.5,
  },
  actionButtonDisabled: {
    opacity: 0.45,
  },
  actionButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  actionButtonTextPrimary: {
    color: '#FFFFFF',
  },
  actionButtonTextSecondary: {
    color: TEXT_SECONDARY,
  },
  stateCard: {
    padding: 20,
    alignItems: 'flex-start',
  },
  stateIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
  },
  stateTitle: {
    marginTop: 16,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: TEXT_PRIMARY,
  },
  stateSubtitle: {
    marginTop: 8,
    fontSize: FONT_BODY,
    lineHeight: 22,
    color: TEXT_SECONDARY,
  },
  stateActions: {
    width: '100%',
    gap: 10,
    marginTop: 18,
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TEXT_PRIMARY,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BG_CARD,
    borderWidth: 0.5,
    borderColor: BORDER_SOFT,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  pressed: {
    opacity: 0.72,
  },
});
