import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing as EasingR,
  useAnimatedStyle,
  useSharedValue,
  withTiming as withTimingR,
} from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { ChromeIconButton } from '@/components/ui/ApplePrimitives';
import { SCENARIOS } from '@/data/scenarios';
import { useDeviceClass } from '@/hooks/useDeviceClass';
import { useEntitlementGuard } from '@/hooks/useEntitlementGuard';
import { fetchSpeakingCredits, isSpeakingAuthError, type SpeakingCredits } from '@/services/api/speakingPractice';
import { fetchSpeakingHistory, type SpeakingSession } from '@/services/api/speakingSessions';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import { useAiDataConsent } from '@/services/privacy/AiDataConsentProvider';
import { SpeakingV1SelectorScreenTablet } from '@/screens/SpeakingV1SelectorScreenTablet';
import { useAppTheme } from '@/theme/AppThemeProvider';
import { COLOR_RED, TEXT_SECONDARY, resolveSpeakingPreparationHeroPalette, type SpeakingPreparationHeroPalette } from '@/theme/tokens';

type ScenarioItem = (typeof SCENARIOS)[number];

const PREPARATION_GOAL_MAP: Record<string, string[]> = {
  'hotel-checkin': ['确认预订信息并顺利办理入住', '说明房型、入住日期或早餐等需求', '围绕提前入住或景观偏好继续补充细节'],
  'night-market': ['主动询问商品价格和可选款式', '尝试讨论折扣、数量或找零问题', '确认购买决定并自然完成付款'],
  'metro-chat': ['自然开启一段轻松的通勤闲聊', '围绕行程、下车站点或座位继续追问', '在短对话里保持礼貌和松弛的回应节奏'],
  'self-introduction': ['清楚介绍自己的名字和来自哪里', '补充居住地、兴趣或日常信息', '让整段自我介绍听起来自然完整'],
  'daily-greetings': ['熟练说出最常见的问候开场', '围绕今天状态做简短自然回应', '用礼貌结尾完成这一轮日常寒暄'],
  'coffee-order': ['向店员询问当日推荐', '提出客制化需求（冰量/甜度）', '确认订单并完成结账'],
  'restaurant-order': ['向服务员询问菜单或今日推荐', '完成点餐并补充口味或份量需求', '在结尾自然提出买单或加单请求'],
  'shopping-store': ['说明你想找的商品类型或颜色', '询问价格、尺码或是否可以试穿', '确认是否购买并完成结账表达'],
  'asking-directions': ['礼貌开口请路人帮忙指路', '听懂并复述直走、左转等方向信息', '确认目的地路线没有理解偏差'],
  'taxi-ride': ['向司机清楚说明目的地', '追问车程时间、路线或费用情况', '在结束时自然完成付款或致谢'],
  'airport-checkin': ['完成值机开场并递交护照信息', '说明托运行李或座位偏好需求', '确认登机手续和后续出发安排'],
  'doctor-visit': ['清楚描述当前症状和不适感受', '回答发病时间、程度等追问', '听懂医生建议并继续确认处理方式'],
  'phone-appointment': ['在电话里清楚提出预约诉求', '询问可选日期和具体时间段', '确认最终预约信息并礼貌结束通话'],
  'hotel-problem': ['向前台准确说明房间问题', '进一步描述影响并请求协助', '确认换房或维修等解决方案'],
  'job-interview': ['用英文完成清晰有力的自我介绍', '围绕经验、优势和岗位兴趣展开回答', '在追问中保持专业、自然和有逻辑的表达'],
  'meeting-discussion': ['主动表达观点并说明你的理由', '回应同事意见并提出建设性建议', '在讨论中练习赞同、补充和委婉分歧'],
  'small-talk-party': ['在聚会里自然开启第一轮闲聊', '围绕工作、兴趣或主人关系继续提问', '让对话保持轻松、有来有回的节奏'],
  'project-presentation': ['清楚概述项目当前进展', '说明挑战、风险和需要关注的问题', '用更完整的表达收束下一步计划'],
  'opinion-discussion': ['明确表达你的核心观点和立场', '补充例子或理由来支撑判断', '在来回讨论中练习更深入的解释能力'],
};

function handleSpeakingBack() {
  if (typeof router.canGoBack === 'function' && router.canGoBack()) {
    router.back();
    return;
  }
  router.replace('/(tabs)/speaking');
}

function pickRecommendedScenario(history: SpeakingSession[]) {
  const latestScenarioId = history.find((item) => item.scenario_id)?.scenario_id;
  if (latestScenarioId) {
    const latestScenario = SCENARIOS.find((item) => item.id === latestScenarioId);
    if (latestScenario && latestScenario.id !== 'free-chat') return latestScenario;
  }
  return SCENARIOS.find((item) => item.id === 'coffee-order')
    ?? SCENARIOS.find((item) => item.id === 'hotel-checkin')
    ?? SCENARIOS.find((item) => item.id !== 'free-chat')
    ?? SCENARIOS[0];
}

function derivePreparationGoals(scenario: ScenarioItem) {
  const presetGoals = PREPARATION_GOAL_MAP[scenario.id];
  if (presetGoals) return presetGoals;

  const phraseGoals = scenario.targetPhrases.slice(0, 3).map((phrase, index) => {
    if (index === 0) return `尝试自然说出「${phrase}」来打开对话`;
    if (index === 1) return `围绕「${phrase}」继续补充你的真实需求`;
    return `在结尾阶段自然用出「${phrase}」完成这一轮表达`;
  });

  return phraseGoals.length > 0
    ? phraseGoals
    : [
        `自然开启和 ${scenario.aiRole} 的第一轮交流`,
        `围绕「${scenario.name}」清楚表达你的核心需求`,
        '根据对方追问补充细节，并完整完成这一轮对话',
      ];
}

function getPreparationDurationMinutes(scenario: ScenarioItem) {
  if (scenario.level === 'C1') return 15;
  if (scenario.level === 'B2') return 12;
  if (scenario.level === 'B1') return 10;
  return 8;
}

export function SpeakingV1SelectorScreen() {
  const params = useLocalSearchParams<{ scenarioId?: string; scene?: string }>();
  const scenarioIdParam = Array.isArray(params.scenarioId) ? params.scenarioId[0] : params.scenarioId;
  const sceneParam = Array.isArray(params.scene) ? params.scene[0] : params.scene;
  const requestedScenarioId = scenarioIdParam ?? sceneParam ?? null;

  const appSession = useAppSession();
  const aiConsent = useAiDataConsent();
  const { theme } = useAppTheme();
  const { isTablet } = useDeviceClass();
  const insets = useSafeAreaInsets();
  const isLoggedIn = appSession.status === 'authenticated';
  const { guardEntry, status: entitlementStatus } = useEntitlementGuard();

  const [credits, setCredits] = useState<SpeakingCredits | null>(null);
  const [history, setHistory] = useState<SpeakingSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(requestedScenarioId ?? pickRecommendedScenario([]).id);
  const [isSceneSheetMounted, setIsSceneSheetMounted] = useState(false);
  const [accessChecking, setAccessChecking] = useState(false);

  const sceneSheetProgress = useSharedValue(0);
  const sceneSheetCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (sceneSheetCloseTimerRef.current) clearTimeout(sceneSheetCloseTimerRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!appSession.session) return;
      setLoading(true);
      setError(null);
      try {
        const [creditsResponse, historyResponse] = await Promise.all([
          fetchSpeakingCredits(appSession.session),
          fetchSpeakingHistory(appSession.session),
        ]);
        if (cancelled) return;
        setCredits(creditsResponse);
        setHistory(historyResponse);

        const requestedScenario = requestedScenarioId
          ? SCENARIOS.find((item) => item.id === requestedScenarioId && item.id !== 'free-chat')
          : null;
        const recommended = requestedScenario ?? pickRecommendedScenario(historyResponse);
        setSelectedScenarioId(recommended.id);
      } catch (nextError) {
        if (cancelled) return;
        if (isSpeakingAuthError(nextError)) {
          await appSession.invalidateSession();
          if (cancelled) return;
          setCredits(null);
          setHistory([]);
          setError(null);
          return;
        }
        setError(nextError instanceof Error ? nextError.message : '加载 V1 选择页失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (isLoggedIn) {
      void load();
      return () => {
        cancelled = true;
      };
    }

    const fallbackScenario = SCENARIOS.find((item) => item.id === requestedScenarioId && item.id !== 'free-chat') ?? pickRecommendedScenario([]);
    setSelectedScenarioId(fallbackScenario.id);
    setCredits(null);
    setHistory([]);
    setLoading(false);
    setError(null);

    return () => {
      cancelled = true;
    };
  }, [appSession.session, isLoggedIn, requestedScenarioId]);

  const availableScenarios = useMemo(() => SCENARIOS.filter((item) => item.id !== 'free-chat'), []);
  const recommendedScenario = useMemo(() => {
    const requestedScenario = requestedScenarioId
      ? SCENARIOS.find((item) => item.id === requestedScenarioId && item.id !== 'free-chat')
      : null;
    return requestedScenario ?? pickRecommendedScenario(history);
  }, [history, requestedScenarioId]);
  const activeScenario = useMemo(
    () => availableScenarios.find((item) => item.id === selectedScenarioId) ?? recommendedScenario,
    [availableScenarios, recommendedScenario, selectedScenarioId],
  );
  const palette: SpeakingPreparationHeroPalette = useMemo(
    () => resolveSpeakingPreparationHeroPalette(activeScenario.id, theme.colorScheme),
    [activeScenario.id, theme.colorScheme],
  );
  const focusGoals = useMemo(() => derivePreparationGoals(activeScenario), [activeScenario]);
  const estimatedDuration = useMemo(() => getPreparationDurationMinutes(activeScenario), [activeScenario]);
  const primaryLabel = !isLoggedIn ? '登录后开始练习' : '开始标准练习';
  const footerError = appSession.authStateReason === 'expired' ? '登录状态已失效，请重新登录。' : error;
  const entitlementBusy = entitlementStatus === 'loading' || accessChecking;

  const openSceneSheet = () => {
    if (sceneSheetCloseTimerRef.current) clearTimeout(sceneSheetCloseTimerRef.current);
    setIsSceneSheetMounted(true);
    sceneSheetProgress.value = withTimingR(1, {
      duration: 420,
      easing: EasingR.bezier(0.32, 0.72, 0, 1),
    });
  };

  const closeSceneSheet = () => {
    if (sceneSheetCloseTimerRef.current) clearTimeout(sceneSheetCloseTimerRef.current);
    sceneSheetProgress.value = withTimingR(0, {
      duration: 260,
      easing: EasingR.bezier(0.32, 0.72, 0, 1),
    });
    sceneSheetCloseTimerRef.current = setTimeout(() => {
      setIsSceneSheetMounted(false);
    }, 260);
  };

  const sceneBackdropStyle = useAnimatedStyle(() => ({
    opacity: sceneSheetProgress.value,
  }));

  const sceneSheetStyle = useAnimatedStyle(() => ({
    opacity: 0.94 + sceneSheetProgress.value * 0.06,
    transform: [
      {
        translateY: (1 - sceneSheetProgress.value) * 420,
      },
    ],
  }));

  const primaryAction = async () => {
    if (!activeScenario) return;
    if (entitlementBusy) {
      return;
    }
    const consented = await aiConsent.requestConsent();
    if (!consented) return;
    setAccessChecking(true);
    try {
      const ok = await guardEntry('speaking_v1');
      if (!ok) return;
      router.push({
        pathname: '/speaking/v1/practice',
        params: { scenarioId: activeScenario.id },
      });
    } finally {
      setAccessChecking(false);
    }
  };

  if (isTablet) {
    return (
      <SpeakingV1SelectorScreenTablet
        availableScenarios={availableScenarios}
        activeScenario={activeScenario}
        selectedScenarioId={selectedScenarioId}
        focusGoals={focusGoals}
        estimatedDuration={estimatedDuration}
        primaryLabel={primaryLabel}
        footerError={footerError}
        entitlementBusy={entitlementBusy}
        loading={loading}
        isLoggedIn={isLoggedIn}
        credits={credits}
        onSelectScenario={setSelectedScenarioId}
        onPressBack={handleSpeakingBack}
        onPressMore={() => router.push('/speaking/history')}
        onPressPrimary={() => void primaryAction()}
      />
    );
  }

  return (
    <>
      <AppScreenShell
        backgroundColor={theme.pageBackground}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        includeBottomInset={false}
      >
        <View style={styles.topBar}>
          <ChromeIconButton icon="chevron-back" onPress={handleSpeakingBack} accessibilityLabel="返回" />

          <ChromeIconButton
            icon="ellipsis-horizontal"
            onPress={() => router.push('/speaking/history')}
            accessibilityLabel="更多操作"
          />
        </View>

        <View style={styles.contentStack}>
          <View style={styles.heroShell}>
            <View style={[styles.heroCard, { backgroundColor: palette.panel, borderColor: palette.border, shadowOpacity: theme.colorScheme === 'dark' ? 0.18 : 0.05 }]}>
              <View style={[styles.heroWash, styles.heroWashLeft, { backgroundColor: palette.start }]} />
              <View style={[styles.heroWash, styles.heroWashRight, { backgroundColor: palette.end }]} />
              <View style={[styles.heroGlow, styles.heroGlowA, { backgroundColor: palette.washA }]} />
              <View style={[styles.heroGlow, styles.heroGlowB, { backgroundColor: palette.washB }]} />

              <Pressable
                accessibilityRole="button"
                onPress={openSceneSheet}
                style={({ pressed }) => [
                  styles.heroSwitchButton,
                  {
                    backgroundColor: theme.colorScheme === 'dark' ? theme.elevatedCardBackground : palette.switchBg,
                    borderColor: theme.colorScheme === 'dark' ? theme.border : palette.switchBorder,
                  },
                  pressed && { opacity: 0.86, transform: [{ scale: 0.98 }] },
                ]}
              >
                <AppText style={[styles.heroSwitchText, { color: theme.colorScheme === 'dark' ? theme.textPrimary : palette.switchText }]}>切换</AppText>
                <Ionicons name="chevron-down" size={14} color={theme.colorScheme === 'dark' ? theme.textPrimary : palette.switchText} />
              </Pressable>

              <View style={styles.heroContent}>
                <View style={[styles.heroIconWrap, { backgroundColor: palette.iconBg, shadowColor: theme.colorScheme === 'dark' ? palette.washA : '#FFFFFF', shadowOpacity: theme.colorScheme === 'dark' ? 0.24 : 0.16 }]}>
                  <AppText style={styles.heroIconGlyph}>{activeScenario.icon}</AppText>
                </View>

                <View style={styles.heroCopy}>
                  <AppText style={[styles.heroTitle, { color: palette.title }]}>{activeScenario.name}</AppText>
                  <AppText style={[styles.heroSubtitle, { color: palette.subtitle }]}>{activeScenario.description}</AppText>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.metricRow}>
            <View style={[styles.metricCard, { backgroundColor: theme.cardBackground, borderColor: theme.border, shadowOpacity: theme.colorScheme === 'dark' ? 0 : 0.025 }]}>
              <View style={[styles.metricIconWrap, { backgroundColor: 'rgba(59,130,246,0.12)' }]}>
                <Ionicons name="time-outline" size={18} color="#2563EB" />
              </View>
              <AppText style={[styles.metricValue, { color: theme.textPrimary }]}>
                {loading ? '…' : estimatedDuration}
                <AppText style={[styles.metricUnit, { color: theme.textTertiary }]}> 分钟</AppText>
              </AppText>
              <AppText style={[styles.metricLabel, { color: theme.textTertiary }]}>建议时长</AppText>
            </View>

            <View style={[styles.metricCard, { backgroundColor: theme.cardBackground, borderColor: theme.border, shadowOpacity: theme.colorScheme === 'dark' ? 0 : 0.025 }]}>
              <View style={[styles.metricIconWrap, { backgroundColor: 'rgba(168,85,247,0.12)' }]}>
                <Ionicons name="sparkles-outline" size={18} color="#7C3AED" />
              </View>
              <AppText style={[styles.metricValue, { color: theme.textPrimary }]}>轮次练习</AppText>
              <AppText style={[styles.metricLabel, { color: theme.textTertiary }]}>结束后同步记录</AppText>
            </View>
          </View>

          {loading ? (
            <View style={styles.feedbackRow}>
              <ActivityIndicator size="small" color={TEXT_SECONDARY} />
              <AppText style={styles.feedbackText}>正在同步练习信息</AppText>
            </View>
          ) : null}

          <View style={styles.goalSection}>
            <AppText style={[styles.goalEyebrow, { color: theme.textSecondary }]}>对话目标</AppText>
            <View style={[styles.goalPanel, { backgroundColor: theme.cardBackground, borderColor: theme.border, shadowOpacity: theme.colorScheme === 'dark' ? 0 : 0.025 }]}>
              {focusGoals.map((goal, index) => (
                <View
                  key={`${activeScenario.id}-goal-${index}`}
                  style={[
                    styles.goalRow,
                    index < focusGoals.length - 1 && styles.goalRowWithBorder,
                    index < focusGoals.length - 1 && { borderBottomColor: theme.separator },
                  ]}
                >
                  <View style={[styles.goalBadge, { backgroundColor: theme.secondaryCardBackground, shadowOpacity: theme.colorScheme === 'dark' ? 0 : 0.04 }]}>
                    <AppText style={styles.goalBadgeText}>{index === 0 ? '🗣️' : index === 1 ? '📝' : '✅'}</AppText>
                  </View>
                  <View style={styles.goalCopy}>
                    <AppText style={[styles.goalText, { color: theme.textPrimary }]}>{goal}</AppText>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>

        <View style={[styles.footerBlock, { paddingBottom: Math.max(insets.bottom + 24, 50) }]}>
          {footerError ? <AppText style={[styles.footerMessage, { color: theme.destructive }]}>{footerError}</AppText> : null}
          {entitlementBusy ? <AppText style={[styles.footerMessage, { color: theme.textSecondary }]}>正在读取账号权益</AppText> : null}
          <Pressable
            accessibilityRole="button"
            disabled={entitlementBusy || !activeScenario}
            onPress={() => void primaryAction()}
            style={({ pressed }) => [
              styles.primaryButton,
              {
                backgroundColor: theme.primaryBlue,
                borderColor: theme.colorScheme === 'dark' ? 'rgba(163,209,255,0.26)' : theme.primaryBlue,
                shadowColor: theme.primaryBlue,
                shadowOpacity: theme.colorScheme === 'dark' ? 0.34 : 0.18,
              },
              (entitlementBusy || !activeScenario) && styles.primaryButtonDisabled,
              pressed && !entitlementBusy && activeScenario && { transform: [{ scale: 0.985 }], opacity: 0.94 },
            ]}
          >
            <Ionicons name="mic" size={18} color="#FFFFFF" />
            <AppText style={styles.primaryButtonText}>{primaryLabel}</AppText>
          </Pressable>
        </View>
      </AppScreenShell>

      <Modal animationType="none" onRequestClose={closeSceneSheet} statusBarTranslucent transparent visible={isSceneSheetMounted}>
        <View style={styles.sheetModalRoot}>
          <Pressable accessibilityRole="button" onPress={closeSceneSheet} style={StyleSheet.absoluteFillObject}>
            <Animated.View style={[styles.sheetBackdrop, sceneBackdropStyle]}>
              <BlurView intensity={12} tint={theme.colorScheme === 'dark' ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
            </Animated.View>
          </Pressable>

          <Animated.View style={[styles.sheetPanel, sceneSheetStyle, { backgroundColor: theme.cardBackground, paddingBottom: Math.max(insets.bottom, 18) }]}>
            <View style={styles.sheetGrabberWrap}>
              <View style={[styles.sheetGrabber, { backgroundColor: theme.separator }]} />
            </View>

            <View style={styles.sheetHeader}>
              <AppText style={[styles.sheetTitle, { color: theme.textPrimary }]}>切换练习场景</AppText>
              <Pressable accessibilityRole="button" onPress={closeSceneSheet} style={({ pressed }) => [styles.sheetCloseButton, { backgroundColor: theme.secondaryCardBackground, borderColor: theme.border }, pressed && { opacity: 0.72 }]}>
                <Ionicons name="close" size={18} color={theme.textSecondary} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.sheetList} showsVerticalScrollIndicator={false}>
              {availableScenarios.map((item) => {
                const itemPalette = resolveSpeakingPreparationHeroPalette(item.id, theme.colorScheme);
                const isActive = item.id === activeScenario.id;

                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    onPress={() => {
                      setSelectedScenarioId(item.id);
                      closeSceneSheet();
                    }}
                    style={({ pressed }) => [
                      styles.sheetRow,
                      {
                        backgroundColor: isActive
                          ? theme.colorScheme === 'dark'
                            ? 'rgba(10,132,255,0.18)'
                            : 'rgba(0,122,255,0.09)'
                          : theme.secondaryCardBackground,
                        borderColor: isActive ? 'rgba(10,132,255,0.30)' : theme.border,
                      },
                      pressed && { opacity: 0.88, transform: [{ scale: 0.992 }] },
                    ]}
                  >
                    <View style={[styles.sheetRowIconWrap, { backgroundColor: theme.colorScheme === 'dark' ? theme.elevatedCardBackground : itemPalette.panel }]}>
                      <AppText style={styles.sheetRowIcon}>{item.icon}</AppText>
                    </View>

                    <View style={styles.sheetRowCopy}>
                      <AppText style={[styles.sheetRowTitle, { color: theme.textPrimary }, isActive && styles.sheetRowTitleActive]}>{item.name}</AppText>
                      <AppText style={[styles.sheetRowSubtitle, { color: theme.textSecondary }]}>{item.description}</AppText>
                    </View>

                    <View style={styles.sheetRowStatus}>
                      {isActive ? <Ionicons name="checkmark-circle" size={22} color={theme.primaryBlue} /> : <View style={[styles.sheetRowStatusDot, { backgroundColor: theme.fillPrimary }]} />}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 0,
    paddingBottom: 0,
  },
  topBar: {
    paddingTop: 8,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  contentStack: {
    gap: 24,
  },
  heroShell: {
    marginTop: 0,
    marginBottom: 0,
  },
  heroCard: {
    minHeight: 222,
    borderRadius: 32,
    overflow: 'hidden',
    borderWidth: 1,
    shadowColor: '#7C5A2A',
    shadowOpacity: 0.05,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  heroSwitchButton: {
    position: 'absolute',
    top: 18,
    right: 18,
    zIndex: 2,
    minHeight: 34,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  heroSwitchText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  heroWash: {
    ...StyleSheet.absoluteFillObject,
  },
  heroWashLeft: {
    right: '28%',
  },
  heroWashRight: {
    left: '34%',
  },
  heroGlow: {
    position: 'absolute',
    borderRadius: 120,
    opacity: 0.9,
  },
  heroGlowA: {
    width: 178,
    height: 154,
    top: -18,
    left: -12,
    transform: [{ rotate: '-10deg' }],
  },
  heroGlowB: {
    width: 164,
    height: 148,
    bottom: -18,
    right: -18,
    transform: [{ rotate: '8deg' }],
  },
  heroContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 24,
    minHeight: 222,
    justifyContent: 'flex-end',
  },
  heroIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FFFFFF',
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  heroIconGlyph: {
    fontSize: 28,
    lineHeight: 32,
  },
  heroCopy: {
    marginTop: 34,
    gap: 6,
  },
  heroTitle: {
    fontSize: 42,
    lineHeight: 46,
    color: '#18181B',
    fontWeight: '800',
    letterSpacing: -1.1,
  },
  heroSubtitle: {
    fontSize: 17,
    lineHeight: 23,
    color: 'rgba(63,63,70,0.64)',
    fontWeight: '600',
    maxWidth: '84%',
  },
  metricRow: {
    flexDirection: 'row',
    gap: 16,
  },
  metricCard: {
    flex: 1,
    borderRadius: 30,
    paddingHorizontal: 22,
    paddingVertical: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(17,17,17,0.06)',
    shadowColor: '#111827',
    shadowOpacity: 0.025,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  metricIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  metricValue: {
    fontSize: 26,
    lineHeight: 30,
    color: '#18181B',
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  metricUnit: {
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(63,63,70,0.46)',
    fontWeight: '600',
  },
  metricLabel: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(63,63,70,0.4)',
    fontWeight: '600',
  },
  feedbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: -8,
  },
  feedbackText: {
    fontSize: 13,
    lineHeight: 18,
    color: TEXT_SECONDARY,
    fontWeight: '600',
  },
  errorText: {
    marginTop: -8,
    fontSize: 13,
    lineHeight: 18,
    color: COLOR_RED,
  },
  goalSection: {
    marginBottom: 0,
  },
  goalEyebrow: {
    marginBottom: 12,
    fontSize: 16,
    lineHeight: 22,
    color: 'rgba(63,63,70,0.4)',
    fontWeight: '600',
  },
  goalPanel: {
    borderRadius: 32,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(17,17,17,0.06)',
    overflow: 'hidden',
    shadowColor: '#111827',
    shadowOpacity: 0.025,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  goalRowWithBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(15,23,42,0.08)',
  },
  goalBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#111827',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  goalBadgeText: {
    fontSize: 20,
    lineHeight: 24,
  },
  goalCopy: {
    flex: 1,
  },
  goalText: {
    fontSize: 16,
    lineHeight: 22,
    color: 'rgba(39,39,42,0.8)',
    fontWeight: '600',
  },
  footerBlock: {
    marginTop: 28,
    paddingTop: 8,
  },
  footerMessage: {
    marginBottom: 12,
    fontSize: 13,
    lineHeight: 18,
    color: COLOR_RED,
    textAlign: 'center',
  },
  primaryButton: {
    height: 70,
    borderRadius: 999,
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    shadowColor: '#111111',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  primaryButtonDisabled: {
    opacity: 0.42,
  },
  primaryButtonText: {
    fontSize: 17,
    lineHeight: 22,
    color: '#FFFFFF',
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  sheetModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  sheetPanel: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    backgroundColor: '#F2F2F7',
    paddingTop: 10,
    paddingHorizontal: 18,
    shadowColor: '#111111',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -8 },
    elevation: 18,
    maxHeight: '82%',
  },
  sheetGrabberWrap: {
    alignItems: 'center',
    paddingBottom: 10,
  },
  sheetGrabber: {
    width: 36,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(60,60,67,0.18)',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    paddingBottom: 12,
  },
  sheetTitle: {
    fontSize: 22,
    lineHeight: 28,
    color: '#18181B',
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  sheetCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(142,142,147,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(60,60,67,0.08)',
  },
  sheetList: {
    paddingBottom: 6,
    gap: 10,
  },
  sheetRow: {
    minHeight: 82,
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    shadowColor: '#111111',
    shadowOpacity: 0.02,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 0,
  },
  sheetRowIconWrap: {
    width: 50,
    height: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(17,17,17,0.04)',
  },
  sheetRowIcon: {
    fontSize: 24,
    lineHeight: 28,
  },
  sheetRowCopy: {
    flex: 1,
    gap: 3,
  },
  sheetRowTitle: {
    fontSize: 17,
    lineHeight: 22,
    color: '#18181B',
    fontWeight: '700',
  },
  sheetRowTitleActive: {
    color: '#007AFF',
  },
  sheetRowSubtitle: {
    fontSize: 14,
    lineHeight: 19,
    color: '#71717A',
  },
  sheetRowStatus: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetRowStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(113,113,122,0.18)',
  },
});
