import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
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

const EMPTY_DETAILS: FavoriteDetailsBundle = {
  episodes: new Map(),
  sentences: new Map(),
  phrases: new Map(),
};

type FavoriteFilter = 'all' | FavoriteType;

function cardShadow(colorScheme: 'light' | 'dark', shadowColor: string, opacity = 0.05) {
  return {
    shadowColor,
    shadowOpacity: colorScheme === 'dark' ? 0.12 : opacity,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: colorScheme === 'dark' ? 0 : 2,
  } as const;
}

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

function normalizeCoverUrl(rawValue?: string | null) {
  if (!rawValue) return null;
  if (/^https?:\/\//i.test(rawValue)) return rawValue;
  if (rawValue.startsWith('//')) return `https:${rawValue}`;
  return null;
}

function formatDateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '最近收藏';
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function resolveFavoriteMeta(item: FavoriteItem, details: FavoriteDetailsBundle) {
  if (item.target_type === 'episode') {
    const episode = details.episodes.get(item.target_id) ?? null;
    return {
      title: episode?.title ?? `单集 ${item.target_id}`,
      cover: episode?.cover ?? null,
      subtitle: '单集收藏',
      episodeId: episode?.id ?? item.target_id,
      sentenceId: null as number | null,
      detailText: episode?.title ?? `单集 ${item.target_id}`,
    };
  }

  if (item.target_type === 'sentence') {
    const detail = details.sentences.get(item.target_id);
    const sentence = detail?.sentence ?? null;
    const episode = detail?.episode ?? null;
    return {
      title: episode?.title ?? '句子收藏',
      cover: episode?.cover ?? null,
      subtitle: sentence?.en ?? '句子内容',
      episodeId: episode?.id ?? sentence?.episode_id ?? null,
      sentenceId: sentence?.id ?? null,
      detailText: sentence?.en ?? '句子内容',
    };
  }

  const detail = details.phrases.get(item.target_id);
  const phrase = detail?.phrase ?? null;
  const episode = detail?.episode ?? null;
  return {
    title: episode?.title ?? phrase?.phrase ?? '短语收藏',
    cover: episode?.cover ?? null,
    subtitle: phrase?.phrase ?? phrase?.zh ?? '短语内容',
    episodeId: episode?.id ?? phrase?.episode_id ?? null,
    sentenceId: detail?.sentence?.id ?? phrase?.sentence_id ?? null,
    detailText: phrase?.zh ?? phrase?.phrase ?? '短语内容',
  };
}

export function MyFavoritesPanel() {
  const { theme } = useAppTheme();
  const session = useAppSession();
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [details, setDetails] = useState<FavoriteDetailsBundle>(EMPTY_DETAILS);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [selectedFavoriteId, setSelectedFavoriteId] = useState<number | null>(null);
  const [activeFilter, setActiveFilter] = useState<FavoriteFilter>('all');
  const [statusText, setStatusText] = useState<string | null>(null);

  async function load() {
    if (session.status !== 'authenticated' || !session.session) return;
    setLoading(true);
    setErrorText(null);
    try {
      const raw = await fetchUserFavorites(session.session);
      const nextDetails = await fetchFavoriteDetails(session.session, raw);
      setFavorites(raw);
      setDetails(nextDetails);
      if (raw.length > 0 && selectedFavoriteId === null) {
        setSelectedFavoriteId(raw[0].id);
      }
    } catch (error) {
      setFavorites([]);
      setDetails(EMPTY_DETAILS);
      setErrorText(isExpiredSessionError(error) ? '登录状态已失效，请重新登录后重试。' : '收藏内容暂时不可用，请稍后再试。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.session, session.status]);

  const filteredFavorites = useMemo(() => {
    if (activeFilter === 'all') return favorites;
    return favorites.filter((item) => item.target_type === activeFilter);
  }, [activeFilter, favorites]);

  const selectedFavorite = useMemo(
    () => favorites.find((item) => item.id === selectedFavoriteId) ?? null,
    [favorites, selectedFavoriteId],
  );

  function handleRemove(item: FavoriteItem) {
    if (!session.session) return;
    Alert.alert('取消收藏', '确认移除这条收藏内容吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '移除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await removeFavoriteByTarget(session.session!, item.target_type, item.target_id);
              setStatusText('已移除收藏');
              setSelectedFavoriteId(null);
              await load();
            } catch (error) {
              setStatusText(error instanceof Error ? error.message : '移除失败');
            }
          })();
        },
      },
    ]);
  }

  const filterChips: Array<{ key: FavoriteFilter; label: string }> = [
    { key: 'all', label: '全部' },
    { key: 'episode', label: '单集' },
    { key: 'sentence', label: '句子' },
    { key: 'phrase', label: '短语' },
  ];

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <AppText style={[styles.panelTitle, { color: theme.textPrimary }]}>我的收藏</AppText>
        <AppText style={[styles.panelSubtitle, { color: theme.textSecondary }]}>
          快速回到收藏的内容
        </AppText>
      </View>

      <View style={styles.panelContent}>
        <View style={styles.chipRow}>
          {filterChips.map((chip) => {
            const active = activeFilter === chip.key;
            return (
              <Pressable
                key={chip.key}
                onPress={() => setActiveFilter(chip.key)}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: active
                      ? 'rgba(10,132,255,0.12)'
                      : theme.colorScheme === 'dark'
                        ? theme.secondaryCardBackground
                        : 'rgba(15,23,42,0.04)',
                    borderColor: active ? 'rgba(10,132,255,0.18)' : 'rgba(15,23,42,0.08)',
                  },
                ]}
              >
                <AppText style={[styles.filterChipText, { color: active ? theme.primaryBlue : theme.textSecondary }]}>
                  {chip.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        <View
          style={[
            styles.listCard,
            {
              backgroundColor: theme.cardBackground,
              borderColor: 'rgba(15,23,42,0.08)',
              ...cardShadow(theme.colorScheme, theme.shadowColor),
            },
          ]}
        >
          {session.status !== 'authenticated' || !session.session ? (
            <AppText style={[styles.emptyText, { color: theme.textSecondary }]}>登录后可查看收藏内容。</AppText>
          ) : loading ? (
            <ActivityIndicator color={theme.primaryBlue} />
          ) : errorText ? (
            <AppText style={[styles.emptyText, { color: theme.destructive }]}>{errorText}</AppText>
          ) : filteredFavorites.length === 0 ? (
            <AppText style={[styles.emptyText, { color: theme.textSecondary }]}>当前筛选下暂无收藏。</AppText>
          ) : (
            <View style={styles.favoriteGrid}>
              {filteredFavorites.slice(0, 6).map((item) => {
                const meta = resolveFavoriteMeta(item, details);
                const coverUrl = normalizeCoverUrl(meta.cover);
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => {
                      if (item.target_type === 'episode' && meta.episodeId) {
                        router.push({ pathname: '/episode/[id]', params: { id: meta.episodeId } });
                        return;
                      }
                      setSelectedFavoriteId(item.id);
                    }}
                    style={({ pressed }) => [
                      styles.favoriteCard,
                      {
                        backgroundColor:
                          selectedFavoriteId === item.id
                            ? 'rgba(10,132,255,0.10)'
                            : theme.colorScheme === 'dark'
                              ? theme.secondaryCardBackground
                              : 'rgba(248,250,252,0.78)',
                        borderColor: selectedFavoriteId === item.id ? 'rgba(10,132,255,0.18)' : 'rgba(15,23,42,0.08)',
                      },
                      pressed && styles.cardPressed,
                    ]}
                  >
                    {coverUrl ? (
                      <Image source={{ uri: coverUrl }} contentFit="cover" style={styles.favoriteCover} />
                    ) : (
                      <View style={[styles.favoriteCover, styles.favoriteCoverFallback]}>
                        <Ionicons name="bookmark-outline" size={18} color={theme.primaryBlue} />
                      </View>
                    )}
                    <View style={styles.favoriteTextWrap}>
                      <AppText style={[styles.favoriteTitle, { color: theme.textPrimary }]} numberOfLines={1}>
                        {meta.title}
                      </AppText>
                      <AppText style={[styles.favoriteSubtitle, { color: theme.textSecondary }]} numberOfLines={1}>
                        {meta.subtitle}
                      </AppText>
                      <AppText style={[styles.favoriteMeta, { color: theme.primaryBlue }]}>
                        {item.target_type === 'episode' ? '单集' : item.target_type === 'sentence' ? '句子' : '短语'} · {formatDateLabel(item.created_at)}
                      </AppText>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {selectedFavorite ? (
          <View
            style={[
              styles.detailCard,
              {
                backgroundColor: theme.cardBackground,
                borderColor: 'rgba(15,23,42,0.08)',
                ...cardShadow(theme.colorScheme, theme.shadowColor, 0.04),
              },
            ]}
          >
            {(() => {
              const meta = resolveFavoriteMeta(selectedFavorite, details);
              return (
                <>
                  <AppText style={[styles.detailTitle, { color: theme.textPrimary }]}>{meta.title}</AppText>
                  <AppText style={[styles.detailMeta, { color: theme.textSecondary }]}>
                    {selectedFavorite.target_type === 'episode' ? '单集收藏' : selectedFavorite.target_type === 'sentence' ? '句子收藏' : '短语收藏'} · {formatDateLabel(selectedFavorite.created_at)}
                  </AppText>
                  <AppText style={[styles.detailBody, { color: theme.textSecondary }]}>{meta.detailText}</AppText>
                  {statusText ? (
                    <AppText style={[styles.statusText, { color: statusText.includes('失败') ? theme.destructive : '#34C759' }]}>
                      {statusText}
                    </AppText>
                  ) : null}
                  <View style={styles.actionRow}>
                    {meta.episodeId ? (
                      <Pressable
                        onPress={() => {
                          if (!meta.episodeId) return;
                          router.push({
                            pathname: '/episode/[id]',
                            params: meta.sentenceId
                              ? { id: meta.episodeId, sentence: String(meta.sentenceId) }
                              : { id: meta.episodeId },
                          });
                        }}
                        style={({ pressed }) => [
                          styles.primaryButton,
                          { backgroundColor: theme.primaryBlue },
                          pressed && styles.cardPressed,
                        ]}
                      >
                        <AppText style={styles.primaryButtonText}>进入内容</AppText>
                      </Pressable>
                    ) : null}
                    <Pressable
                      onPress={() => handleRemove(selectedFavorite)}
                      style={({ pressed }) => [
                        styles.secondaryButton,
                        { borderColor: 'rgba(255,69,58,0.24)', backgroundColor: 'rgba(255,69,58,0.08)' },
                        pressed && styles.cardPressed,
                      ]}
                    >
                      <AppText style={styles.secondaryButtonText}>取消收藏</AppText>
                    </Pressable>
                  </View>
                </>
              );
            })()}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 0 },
  panelHeader: { marginBottom: 14 },
  panelTitle: { fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.35 },
  panelSubtitle: { marginTop: 4, fontSize: 14, lineHeight: 20, fontWeight: '500' },
  panelContent: { gap: 12 },
  chipRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  filterChip: {
    height: 32,
    borderRadius: 16,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipText: { fontSize: 12, lineHeight: 16, fontWeight: '700' },
  listCard: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 20 },
  emptyText: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  favoriteGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  favoriteCard: {
    width: '48.9%',
    height: 104,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  favoriteCover: { width: 96, height: 64, borderRadius: 10, marginRight: 10 },
  favoriteCoverFallback: { backgroundColor: 'rgba(10,132,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  favoriteTextWrap: { flex: 1, minWidth: 0 },
  favoriteTitle: { fontSize: 14, lineHeight: 18, fontWeight: '800' },
  favoriteSubtitle: { marginTop: 4, fontSize: 12, lineHeight: 16, fontWeight: '500' },
  favoriteMeta: { marginTop: 6, fontSize: 11, lineHeight: 14, fontWeight: '700' },
  detailCard: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 20 },
  detailTitle: { fontSize: 18, lineHeight: 24, fontWeight: '800' },
  detailMeta: { marginTop: 6, fontSize: 12, lineHeight: 16, fontWeight: '500' },
  detailBody: { marginTop: 10, fontSize: 14, lineHeight: 20, fontWeight: '500' },
  statusText: { marginTop: 10, fontSize: 12, lineHeight: 16, fontWeight: '700' },
  actionRow: { marginTop: 14, flexDirection: 'row', gap: 10 },
  primaryButton: { flex: 1, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { fontSize: 14, lineHeight: 18, fontWeight: '700', color: '#FFFFFF' },
  secondaryButton: { flex: 1, height: 42, borderRadius: 21, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { fontSize: 14, lineHeight: 18, fontWeight: '700', color: '#FF453A' },
  cardPressed: { opacity: 0.84 },
});
