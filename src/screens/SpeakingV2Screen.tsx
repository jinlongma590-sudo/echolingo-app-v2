import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Blur, Canvas, Circle, Group, Paint, Path, Rect, Skia } from '@shopify/react-native-skia';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import {
  Easing as EasingR,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming as withTimingR,
} from 'react-native-reanimated';

import { AppText } from '../components/AppText';
import { AppScreenShell } from '../components/layout/AppScreenShell';
import { SectionCard } from '../components/SectionCard';
import {
  ActionButton,
  ChromeIconButton,
  MetricTile,
  StatusPill,
} from '../components/ui/ApplePrimitives';
import { PageHeader } from '../components/ui/PageHeader';
import { SCENARIOS } from '../data/scenarios';
import { useEntitlementGuard } from '../hooks/useEntitlementGuard';
import { useAiDataConsent } from '../services/privacy/AiDataConsentProvider';
import {
  type SpeakingV2RuntimeContextValue,
  useSpeakingV2RuntimeContext,
} from '../hooks/speaking/SpeakingV2RuntimeProvider';
import {
  BG_PAGE,
  COLOR_RED,
  FONT_CALLOUT,
  FONT_CAPTION,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  resolveSpeakingPreparationHeroPalette,
  type SpeakingPreparationHeroPalette,
} from '../theme/tokens';
import { useAppTheme } from '../theme/AppThemeProvider';
import type { SpeakingV2TranscriptItem } from '../types/speakingV2';
import { useDeviceClass } from '../hooks/useDeviceClass';
import { SpeakingV2EntryScreenTablet } from './SpeakingV2EntryScreenTablet';

// ─── Types ────────────────────────────────────────────────────────────────────

type CallVisualState =
  | 'connecting'
  | 'idle'
  | 'user_speaking'
  | 'thinking'
  | 'ai_speaking';

type RuntimeType = SpeakingV2RuntimeContextValue['runtime'];
type ScenarioItem = (typeof SCENARIOS)[number];

const V2_PREP_DURATION_MIN = 8;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)
    .toString()
    .padStart(2, '0')}:${(safe % 60).toString().padStart(2, '0')}`;
}

function connectionLabel(status: string) {
  switch (status) {
    case 'starting':
      return '启动中';
    case 'connecting':
      return '连接中';
    case 'connected':
      return '已连接';
    case 'reconnecting':
      return '重连中';
    case 'ending':
      return '结束中';
    case 'completed':
      return '已结束';
    case 'error':
      return '异常';
    default:
      return '未开始';
  }
}

function handleSpeakingBack() {
  if (typeof router.canGoBack === 'function' && router.canGoBack()) {
    router.back();
    return;
  }
  router.replace('/(tabs)/speaking');
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const PREPARATION_GOAL_MAP: Record<string, string[]> = {
  'hotel-checkin': [
    '确认预订信息并顺利办理入住',
    '说明房型、入住日期或早餐等需求',
    '围绕提前入住或景观偏好继续补充细节',
  ],
  'night-market': [
    '主动询问商品价格和可选款式',
    '尝试讨论折扣、数量或找零问题',
    '确认购买决定并自然完成付款',
  ],
  'metro-chat': [
    '自然开启一段轻松的通勤闲聊',
    '围绕行程、下车站点或座位继续追问',
    '在短对话里保持礼貌和松弛的回应节奏',
  ],
  'self-introduction': [
    '清楚介绍自己的名字和来自哪里',
    '补充居住地、兴趣或日常信息',
    '让整段自我介绍听起来自然完整',
  ],
  'daily-greetings': [
    '熟练说出最常见的问候开场',
    '围绕今天状态做简短自然回应',
    '用礼貌结尾完成这一轮日常寒暄',
  ],
  'coffee-order': [
    '向店员询问当日推荐',
    '提出客制化需求（冰量/甜度）',
    '确认订单并完成结账',
  ],
  'restaurant-order': [
    '向服务员询问菜单或今日推荐',
    '完成点餐并补充口味或份量需求',
    '在结尾自然提出买单或加单请求',
  ],
  'shopping-store': [
    '说明你想找的商品类型或颜色',
    '询问价格、尺码或是否可以试穿',
    '确认是否购买并完成结账表达',
  ],
  'asking-directions': [
    '礼貌开口请路人帮忙指路',
    '听懂并复述直走、左转等方向信息',
    '确认目的地路线没有理解偏差',
  ],
  'taxi-ride': [
    '向司机清楚说明目的地',
    '追问车程时间、路线或费用情况',
    '在结束时自然完成付款或致谢',
  ],
  'airport-checkin': [
    '完成值机开场并递交护照信息',
    '说明托运行李或座位偏好需求',
    '确认登机手续和后续出发安排',
  ],
  'doctor-visit': [
    '清楚描述当前症状和不适感受',
    '回答发病时间、程度等追问',
    '听懂医生建议并继续确认处理方式',
  ],
  'phone-appointment': [
    '在电话里清楚提出预约诉求',
    '询问可选日期和具体时间段',
    '确认最终预约信息并礼貌结束通话',
  ],
  'hotel-problem': [
    '向前台准确说明房间问题',
    '进一步描述影响并请求协助',
    '确认换房或维修等解决方案',
  ],
  'job-interview': [
    '用英文完成清晰有力的自我介绍',
    '围绕经验、优势和岗位兴趣展开回答',
    '在追问中保持专业、自然和有逻辑的表达',
  ],
  'meeting-discussion': [
    '主动表达观点并说明你的理由',
    '回应同事意见并提出建设性建议',
    '在讨论中练习赞同、补充和委婉分歧',
  ],
  'small-talk-party': [
    '在聚会里自然开启第一轮闲聊',
    '围绕工作、兴趣或主人关系继续提问',
    '让对话保持轻松、有来有回的节奏',
  ],
  'project-presentation': [
    '清楚概述项目当前进展',
    '说明挑战、风险和需要关注的问题',
    '用更完整的表达收束下一步计划',
  ],
  'opinion-discussion': [
    '明确表达你的核心观点和立场',
    '补充例子或理由来支撑判断',
    '在来回讨论中练习更深入的解释能力',
  ],
  'free-chat': [
    '围绕任意话题自然开启对话',
    '根据对方回应自由延展话题方向',
    '让交流保持轻松、连续和真实的口语节奏',
  ],
};

function derivePreparationGoals(scenario: ScenarioItem) {
  return (
    PREPARATION_GOAL_MAP[scenario.id] ?? [
      `自然开启和 ${scenario.aiRole} 的第一轮交流`,
      `围绕「${scenario.name}」清楚表达你的核心需求`,
      '根据对方追问补充细节，并完整完成这一轮对话',
    ]
  );
}

function getPreparationDurationMinutes(scenario: ScenarioItem) {
  if (scenario.level === 'C1') return 15;
  if (scenario.level === 'B2') return 12;
  if (scenario.level === 'B1') return 10;
  return V2_PREP_DURATION_MIN;
}

function formatMetricValue(value: number | null | undefined) {
  return typeof value === 'number' ? String(value) : '--';
}

function buildReplayItems(reviewPayload: RuntimeType['state']['reviewPayload']) {
  return reviewPayload?.replayItems ?? [];
}

// ─── Round control button (shared) ───────────────────────────────────────────

function RoundControlButton({
  icon,
  active = false,
  filled = false,
  onPress,
  size = 56,
  iconSize = 22,
  disabled = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  active?: boolean;
  filled?: boolean;
  onPress: () => void;
  size?: number;
  iconSize?: number;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: filled
          ? 'rgba(255,255,255,0.92)'
          : active
            ? 'rgba(255,255,255,0.16)'
            : 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.10)',
        opacity: disabled ? 0.35 : pressed ? 0.82 : 1,
      })}
    >
      <Ionicons
        name={icon}
        size={iconSize}
        color={filled ? '#000000' : '#FFFFFF'}
      />
    </Pressable>
  );
}

function TopBarSpacer({ size = 44 }: { size?: number }) {
  return <View style={{ width: size, height: size }} pointerEvents="none" />;
}

// ─── Skia orb canvas ──────────────────────────────────────────────────────────

function SkiaOrbCanvas({
  width,
  height,
  callVisualState,
}: {
  width: number;
  height: number;
  callVisualState: CallVisualState;
}) {
  const canvasWidth = width * 1.12;
  const canvasHeight = height * 1.14;
  const base = Math.min(width, height) * 0.88;
  const CX = canvasWidth / 2;
  const CY = canvasHeight * 0.47;
  const offsetX = (width - canvasWidth) / 2;
  const offsetY = -height * 0.04;

  const stateScale = useSharedValue(1);
  const stateOpacity = useSharedValue(0.88);
  const pulseAmount = useSharedValue(0.018);
  const motionAmount = useSharedValue(1);
  const orbit = useSharedValue(0);

  useEffect(() => {
    const nextScale =
      callVisualState === 'connecting'
        ? 0.56
        : callVisualState === 'user_speaking'
          ? 1.1
          : callVisualState === 'thinking'
            ? 0.86
            : callVisualState === 'ai_speaking'
              ? 1.06
              : 1;

    const nextOpacity =
      callVisualState === 'connecting'
        ? 0.46
        : callVisualState === 'thinking'
          ? 0.78
          : callVisualState === 'ai_speaking'
            ? 0.96
            : callVisualState === 'user_speaking'
              ? 0.93
              : 0.88;

    const nextPulse =
      callVisualState === 'connecting'
        ? 0.012
        : callVisualState === 'thinking'
          ? 0.01
          : callVisualState === 'ai_speaking'
            ? 0.03
            : callVisualState === 'user_speaking'
              ? 0.02
              : 0.014;

    const nextMotion =
      callVisualState === 'connecting'
        ? 0.36
        : callVisualState === 'thinking'
          ? 0.52
          : callVisualState === 'ai_speaking'
            ? 0.82
            : callVisualState === 'user_speaking'
              ? 0.94
              : 0.62;

    stateScale.value = withTimingR(nextScale, {
      duration: 650,
      easing: EasingR.out(EasingR.ease),
    });
    stateOpacity.value = withTimingR(nextOpacity, {
      duration: 650,
      easing: EasingR.out(EasingR.ease),
    });
    pulseAmount.value = withTimingR(nextPulse, {
      duration: 650,
      easing: EasingR.out(EasingR.ease),
    });
    motionAmount.value = withTimingR(nextMotion, {
      duration: 650,
      easing: EasingR.out(EasingR.ease),
    });
  }, [callVisualState, motionAmount, pulseAmount, stateOpacity, stateScale]);

  useEffect(() => {
    orbit.value = 0;
    orbit.value = withRepeat(
      withTimingR(Math.PI * 2, {
        duration: 9600,
        easing: EasingR.linear,
      }),
      -1,
      false,
    );
  }, [orbit]);

  const animatedStyle = useAnimatedStyle(() => {
    const pulse = 1 + Math.sin(orbit.value * 1.9) * pulseAmount.value;
    return {
      opacity: stateOpacity.value,
      transform: [{ scale: stateScale.value * pulse }],
    };
  });

  const pinkX = useDerivedValue(
    () => CX - base * 0.07 + Math.cos(orbit.value + 0.2) * 13 * motionAmount.value,
  );
  const pinkY = useDerivedValue(
    () => CY + base * 0.07 + Math.sin(orbit.value + 0.2) * 15 * motionAmount.value,
  );
  const blueX = useDerivedValue(
    () =>
      CX +
      base * 0.08 +
      Math.cos(orbit.value * 1.06 + Math.PI * 0.92) * 14 * motionAmount.value,
  );
  const blueY = useDerivedValue(
    () =>
      CY +
      base * 0.03 +
      Math.sin(orbit.value * 1.06 + Math.PI * 0.92) * 11 * motionAmount.value,
  );
  const purpleX = useDerivedValue(
    () =>
      CX +
      Math.cos(orbit.value * 0.92 + Math.PI * 1.44) * 12 * motionAmount.value,
  );
  const purpleY = useDerivedValue(
    () =>
      CY -
      base * 0.09 +
      Math.sin(orbit.value * 0.92 + Math.PI * 1.44) * 12 * motionAmount.value,
  );
  const whiteX = useDerivedValue(
    () => CX + Math.cos(orbit.value * 0.9 + 0.8) * 4 * motionAmount.value,
  );
  const whiteY = useDerivedValue(
    () => CY + Math.sin(orbit.value * 0.88 + 0.4) * 4 * motionAmount.value,
  );
  const whiteHighlightX = useDerivedValue(
    () => whiteX.value - base * 0.02 + Math.cos(orbit.value * 1.24 + 1.2) * 3 * motionAmount.value,
  );
  const whiteHighlightY = useDerivedValue(
    () => whiteY.value - base * 0.03 + Math.sin(orbit.value * 1.16 + 0.8) * 2 * motionAmount.value,
  );
  const pinkEdgeX = useDerivedValue(
    () => pinkX.value - base * 0.035 + Math.cos(orbit.value * 1.18 + 1.4) * 5 * motionAmount.value,
  );
  const pinkEdgeY = useDerivedValue(
    () => pinkY.value + base * 0.018 + Math.sin(orbit.value * 1.12 + 1.1) * 5 * motionAmount.value,
  );
  const blueEdgeX = useDerivedValue(
    () => blueX.value + base * 0.03 + Math.cos(orbit.value * 1.1 + Math.PI * 0.36) * 5 * motionAmount.value,
  );
  const blueEdgeY = useDerivedValue(
    () => blueY.value - base * 0.016 + Math.sin(orbit.value * 1.08 + Math.PI * 0.28) * 4 * motionAmount.value,
  );
  const purpleEdgeX = useDerivedValue(
    () => purpleX.value + Math.cos(orbit.value * 1.02 + 2.2) * 4 * motionAmount.value,
  );
  const purpleEdgeY = useDerivedValue(
    () => purpleY.value - base * 0.022 + Math.sin(orbit.value * 1.04 + 2.1) * 4 * motionAmount.value,
  );

  const pinkRadius = base * 0.215;
  const blueRadius = base * 0.232;
  const purpleRadius = base * 0.222;
  const whiteCore = base * 0.054;
  const whiteBloom = base * 0.092;
  const whiteHighlight = base * 0.028;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: offsetX,
          top: offsetY,
          width: canvasWidth,
          height: canvasHeight,
        },
        animatedStyle,
      ]}
    >
      <Canvas style={{ flex: 1 }}>
        <Group layer={<Paint><Blur blur={39} /></Paint>} blendMode="screen">
          <Rect x={0} y={0} width={canvasWidth} height={canvasHeight} color="transparent" />
          <Circle cx={pinkX} cy={pinkY} r={pinkRadius * 1.08} color="rgba(255,118,170,0.12)" />
          <Circle cx={blueX} cy={blueY} r={blueRadius * 1.06} color="rgba(120,190,255,0.13)" />
          <Circle cx={purpleX} cy={purpleY} r={purpleRadius * 1.06} color="rgba(218,170,255,0.12)" />
          <Circle cx={pinkEdgeX} cy={pinkEdgeY} r={pinkRadius * 0.9} color="rgba(255,132,178,0.08)" />
          <Circle cx={blueEdgeX} cy={blueEdgeY} r={blueRadius * 0.88} color="rgba(134,198,255,0.08)" />
          <Circle cx={purpleEdgeX} cy={purpleEdgeY} r={purpleRadius * 0.88} color="rgba(224,184,255,0.08)" />
          <Circle cx={pinkX} cy={pinkY} r={pinkRadius} color="rgba(255,112,166,0.56)" />
          <Circle cx={blueX} cy={blueY} r={blueRadius} color="rgba(96,178,255,0.6)" />
          <Circle cx={purpleX} cy={purpleY} r={purpleRadius} color="rgba(208,154,255,0.56)" />
        </Group>

        <Group layer={<Paint><Blur blur={13} /></Paint>} blendMode="screen">
          <Rect x={0} y={0} width={canvasWidth} height={canvasHeight} color="transparent" />
          <Circle cx={whiteX} cy={whiteY} r={whiteBloom} color="rgba(255,255,255,0.06)" />
          <Circle cx={whiteX} cy={whiteY} r={whiteCore} color="rgba(255,255,255,0.14)" />
          <Circle cx={whiteHighlightX} cy={whiteHighlightY} r={whiteHighlight} color="rgba(255,255,255,0.1)" />
        </Group>
      </Canvas>
    </Animated.View>
  );
}

function NativeOrbCanvas({
  width,
  height,
  callVisualState,
}: {
  width: number;
  height: number;
  callVisualState: CallVisualState;
}) {
  const orbWidth = width * 0.84;
  const orbHeight = height * 0.86;
  const base = Math.min(width, height) * 0.88;
  const centerX = orbWidth / 2;
  const centerY = orbHeight * 0.47;
  const offsetX = (width - orbWidth) / 2;
  const offsetY = -height * 0.04;

  const stateScale = useSharedValue(1);
  const stateOpacity = useSharedValue(0.88);
  const pulseAmount = useSharedValue(0.018);
  const motionAmount = useSharedValue(1);
  const orbit = useSharedValue(0);

  useEffect(() => {
    const nextScale =
      callVisualState === 'connecting'
        ? 0.56
        : callVisualState === 'user_speaking'
          ? 1.1
          : callVisualState === 'thinking'
            ? 0.86
            : callVisualState === 'ai_speaking'
              ? 1.06
              : 1;

    const nextOpacity =
      callVisualState === 'connecting'
        ? 0.46
        : callVisualState === 'thinking'
          ? 0.78
          : callVisualState === 'ai_speaking'
            ? 0.96
            : callVisualState === 'user_speaking'
              ? 0.93
              : 0.88;

    const nextPulse =
      callVisualState === 'connecting'
        ? 0.012
        : callVisualState === 'thinking'
          ? 0.01
          : callVisualState === 'ai_speaking'
            ? 0.03
            : callVisualState === 'user_speaking'
              ? 0.02
              : 0.014;

    const nextMotion =
      callVisualState === 'connecting'
        ? 0.36
        : callVisualState === 'thinking'
          ? 0.52
          : callVisualState === 'ai_speaking'
            ? 0.82
            : callVisualState === 'user_speaking'
              ? 0.94
              : 0.62;

    stateScale.value = withTimingR(nextScale, {
      duration: 650,
      easing: EasingR.out(EasingR.ease),
    });
    stateOpacity.value = withTimingR(nextOpacity, {
      duration: 650,
      easing: EasingR.out(EasingR.ease),
    });
    pulseAmount.value = withTimingR(nextPulse, {
      duration: 650,
      easing: EasingR.out(EasingR.ease),
    });
    motionAmount.value = withTimingR(nextMotion, {
      duration: 650,
      easing: EasingR.out(EasingR.ease),
    });
  }, [callVisualState, motionAmount, pulseAmount, stateOpacity, stateScale]);

  useEffect(() => {
    orbit.value = 0;
    orbit.value = withRepeat(
      withTimingR(Math.PI * 2, {
        duration: 9600,
        easing: EasingR.linear,
      }),
      -1,
      false,
    );
  }, [orbit]);

  const shellStyle = useAnimatedStyle(() => {
    const pulse = 1 + Math.sin(orbit.value * 1.9) * pulseAmount.value;
    return {
      opacity: stateOpacity.value,
      transform: [{ scale: stateScale.value * pulse }],
    };
  });

  const pinkRadius = base * 0.215;
  const blueRadius = base * 0.232;
  const purpleRadius = base * 0.222;
  const whiteCore = base * 0.05;

  const pinkStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: Math.cos(orbit.value + 0.2) * 13 * motionAmount.value },
      { translateY: Math.sin(orbit.value + 0.2) * 15 * motionAmount.value },
    ],
  }));
  const blueStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: Math.cos(orbit.value * 1.06 + Math.PI * 0.92) * 14 * motionAmount.value },
      { translateY: Math.sin(orbit.value * 1.06 + Math.PI * 0.92) * 11 * motionAmount.value },
    ],
  }));
  const purpleStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: Math.cos(orbit.value * 0.92 + Math.PI * 1.44) * 12 * motionAmount.value },
      { translateY: Math.sin(orbit.value * 0.92 + Math.PI * 1.44) * 12 * motionAmount.value },
    ],
  }));
  const whiteStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: Math.cos(orbit.value * 0.9 + 0.8) * 4 * motionAmount.value },
      { translateY: Math.sin(orbit.value * 0.88 + 0.4) * 4 * motionAmount.value },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: offsetX,
          top: offsetY,
          width: orbWidth,
          height: orbHeight,
          alignItems: 'center',
          justifyContent: 'center',
        },
        shellStyle,
      ]}
    >
      <Animated.View
        style={[
          nativeOrbStyles.orb,
          {
            width: pinkRadius * 2.1,
            height: pinkRadius * 2.1,
            borderRadius: pinkRadius * 1.05,
            left: centerX - pinkRadius * 1.05 - base * 0.07,
            top: centerY - pinkRadius * 1.05 + base * 0.07,
            backgroundColor: 'rgba(255,112,166,0.48)',
            shadowColor: '#FF78AA',
            shadowOpacity: 0.88,
            shadowRadius: 54,
          },
          pinkStyle,
        ]}
      />
      <Animated.View
        style={[
          nativeOrbStyles.orb,
          {
            width: blueRadius * 2.14,
            height: blueRadius * 2.14,
            borderRadius: blueRadius * 1.07,
            left: centerX - blueRadius * 1.07 + base * 0.08,
            top: centerY - blueRadius * 1.07 + base * 0.03,
            backgroundColor: 'rgba(96,178,255,0.5)',
            shadowColor: '#60B2FF',
            shadowOpacity: 0.92,
            shadowRadius: 56,
          },
          blueStyle,
        ]}
      />
      <Animated.View
        style={[
          nativeOrbStyles.orb,
          {
            width: purpleRadius * 2.08,
            height: purpleRadius * 2.08,
            borderRadius: purpleRadius * 1.04,
            left: centerX - purpleRadius * 1.04,
            top: centerY - purpleRadius * 1.04 - base * 0.09,
            backgroundColor: 'rgba(208,154,255,0.46)',
            shadowColor: '#D09AFF',
            shadowOpacity: 0.84,
            shadowRadius: 52,
          },
          purpleStyle,
        ]}
      />
      <Animated.View
        style={[
          nativeOrbStyles.whiteCore,
          {
            width: whiteCore * 2.6,
            height: whiteCore * 2.6,
            borderRadius: whiteCore * 1.3,
            left: centerX - whiteCore * 1.3,
            top: centerY - whiteCore * 1.3,
            shadowRadius: 26,
          },
          whiteStyle,
        ]}
      />
    </Animated.View>
  );
}

function ScoreRing({
  score,
  size = 160,
  trackColor = '#2C2C2E',
  progressColor = '#0A84FF',
  valueColor = '#FFFFFF',
  labelColor = '#8E8E93',
}: {
  score: number | null;
  size?: number;
  trackColor?: string;
  progressColor?: string;
  valueColor?: string;
  labelColor?: string;
}) {
  const stroke = size <= 144 ? 10 : 12;
  const radius = (size - stroke) / 2 - 4;
  const center = size / 2;
  const progress = clamp((score ?? 0) / 100, 0, 1);

  const progressPath = useMemo(() => {
    const path = Skia.Path.Make();
    path.addArc(
      {
        x: center - radius,
        y: center - radius,
        width: radius * 2,
        height: radius * 2,
      },
      -90,
      360 * progress,
    );
    return path;
  }, [center, progress, radius]);

  return (
    <View style={[reportStyles.scoreWrap, { width: size, height: size }]}>
      <Canvas style={{ width: size, height: size }}>
        <Circle
          cx={center}
          cy={center}
          r={radius}
          color={trackColor}
          style="stroke"
          strokeWidth={stroke}
        />
        <Path
          path={progressPath}
          color={progressColor}
          style="stroke"
          strokeWidth={stroke}
          strokeCap="round"
        />
      </Canvas>

      <View style={reportStyles.scoreCenter}>
        <AppText style={[reportStyles.scoreValue, { color: valueColor }]}>{score ?? '--'}</AppText>
        <AppText style={[reportStyles.scoreLabel, { color: labelColor }]}>总体评分</AppText>
      </View>
    </View>
  );
}

function ReportScreenTablet({
  scenario,
  runtime,
  onClose,
  onReplay,
}: {
  scenario: (typeof SCENARIOS)[number];
  runtime: RuntimeType;
  onClose: () => void;
  onReplay: () => void;
}) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { theme } = useAppTheme();
  const reviewPayload = runtime.state.reviewPayload;
  const metrics = reviewPayload?.metrics;
  const replayItems = buildReplayItems(reviewPayload);
  const isDark = theme.colorScheme === 'dark';
  const reportPalette = isDark
    ? {
        overlay: 'rgba(0,0,0,0.74)',
        reportCard: '#111113',
        card: 'rgba(28,28,30,0.92)',
        cardSoft: 'rgba(255,255,255,0.05)',
        border: 'rgba(255,255,255,0.10)',
        separator: 'rgba(255,255,255,0.08)',
        title: '#F5F5F7',
        body: 'rgba(245,245,247,0.68)',
        muted: 'rgba(245,245,247,0.46)',
        closeBg: 'rgba(255,255,255,0.08)',
        closeIcon: 'rgba(255,255,255,0.68)',
        ringTrack: 'rgba(255,255,255,0.12)',
        cta: theme.primaryBlue,
      }
    : {
        overlay: 'rgba(242,244,248,0.96)',
        reportCard: theme.cardBackground,
        card: theme.secondaryCardBackground,
        cardSoft: 'rgba(255,255,255,0.86)',
        border: theme.border,
        separator: theme.separator,
        title: theme.textPrimary,
        body: theme.textSecondary,
        muted: theme.textTertiary,
        closeBg: 'rgba(0,0,0,0.06)',
        closeIcon: theme.textSecondary,
        ringTrack: 'rgba(60,60,67,0.16)',
        cta: theme.primaryBlue,
      };

  return (
    <View style={[reportTabletStyles.overlay, { backgroundColor: reportPalette.overlay }]}>
      <View
        style={[
          reportTabletStyles.card,
          {
            width: Math.min(screenWidth - 48, 1220),
            height: screenHeight - 72,
            maxHeight: screenHeight - 72,
            backgroundColor: reportPalette.reportCard,
            borderColor: reportPalette.border,
          },
        ]}
      >
        <Pressable
          onPress={onClose}
          style={({ pressed }) => [
            reportTabletStyles.closeButton,
            {
              backgroundColor: reportPalette.closeBg,
              borderColor: reportPalette.separator,
            },
            pressed && { opacity: 0.82 },
          ]}
        >
          <Ionicons name="close" size={20} color={reportPalette.closeIcon} />
        </Pressable>

        <View style={reportTabletStyles.columns}>
          <View style={reportTabletStyles.leftColumn}>
            <View style={reportTabletStyles.leftContent}>
              <AppText style={[reportTabletStyles.title, { color: reportPalette.title }]}>本次表现</AppText>
              <AppText style={[reportTabletStyles.subtitle, { color: reportPalette.body }]}>回顾这次实时通话中的表现与下一轮重点。</AppText>

              <View
                style={[
                  reportTabletStyles.scorePanel,
                  {
                    backgroundColor: reportPalette.cardSoft,
                    borderColor: reportPalette.separator,
                  },
                ]}
              >
                <ScoreRing
                  score={metrics?.overall.value ?? null}
                  size={134}
                  trackColor={reportPalette.ringTrack}
                  progressColor={theme.primaryBlue}
                  valueColor={reportPalette.title}
                  labelColor={reportPalette.muted}
                />
              </View>

              <View style={reportTabletStyles.metricStack}>
                <View
                  style={[
                    reportTabletStyles.metricCard,
                    {
                      backgroundColor: reportPalette.card,
                      borderColor: reportPalette.separator,
                    },
                  ]}
                >
                  <View style={reportTabletStyles.metricCardHeader}>
                    <AppText style={[reportTabletStyles.metricLabel, { color: reportPalette.muted }]}>自然表达度</AppText>
                    <AppText style={[reportTabletStyles.metricValue, { color: '#32D74B' }]}>
                      {formatMetricValue(metrics?.naturalness?.value)}
                    </AppText>
                  </View>
                  <AppText numberOfLines={2} style={[reportTabletStyles.metricReason, { color: reportPalette.body }]}>
                    {metrics?.naturalness?.reason || '表达是否自然、贴近真实交流'}
                  </AppText>
                </View>

                <View
                  style={[
                    reportTabletStyles.metricCard,
                    {
                      backgroundColor: reportPalette.card,
                      borderColor: reportPalette.separator,
                    },
                  ]}
                >
                  <View style={reportTabletStyles.metricCardHeader}>
                    <AppText style={[reportTabletStyles.metricLabel, { color: reportPalette.muted }]}>流利度</AppText>
                    <AppText style={[reportTabletStyles.metricValue, { color: '#FFD60A' }]}>
                      {formatMetricValue(metrics?.fluency.value)}
                    </AppText>
                  </View>
                  <AppText numberOfLines={2} style={[reportTabletStyles.metricReason, { color: reportPalette.body }]}>
                    {metrics?.fluency.reason || '关注表达连贯度与停顿节奏'}
                  </AppText>
                </View>

                <View
                  style={[
                    reportTabletStyles.metricCard,
                    {
                      backgroundColor: reportPalette.card,
                      borderColor: reportPalette.separator,
                    },
                  ]}
                >
                  <View style={reportTabletStyles.metricCardHeader}>
                    <AppText style={[reportTabletStyles.metricLabel, { color: reportPalette.muted }]}>语法</AppText>
                    <AppText style={[reportTabletStyles.metricValue, { color: '#0A84FF' }]}>
                      {formatMetricValue(metrics?.grammar.value)}
                    </AppText>
                  </View>
                  <AppText numberOfLines={2} style={[reportTabletStyles.metricReason, { color: reportPalette.body }]}>
                    {metrics?.grammar.reason || '关注句式准确度与表达清晰度'}
                  </AppText>
                </View>
              </View>
            </View>

            <View style={reportTabletStyles.leftFooter}>
              <Pressable
                onPress={onReplay}
                style={({ pressed }) => [
                  reportTabletStyles.primaryButton,
                  { backgroundColor: reportPalette.cta },
                  pressed && { opacity: 0.86 },
                ]}
              >
                <Ionicons name="refresh" size={18} color="#FFFFFF" />
                <AppText style={reportTabletStyles.primaryButtonText}>继续练习</AppText>
              </Pressable>
            </View>
          </View>

          <View style={reportTabletStyles.rightColumn}>
            <ScrollView
              style={reportTabletStyles.rightScroll}
              contentContainerStyle={reportTabletStyles.rightScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <AppText style={[reportTabletStyles.replayTitle, { color: reportPalette.title }]}>对话回放与表达建议</AppText>

              {replayItems.length > 0 ? (
                replayItems.map((item) =>
                  item.role === 'ai' ? (
                    <View
                      key={item.id}
                      style={[
                        reportTabletStyles.aiBubble,
                        {
                          backgroundColor: reportPalette.card,
                          borderColor: reportPalette.separator,
                        },
                      ]}
                    >
                      <AppText style={[reportTabletStyles.bubbleRole, { color: reportPalette.muted }]}>{scenario.aiName} (AI)</AppText>
                      <AppText style={[reportTabletStyles.bubbleText, { color: reportPalette.title }]}>{item.text}</AppText>
                    </View>
                  ) : (
                    <View
                      key={item.id}
                      style={[
                        reportTabletStyles.userBubble,
                        {
                          backgroundColor: reportPalette.card,
                          borderColor: reportPalette.separator,
                        },
                      ]}
                    >
                      <View style={reportTabletStyles.userAccentBar} />
                      <View style={reportTabletStyles.userBubbleHeader}>
                        <AppText style={[reportTabletStyles.bubbleRole, { color: reportPalette.muted }]}>你的表达</AppText>
                        <View style={reportTabletStyles.scorePill}>
                          <AppText style={reportTabletStyles.scorePillText}>
                            {metrics?.overall.value ?? '--'}
                          </AppText>
                        </View>
                      </View>

                      <AppText style={[reportTabletStyles.userOriginalText, { color: reportPalette.title }]}>{item.text}</AppText>

                      <View
                        style={[
                          reportTabletStyles.suggestionCard,
                          {
                            backgroundColor: reportPalette.cardSoft,
                            borderColor: reportPalette.separator,
                          },
                        ]}
                      >
                        <View style={reportTabletStyles.suggestionHeader}>
                          <Ionicons name="checkmark-circle" size={14} color="#32D74B" />
                          <AppText style={reportTabletStyles.suggestionTitle}>表达优化</AppText>
                        </View>
                        <AppText style={[reportTabletStyles.suggestionText, { color: reportPalette.title }]}>
                          {item.correction?.fixed || '继续保持清楚、完整的表达'}
                        </AppText>
                        <AppText style={[reportTabletStyles.suggestionNote, { color: reportPalette.body }]}>
                          {item.correction?.note || item.unavailableReason || '建议优先练习完整句表达，并补充具体细节。'}
                        </AppText>
                      </View>
                    </View>
                  ),
                )
              ) : (
                <View
                  style={[
                    reportTabletStyles.warningCard,
                    {
                      backgroundColor: reportPalette.cardSoft,
                      borderColor: reportPalette.separator,
                    },
                  ]}
                >
                  <View style={reportTabletStyles.sectionHeader}>
                    <Ionicons name="document-text-outline" size={17} color="#8E8E93" />
                    <AppText style={[reportTabletStyles.warningTitle, { color: reportPalette.title }]}>暂无可回放内容</AppText>
                  </View>
                  <AppText style={[reportTabletStyles.warningText, { color: reportPalette.body }]}>
                    本轮没有拿到足够的实时转写，因此无法展示对话回放。
                  </AppText>
                </View>
              )}

              <View
                style={[
                  reportTabletStyles.coachCard,
                  reportTabletStyles.rightSectionCard,
                  {
                    backgroundColor: reportPalette.cardSoft,
                    borderColor: reportPalette.separator,
                  },
                ]}
              >
                <View style={reportTabletStyles.sectionHeader}>
                  <Ionicons name="sparkles" size={18} color="#BF5AF2" />
                  <AppText style={[reportTabletStyles.sectionTitle, { color: reportPalette.title }]}>AI 导师点评</AppText>
                </View>
                <AppText style={[reportTabletStyles.coachBody, { color: reportPalette.body }]}>
                  {reviewPayload?.aiCoachFeedback || '本轮有效转写不足，建议再练一轮以生成完整点评。'}
                </AppText>
              </View>

            </ScrollView>
          </View>
        </View>
      </View>
    </View>
  );
}

function ReportScreen({
  scenario,
  runtime,
  onClose,
  onReplay,
}: {
  scenario: (typeof SCENARIOS)[number];
  runtime: RuntimeType;
  onClose: () => void;
  onReplay: () => void;
}) {
  const { isTablet } = useDeviceClass();
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const reviewPayload = runtime.state.reviewPayload;
  const metrics = reviewPayload?.metrics;
  const replayItems = buildReplayItems(reviewPayload);

  if (isTablet) {
    return (
      <ReportScreenTablet
        scenario={scenario}
        runtime={runtime}
        onClose={onClose}
        onReplay={onReplay}
      />
    );
  }

  return (
    <View style={reportStyles.overlay}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 28, 40) }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[reportStyles.header, { paddingTop: Math.max(insets.top + 8, 54) }]}>
          <AppText style={reportStyles.headerTitle}>本次表现</AppText>
          <Pressable onPress={onClose} style={({ pressed }) => [reportStyles.closeButton, pressed && { opacity: 0.82 }]}>
            <Ionicons name="close" size={20} color="#8E8E93" />
          </Pressable>
        </View>

        <View style={reportStyles.content}>
          <View style={reportStyles.scoreSection}>
            <ScoreRing score={metrics?.overall.value ?? null} />
          </View>

          <View style={reportStyles.metricRow}>
            <View style={reportStyles.metricCard}>
              <AppText style={reportStyles.metricLabel}>自然表达度</AppText>
              <AppText style={[reportStyles.metricValue, { color: '#32D74B' }]}>
                {formatMetricValue(metrics?.naturalness?.value)}
              </AppText>
              <AppText style={reportStyles.metricReason}>
                {metrics?.naturalness?.reason || '表达是否自然、贴近真实交流'}
              </AppText>
            </View>
            <View style={reportStyles.metricCard}>
              <AppText style={reportStyles.metricLabel}>流利度</AppText>
              <AppText style={[reportStyles.metricValue, { color: '#FFD60A' }]}>
                {formatMetricValue(metrics?.fluency.value)}
              </AppText>
              <AppText style={reportStyles.metricReason}>
                {metrics?.fluency.reason || '关注表达连贯度与停顿节奏'}
              </AppText>
            </View>
            <View style={reportStyles.metricCard}>
              <AppText style={reportStyles.metricLabel}>语法</AppText>
              <AppText style={[reportStyles.metricValue, { color: '#0A84FF' }]}>
                {formatMetricValue(metrics?.grammar.value)}
              </AppText>
              <AppText style={reportStyles.metricReason}>
                {metrics?.grammar.reason || '关注句式准确度与表达清晰度'}
              </AppText>
            </View>
          </View>

          <View style={reportStyles.aiCoachCard}>
            <View style={reportStyles.aiCoachHeader}>
              <Ionicons name="sparkles" size={18} color="#BF5AF2" />
              <AppText style={reportStyles.aiCoachTitle}>AI 导师点评</AppText>
            </View>
            <AppText style={reportStyles.aiCoachBody}>
              {reviewPayload?.aiCoachFeedback ||
                '根据本轮对话表现，建议下一轮用完整句表达核心需求，并补充一到两个细节。'}
            </AppText>
          </View>

          <AppText style={reportStyles.replayTitle}>对话回放与表达建议</AppText>

          {replayItems.length > 0 ? (
            replayItems.map((item) =>
              item.role === 'ai' ? (
                <View key={item.id} style={reportStyles.aiBubble}>
                  <AppText style={reportStyles.bubbleRole}>{scenario.aiName} (AI)</AppText>
                  <AppText style={reportStyles.bubbleText}>{item.text}</AppText>
                </View>
              ) : (
                <View key={item.id} style={reportStyles.userBubble}>
                  <View style={reportStyles.userAccentBar} />
                  <View style={reportStyles.userBubbleHeader}>
                    <AppText style={reportStyles.bubbleRole}>你的表达</AppText>
                    <View style={reportStyles.scorePill}>
                      <AppText style={reportStyles.scorePillText}>
                        {metrics?.overall.value ?? '--'}
                      </AppText>
                    </View>
                  </View>

                  <AppText style={[reportStyles.userOriginalText, { textDecorationLine: 'none' }]}>
                    {item.text}
                  </AppText>

                  <View style={reportStyles.suggestionCard}>
                    <View style={reportStyles.suggestionHeader}>
                      <Ionicons name="checkmark-circle" size={14} color="#32D74B" />
                      <AppText style={reportStyles.suggestionTitle}>表达优化</AppText>
                    </View>
                    <AppText style={reportStyles.suggestionText}>
                      {item.correction?.fixed || '继续保持清楚、完整的表达'}
                    </AppText>
                    <AppText style={reportStyles.suggestionNote}>
                      {item.correction?.note ||
                        item.unavailableReason ||
                        '建议优先练习完整句表达，并补充具体细节。'}
                    </AppText>
                  </View>

                  <View style={reportStyles.replayActions}>
                    <Pressable style={({ pressed }) => [reportStyles.inlineAction, pressed && { opacity: 0.7 }]} onPress={onReplay}>
                      <Ionicons name="mic" size={13} color="#BF5AF2" />
                      <AppText style={[reportStyles.inlineActionText, { color: '#BF5AF2' }]}>再来一轮</AppText>
                    </Pressable>
                  </View>
                </View>
              ),
            )
          ) : (
            <View style={reportStyles.warningCard}>
              <View style={reportStyles.aiCoachHeader}>
                <Ionicons name="document-text-outline" size={17} color="#8E8E93" />
                <AppText style={reportStyles.warningTitle}>暂无可回放内容</AppText>
              </View>
              <AppText style={reportStyles.warningText}>本轮对话内容较少，继续练习后会展示更完整的回放与建议。</AppText>
            </View>
          )}

          <Pressable onPress={onReplay} style={({ pressed }) => [reportStyles.primaryButton, pressed && { opacity: 0.86 }]}>
            <Ionicons name="refresh" size={18} color="#FFFFFF" />
            <AppText style={reportStyles.primaryButtonText}>继续练习</AppText>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Legacy V2 entry page (/speaking/v2) ─────────────────────────────────────

function LegacySpeakingV2Screen({
  scenario,
  runtime: _runtime,
  isLoggedIn,
}: {
  scenario: ScenarioItem;
  runtime: RuntimeType;
  isLoggedIn: boolean;
}) {
  const { theme } = useAppTheme();
  const aiConsent = useAiDataConsent();
  const { isTablet } = useDeviceClass();
  const insets = useSafeAreaInsets();
  const { guardEntry, status: entitlementStatus } = useEntitlementGuard();
  const [activeScenarioId, setActiveScenarioId] = useState(scenario.id);
  const [isSceneSheetMounted, setIsSceneSheetMounted] = useState(false);
  const [accessChecking, setAccessChecking] = useState(false);
  const sceneSheetCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sceneSheetProgress = useSharedValue(0);

  useEffect(() => {
    setActiveScenarioId(scenario.id);
  }, [scenario.id]);

  useEffect(() => {
    return () => {
      if (sceneSheetCloseTimerRef.current) clearTimeout(sceneSheetCloseTimerRef.current);
    };
  }, []);

  const activeScenario = useMemo(
    () => SCENARIOS.find((item) => item.id === activeScenarioId) ?? scenario,
    [activeScenarioId, scenario],
  );
  const palette: SpeakingPreparationHeroPalette = useMemo(
    () => resolveSpeakingPreparationHeroPalette(activeScenario.id, theme.colorScheme),
    [activeScenario.id, theme.colorScheme],
  );
  const focusGoals = useMemo(() => derivePreparationGoals(activeScenario), [activeScenario]);
  const estimatedDuration = useMemo(
    () => getPreparationDurationMinutes(activeScenario),
    [activeScenario],
  );
  const primaryLabel = !isLoggedIn ? '登录后开始练习' : '开始实景对练';
  const heroSubtitle =
    activeScenario.id === 'coffee-order' ? '日常沉浸式口语练习' : activeScenario.description;
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
    if (entitlementBusy) {
      return;
    }
    const consented = await aiConsent.requestConsent();
    if (!consented) return;
    setAccessChecking(true);
    try {
      const ok = await guardEntry('speaking_v2');
      if (!ok) return;
      router.push({
        pathname: '/speaking/v2/call',
        params: { scenarioId: activeScenario.id },
      });
    } finally {
      setAccessChecking(false);
    }
  };

  if (isTablet) {
    return (
      <SpeakingV2EntryScreenTablet
        availableScenarios={SCENARIOS}
        activeScenario={activeScenario}
        selectedScenarioId={activeScenarioId}
        focusGoals={focusGoals}
        estimatedDuration={estimatedDuration}
        primaryLabel={primaryLabel}
        entitlementBusy={entitlementBusy}
        isLoggedIn={isLoggedIn}
        onSelectScenario={setActiveScenarioId}
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
        contentContainerStyle={prepStyles.scrollContent}
        showsVerticalScrollIndicator={false}
        includeBottomInset={false}
      >
        <View style={prepStyles.topBar}>
          <ChromeIconButton icon="chevron-back" onPress={handleSpeakingBack} accessibilityLabel="返回" />

          <ChromeIconButton
            icon="ellipsis-horizontal"
            onPress={() => router.push('/speaking/history')}
            accessibilityLabel="更多操作"
          />
        </View>

        <View style={prepStyles.contentStack}>
          <View style={prepStyles.heroShell}>
            <View
              style={[
                prepStyles.heroCard,
                {
                  backgroundColor: palette.panel,
                  borderColor: palette.border,
                  shadowOpacity: theme.colorScheme === 'dark' ? 0.18 : 0.05,
                },
              ]}
            >
              <View style={[prepStyles.heroWash, prepStyles.heroWashLeft, { backgroundColor: palette.start }]} />
              <View style={[prepStyles.heroWash, prepStyles.heroWashRight, { backgroundColor: palette.end }]} />
              <View style={[prepStyles.heroGlow, prepStyles.heroGlowA, { backgroundColor: palette.washA }]} />
              <View style={[prepStyles.heroGlow, prepStyles.heroGlowB, { backgroundColor: palette.washB }]} />

              <Pressable
                accessibilityRole="button"
                onPress={openSceneSheet}
                style={({ pressed }) => [
                  prepStyles.heroSwitchButton,
                  {
                    backgroundColor: theme.colorScheme === 'dark' ? theme.elevatedCardBackground : palette.switchBg,
                    borderColor: theme.colorScheme === 'dark' ? theme.border : palette.switchBorder,
                  },
                  pressed && { opacity: 0.86, transform: [{ scale: 0.98 }] },
                ]}
              >
                <AppText style={[prepStyles.heroSwitchText, { color: theme.colorScheme === 'dark' ? theme.textPrimary : palette.switchText }]}>切换</AppText>
                <Ionicons name="chevron-down" size={14} color={theme.colorScheme === 'dark' ? theme.textPrimary : palette.switchText} />
              </Pressable>

              <View style={prepStyles.heroContent}>
                <View style={[prepStyles.heroIconWrap, { backgroundColor: palette.iconBg, shadowColor: theme.colorScheme === 'dark' ? palette.washA : '#FFFFFF', shadowOpacity: theme.colorScheme === 'dark' ? 0.24 : 0.16 }]}>
                  <AppText style={prepStyles.heroIconGlyph}>{activeScenario.icon}</AppText>
                </View>

                <View style={prepStyles.heroCopy}>
                  <AppText style={[prepStyles.heroTitle, { color: palette.title }]}>{activeScenario.name}</AppText>
                  <AppText style={[prepStyles.heroSubtitle, { color: palette.subtitle }]}>{heroSubtitle}</AppText>
                </View>
              </View>
            </View>
          </View>

          <View style={prepStyles.metricRow}>
            <View style={[prepStyles.metricCard, { backgroundColor: theme.cardBackground, borderColor: theme.border, shadowOpacity: theme.colorScheme === 'dark' ? 0 : 0.025 }]}>
              <View style={[prepStyles.metricIconWrap, { backgroundColor: 'rgba(59,130,246,0.12)' }]}>
                <Ionicons name="time-outline" size={18} color="#2563EB" />
              </View>
              <AppText style={[prepStyles.metricValue, { color: theme.textPrimary }]}>
                {estimatedDuration}
                <AppText style={[prepStyles.metricUnit, { color: theme.textTertiary }]}> 分钟</AppText>
              </AppText>
              <AppText style={[prepStyles.metricLabel, { color: theme.textTertiary }]}>建议时长</AppText>
            </View>

            <View style={[prepStyles.metricCard, { backgroundColor: theme.cardBackground, borderColor: theme.border, shadowOpacity: theme.colorScheme === 'dark' ? 0 : 0.025 }]}>
              <View style={[prepStyles.metricIconWrap, { backgroundColor: 'rgba(168,85,247,0.12)' }]}>
                <Ionicons name="sparkles-outline" size={18} color="#7C3AED" />
              </View>
              <AppText style={[prepStyles.metricValue, { color: theme.textPrimary }]}>实时对话</AppText>
              <AppText style={[prepStyles.metricLabel, { color: theme.textTertiary }]}>结束后同步记录</AppText>
            </View>
          </View>

          <View style={prepStyles.goalSection}>
            <AppText style={[prepStyles.goalEyebrow, { color: theme.textSecondary }]}>对话目标</AppText>

            <View style={[prepStyles.goalPanel, { backgroundColor: theme.cardBackground, borderColor: theme.border, shadowOpacity: theme.colorScheme === 'dark' ? 0 : 0.025 }]}>
              {focusGoals.map((goal, index) => (
                <View
                  key={`${activeScenario.id}-goal-${index}`}
                  style={[
                    prepStyles.goalRow,
                    index < focusGoals.length - 1 && prepStyles.goalRowWithBorder,
                    index < focusGoals.length - 1 && { borderBottomColor: theme.separator },
                  ]}
                >
                  <View style={[prepStyles.goalBadge, { backgroundColor: theme.secondaryCardBackground, shadowOpacity: theme.colorScheme === 'dark' ? 0 : 0.04 }]}>
                    <AppText style={prepStyles.goalBadgeText}>
                      {index === 0 ? '🗣️' : index === 1 ? '📝' : '✅'}
                    </AppText>
                  </View>

                  <View style={prepStyles.goalCopy}>
                    <AppText style={[prepStyles.goalText, { color: theme.textPrimary }]}>{goal}</AppText>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>

        <View style={[prepStyles.footerBlock, { paddingBottom: Math.max(insets.bottom + 24, 50) }]}>
          {entitlementBusy ? (
            <AppText style={[prepStyles.footerMessage, { color: theme.textSecondary }]}>正在读取账号权益</AppText>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={entitlementBusy}
            onPress={() => void primaryAction()}
            style={({ pressed }) => [
              prepStyles.primaryButton,
              {
                backgroundColor: theme.primaryBlue,
                borderColor: theme.colorScheme === 'dark' ? 'rgba(163,209,255,0.26)' : theme.primaryBlue,
                shadowColor: theme.primaryBlue,
                shadowOpacity: theme.colorScheme === 'dark' ? 0.34 : 0.18,
              },
              entitlementBusy && prepStyles.primaryButtonDisabled,
              pressed && !entitlementBusy && { transform: [{ scale: 0.985 }], opacity: 0.94 },
            ]}
          >
            <Ionicons name="mic" size={18} color="#FFFFFF" />
            <AppText style={prepStyles.primaryButtonText}>{primaryLabel}</AppText>
          </Pressable>
        </View>
      </AppScreenShell>

      <Modal
        animationType="none"
        onRequestClose={closeSceneSheet}
        statusBarTranslucent
        transparent
        visible={isSceneSheetMounted}
      >
        <View style={prepStyles.sheetModalRoot}>
          <Pressable accessibilityRole="button" onPress={closeSceneSheet} style={StyleSheet.absoluteFillObject}>
            <Animated.View style={[prepStyles.sheetBackdrop, sceneBackdropStyle]}>
              <BlurView intensity={12} tint={theme.colorScheme === 'dark' ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
            </Animated.View>
          </Pressable>

          <Animated.View style={[prepStyles.sheetPanel, sceneSheetStyle, { backgroundColor: theme.cardBackground, paddingBottom: Math.max(insets.bottom, 18) }]}>
            <View style={prepStyles.sheetGrabberWrap}>
              <View style={[prepStyles.sheetGrabber, { backgroundColor: theme.separator }]} />
            </View>

            <View style={prepStyles.sheetHeader}>
              <AppText style={[prepStyles.sheetTitle, { color: theme.textPrimary }]}>切换练习场景</AppText>
              <Pressable
                accessibilityRole="button"
                onPress={closeSceneSheet}
                style={({ pressed }) => [prepStyles.sheetCloseButton, { backgroundColor: theme.secondaryCardBackground, borderColor: theme.border }, pressed && { opacity: 0.72 }]}
              >
                <Ionicons name="close" size={18} color={theme.textSecondary} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={prepStyles.sheetList}
              showsVerticalScrollIndicator={false}
            >
              {SCENARIOS.map((item) => {
                const itemPalette = resolveSpeakingPreparationHeroPalette(item.id, theme.colorScheme);
                const isActive = item.id === activeScenario.id;

                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    onPress={() => {
                      setActiveScenarioId(item.id);
                      closeSceneSheet();
                    }}
                    style={({ pressed }) => [
                      prepStyles.sheetRow,
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
                    <View style={[prepStyles.sheetRowIconWrap, { backgroundColor: theme.colorScheme === 'dark' ? theme.elevatedCardBackground : itemPalette.panel }]}>
                      <AppText style={prepStyles.sheetRowIcon}>{item.icon}</AppText>
                    </View>

                    <View style={prepStyles.sheetRowCopy}>
                      <AppText style={[prepStyles.sheetRowTitle, { color: theme.textPrimary }, isActive && prepStyles.sheetRowTitleActive]}>
                        {item.name}
                      </AppText>
                      <AppText style={[prepStyles.sheetRowSubtitle, { color: theme.textSecondary }]}>{item.description}</AppText>
                    </View>

                    <View style={prepStyles.sheetRowStatus}>
                      {isActive ? (
                        <Ionicons name="checkmark-circle" size={22} color={theme.primaryBlue} />
                      ) : (
                        <View style={[prepStyles.sheetRowStatusDot, { backgroundColor: theme.fillPrimary }]} />
                      )}
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

// ─── Immersive call stage (/speaking/v2/call) ────────────────────────────────

function CallStageScreen({
  scenario,
  runtime,
  isLoggedIn,
}: {
  scenario: (typeof SCENARIOS)[number];
  runtime: RuntimeType;
  isLoggedIn: boolean;
}) {
  const insets = useSafeAreaInsets();
  const aiConsent = useAiDataConsent();
  const { width: screenWidth } = useWindowDimensions();
  const autoStartedRef = useRef(false);
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [currentView, setCurrentView] = useState<'call' | 'report'>('call');
  const allowAutoStart = true;

  const [stageLayout, setStageLayout] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const callVisualState = useMemo<CallVisualState>(() => {
    const csStatus = runtime.state.connectionStatus;

    if (
      csStatus === 'starting' ||
      csStatus === 'connecting' ||
      csStatus === 'reconnecting'
    ) {
      return 'connecting';
    }

    if (csStatus === 'connected') {
      switch (runtime.state.liveStageState) {
        case 'user_speaking':
          return 'user_speaking';
        case 'thinking':
          return 'thinking';
        case 'ai_speaking':
          return 'ai_speaking';
        case 'idle':
        default:
          return 'idle';
      }
    }

    return 'idle';
  }, [
    runtime.state.connectionStatus,
    runtime.state.liveStageState,
  ]);

  const topSubtitle = useMemo(() => {
    switch (runtime.state.connectionStatus) {
      case 'connected':
        return formatDuration(runtime.state.callDurationSec);
      case 'completed':
        return '通话结束';
      default:
        return runtime.statusTitle;
    }
  }, [runtime.state.callDurationSec, runtime.state.connectionStatus, runtime.statusTitle]);

  const subtitleContent = useMemo(() => {
    if (runtime.state.error) {
      return {
        speaker: '',
        labelColor: 'rgba(255,69,58,0.9)',
        text: runtime.statusSubtitle,
      };
    }

    return {
      speaker: '',
      labelColor:
        callVisualState === 'ai_speaking'
          ? '#BF5AF2'
          : callVisualState === 'user_speaking'
            ? '#0A84FF'
            : 'rgba(255,255,255,0.72)',
      text: runtime.statusSubtitle,
    };
  }, [
    callVisualState,
    runtime.state.error,
    runtime.statusSubtitle,
  ]);

  const canHangUp =
    Boolean(runtime.state.sessionId) &&
    runtime.state.connectionStatus !== 'ending' &&
    runtime.state.connectionStatus !== 'completed';
  const canRetryComplete =
    runtime.state.completionFailed &&
    Boolean(runtime.state.sessionId) &&
    Boolean(runtime.state.pendingCompletionStatus) &&
    Boolean(runtime.state.pendingCompletionPayload);
  const canRetryStart =
    runtime.state.connectionStatus === 'error' &&
    !runtime.state.sessionId &&
    !runtime.state.pendingCompletionStatus;
  const shouldShowSubtitleBlock =
    Boolean(runtime.state.error) || (showSubtitles && Boolean(subtitleContent.text));

  const topPadding = Math.max(insets.top + 10, 52);
  const bottomPadding = Math.max(insets.bottom + 20, 44);

  useEffect(() => {
    autoStartedRef.current = false;
    setCurrentView('call');
    setShowSubtitles(true);
  }, [scenario.id]);

  useEffect(() => {
    if (!allowAutoStart) return;
    if (!isLoggedIn) return;
    if (currentView === 'report') return;
    if (runtime.state.reviewPayload) return;
    if (runtime.state.sessionId) return;
    if (runtime.state.connectionStatus !== 'idle') return;
    if (autoStartedRef.current) return;

    autoStartedRef.current = true;
    void (async () => {
      const consented = await aiConsent.requestConsent();
      if (!consented) {
        autoStartedRef.current = false;
        handleSpeakingBack();
        return;
      }
      await runtime.startCall();
    })();
  }, [
    aiConsent,
    allowAutoStart,
    currentView,
    isLoggedIn,
    runtime,
    runtime.state.connectionStatus,
    runtime.state.reviewPayload,
    runtime.state.sessionId,
  ]);

  useEffect(() => {
    if (runtime.state.reviewPayload && runtime.state.connectionStatus === 'completed') {
      setCurrentView('report');
      return;
    }

    if (
      runtime.state.connectionStatus === 'starting' ||
      runtime.state.connectionStatus === 'connecting' ||
      runtime.state.connectionStatus === 'connected'
    ) {
      setCurrentView('call');
    }
  }, [runtime.state.connectionStatus, runtime.state.reviewPayload]);

  const handleReplay = () => {
    autoStartedRef.current = true;
    setCurrentView('call');
    void runtime.startCall();
  };

  if (!isLoggedIn) {
    return (
      <View style={cs.root}>
        <View style={[cs.topBar, { paddingTop: topPadding }]}>
          <RoundControlButton
            icon="chevron-back"
            onPress={handleSpeakingBack}
            size={44}
            iconSize={20}
          />

          <View style={cs.topCenter}>
            <AppText style={cs.topTitle}>{scenario.name}</AppText>
            <AppText style={[cs.topMeta, cs.topMetaMuted]}>请先登录后继续</AppText>
          </View>

          <TopBarSpacer />
        </View>

        <View style={cs.loginGate}>
          <AppText style={cs.loginGateTitle}>V2 实时练习</AppText>
          <AppText style={cs.loginGateBody}>
            登录后会自动开始本次口语练习。
          </AppText>

          <Pressable
            style={({ pressed }) => [
              cs.loginGateButton,
              pressed && { opacity: 0.82 },
            ]}
            onPress={() => router.push('/auth/sign-in')}
          >
            <AppText style={cs.loginGateButtonText}>去登录</AppText>
          </Pressable>
        </View>

      </View>
    );
  }

  return (
    <View style={cs.root}>
      <View style={[cs.topBar, { paddingTop: topPadding }]}>
        <RoundControlButton
          icon="chevron-back"
          onPress={handleSpeakingBack}
          size={44}
          iconSize={20}
        />

        <View style={cs.topCenter}>
          <AppText style={cs.topTitle}>{scenario.name}</AppText>
          <AppText
            style={[
              cs.topMeta,
              runtime.state.connectionStatus === 'connected'
                ? cs.topMetaGreen
                : runtime.state.connectionStatus === 'error'
                  ? cs.topMetaRed
                  : cs.topMetaMuted,
            ]}
          >
            {topSubtitle}
          </AppText>
        </View>

        <TopBarSpacer />
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={runtime.interruptAssistant}
        disabled={runtime.state.connectionStatus !== 'connected'}
        style={cs.stageArea}
        onLayout={(e) =>
          setStageLayout({
            width: e.nativeEvent.layout.width,
            height: e.nativeEvent.layout.height,
          })
        }
      >
        {stageLayout.width > 0 && (
          <SkiaOrbCanvas
            width={stageLayout.width}
            height={stageLayout.height}
            callVisualState={callVisualState}
          />
        )}

        {(callVisualState === 'idle' || callVisualState === 'ai_speaking') &&
        runtime.state.connectionStatus === 'connected' ? (
          <View style={cs.interruptHint}>
            <AppText style={cs.interruptHintText}>轻点球体可打断并开始说话</AppText>
          </View>
        ) : null}
      </Pressable>

      <View style={cs.subtitleArea}>
        {shouldShowSubtitleBlock ? (
          <View style={{ maxWidth: Math.min(screenWidth - 64, 720) }}>
            {showSubtitles && subtitleContent.speaker ? (
              <AppText
                style={[cs.subtitleSpeaker, { color: subtitleContent.labelColor }]}
              >
                {subtitleContent.speaker}
              </AppText>
            ) : null}
            <AppText style={cs.subtitleText}>{subtitleContent.text}</AppText>
            {runtime.state.error ? (
              <View style={cs.subtitleActions}>
                <Pressable
                  onPress={runtime.clearError}
                  style={({ pressed }) => [
                    cs.subtitleActionButton,
                    pressed && { opacity: 0.78 },
                  ]}
                >
                  <AppText style={cs.subtitleActionText}>清除错误</AppText>
                </Pressable>

                {canRetryComplete ? (
                  <Pressable
                    onPress={() => {
                      void runtime.retryComplete();
                    }}
                    style={({ pressed }) => [
                      cs.subtitleActionButton,
                      pressed && { opacity: 0.78 },
                    ]}
                  >
                    <AppText style={cs.subtitleActionText}>重试结束</AppText>
                  </Pressable>
                ) : canRetryStart ? (
                  <Pressable
                    onPress={() => {
                      void runtime.startCall();
                    }}
                    style={({ pressed }) => [
                      cs.subtitleActionButton,
                      pressed && { opacity: 0.78 },
                    ]}
                  >
                    <AppText style={cs.subtitleActionText}>重新连接</AppText>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={[cs.bottomControls, { paddingBottom: bottomPadding }]}>
        <View style={cs.bottomFade} pointerEvents="none" />

        <View style={cs.bottomRow}>
          <RoundControlButton
            icon={showSubtitles ? 'chatbox-ellipses' : 'chatbox-outline'}
            onPress={() => setShowSubtitles((v) => !v)}
            active={showSubtitles}
            size={56}
            iconSize={22}
          />

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void runtime.endCall('completed');
            }}
            disabled={!canHangUp}
            style={({ pressed }) => [
              cs.hangupButton,
              { opacity: !canHangUp ? 0.42 : pressed ? 0.82 : 1 },
            ]}
          >
            <Ionicons
              name="call"
              size={34}
              color="#FFFFFF"
              style={{ transform: [{ rotate: '135deg' }] }}
            />
          </Pressable>

          <RoundControlButton
            icon={runtime.state.isMicMuted ? 'mic-off' : 'mic'}
            onPress={runtime.toggleMute}
            filled={runtime.state.isMicMuted}
            size={56}
            iconSize={22}
          />
        </View>
      </View>

      {currentView === 'report' ? (
        <ReportScreen
          scenario={scenario}
          runtime={runtime}
          onClose={() => setCurrentView('call')}
          onReplay={handleReplay}
        />
      ) : null}
    </View>
  );
}

// ─── Route-bound screens backed by shared V2 runtime ─────────────────────────

export function SpeakingV2EntryScreen() {
  const { scenario, runtime, isLoggedIn } = useSpeakingV2RuntimeContext();

  return (
    <LegacySpeakingV2Screen
      scenario={scenario}
      runtime={runtime}
      isLoggedIn={isLoggedIn}
    />
  );
}

export function SpeakingV2CallScreen() {
  const { scenario, runtime, isLoggedIn } = useSpeakingV2RuntimeContext();

  return (
    <CallStageScreen
      scenario={scenario}
      runtime={runtime}
      isLoggedIn={isLoggedIn}
    />
  );
}

export default SpeakingV2EntryScreen;

// ─── Styles: legacy entry page ────────────────────────────────────────────────

const prepStyles = StyleSheet.create({
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
    fontSize: 44,
    lineHeight: 48,
    color: '#18181B',
    fontWeight: '800',
    letterSpacing: -1.2,
  },
  heroSubtitle: {
    fontSize: 18,
    lineHeight: 24,
    color: 'rgba(63,63,70,0.64)',
    fontWeight: '600',
    maxWidth: '86%',
  },
  metricRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 0,
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
    marginBottom: 10,
    fontSize: 13,
    lineHeight: 18,
    color: TEXT_SECONDARY,
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
    opacity: 0.52,
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
    fontWeight: '500',
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
    backgroundColor: 'rgba(161,161,170,0.46)',
  },
});

const nativeOrbStyles = StyleSheet.create({
  orb: {
    position: 'absolute',
    shadowOffset: { width: 0, height: 0 },
  },
  whiteCore: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.24)',
    shadowColor: '#FFFFFF',
    shadowOpacity: 0.65,
    shadowOffset: { width: 0, height: 0 },
  },
});

// ─── Styles: immersive call stage ─────────────────────────────────────────────

const cs = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },

  topBar: {
    paddingHorizontal: 24,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  topCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 3,
  },
  topTitle: {
    color: 'rgba(255,255,255,0.90)',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  topMeta: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  topMetaGreen: {
    color: '#32D74B',
  },
  topMetaRed: {
    color: '#FF453A',
  },
  topMetaMuted: {
    color: 'rgba(255,255,255,0.38)',
  },

  stageArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -12,
  },

  interruptHint: {
    position: 'absolute',
    top: '18%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  interruptHintText: {
    color: 'rgba(255,255,255,0.50)',
    fontSize: 11,
    fontWeight: '500',
  },

  subtitleArea: {
    minHeight: 170,
    paddingHorizontal: 30,
    paddingBottom: 18,
    justifyContent: 'flex-end',
    marginTop: -18,
    zIndex: 3,
  },
  subtitleSpeaker: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 5,
    letterSpacing: 1.0,
    textTransform: 'uppercase',
  },
  subtitleText: {
    color: '#F2F2F7',
    fontSize: 23,
    lineHeight: 32,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitleActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
  },
  subtitleActionButton: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  subtitleActionText: {
    color: 'rgba(255,255,255,0.84)',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },

  bottomControls: {
    paddingHorizontal: 32,
    paddingTop: 20,
    position: 'relative',
    zIndex: 10,
  },
  bottomFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -56,
    height: 56,
    backgroundColor: 'rgba(0,0,0,0.01)',
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hangupButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FF453A',
    shadowColor: '#FF453A',
    shadowOpacity: 0.48,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },

  loginGate: {
    flex: 1,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  loginGateTitle: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
  },
  loginGateBody: {
    color: 'rgba(255,255,255,0.66)',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  loginGateButton: {
    marginTop: 8,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 13,
    backgroundColor: '#FFFFFF',
  },
  loginGateButtonText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '700',
  },
});

const reportStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    zIndex: 30,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.84)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2C2C2E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 16,
  },
  scoreSection: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreWrap: {
    width: 160,
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreCenter: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreValue: {
    color: '#FFFFFF',
    fontSize: 48,
    lineHeight: 52,
    fontWeight: '800',
    letterSpacing: -1.6,
  },
  scoreLabel: {
    color: '#8E8E93',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: 4,
  },
  metricRow: {
    flexDirection: 'row',
    gap: 12,
  },
  metricCard: {
    flex: 1,
    backgroundColor: '#1C1C1E',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 4,
  },
  metricLabel: {
    color: '#8E8E93',
    fontSize: 12,
    fontWeight: '600',
  },
  metricValue: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '700',
    letterSpacing: -0.8,
  },
  metricReason: {
    color: '#8E8E93',
    fontSize: 11,
    lineHeight: 15,
  },
  aiCoachCard: {
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: '#1F1F22',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    gap: 12,
  },
  aiCoachHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aiCoachTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  aiCoachBody: {
    color: '#E5E5EA',
    fontSize: 14,
    lineHeight: 22,
  },
  replayTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginTop: 4,
  },
  aiBubble: {
    backgroundColor: '#1C1C1E',
    borderRadius: 24,
    borderTopLeftRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 10,
  },
  userBubble: {
    backgroundColor: '#1C1C1E',
    borderRadius: 24,
    borderTopRightRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 14,
    overflow: 'hidden',
  },
  userAccentBar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: 4,
    backgroundColor: '#FF9F0A',
  },
  userBubbleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  bubbleRole: {
    color: '#8E8E93',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  scorePill: {
    borderRadius: 8,
    backgroundColor: 'rgba(255,159,10,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  scorePillText: {
    color: '#FF9F0A',
    fontSize: 11,
    fontWeight: '700',
  },
  bubbleText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 23,
  },
  userOriginalText: {
    color: '#E5E5EA',
    fontSize: 15,
    lineHeight: 22,
    textDecorationLine: 'line-through',
    textDecorationColor: 'rgba(255,69,58,0.55)',
  },
  suggestionCard: {
    backgroundColor: '#2C2C2E',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 8,
  },
  suggestionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  suggestionTitle: {
    color: '#32D74B',
    fontSize: 12,
    fontWeight: '700',
  },
  suggestionText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  suggestionNote: {
    color: '#8E8E93',
    fontSize: 12,
    lineHeight: 18,
  },
  replayActions: {
    flexDirection: 'row',
    gap: 20,
  },
  inlineAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inlineActionText: {
    color: '#0A84FF',
    fontSize: 12,
    fontWeight: '700',
  },
  warningCard: {
    backgroundColor: '#1C1C1E',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,159,10,0.16)',
  },
  warningTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  warningText: {
    color: '#E5E5EA',
    fontSize: 13,
    lineHeight: 20,
  },
  primaryButton: {
    marginTop: 4,
    borderRadius: 999,
    backgroundColor: '#0A84FF',
    paddingHorizontal: 20,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});

const reportTabletStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.74)',
    zIndex: 30,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 36,
  },
  card: {
    borderRadius: 32,
    backgroundColor: '#111113',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    alignSelf: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 22,
    right: 22,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  columns: {
    flexDirection: 'row',
    columnGap: 22,
    padding: 24,
    flex: 1,
  },
  leftColumn: {
    width: '36%',
    maxWidth: 420,
    minWidth: 0,
    flexShrink: 0,
  },
  rightColumn: {
    flex: 1,
    minWidth: 0,
  },
  leftContent: {
    flexShrink: 0,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  scorePanel: {
    marginTop: 18,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricStack: {
    marginTop: 14,
    gap: 10,
  },
  metricCard: {
    minHeight: 86,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    justifyContent: 'space-between',
    gap: 6,
  },
  metricCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  metricLabel: {
    color: 'rgba(255,255,255,0.46)',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  metricValue: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  metricReason: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 12,
    lineHeight: 17,
  },
  coachCard: {
    marginTop: 14,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  coachBody: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 14,
    lineHeight: 21,
  },
  warningCard: {
    marginTop: 14,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 8,
  },
  warningTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  warningText: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 13,
    lineHeight: 19,
  },
  leftFooter: {
    marginTop: 22,
    paddingBottom: 4,
    flexShrink: 0,
  },
  primaryButton: {
    width: '100%',
    minHeight: 56,
    borderRadius: 18,
    backgroundColor: '#0A84FF',
    paddingHorizontal: 20,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
  },
  replayTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: 12,
  },
  rightScroll: {
    flex: 1,
    minWidth: 0,
  },
  rightScrollContent: {
    paddingBottom: 8,
    gap: 12,
  },
  rightSectionCard: {
    marginTop: 0,
  },
  aiBubble: {
    minHeight: 82,
    borderRadius: 20,
    borderTopLeftRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 10,
  },
  userBubble: {
    minHeight: 154,
    borderRadius: 20,
    borderTopRightRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 10,
    overflow: 'hidden',
  },
  userAccentBar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: 4,
    backgroundColor: '#FF9F0A',
  },
  userBubbleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  bubbleRole: {
    color: 'rgba(255,255,255,0.46)',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  bubbleText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 23,
  },
  scorePill: {
    borderRadius: 999,
    backgroundColor: 'rgba(255,159,10,0.14)',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  scorePillText: {
    color: '#FFB340',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
  },
  userOriginalText: {
    color: '#F2F2F7',
    fontSize: 15,
    lineHeight: 22,
  },
  suggestionCard: {
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 8,
  },
  suggestionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  suggestionTitle: {
    color: '#32D74B',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  suggestionText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  suggestionNote: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 12,
    lineHeight: 18,
  },
});
