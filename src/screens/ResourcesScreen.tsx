import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { AppText } from '@/components/AppText';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { ChromeIconButton, SurfaceCard } from '@/components/ui/ApplePrimitives';
import {
  LEARNING_RESOURCES,
  RESOURCE_CATEGORIES,
  type LearningResource,
  type ResourceCategory,
  type ResourceType,
} from '@/data/resources';
import { safeBack } from '@/navigation/safeBack';
import { useAppTheme } from '@/theme/AppThemeProvider';
import { useThemeColors } from '@/theme/useThemeColors';
import { openAppSafeUrl } from '@/utils/appSafeLink';
import {
  ACCENT,
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

const ECHOLINGO_WEB_BASE = 'https://echolingo.cn';

function resolveOpenTarget(resource: LearningResource) {
  const isExternal = resource.href.startsWith('http://') || resource.href.startsWith('https://');
  return isExternal ? resource.href : `${ECHOLINGO_WEB_BASE}${resource.href}`;
}

function resolveTypeLabel(type: ResourceType) {
  switch (type) {
    case 'original':
      return '独家';
    case 'guide':
      return '指南';
    case 'tool':
      return '工具';
    case 'official':
      return '官方';
    default:
      return type;
  }
}

function resolveOpenModeLabel(resource: LearningResource) {
  return resource.href.startsWith('http://') || resource.href.startsWith('https://') ? '外部链接' : '站内文章';
}

function SearchBar({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (value: string) => void;
}) {
  const { colors, theme } = useThemeColors();

  return (
    <View
      style={[
        styles.searchWrap,
        {
          backgroundColor: theme.secondaryCardBackground,
          borderColor: theme.border,
        },
      ]}
    >
      <Ionicons name="search-outline" size={18} color={theme.textSecondary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="搜索标题、说明或分类"
        placeholderTextColor={theme.textTertiary}
        style={[styles.searchInput, { color: colors.textPrimary }]}
        returnKeyType="search"
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={8} style={({ pressed }) => pressed && styles.pressed}>
          <Ionicons name="close-circle" size={18} color={theme.textTertiary} />
        </Pressable>
      ) : null}
    </View>
  );
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
  const { colors, theme } = useThemeColors();

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
      <AppText style={[styles.metricLabel, { color: colors.textSecondary }]}>{label}</AppText>
      <AppText style={[styles.metricValue, { color: colors.textPrimary }]}>{value}</AppText>
      <AppText style={[styles.metricNote, { color: colors.textSecondary }]}>{note}</AppText>
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
  const { colors, theme } = useThemeColors();

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
      <AppText style={[styles.filterChipText, { color: active ? '#FFFFFF' : colors.textSecondary }]}>{label}</AppText>
    </Pressable>
  );
}

function ResourceMetaPill({
  label,
  tone,
}: {
  label: string;
  tone: 'type' | 'mode' | 'category';
}) {
  const { colors } = useThemeColors();

  return (
    <View
      style={[
        styles.metaPill,
        { backgroundColor: colors.chipBackground },
        tone === 'type' ? styles.metaPillType : null,
        tone === 'mode' ? styles.metaPillMode : null,
      ]}
    >
      <AppText
        style={[
          styles.metaPillText,
          { color: colors.textSecondary },
          tone === 'type' ? styles.metaPillTextType : null,
          tone === 'mode' ? { color: colors.textPrimary } : null,
        ]}
      >
        {label}
      </AppText>
    </View>
  );
}

function EmptyState({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  const { colors, theme } = useThemeColors();

  return (
    <View style={[styles.emptyState, { backgroundColor: colors.secondaryCardBackground, borderColor: colors.border }]}>
      <View style={[styles.emptyIconWrap, { backgroundColor: theme.fillTertiary }]}>
        <Ionicons name="search-outline" size={18} color={theme.textSecondary} />
      </View>
      <AppText style={[styles.emptyTitle, { color: colors.textPrimary }]}>{title}</AppText>
      <AppText style={[styles.emptySubtitle, { color: colors.textSecondary }]}>{subtitle}</AppText>
    </View>
  );
}

export function ResourcesScreen() {
  const { colors, theme } = useThemeColors();
  const [activeCategory, setActiveCategory] = useState<ResourceCategory>('全部');
  const [query, setQuery] = useState('');

  const filteredResources = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return LEARNING_RESOURCES.filter((resource) => {
      const matchesCategory = activeCategory === '全部' || resource.category === activeCategory;
      if (!matchesCategory) return false;
      if (!normalized) return true;
      return (
        resource.title.toLowerCase().includes(normalized) ||
        resource.desc.toLowerCase().includes(normalized) ||
        (resource.note ?? '').toLowerCase().includes(normalized) ||
        resource.category.toLowerCase().includes(normalized)
      );
    });
  }, [activeCategory, query]);

  const categoryCount = RESOURCE_CATEGORIES.length - 1;
  const curatedCount = LEARNING_RESOURCES.filter((item) => item.type === 'original' || item.type === 'guide').length;

  const handleOpenResource = async (resource: LearningResource) => {
    if (resource.disabled) return;

    const target = resolveOpenTarget(resource);
    try {
      await openAppSafeUrl(target);
    } catch (error) {
      const message =
        error instanceof Error && error.message === 'blocked_purchase_risk_url'
          ? '请在 App 内完成购买或账号相关操作。'
          : '请稍后再试，或复制链接后在浏览器中打开。';
      Alert.alert('暂时无法打开链接', message);
    }
  };

  const header = (
    <View style={styles.header}>
      <View style={styles.backRow}>
        <ChromeIconButton icon="chevron-back" onPress={() => safeBack('/my')} accessibilityLabel="返回我的" />
      </View>
    </View>
  );

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
            <AppText style={[styles.heroEyebrow, { color: colors.textMuted }]}>学习资源</AppText>
            <AppText style={[styles.heroTitle, { color: colors.textPrimary }]}>精选路线、工具与官方资源</AppText>
            <AppText style={[styles.heroSubtitle, { color: colors.textSecondary }]}>
              站内文章、学习路线和外部工具统一收在这里，方便按目标查找。
            </AppText>
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
            <Ionicons name="library-outline" size={18} color={theme.textPrimary} />
          </View>
        </View>

        <View style={[styles.metricRow, { borderTopColor: theme.border }]}>
          <SummaryMetric label="资源总数" value={LEARNING_RESOURCES.length} note="持续整理常用学习资源" />
          <SummaryMetric label="分类数量" value={categoryCount} note="按训练目标整理筛选" />
          <SummaryMetric label="独家 / 指南" value={curatedCount} note="站内长文入口统一收纳" />
        </View>
      </SurfaceCard>

      <SearchBar value={query} onChangeText={setQuery} />

      <View style={styles.filterSection}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterScrollContent}
        >
          {RESOURCE_CATEGORIES.map((category) => (
            <FilterChip
              key={category}
              label={category}
              active={activeCategory === category}
              onPress={() => setActiveCategory(category)}
            />
          ))}
        </ScrollView>
      </View>

      <SurfaceCard style={styles.listCard}>
        <View style={styles.listHeader}>
          <View style={{ flex: 1 }}>
            <AppText style={[styles.listTitle, { color: colors.textPrimary }]}>资源列表</AppText>
            <AppText style={[styles.listSubtitle, { color: colors.textSecondary }]}>
              {filteredResources.length > 0
                ? `共 ${filteredResources.length} 条，站内文章与外部链接统一展示。`
                : '换个关键词或切换分类试试。'}
            </AppText>
          </View>
        </View>

        {filteredResources.length === 0 ? (
          <EmptyState
            title="没有找到相关资源"
            subtitle="换个关键词或切换分类试试。"
          />
        ) : (
          <View style={styles.resourceStack}>
            {filteredResources.map((resource) => {
              const openMode = resolveOpenModeLabel(resource);
              const titleNote = resource.note ?? resource.desc;
              const isExternal = openMode === '外部链接';
              return (
                <Pressable
                  key={resource.id}
                  onPress={() => void handleOpenResource(resource)}
                  style={({ pressed }) => [
                    styles.resourceCard,
                    { backgroundColor: colors.cardBackground, borderColor: colors.border },
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={[styles.resourceIcon, { backgroundColor: resource.color }]}>
                    <AppText style={styles.resourceIconText}>{resource.abbr}</AppText>
                  </View>

                  <View style={styles.resourceBody}>
                    <View style={styles.resourceTitleRow}>
                      <AppText style={[styles.resourceTitle, { color: colors.textPrimary }]}>{resource.title}</AppText>
                      <Ionicons
                        name={isExternal ? 'open-outline' : 'chevron-forward'}
                        size={16}
                        color={colors.textMuted}
                      />
                    </View>

                    <View style={styles.metaRow}>
                      <ResourceMetaPill label={resource.category} tone="category" />
                      <ResourceMetaPill label={resolveTypeLabel(resource.type)} tone="type" />
                      <ResourceMetaPill label={openMode} tone="mode" />
                    </View>

                    <AppText style={[styles.resourceDescription, { color: colors.textSecondary }]}>{resource.desc}</AppText>
                    {resource.note ? <AppText style={[styles.resourceNote, { color: colors.textSecondary }]}>{titleNote}</AppText> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </SurfaceCard>
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
    fontSize: 25,
    lineHeight: 30,
    fontWeight: '800',
    letterSpacing: -0.7,
    color: TEXT_PRIMARY,
  },
  heroSubtitle: {
    fontSize: FONT_CALLOUT,
    lineHeight: 19,
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
  metricRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 0.5,
  },
  metricCard: {
    flex: 1,
    minHeight: 118,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 15,
    borderWidth: 0.5,
    gap: 8,
  },
  metricLabel: {
    fontSize: FONT_CAPTION,
    lineHeight: 16,
    color: TEXT_SECONDARY,
  },
  metricValue: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: TEXT_PRIMARY,
  },
  metricNote: {
    marginTop: 'auto',
    fontSize: FONT_CAPTION,
    lineHeight: 17,
  },
  searchWrap: {
    minHeight: 50,
    borderRadius: 18,
    borderWidth: 0.5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    minHeight: 44,
    color: TEXT_PRIMARY,
    fontSize: FONT_BODY,
  },
  filterSection: {
    marginTop: -2,
  },
  filterScrollContent: {
    gap: 8,
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
    color: TEXT_SECONDARY,
  },
  filterChipTextActive: {
    color: TEXT_PRIMARY,
  },
  listCard: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  listHeader: {
    marginBottom: 16,
  },
  listTitle: {
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: TEXT_PRIMARY,
  },
  listSubtitle: {
    marginTop: 4,
    fontSize: FONT_CALLOUT,
    lineHeight: 18,
    color: TEXT_SECONDARY,
  },
  resourceStack: {
    gap: 12,
  },
  resourceCard: {
    flexDirection: 'row',
    gap: 14,
    borderRadius: 20,
    padding: 16,
    backgroundColor: BG_CARD,
    borderWidth: 0.5,
    borderColor: BORDER_SOFT,
  },
  resourceIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  resourceIconText: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  resourceBody: {
    flex: 1,
    gap: 10,
  },
  resourceTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  resourceTitle: {
    flex: 1,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: TEXT_PRIMARY,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  metaPillType: {
    backgroundColor: 'rgba(245,166,35,0.12)',
  },
  metaPillMode: {
    backgroundColor: BG_CARD_SOFT,
  },
  metaPillText: {
    fontSize: FONT_MICRO,
    lineHeight: 12,
    fontWeight: '700',
    color: TEXT_SECONDARY,
  },
  metaPillTextType: {
    color: ACCENT,
  },
  metaPillTextMode: {
    color: TEXT_PRIMARY,
  },
  resourceDescription: {
    fontSize: FONT_CALLOUT,
    lineHeight: 19,
    color: TEXT_SECONDARY,
  },
  resourceNote: {
    fontSize: FONT_CAPTION,
    lineHeight: 18,
    color: TEXT_SECONDARY,
  },
  emptyState: {
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 20,
    borderRadius: 20,
    backgroundColor: BG_CARD_SOFT,
    borderWidth: 0.5,
    borderColor: BORDER_SOFT,
  },
  emptyIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: TEXT_PRIMARY,
  },
  emptySubtitle: {
    maxWidth: 280,
    fontSize: FONT_CALLOUT,
    lineHeight: 20,
    textAlign: 'center',
    color: TEXT_SECONDARY,
  },
  pressed: {
    opacity: 0.72,
  },
});
