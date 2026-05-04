import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { LEARNING_RESOURCES, RESOURCE_CATEGORIES } from '@/data/resources';
import { useAppTheme } from '@/theme/AppThemeProvider';
import { openAppSafeUrl } from '@/utils/appSafeLink';

function cardShadow(colorScheme: 'light' | 'dark', shadowColor: string, opacity = 0.05) {
  return {
    shadowColor,
    shadowOpacity: colorScheme === 'dark' ? 0.12 : opacity,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: colorScheme === 'dark' ? 0 : 2,
  } as const;
}

function normalizeResourceHref(href: string) {
  if (/^https?:\/\//i.test(href)) return href;
  return null;
}

export function MyResourcesPanel() {
  const { theme } = useAppTheme();
  const chips = RESOURCE_CATEGORIES;
  const [selectedCategory, setSelectedCategory] = useState<string>('全部');
  const [searchText, setSearchText] = useState('');

  const resources = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return LEARNING_RESOURCES.filter((item) => {
      const categoryMatch = selectedCategory === '全部' || item.category === selectedCategory;
      const searchMatch =
        keyword.length === 0 ||
        item.title.toLowerCase().includes(keyword) ||
        item.desc.toLowerCase().includes(keyword) ||
        item.abbr.toLowerCase().includes(keyword);
      return categoryMatch && searchMatch;
    });
  }, [searchText, selectedCategory]);

  async function openResource(href: string) {
    const target = normalizeResourceHref(href);
    if (!target) return;
    try {
      await openAppSafeUrl(target);
    } catch (error) {
      const message =
        error instanceof Error && error.message === 'blocked_purchase_risk_url'
          ? '请在 App 内完成购买或账号相关操作。'
          : '当前资源链接暂时无法打开。';
      Alert.alert('打开失败', message);
    }
  }

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <AppText style={[styles.panelTitle, { color: theme.textPrimary }]}>学习资源</AppText>
        <AppText style={[styles.panelSubtitle, { color: theme.textSecondary }]}>
          精选英语学习资料与工具
        </AppText>
      </View>

      <View style={styles.panelContent}>
        <View style={styles.chipRow}>
          {chips.map((item) => {
            const active = selectedCategory === item;
            return (
              <Pressable
                key={item}
                onPress={() => setSelectedCategory(item)}
                style={[
                  styles.categoryChip,
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
                <AppText style={[styles.categoryChipText, { color: active ? theme.primaryBlue : theme.textSecondary }]}>
                  {item}
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
              value={searchText}
              onChangeText={setSearchText}
              placeholder="搜索资源、工具或缩写"
              placeholderTextColor={theme.textSecondary}
              style={[styles.searchInput, { color: theme.textPrimary }]}
            />
          </View>

          <View style={styles.resourceGrid}>
            {resources.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => void openResource(item.href)}
                style={({ pressed }) => [
                  styles.resourceCard,
                  {
                    backgroundColor:
                      theme.colorScheme === 'dark' ? theme.secondaryCardBackground : 'rgba(248,250,252,0.78)',
                    borderColor: 'rgba(15,23,42,0.08)',
                  },
                  pressed && styles.cardPressed,
                ]}
              >
                <View style={[styles.resourceBadge, { backgroundColor: item.color }]}>
                  <AppText style={styles.resourceBadgeText}>{item.abbr}</AppText>
                </View>
                <AppText style={[styles.resourceTitle, { color: theme.textPrimary }]} numberOfLines={1}>
                  {item.title}
                </AppText>
                <AppText style={[styles.resourceSubtitle, { color: theme.textSecondary }]} numberOfLines={2}>
                  {item.desc}
                </AppText>
                <AppText style={[styles.resourceTag, { color: theme.primaryBlue }]} numberOfLines={1}>
                  {item.category}
                </AppText>
              </Pressable>
            ))}
          </View>
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
  chipRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  categoryChip: {
    height: 32,
    borderRadius: 16,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryChipText: { fontSize: 12, lineHeight: 16, fontWeight: '700' },
  contentCard: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 20 },
  searchWrap: {
    height: 42,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    justifyContent: 'center',
    marginBottom: 14,
  },
  searchInput: { fontSize: 14, lineHeight: 18, fontWeight: '500', paddingVertical: 0 },
  resourceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  resourceCard: {
    width: '48.9%',
    height: 112,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    justifyContent: 'space-between',
  },
  resourceBadge: {
    alignSelf: 'flex-start',
    minWidth: 44,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resourceBadgeText: { fontSize: 11, lineHeight: 14, fontWeight: '800', color: '#FFFFFF' },
  resourceTitle: { fontSize: 15, lineHeight: 19, fontWeight: '800' },
  resourceSubtitle: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  resourceTag: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
  cardPressed: { opacity: 0.84 },
});
