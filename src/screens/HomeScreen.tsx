import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { TopRightAvatarButton } from '@/components/ui/TopRightAvatarButton';
import { useDeviceClass } from '@/hooks/useDeviceClass';
import { useBottomFloatingTabInset } from '@/hooks/useBottomFloatingTabInset';
import { useFloatingTabInsets } from '@/hooks/useFloatingTabInsets';
import { useDailyGoalTracker } from '@/hooks/useDailyGoalTracker';
import { useHomeDashboard } from '@/hooks/useHomeDashboard';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import {
  HomeScreenTablet,
  type HomeScreenTabletFeatureItem,
} from '@/screens/HomeScreenTablet';
import { useAppTheme } from '@/theme/AppThemeProvider';
import { useThemeColors } from '@/theme/useThemeColors';
import { BG_CARD, BG_CARD_SOFT, BG_OVERLAY, BG_PAGE, BORDER_SOFT, COLOR_BLUE, COLOR_BLUE_BG, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY } from '@/theme/tokens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type FeatureItem = HomeScreenTabletFeatureItem;

const DAILY_GOAL_OPTIONS = [10, 15, 20, 30, 45, 60] as const;

const DAILY_SUBTITLES = [
  '今天也用英语表达自己',
  '每天进步一点点',
  '开口，就是新的开始',
  '听懂一句，也算前进',
  '让英语慢慢变自然',
  '把今天说成英文',
  '练 10 分钟，也很重要',
  '一句一句，慢慢听懂',
  '先开口，再变好',
  '今天也别怕说错',
  '把难的事做轻一点',
  '多听一句，多懂一点',
  '英语会在重复里变熟',
  '今天比昨天自然一点',
  '慢慢来，也是在前进',
  '先完成，再完美',
  '把表达练成习惯',
  '每天给自己一点进步',
  '听见变化，也看见成长',
  '让开口变得更轻松',
  '不用很快，只要继续',
  '今天也向前一点点',
  '小练习，也有大变化',
  '把一句话说清楚',
  '越常说，越自然',
  '坚持，比天赋更可靠',
  '先听懂，再说出',
  '每一次开口都算数',
  '把英语放进今天',
  '练习会留下痕迹',
  '别急，先说出来',
  '今天的你，也在升级',
  '让表达更像自己',
  '每天靠近流利一点',
  '听力从一句开始',
  '口语从敢说开始',
  '把错误变成进步',
  '重复，是最稳的捷径',
  '今天也认真一点',
  '用英语打开今天',
] as const;

const FEATURES: FeatureItem[] = [
  {
    title: '精听训练',
    subtitle: '听懂原声，掌握细节',
    icon: 'headset',
    tint: '#8E63FF',
    bg: '#F1EAFF',
    route: '/library',
  },
  {
    title: '单词中心',
    subtitle: 'AI 记忆，高效掌握',
    icon: 'book',
    tint: '#2FC37B',
    bg: '#E7F8EF',
    route: '/words',
  },
  {
    title: '口语练习',
    subtitle: '实时对话，提升表达',
    icon: 'mic',
    tint: '#0A84FF',
    bg: '#EAF4FF',
    route: '/speaking',
  },
  {
    title: '学习社区',
    subtitle: '打卡交流，一起进步',
    icon: 'sparkles',
    tint: '#F5A524',
    bg: '#FFF3DC',
    locked: true,
  },
];

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 5) return '凌晨好';
  if (hour < 11) return '早上好';
  if (hour < 13) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function hashString(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function getDailySubtitle() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return DAILY_SUBTITLES[hashString(`${year}-${month}-${day}`) % DAILY_SUBTITLES.length];
}

type IOSGoalCardProps = {
  completedUnits: number;
  progress: number;
  subtitle: string;
  progressSuffix: string;
  onPress: () => void;
};

function IOSGoalCard({
  completedUnits,
  progress,
  subtitle,
  progressSuffix,
  onPress,
}: IOSGoalCardProps) {
  const { theme } = useAppTheme();
  const isDark = theme.colorScheme === 'dark';
  const goalCardBackground =
    isDark
      ? require('../../assets/images/home/daily_goal_dark.png')
      : require('../../assets/images/home/daily_goal_card_bg.png');

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.goalCard,
        isDark && styles.goalCardDark,
        pressed && styles.goalPressed,
      ]}
    >
      <Image
        source={goalCardBackground}
        style={styles.goalBackgroundImage}
        contentFit="cover"
      />

      <View
        pointerEvents="none"
        style={[
          styles.goalInnerBorder,
          isDark && styles.goalInnerBorderDark,
        ]}
      />

      <View style={styles.sparkles}>
        <Ionicons name="sparkles" size={26} color="rgba(255,255,255,0.9)" />
      </View>

      <AppText style={styles.goalTitle}>每日目标</AppText>

      <AppText style={styles.goalSubtitle}>
        {subtitle}
      </AppText>

      <View style={styles.goalProgressRow}>
        <AppText style={styles.goalProgressText}>
          <AppText style={styles.goalProgressStrong}>
            {completedUnits}
          </AppText>
          {progressSuffix}
        </AppText>
      </View>

      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.round(Math.min(progress, 1) * 100)}%` },
          ]}
        />
      </View>
    </Pressable>
  );
}

function DailyGoalSheet({
  visible,
  currentGoal,
  saving,
  onSelect,
  onClose,
}: {
  visible: boolean;
  currentGoal: number;
  saving: boolean;
  onSelect: (minutes: number) => Promise<void>;
  onClose: () => void;
}) {
  const { colors, theme } = useThemeColors();
  const [selectedGoal, setSelectedGoal] = useState(currentGoal);

  React.useEffect(() => {
    if (visible) {
      setSelectedGoal(currentGoal);
    }
  }, [currentGoal, visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.goalSheetRoot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭每日目标设置"
          style={styles.goalSheetBackdrop}
          onPress={onClose}
        />

        <View style={[styles.goalSheetCard, { backgroundColor: colors.cardBackground }]}>
          <View style={[styles.goalSheetHandle, { backgroundColor: colors.textMuted }]} />
          <AppText style={[styles.goalSheetTitle, { color: colors.textPrimary }]}>设置每日目标</AppText>
          <AppText style={[styles.goalSheetSubtitle, { color: colors.textSecondary }]}>
            选择一个适合今天的练习时长
          </AppText>

          <View style={styles.goalOptionGrid}>
            {DAILY_GOAL_OPTIONS.map((minutes) => {
              const active = minutes === selectedGoal;
              return (
                <Pressable
                  key={minutes}
                  disabled={saving}
                  onPress={() => setSelectedGoal(minutes)}
                  style={[
                    styles.goalOption,
                    active && styles.goalOptionActive,
                    saving && styles.goalOptionDisabled,
                    {
                      backgroundColor: active ? COLOR_BLUE_BG : theme.secondaryCardBackground,
                      borderColor: active ? theme.primaryBlue : theme.border,
                    },
                  ]}
                >
                  <AppText
                    style={[
                      styles.goalOptionText,
                      active && styles.goalOptionTextActive,
                      { color: active ? theme.primaryBlue : theme.textSecondary },
                    ]}
                  >
                    {minutes} 分钟
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            disabled={saving}
            onPress={() => {
              void onSelect(selectedGoal);
            }}
            style={({ pressed }) => [
              styles.goalSheetDone,
              saving && styles.goalSheetDoneDisabled,
              pressed && styles.pressed,
            ]}
          >
            <AppText style={styles.goalSheetDoneText}>{saving ? '保存中...' : '完成'}</AppText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function FeatureCard({
  item,
  disabled = false,
  onPress,
}: {
  item: FeatureItem;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors, theme } = useThemeColors();
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.featureCard,
        {
          backgroundColor: colors.cardBackground,
          borderColor: colors.border,
          shadowOpacity: colors.isDark ? 0 : 0.04,
          elevation: colors.isDark ? 0 : 5,
        },
        disabled && styles.featureCardDisabled,
        pressed && styles.pressed,
      ]}
    >
      {theme.colorScheme !== 'dark' ? (
        <View
          style={[
            styles.featureCardHighlight,
            { backgroundColor: 'rgba(255,255,255,0.46)' },
          ]}
        />
      ) : null}

      <View style={[styles.featureIconWrap, { backgroundColor: colors.isDark ? `${item.tint}22` : item.bg }]}>
        <Ionicons name={item.icon} size={23} color={item.tint} />
      </View>

      <View style={styles.featureCopy}>
        <AppText style={[styles.featureTitle, { color: colors.textPrimary }]}>{item.title}</AppText>
        <AppText numberOfLines={1} style={[styles.featureSubtitle, { color: colors.textSecondary }]}>
          {item.subtitle}
        </AppText>
      </View>

      <View style={[styles.featureArrow, { backgroundColor: colors.pressableBackground }]}>
        <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
      </View>
    </Pressable>
  );
}

function RecommendationArtwork({ cover }: { cover?: string | null }) {
  const [failed, setFailed] = useState(false);

  if (cover && !failed) {
    return (
      <View style={styles.recommendArtwork}>
        <Image
          source={cover}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          onError={() => setFailed(true)}
        />
      </View>
    );
  }

  return (
    <View style={styles.recommendArtwork}>
      <View style={styles.skyGlow} />
      <View style={[styles.mountain, styles.mountainBack]} />
      <View style={[styles.mountain, styles.mountainFront]} />
      <View style={styles.waterLine} />
    </View>
  );
}

export function HomeScreen() {
  const { colors, theme } = useThemeColors();
  const { shouldUseTabletLayout } = useDeviceClass();
  const safeAreaInsets = useSafeAreaInsets();
  const floatingInsets = useFloatingTabInsets();
  const bottomInset = useBottomFloatingTabInset();
  const [goalSheetOpen, setGoalSheetOpen] = useState(false);
  const [goalSaving, setGoalSaving] = useState(false);
  const greeting = useMemo(() => getGreeting(), []);
  const subtitle = useMemo(() => getDailySubtitle(), []);
  const session = useAppSession();
  const {
    dailyGoalMinutes,
    loaded: dailyGoalLoaded,
    source: localGoalSource,
    setDailyGoalMinutes,
  } = useDailyGoalTracker(session.session?.user?.id ?? session.user?.id ?? null);
  const { dashboard, rotateRecommendations, refreshHomeRecommendations } = useHomeDashboard({
    localGoalMinutes: dailyGoalMinutes,
    localGoalLoaded: dailyGoalLoaded,
    localGoalSource,
  });
  const homeFocusedRef = useRef(false);
  const sessionRefreshKeyRef = useRef<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      homeFocusedRef.current = true;
      void refreshHomeRecommendations('home_focus');

      return () => {
        homeFocusedRef.current = false;
      };
    }, [refreshHomeRecommendations]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' || !homeFocusedRef.current) {
        return;
      }

      void refreshHomeRecommendations('app_active_home');
    });

    return () => {
      subscription.remove();
    };
  }, [refreshHomeRecommendations]);

  useEffect(() => {
    if (session.isHydrating || session.status !== 'authenticated') {
      return;
    }

    const refreshKey = session.session?.user?.id ?? session.user?.id ?? null;
    if (!refreshKey || sessionRefreshKeyRef.current === refreshKey) {
      return;
    }

    sessionRefreshKeyRef.current = refreshKey;
    void refreshHomeRecommendations('session_restored');
  }, [
    refreshHomeRecommendations,
    session.isHydrating,
    session.session?.user?.id,
    session.status,
    session.user?.id,
  ]);

  const handleFeaturePress = useCallback((item: FeatureItem) => {
    if (item.locked) {
      Alert.alert(
        '学习社区待开放',
        '这个功能正在打磨中，后续会开放学习打卡、交流和成长记录。',
        [{ text: '我知道了' }],
      );
      return;
    }

    if (item.route) {
      router.navigate(item.route);
    }
  }, []);

  const handleSetDailyGoalMinutes = useCallback(
    async (minutes: number) => {
      if (goalSaving) {
        return;
      }

      setGoalSaving(true);
      try {
        await setDailyGoalMinutes(minutes);
        setGoalSheetOpen(false);
      } catch (error) {
        Alert.alert('设置失败', error instanceof Error ? error.message : '每日目标暂时无法保存，请稍后重试。');
      } finally {
        setGoalSaving(false);
      }
    },
    [goalSaving, setDailyGoalMinutes],
  );

  const goalSubtitle = dashboard.loading && !dailyGoalLoaded
    ? '正在读取每日目标'
    : dashboard.goal.helperText;
  const goalProgressSuffix = dashboard.goal.targetMinutes > 0
    ? ` / ${dashboard.goal.targetMinutes} 分钟`
    : ' / 未设置';
  const resolvedHomeTopPadding =
    (floatingInsets.placement === 'top' ? floatingInsets.top : safeAreaInsets.top) + 4;

  return (
    <>
      {shouldUseTabletLayout ? (
        <HomeScreenTablet
          greeting={greeting}
          subtitle={subtitle}
          dashboard={dashboard}
          features={FEATURES}
          onOpenGoalSheet={() => setGoalSheetOpen(true)}
          onFeaturePress={handleFeaturePress}
          onOpenLearningRecords={() => router.push('/my/learning')}
          onRotateRecommendations={rotateRecommendations}
        />
      ) : (
        <SafeAreaView edges={['left', 'right']} style={[styles.safeArea, { backgroundColor: colors.pageBackground }]}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentInsetAdjustmentBehavior="never"
            contentContainerStyle={[
              styles.content,
              { paddingTop: resolvedHomeTopPadding },
              { paddingBottom: bottomInset + 28 },
            ]}
          >
            <View style={styles.header}>
              <View style={styles.headerCopy}>
                <AppText style={[styles.greeting, { color: colors.textPrimary }]}>{greeting}</AppText>
                <AppText style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{subtitle}</AppText>
              </View>

              <TopRightAvatarButton consumer="home" onPress={() => router.navigate('/my')} />
            </View>

            <IOSGoalCard
              completedUnits={dashboard.goal.completedUnits}
              progress={dashboard.goal.progressRatio}
              subtitle={goalSubtitle}
              progressSuffix={goalProgressSuffix}
              onPress={() => setGoalSheetOpen(true)}
            />

            <View style={styles.featureGrid}>
              {FEATURES.map((item) => (
                <FeatureCard
                  key={item.title}
                  item={item}
                  onPress={() => handleFeaturePress(item)}
                />
              ))}
            </View>

            <View style={styles.recommendSection}>
              <AppText style={[styles.recommendSectionTitle, { color: colors.textSecondary }]}>今日推荐</AppText>

              {dashboard.recommendations.length > 0 ? (
                dashboard.recommendations.map((episode) => (
                  <Pressable
                    key={episode.id}
                    onPress={() => router.push(episode.href as never)}
                    style={({ pressed }) => [
                      styles.recommendCard,
                      {
                        backgroundColor: colors.cardBackground,
                        shadowOpacity: colors.isDark ? 0 : 0.04,
                        elevation: colors.isDark ? 0 : 5,
                      },
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.recommendText}>
                      <AppText numberOfLines={2} style={[styles.recommendTitle, { color: colors.textPrimary }]}>
                        {episode.title}
                      </AppText>
                    </View>

                    <RecommendationArtwork cover={episode.imageUrl ?? null} />
                  </Pressable>
                ))
              ) : (
                <Pressable
                  onPress={() => router.push('/library')}
                  style={({ pressed }) => [
                    styles.recommendCard,
                    {
                      backgroundColor: colors.cardBackground,
                      shadowOpacity: colors.isDark ? 0 : 0.04,
                      elevation: colors.isDark ? 0 : 5,
                    },
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.recommendText}>
                    <AppText numberOfLines={2} style={[styles.recommendTitle, { color: colors.textPrimary }]}>
                      {dashboard.recommendationEmptyConfirmed ? '今日暂无推荐内容' : '正在载入推荐内容'}
                    </AppText>
                  </View>

                  <RecommendationArtwork cover={null} />
                </Pressable>
              )}
            </View>
          </ScrollView>
        </SafeAreaView>
      )}

      <DailyGoalSheet
        visible={goalSheetOpen}
        currentGoal={dailyGoalMinutes}
        saving={goalSaving}
        onSelect={handleSetDailyGoalMinutes}
        onClose={() => {
          if (goalSaving) return;
          setGoalSheetOpen(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: BG_PAGE,
  },

  content: {
    paddingHorizontal: 12,
    paddingTop: 4,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 4,
  },

  headerCopy: {
    flex: 1,
    paddingRight: 16,
  },

  greeting: {
    fontSize: 31,
    lineHeight: 36,
    fontWeight: '900',
    letterSpacing: -1.05,
    color: TEXT_PRIMARY,
  },

  headerSubtitle: {
    marginTop: 4,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    color: TEXT_SECONDARY,
  },

  goalCard: {
    width: '100%',
    height: 204,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#1040D0',

    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 13 },

    elevation: 8,
  },

  goalCardDark: {
    backgroundColor: '#0B2A67',
    shadowOpacity: 0.02,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 0,
  },

  goalBackgroundImage: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 28,
  },

  goalInnerBorder: {
    position: 'absolute',
    inset: 0,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    zIndex: 3,
  },

  goalInnerBorderDark: {
    borderWidth: 0,
    borderColor: 'transparent',
  },

  goalPressed: {
    opacity: 0.96,
    transform: [{ scale: 0.995 }],
  },

  sparkles: {
    position: 'absolute',
    left: 23,
    top: 20,
    width: 31,
    height: 31,
    zIndex: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  goalTitle: {
    position: 'absolute',
    left: 24,
    top: 80,
    zIndex: 2,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '900',
    letterSpacing: -0.28,
    color: '#FFFFFF',
  },

  goalSubtitle: {
    position: 'absolute',
    left: 24,
    top: 113,
    zIndex: 2,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.86)',
  },

  goalProgressText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.82)',
  },

  goalProgressRow: {
    position: 'absolute',
    left: 24,
    bottom: 39,
    zIndex: 2,
  },

  goalProgressStrong: {
    fontSize: 23,
    lineHeight: 26,
    fontWeight: '900',
    color: '#FFFFFF',
  },

  progressTrack: {
    position: 'absolute',
    left: 24,
    bottom: 22,
    zIndex: 2,
    width: 210,
    height: 5,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
  },

  progressFill: {
    height: '100%',
    borderRadius: 99,
    backgroundColor: '#FFFFFF',
  },

  goalSheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },

  goalSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BG_OVERLAY,
  },

  goalSheetCard: {
    marginHorizontal: 14,
    marginBottom: 14,
    borderRadius: 30,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 18,
    backgroundColor: BG_CARD,
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 18 },
    elevation: 16,
  },

  goalSheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 99,
    backgroundColor: TEXT_TERTIARY,
    marginBottom: 17,
  },

  goalSheetTitle: {
    fontSize: 23,
    lineHeight: 29,
    fontWeight: '900',
    letterSpacing: -0.45,
    color: TEXT_PRIMARY,
    textAlign: 'center',
  },

  goalSheetSubtitle: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
    color: TEXT_SECONDARY,
    textAlign: 'center',
  },

  goalOptionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
    marginTop: 22,
  },

  goalOption: {
    width: '48%',
    minHeight: 48,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BG_CARD_SOFT,
    borderWidth: 1,
    borderColor: BORDER_SOFT,
  },

  goalOptionDisabled: {
    opacity: 0.72,
  },

  goalOptionActive: {
    backgroundColor: COLOR_BLUE_BG,
    borderColor: COLOR_BLUE,
  },

  goalOptionText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
    color: TEXT_SECONDARY,
  },

  goalOptionTextActive: {
    color: COLOR_BLUE,
  },

  goalSheetDone: {
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
    backgroundColor: COLOR_BLUE,
  },

  goalSheetDoneDisabled: {
    opacity: 0.72,
  },

  goalSheetDoneText: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
    color: '#FFFFFF',
  },

  featureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 10,
    rowGap: 10,
    marginTop: 18,
  },

  featureCard: {
    width: '48.55%',
    minHeight: 132,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: BG_CARD,
    overflow: 'hidden',

    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 8 },

    elevation: 5,
  },
  featureCardDisabled: {
    opacity: 0.7,
  },

  featureCardHighlight: {
    position: 'absolute',
    left: 1,
    right: 1,
    top: 0,
    height: 58,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.46)',
  },

  pressed: {
    opacity: 0.78,
  },

  featureIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 23,
  },

  featureCopy: {
    paddingRight: 24,
  },

  featureTitle: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '900',
    letterSpacing: -0.35,
    color: TEXT_PRIMARY,
  },

  featureSubtitle: {
    marginTop: 5,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: TEXT_SECONDARY,
  },

  featureArrow: {
    position: 'absolute',
    right: 14,
    bottom: 16,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BG_CARD_SOFT,
  },

  recommendSection: {
    marginTop: 16,
    gap: 10,
  },

  recommendText: {
    flex: 1,
    paddingRight: 14,
  },

  recommendSectionTitle: {
    paddingHorizontal: 4,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
    color: TEXT_SECONDARY,
  },

  recommendCard: {
    minHeight: 98,
    borderRadius: 22,
    backgroundColor: BG_CARD,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',

    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 8 },

    elevation: 5,
  },

  recommendTitle: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '900',
    letterSpacing: -0.3,
    color: TEXT_PRIMARY,
  },

  recommendArtwork: {
    width: 112,
    height: 72,
    borderRadius: 13,
    overflow: 'hidden',
    backgroundColor: '#BFD9EE',
  },

  skyGlow: {
    position: 'absolute',
    right: -18,
    top: -16,
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: '#F5E0C4',
    opacity: 0.62,
  },

  mountain: {
    position: 'absolute',
    bottom: -24,
    width: 92,
    height: 92,
    backgroundColor: '#667F87',
    transform: [{ rotate: '45deg' }],
  },

  mountainBack: {
    left: 42,
    backgroundColor: '#8EA5AA',
  },

  mountainFront: {
    left: -16,
    bottom: -32,
    backgroundColor: '#4E686E',
  },

  waterLine: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: '100%',
    height: 22,
    backgroundColor: 'rgba(129,174,202,0.58)',
  },
});
