import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { AppText } from '@/components/AppText';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { SurfaceCard } from '@/components/ui/ApplePrimitives';
import { BackLink } from '@/components/ui/BackLink';
import {
  fetchMonthlyLeaderboard,
  isLeaderboardAuthOrPermissionError,
  type MonthlyLeaderboardItem,
  type MonthlyLeaderboardSnapshot,
} from '@/services/api/leaderboard';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import {
  BG_CARD,
  BORDER_SOFT,
  COLOR_AMBER_BG,
  COLOR_BLUE_BG,
  FONT_BODY,
  FONT_CALLOUT,
  FONT_CAPTION,
  FONT_MICRO,
  SPACING_PAGE_H,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
} from '@/theme/tokens';
import { useAppTheme } from '@/theme/AppThemeProvider';

type LoadState = 'loading' | 'ready' | 'empty' | 'error';

function formatStudyDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return '0m';
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
          backgroundColor: theme.colorScheme === 'dark' ? theme.secondaryCardBackground : 'rgba(28,28,30,0.035)',
          borderColor: theme.border,
        },
      ]}
    >
      <AppText style={[styles.metricLabel, { color: theme.textSecondary }]}>{label}</AppText>
      <AppText numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.84} style={[styles.metricValue, { color: theme.textPrimary }]}>
        {value}
      </AppText>
      <AppText style={[styles.metricNote, { color: theme.textTertiary }]}>{note}</AppText>
    </View>
  );
}

function StateCard({
  icon,
  title,
  subtitle,
  primaryLabel,
  onPrimary,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
  primaryLabel?: string;
  onPrimary?: () => void;
}) {
  const { theme } = useAppTheme();

  return (
    <SurfaceCard style={styles.stateCard}>
      <View style={[styles.stateIconWrap, { backgroundColor: theme.fillSecondary, borderColor: theme.border }]}>
        <Ionicons name={icon} size={18} color={theme.textSecondary} />
      </View>
      <AppText style={[styles.stateTitle, { color: theme.textPrimary }]}>{title}</AppText>
      <AppText style={[styles.stateSubtitle, { color: theme.textSecondary }]}>{subtitle}</AppText>
      {primaryLabel && onPrimary ? (
        <Pressable onPress={onPrimary} style={({ pressed }) => [styles.primaryButton, { backgroundColor: theme.textPrimary }, pressed && styles.pressed]}>
          <AppText style={[styles.primaryButtonText, { color: theme.cardBackground }]}>{primaryLabel}</AppText>
        </Pressable>
      ) : null}
    </SurfaceCard>
  );
}

function RankTone({
  rank,
}: {
  rank: number;
}) {
  const { theme } = useAppTheme();

  if (rank === 1) {
    return (
      <View style={[styles.rankBadge, styles.rankBadgeGold]}>
        <Ionicons name="trophy-outline" size={12} color="#9C6A1A" />
      </View>
    );
  }

  if (rank === 2 || rank === 3) {
    return (
      <View style={[styles.rankBadge, { backgroundColor: theme.fillSecondary }]}>
        <Ionicons name="medal-outline" size={12} color={theme.textSecondary} />
      </View>
    );
  }

  return <View style={[styles.rankDot, { backgroundColor: theme.textTertiary }]} />;
}

function LeaderboardRow({
  item,
  isLast = false,
}: {
  item: MonthlyLeaderboardItem;
  isLast?: boolean;
}) {
  const { theme } = useAppTheme();

  return (
    <View
      style={[
        styles.rankRow,
        {
          borderBottomColor: theme.separator,
          borderBottomWidth: isLast ? 0 : 0.5,
          backgroundColor: item.isCurrentUser
            ? theme.colorScheme === 'dark'
              ? 'rgba(10,132,255,0.16)'
              : COLOR_BLUE_BG
            : theme.cardBackground,
        },
      ]}
    >
      <View style={styles.rankLeading}>
        <View style={styles.rankIndexWrap}>
          <RankTone rank={item.rank} />
          <AppText style={[styles.rankIndex, { color: item.rank <= 3 ? theme.textPrimary : theme.textSecondary }]}>{item.rank}</AppText>
        </View>
        <View style={styles.rankMeta}>
          <View style={styles.rankNameRow}>
            <AppText style={[styles.rankName, { color: theme.textPrimary }]}>{item.displayName}</AppText>
            {item.isCurrentUser ? (
              <View style={[styles.youPill, { backgroundColor: theme.colorScheme === 'dark' ? 'rgba(10,132,255,0.2)' : COLOR_BLUE_BG }]}>
                <AppText style={styles.youPillText}>你</AppText>
              </View>
            ) : null}
          </View>
        </View>
      </View>
      <AppText
        numberOfLines={1}
        style={[styles.rankDuration, { color: item.isCurrentUser ? theme.textPrimary : theme.textSecondary }]}
      >
        {formatStudyDuration(item.totalSeconds)}
      </AppText>
    </View>
  );
}

export function LeaderboardScreen() {
  const session = useAppSession();
  const { theme } = useAppTheme();
  const [snapshot, setSnapshot] = useState<MonthlyLeaderboardSnapshot | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  const isLoggedIn = session.status === 'authenticated';

  const load = useCallback(async () => {
    setState('loading');
    try {
      const next = await fetchMonthlyLeaderboard(session.session);
      setSnapshot(next);
      setState(next.leaderboard.length > 0 ? 'ready' : 'empty');
    } catch (error) {
      if (isLoggedIn && isLeaderboardAuthOrPermissionError(error)) {
        await session.invalidateSession();
        try {
          const guestSnapshot = await fetchMonthlyLeaderboard(null);
          setSnapshot(guestSnapshot);
          setState(guestSnapshot.leaderboard.length > 0 ? 'ready' : 'empty');
          return;
        } catch {
          setSnapshot(null);
          setState('error');
          return;
        }
      }
      setSnapshot(null);
      setState('error');
    }
  }, [isLoggedIn, session]);

  useEffect(() => {
    void load();
  }, [load]);

  const header = (
    <View style={styles.header}>
      <View style={styles.backRow}>
        <BackLink label="我的" onPress={() => router.back()} />
      </View>
    </View>
  );

  const firstPlaceDuration = snapshot ? formatStudyDuration(snapshot.winnerSeconds) : '0m';
  const participantCount = snapshot?.totalParticipants ?? 0;

  return (
    <AppScreenShell
      header={header}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      headerScrollFade
    >
      <View style={styles.pageContent}>
        <SurfaceCard style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={{ flex: 1, gap: 6 }}>
              <AppText style={[styles.heroEyebrow, { color: theme.textTertiary }]}>本月榜单</AppText>
              <AppText style={[styles.heroTitle, { color: theme.textPrimary }]}>学习排行榜</AppText>
              <AppText style={[styles.heroSubtitle, { color: theme.textSecondary }]}>
                按本月精听学习时长排行，持续学习会自动上榜。
              </AppText>
            </View>
            <View style={[styles.heroBadge, { backgroundColor: theme.fillSecondary, borderColor: theme.border }]}>
              <Ionicons name="trophy-outline" size={18} color={theme.textPrimary} />
            </View>
          </View>

          <View style={styles.metricRow}>
            <SummaryMetric label="参与人数" value={participantCount} note="本月已上榜学习者" />
            <SummaryMetric label="第一名时长" value={firstPlaceDuration} note="当前榜首学习时长" />
            <SummaryMetric label="奖励" value="¥99" note="本月第一名奖励" />
          </View>
        </SurfaceCard>

        {state === 'loading' ? (
          <StateCard icon="time-outline" title="排行榜加载中" subtitle="正在同步本月学习榜单…" />
        ) : null}

        {state === 'error' ? (
          <StateCard
            icon="cloud-offline-outline"
            title="排行榜暂时无法加载"
            subtitle="请稍后重试。"
            primaryLabel="重新加载"
            onPrimary={() => {
              void load();
            }}
          />
        ) : null}

        {(state === 'ready' || state === 'empty') && (
          <>
            <SurfaceCard style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <View>
                  <AppText style={[styles.sectionTitle, { color: theme.textPrimary }]}>本月 Top 5</AppText>
                  <AppText style={[styles.sectionSubtitle, { color: theme.textSecondary }]}>按本月学习时长排序。</AppText>
                </View>
              </View>

              {snapshot && snapshot.leaderboard.length > 0 ? (
                <View style={[styles.rankList, { backgroundColor: theme.cardBackground, borderColor: theme.border }]}>
                  {snapshot.leaderboard.map((item, index) => (
                    <LeaderboardRow
                      key={`${item.userId}-${item.rank}`}
                      item={item}
                      isLast={index === snapshot.leaderboard.length - 1}
                    />
                  ))}
                </View>
              ) : (
                <View style={styles.emptyBox}>
                  <AppText style={[styles.emptyTitle, { color: theme.textPrimary }]}>本月暂无学习排行</AppText>
                  <AppText style={[styles.emptySubtitle, { color: theme.textSecondary }]}>开始学习即可上榜。</AppText>
                </View>
              )}
            </SurfaceCard>

            {isLoggedIn ? (
              <SurfaceCard style={styles.sectionCard}>
                <View style={styles.sectionHeader}>
                  <View>
                    <AppText style={[styles.sectionTitle, { color: theme.textPrimary }]}>你的排名</AppText>
                    <AppText style={[styles.sectionSubtitle, { color: theme.textSecondary }]}>已登录时会同步显示你的本月位置。</AppText>
                  </View>
                </View>

                {snapshot?.currentUserRank && snapshot.currentUserSeconds > 0 ? (
                  <View style={[styles.userCard, { backgroundColor: theme.secondaryCardBackground, borderColor: theme.border }]}>
                    <View style={styles.userMetric}>
                      <AppText style={[styles.userMetricLabel, { color: theme.textSecondary }]}>你的排名</AppText>
                      <AppText style={[styles.userMetricValue, { color: theme.textPrimary }]}>第 {snapshot.currentUserRank} 名</AppText>
                    </View>
                    <View style={[styles.userMetricDivider, { backgroundColor: theme.separator }]} />
                    <View style={styles.userMetric}>
                      <AppText style={[styles.userMetricLabel, { color: theme.textSecondary }]}>本月学习</AppText>
                      <AppText style={[styles.userMetricValue, { color: theme.textPrimary }]}>{formatStudyDuration(snapshot.currentUserSeconds)}</AppText>
                    </View>
                  </View>
                ) : (
                  <View style={[styles.emptyBox, { backgroundColor: theme.secondaryCardBackground, borderColor: theme.border }]}>
                    <AppText style={[styles.emptyTitle, { color: theme.textPrimary }]}>本月暂无学习记录</AppText>
                    <AppText style={[styles.emptySubtitle, { color: theme.textSecondary }]}>去精听页面开始学习，学习时长会自动计入排行。</AppText>
                    <Pressable onPress={() => router.push('/library')} style={({ pressed }) => [styles.secondaryButton, { backgroundColor: theme.fillSecondary, borderColor: theme.border }, pressed && styles.pressed]}>
                      <AppText style={[styles.secondaryButtonText, { color: theme.textPrimary }]}>去精听页面开始学习</AppText>
                    </Pressable>
                  </View>
                )}
              </SurfaceCard>
            ) : (
              <SurfaceCard style={styles.sectionCard}>
                <View style={styles.sectionHeader}>
                  <View>
                    <AppText style={[styles.sectionTitle, { color: theme.textPrimary }]}>登录后参与本月学习榜</AppText>
                    <AppText style={[styles.sectionSubtitle, { color: theme.textSecondary }]}>学习时长会自动计入排行，每月榜单会重新开始。</AppText>
                  </View>
                </View>

                <Pressable onPress={() => router.push('/auth/sign-in')} style={({ pressed }) => [styles.primaryButton, { backgroundColor: theme.textPrimary }, pressed && styles.pressed]}>
                  <AppText style={[styles.primaryButtonText, { color: theme.cardBackground }]}>登录 / 注册</AppText>
                </Pressable>
              </SurfaceCard>
            )}

            <SurfaceCard style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <View>
                  <AppText style={[styles.sectionTitle, { color: theme.textPrimary }]}>规则说明</AppText>
                </View>
              </View>

              <View style={styles.ruleStack}>
                {[
                  '统计本月精听、单词、口语学习时长',
                  '每月 1 号重新开始',
                  '本月第一名奖励 ¥99',
                  '奖励发放以后续运营通知为准',
                ].map((rule) => (
                  <View key={rule} style={styles.ruleRow}>
                    <View style={[styles.ruleDot, { backgroundColor: theme.textTertiary }]} />
                    <AppText style={[styles.ruleText, { color: theme.textSecondary }]}>{rule}</AppText>
                  </View>
                ))}
              </View>
            </SurfaceCard>
          </>
        )}
      </View>
    </AppScreenShell>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 32,
  },
  pageContent: {
    paddingHorizontal: SPACING_PAGE_H,
    gap: 14,
  },
  header: {
    paddingTop: 12,
    paddingBottom: 0,
  },
  backRow: {
    paddingHorizontal: SPACING_PAGE_H,
    paddingTop: 4,
    paddingBottom: 10,
  },
  heroCard: {
    padding: 20,
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
    backgroundColor: 'rgba(28,28,30,0.045)',
    borderWidth: 0.5,
    borderColor: 'rgba(28,28,30,0.08)',
  },
  metricRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  metricCard: {
    flex: 1,
    minHeight: 114,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: 'rgba(28,28,30,0.035)',
    borderWidth: 0.5,
    borderColor: 'rgba(28,28,30,0.06)',
    justifyContent: 'flex-start',
  },
  metricLabel: {
    fontSize: FONT_CAPTION,
    lineHeight: 16,
    color: TEXT_SECONDARY,
  },
  metricValue: {
    marginTop: 9,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: TEXT_PRIMARY,
  },
  metricNote: {
    marginTop: 9,
    fontSize: FONT_CAPTION,
    lineHeight: 17,
    color: 'rgba(28,28,30,0.48)',
  },
  stateCard: {
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 22,
    alignItems: 'center',
  },
  stateIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(28,28,30,0.045)',
    borderWidth: 0.5,
    borderColor: 'rgba(28,28,30,0.08)',
  },
  stateTitle: {
    marginTop: 14,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '800',
    color: TEXT_PRIMARY,
    textAlign: 'center',
  },
  stateSubtitle: {
    marginTop: 6,
    fontSize: FONT_CALLOUT,
    lineHeight: 19,
    color: TEXT_SECONDARY,
    textAlign: 'center',
  },
  primaryButton: {
    minWidth: 138,
    marginTop: 18,
    minHeight: 46,
    borderRadius: 16,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TEXT_PRIMARY,
  },
  primaryButtonText: {
    fontSize: FONT_BODY,
    lineHeight: 20,
    fontWeight: '700',
    color: BG_CARD,
  },
  secondaryButton: {
    marginTop: 16,
    minHeight: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(28,28,30,0.045)',
    borderWidth: 0.5,
    borderColor: BORDER_SOFT,
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    fontSize: FONT_BODY,
    lineHeight: 20,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  sectionCard: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 18,
  },
  sectionHeader: {
    marginBottom: 14,
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
    marginTop: 4,
    fontSize: FONT_CALLOUT,
    lineHeight: 18,
    color: TEXT_SECONDARY,
  },
  rankList: {
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: BORDER_SOFT,
    backgroundColor: BG_CARD,
  },
  rankRow: {
    minHeight: 62,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER_SOFT,
  },
  rankRowCurrent: {
    backgroundColor: COLOR_BLUE_BG,
  },
  rankLeading: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rankIndexWrap: {
    width: 42,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  rankBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBadgeGold: {
    backgroundColor: COLOR_AMBER_BG,
  },
  rankBadgeNeutral: {
    backgroundColor: 'rgba(28,28,30,0.05)',
  },
  rankDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: TEXT_TERTIARY,
  },
  rankIndex: {
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '700',
    color: TEXT_SECONDARY,
  },
  rankIndexStrong: {
    color: TEXT_PRIMARY,
  },
  rankMeta: {
    flex: 1,
  },
  rankNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  rankName: {
    fontSize: FONT_BODY,
    lineHeight: 20,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  youPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: COLOR_BLUE_BG,
  },
  youPillText: {
    fontSize: FONT_CAPTION,
    lineHeight: 14,
    fontWeight: '700',
    color: '#246BCE',
  },
  rankDuration: {
    fontSize: FONT_BODY,
    lineHeight: 20,
    fontWeight: '700',
    color: TEXT_SECONDARY,
    flexShrink: 0,
  },
  rankDurationCurrent: {
    color: TEXT_PRIMARY,
  },
  emptyBox: {
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 22,
    backgroundColor: 'rgba(28,28,30,0.03)',
    borderWidth: 0.5,
    borderColor: BORDER_SOFT,
  },
  emptyTitle: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  emptySubtitle: {
    marginTop: 6,
    fontSize: FONT_CALLOUT,
    lineHeight: 19,
    color: TEXT_SECONDARY,
  },
  userCard: {
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: BORDER_SOFT,
    backgroundColor: 'rgba(28,28,30,0.03)',
  },
  userMetric: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 4,
  },
  userMetricLabel: {
    fontSize: FONT_CAPTION,
    lineHeight: 16,
    color: TEXT_SECONDARY,
  },
  userMetricValue: {
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: TEXT_PRIMARY,
  },
  userMetricDivider: {
    height: 0.5,
    backgroundColor: BORDER_SOFT,
  },
  ruleStack: {
    gap: 12,
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  ruleDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 6,
    backgroundColor: TEXT_TERTIARY,
  },
  ruleText: {
    flex: 1,
    fontSize: FONT_BODY,
    lineHeight: 21,
    color: TEXT_SECONDARY,
  },
  pressed: {
    opacity: 0.82,
  },
});
