import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { ChromeIconButton, SurfaceCard } from '@/components/ui/ApplePrimitives';
import { LEARNING_METHOD_ENTRIES, type LearningMethodEntry } from '@/data/learningMethods';
import { safeBack } from '@/navigation/safeBack';
import { useAppTheme } from '@/theme/AppThemeProvider';
import { openAppSafeUrl } from '@/utils/appSafeLink';
import {
  ACCENT,
  FONT_CALLOUT,
  FONT_CAPTION,
  FONT_MICRO,
  SPACING_PAGE_H,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
} from '@/theme/tokens';

const ECHOLINGO_WEB_BASE = 'https://echolingo.cn';

function resolveWebTarget(href: string) {
  const isExternal = href.startsWith('http://') || href.startsWith('https://');
  return isExternal ? href : `${ECHOLINGO_WEB_BASE}${href}`;
}

async function openWebTarget(href: string) {
  const target = resolveWebTarget(href);
  try {
    await openAppSafeUrl(target);
  } catch (error) {
    const message =
      error instanceof Error && error.message === 'blocked_purchase_risk_url'
        ? '请在 App 内完成购买或账号相关操作。'
        : '请稍后再试。';
    Alert.alert('无法打开链接', message);
  }
}

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  const { theme } = useAppTheme();

  return (
    <View style={styles.sectionHeader}>
      <AppText style={[styles.sectionTitle, { color: theme.textPrimary }]}>{title}</AppText>
      {subtitle ? <AppText style={[styles.sectionSubtitle, { color: theme.textSecondary }]}>{subtitle}</AppText> : null}
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

function MethodPill() {
  const { theme } = useAppTheme();
  const isDark = theme.colorScheme === 'dark';

  return (
    <View
      style={[
        styles.metaPill,
        {
          backgroundColor: isDark ? 'rgba(255, 159, 10, 0.18)' : 'rgba(183,131,63,0.12)',
          borderColor: isDark ? 'rgba(255, 159, 10, 0.34)' : 'rgba(183,131,63,0.18)',
        },
      ]}
    >
      <AppText style={[styles.metaPillText, { color: isDark ? '#ffb340' : ACCENT }]}>训练法</AppText>
    </View>
  );
}

function MethodCard({ item }: { item: LearningMethodEntry }) {
  const { theme } = useAppTheme();

  return (
    <Pressable
      onPress={() => void openWebTarget(item.href)}
      style={({ pressed }) => [
        styles.itemCard,
        {
          backgroundColor: theme.secondaryCardBackground,
          borderColor: theme.border,
        },
        pressed && styles.cardPressed,
      ]}
    >
      <View style={styles.itemHeaderRow}>
        <MethodPill />
        <Ionicons name="open-outline" size={16} color={theme.textTertiary} />
      </View>

      <View style={styles.itemCopy}>
        <AppText style={[styles.itemTitleEn, { color: theme.textTertiary }]}>{item.titleEn}</AppText>
        <AppText style={[styles.itemTitle, { color: theme.textPrimary }]}>{item.titleZh}</AppText>
        <AppText style={[styles.itemDescription, { color: theme.textSecondary }]}>{item.summary}</AppText>
      </View>

      <View style={styles.detailBlock}>
        <AppText style={[styles.detailLabel, { color: theme.textSecondary }]}>适合解决的问题</AppText>
        <AppText style={[styles.detailValue, { color: theme.textPrimary }]}>{item.solves}</AppText>
      </View>

      <View style={styles.detailBlock}>
        <AppText style={[styles.detailLabel, { color: theme.textSecondary }]}>推荐使用场景</AppText>
        <AppText style={[styles.detailValue, { color: theme.textPrimary }]}>{item.scenario}</AppText>
      </View>
    </Pressable>
  );
}

export function LearningMethodsScreen() {
  const { theme } = useAppTheme();
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
            <AppText style={styles.heroEyebrow}>学习方法</AppText>
            <AppText style={styles.heroTitle}>五种核心训练法</AppText>
            <AppText style={styles.heroSubtitle}>
              把跟读、回声、听写、多轮输入和意群听力集中在这里。
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
            <Ionicons name="compass-outline" size={18} color={theme.textPrimary} />
          </View>
        </View>

        <View style={[styles.metricRow, { borderTopColor: theme.border }]}>
          <SummaryMetric label="训练法" value={LEARNING_METHOD_ENTRIES.length} note="五种核心练习方式" />
          <SummaryMetric label="重点" value="听力输入" note="围绕节奏、辨音与吸收" />
          <SummaryMetric label="场景" value="日常训练" note="适合精听后的稳定练习" />
        </View>
      </SurfaceCard>

      <SurfaceCard style={styles.sectionCard}>
        <SectionHeader title="五个训练法" subtitle="按训练目标选择方法，配合精听和复习长期使用。" />
        <View style={styles.stack}>
          {LEARNING_METHOD_ENTRIES.map((item) => (
            <MethodCard key={item.id} item={item} />
          ))}
        </View>
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
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: TEXT_PRIMARY,
  },
  metricNote: {
    marginTop: 'auto',
    fontSize: FONT_CAPTION,
    lineHeight: 17,
  },
  sectionCard: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
  },
  sectionHeader: {
    marginBottom: 16,
    gap: 4,
  },
  sectionTitle: {
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: TEXT_PRIMARY,
  },
  sectionSubtitle: {
    fontSize: FONT_CALLOUT,
    lineHeight: 18,
    color: TEXT_SECONDARY,
  },
  stack: {
    gap: 12,
  },
  itemCard: {
    borderRadius: 22,
    padding: 18,
    borderWidth: 0.5,
    gap: 14,
  },
  itemHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  metaPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 0.5,
  },
  metaPillText: {
    fontSize: FONT_CAPTION,
    fontWeight: '600',
  },
  itemCopy: {
    gap: 6,
  },
  itemTitleEn: {
    fontSize: FONT_CAPTION,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  itemTitle: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '700',
    letterSpacing: -0.35,
  },
  itemDescription: {
    fontSize: FONT_CALLOUT,
    lineHeight: 19,
  },
  detailBlock: {
    gap: 4,
  },
  detailLabel: {
    fontSize: FONT_CAPTION,
    lineHeight: 16,
    fontWeight: '700',
  },
  detailValue: {
    fontSize: FONT_CALLOUT,
    lineHeight: 19,
  },
  cardPressed: {
    opacity: 0.72,
  },
});
