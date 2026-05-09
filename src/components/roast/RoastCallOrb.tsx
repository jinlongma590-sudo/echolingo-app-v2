import React, { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Blur, Canvas, Circle, Group, Paint, Rect } from '@shopify/react-native-skia';
import Animated, {
  Easing as EasingR,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

export type RoastCallOrbState =
  | 'idle'
  | 'connecting'
  | 'greeting'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'rejected'
  | 'ended'
  | 'error';

export type RoastCallOrbProps = {
  state: RoastCallOrbState;
  isAiSpeaking?: boolean;
  isListening?: boolean;
  intensity?: number;
  size?: number;
  useNativeFallback?: boolean;
};

type V2OrbVisualState =
  | 'connecting'
  | 'idle'
  | 'user_speaking'
  | 'thinking'
  | 'ai_speaking';

const DEFAULT_SIZE = 244;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function mapRoastToV2VisualState(
  state: RoastCallOrbState,
  isAiSpeaking?: boolean,
  isListening?: boolean,
): V2OrbVisualState {
  if (isAiSpeaking || state === 'speaking') return 'ai_speaking';
  if (state === 'processing') return 'thinking';
  if (state === 'connecting' || state === 'greeting') return 'connecting';
  if (isListening || state === 'listening') return 'user_speaking';
  return 'idle';
}

function SkiaOrbCanvas({
  width,
  height,
  callVisualState,
  alertTone = false,
}: {
  width: number;
  height: number;
  callVisualState: V2OrbVisualState;
  alertTone?: boolean;
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

    stateScale.value = withTiming(nextScale, {
      duration: 650,
      easing: EasingR.out(EasingR.ease),
    });
    stateOpacity.value = withTiming(nextOpacity, {
      duration: 650,
      easing: EasingR.out(EasingR.ease),
    });
    pulseAmount.value = withTiming(nextPulse, {
      duration: 650,
      easing: EasingR.out(EasingR.ease),
    });
    motionAmount.value = withTiming(nextMotion, {
      duration: 650,
      easing: EasingR.out(EasingR.ease),
    });
  }, [callVisualState, motionAmount, pulseAmount, stateOpacity, stateScale]);

  useEffect(() => {
    orbit.value = 0;
    orbit.value = withRepeat(
      withTiming(Math.PI * 2, {
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
  const pinkMain = alertTone ? 'rgba(255,106,128,0.56)' : 'rgba(255,112,166,0.56)';
  const blueMain = alertTone ? 'rgba(176,106,132,0.48)' : 'rgba(96,178,255,0.6)';
  const purpleMain = alertTone ? 'rgba(208,134,178,0.48)' : 'rgba(208,154,255,0.56)';

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
          <Circle cx={pinkX} cy={pinkY} r={pinkRadius * 1.08} color={alertTone ? 'rgba(255,92,118,0.15)' : 'rgba(255,118,170,0.12)'} />
          <Circle cx={blueX} cy={blueY} r={blueRadius * 1.06} color={alertTone ? 'rgba(255,112,138,0.12)' : 'rgba(120,190,255,0.13)'} />
          <Circle cx={purpleX} cy={purpleY} r={purpleRadius * 1.06} color={alertTone ? 'rgba(235,140,190,0.11)' : 'rgba(218,170,255,0.12)'} />
          <Circle cx={pinkEdgeX} cy={pinkEdgeY} r={pinkRadius * 0.9} color={alertTone ? 'rgba(255,105,128,0.09)' : 'rgba(255,132,178,0.08)'} />
          <Circle cx={blueEdgeX} cy={blueEdgeY} r={blueRadius * 0.88} color={alertTone ? 'rgba(255,120,150,0.08)' : 'rgba(134,198,255,0.08)'} />
          <Circle cx={purpleEdgeX} cy={purpleEdgeY} r={purpleRadius * 0.88} color={alertTone ? 'rgba(236,150,198,0.08)' : 'rgba(224,184,255,0.08)'} />
          <Circle cx={pinkX} cy={pinkY} r={pinkRadius} color={pinkMain} />
          <Circle cx={blueX} cy={blueY} r={blueRadius} color={blueMain} />
          <Circle cx={purpleX} cy={purpleY} r={purpleRadius} color={purpleMain} />
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
  alertTone = false,
}: {
  width: number;
  height: number;
  callVisualState: V2OrbVisualState;
  alertTone?: boolean;
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

    stateScale.value = withTiming(nextScale, { duration: 650, easing: EasingR.out(EasingR.ease) });
    stateOpacity.value = withTiming(nextOpacity, { duration: 650, easing: EasingR.out(EasingR.ease) });
    pulseAmount.value = withTiming(nextPulse, { duration: 650, easing: EasingR.out(EasingR.ease) });
    motionAmount.value = withTiming(nextMotion, { duration: 650, easing: EasingR.out(EasingR.ease) });
  }, [callVisualState, motionAmount, pulseAmount, stateOpacity, stateScale]);

  useEffect(() => {
    orbit.value = 0;
    orbit.value = withRepeat(
      withTiming(Math.PI * 2, {
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
          styles.orb,
          {
            width: pinkRadius * 2.1,
            height: pinkRadius * 2.1,
            borderRadius: pinkRadius * 1.05,
            left: centerX - pinkRadius * 1.05 - base * 0.07,
            top: centerY - pinkRadius * 1.05 + base * 0.07,
            backgroundColor: alertTone ? 'rgba(255,106,128,0.48)' : 'rgba(255,112,166,0.48)',
            shadowColor: alertTone ? '#FF6A80' : '#FF78AA',
            shadowOpacity: 0.88,
            shadowRadius: 54,
          },
          pinkStyle,
        ]}
      />
      <Animated.View
        style={[
          styles.orb,
          {
            width: blueRadius * 2.14,
            height: blueRadius * 2.14,
            borderRadius: blueRadius * 1.07,
            left: centerX - blueRadius * 1.07 + base * 0.08,
            top: centerY - blueRadius * 1.07 + base * 0.03,
            backgroundColor: alertTone ? 'rgba(176,106,132,0.44)' : 'rgba(96,178,255,0.5)',
            shadowColor: alertTone ? '#FF7A9C' : '#60B2FF',
            shadowOpacity: 0.92,
            shadowRadius: 56,
          },
          blueStyle,
        ]}
      />
      <Animated.View
        style={[
          styles.orb,
          {
            width: purpleRadius * 2.08,
            height: purpleRadius * 2.08,
            borderRadius: purpleRadius * 1.04,
            left: centerX - purpleRadius * 1.04,
            top: centerY - purpleRadius * 1.04 - base * 0.09,
            backgroundColor: alertTone ? 'rgba(208,134,178,0.42)' : 'rgba(208,154,255,0.46)',
            shadowColor: alertTone ? '#EC96C6' : '#D09AFF',
            shadowOpacity: 0.84,
            shadowRadius: 52,
          },
          purpleStyle,
        ]}
      />
      <Animated.View
        style={[
          styles.whiteCore,
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

export const RoastCallOrb = memo(function RoastCallOrb({
  state,
  isAiSpeaking = false,
  isListening = false,
  size = DEFAULT_SIZE,
  useNativeFallback = false,
}: RoastCallOrbProps) {
  const safeSize = clamp(size, 180, 340);
  const visualState = mapRoastToV2VisualState(state, isAiSpeaking, isListening);
  const alertTone = state === 'rejected' || state === 'error';

  return (
    <View pointerEvents="none" style={[styles.root, { width: safeSize, height: safeSize }]}>
      {useNativeFallback ? (
        <NativeOrbCanvas
          width={safeSize}
          height={safeSize}
          callVisualState={visualState}
          alertTone={alertTone}
        />
      ) : (
        <SkiaOrbCanvas
          width={safeSize}
          height={safeSize}
          callVisualState={visualState}
          alertTone={alertTone}
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  orb: {
    position: 'absolute',
  },
  whiteCore: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.34)',
    shadowColor: '#FFFFFF',
    shadowOpacity: 0.8,
  },
});
