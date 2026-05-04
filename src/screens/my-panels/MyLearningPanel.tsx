import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import type { LearningRecord } from '@/services/api/learning';
import { useAppTheme } from '@/theme/AppThemeProvider';

type MyLearningPanelProps = {
  records: LearningRecord[];
  loading: boolean;
  error: string | null;
  onReload: () => Promise<void>;
};

type LearningFilter = 'all' | 'mastered' | 'learning' | 'reviewed';

function cardShadow(colorScheme: 'light' | 'dark', shadowColor: string, opacity = 0.05) {
  return {
    shadowColor,
    shadowOpacity: colorScheme === 'dark' ? 0.12 : opacity,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: colorScheme === 'dark' ? 0 : 2,
  } as const;
}

function formatDateTime(value?: string | null) {
  if (!value) return '暂无时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '暂无时间';
  return `${date.getMonth() + 1}/${date.getDate()} ${`${date.getHours()}`.padStart(2, '0')}:${`${date.getMinutes()}`.padStart(2, '0')}`;
}

function statusLabel(status: LearningRecord['status']) {
  if (status === 'mastered') return '已掌握';
  if (status === 'learning') return '进行中';
  if (status === 'reviewed') return '已学习';
  return '未开始';
}

export function MyLearningPanel({ records, loading, error, onReload }: MyLearningPanelProps) {
  const { theme } = useAppTheme();
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState<LearningFilter>('all');

  const filtered = useMemo(() => {
    const search = keyword.trim().toLowerCase();
    return records.filter((item) => {
      const filterMatch = filter === 'all' || item.status === filter;
      const searchMatch = search.length === 0 || item.episode.title.toLowerCase().includes(search);
      return filterMatch && searchMatch;
    });
  }, [filter, keyword, records]);

  const filters: Array<{ key: LearningFilter; label: string }> = [
    { key: 'all', label: '全部' },
    { key: 'learning', label: '进行中' },
    { key: 'reviewed', label: '已学习' },
    { key: 'mastered', label: '已掌握' },
  ];

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <AppText style={[styles.panelTitle, { color: theme.textPrimary }]}>学习记录</AppText>
        <AppText style={[styles.panelSubtitle, { color: theme.textSecondary }]}>
          浏览全部学习进度并回到对应单集
        </AppText>
      </View>

      <View style={styles.panelContent}>
        <View style={styles.filterRow}>
          {filters.map((item) => {
            const active = filter === item.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => setFilter(item.key)}
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
                  {item.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        <View
          style={[
            styles.contentCard,
            {
              backgroundColor: theme.cardBackground,
              borderColor: 'rgba(15,23,42,0.08)',
              ...cardShadow(theme.colorScheme, theme.shadowColor),
            },
          ]}
        >
          <View
            style={[
              styles.searchWrap,
              {
                backgroundColor:
                  theme.colorScheme === 'dark' ? theme.secondaryCardBackground : 'rgba(248,250,252,0.78)',
                borderColor: 'rgba(15,23,42,0.08)',
              },
            ]}
          >
            <TextInput
              value={keyword}
              onChangeText={setKeyword}
              placeholder="搜索学习记录"
              placeholderTextColor={theme.textSecondary}
              style={[styles.searchInput, { color: theme.textPrimary }]}
            />
          </View>

          {loading ? (
            <ActivityIndicator color={theme.primaryBlue} />
          ) : error ? (
            <AppText style={[styles.emptyText, { color: theme.destructive }]}>{error}</AppText>
          ) : filtered.length === 0 ? (
            <AppText style={[styles.emptyText, { color: theme.textSecondary }]}>当前筛选下没有学习记录。</AppText>
          ) : (
            <View style={styles.recordList}>
              {filtered.map((record) => {
                const progressPercentage =
                  record.totalSentences > 0 ? Math.round((record.reviewedSentences / record.totalSentences) * 100) : 0;
                return (
                  <Pressable
                    key={record.episode.id}
                    onPress={() =>
                      router.push({
                        pathname: '/episode/[id]',
                        params: record.lastSentenceId
                          ? { id: record.episode.id, sentence: String(record.lastSentenceId) }
                          : { id: record.episode.id },
                      })
                    }
                    style={({ pressed }) => [
                      styles.recordCard,
                      {
                        backgroundColor:
                          theme.colorScheme === 'dark' ? theme.secondaryCardBackground : 'rgba(248,250,252,0.78)',
                        borderColor: 'rgba(15,23,42,0.08)',
                      },
                      pressed && styles.cardPressed,
                    ]}
                  >
                    <View style={styles.recordHeadRow}>
                      <AppText style={[styles.recordTitle, { color: theme.textPrimary }]} numberOfLines={1}>
                        {record.episode.title}
                      </AppText>
                      <AppText style={[styles.recordStatus, { color: theme.primaryBlue }]}>{statusLabel(record.status)}</AppText>
                    </View>
                    <AppText style={[styles.recordMeta, { color: theme.textSecondary }]}>
                      最近学习 {formatDateTime(record.lastReviewedAt)}
                    </AppText>
                    <AppText style={[styles.recordMeta, { color: theme.textSecondary }]}>
                      已完成 {record.reviewedSentences}/{record.totalSentences || '--'} 句 · 进度 {progressPercentage}%
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          )}

          <Pressable
            onPress={() => void onReload()}
            style={({ pressed }) => [
              styles.reloadButton,
              { backgroundColor: theme.primaryBlue },
              pressed && styles.cardPressed,
            ]}
          >
            <AppText style={styles.reloadButtonText}>刷新学习记录</AppText>
          </Pressable>
        </View>
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
  filterRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  filterChip: { height: 32, borderRadius: 16, paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  filterChipText: { fontSize: 12, lineHeight: 16, fontWeight: '700' },
  contentCard: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 20 },
  searchWrap: { height: 42, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, justifyContent: 'center', marginBottom: 14 },
  searchInput: { fontSize: 14, lineHeight: 18, fontWeight: '500', paddingVertical: 0 },
  emptyText: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  recordList: { gap: 10 },
  recordCard: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 14 },
  recordHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  recordTitle: { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: '800' },
  recordStatus: { fontSize: 12, lineHeight: 16, fontWeight: '700' },
  recordMeta: { marginTop: 6, fontSize: 12, lineHeight: 16, fontWeight: '500' },
  reloadButton: { marginTop: 14, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  reloadButtonText: { fontSize: 14, lineHeight: 18, fontWeight: '700', color: '#FFFFFF' },
  cardPressed: { opacity: 0.84 },
});
