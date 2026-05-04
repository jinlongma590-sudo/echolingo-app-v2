import React from 'react';
import { Animated, Pressable, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { SpeakingRoundAnalysis } from '@/types/xfyunSpeakingAssessment';

type RoundCardPalette = {
  background: string;
  border: string;
  separator: string;
  subtitle: string;
  shadowColor: string;
  shadowOpacity: number;
  success: string;
  warning: string;
  danger: string;
  pending: string;
};

function buildRoundCardPalette(theme: ReturnType<typeof useAppTheme>['theme']): RoundCardPalette {
  if (theme.colorScheme === 'dark') {
    return {
      background: 'rgba(28,28,30,0.92)',
      border: 'rgba(255,255,255,0.10)',
      separator: 'rgba(255,255,255,0.14)',
      subtitle: 'rgba(245,245,247,0.45)',
      shadowColor: '#000',
      shadowOpacity: 0.18,
      success: '#30D158',
      warning: '#FF9F0A',
      danger: '#FF453A',
      pending: '#64D2FF',
    };
  }

  return {
    background: 'rgba(255,255,255,0.92)',
    border: theme.border,
    separator: theme.separator,
    subtitle: theme.textTertiary,
    shadowColor: theme.shadowColor,
    shadowOpacity: 0.08,
    success: '#34C759',
    warning: '#FF9500',
    danger: '#FF3B30',
    pending: '#0A84FF',
  };
}

function scoreColor(score: number | null | undefined, palette: RoundCardPalette) {
  if (typeof score !== 'number') return palette.subtitle;
  if (score >= 85) return palette.success;
  if (score >= 70) return palette.warning;
  return palette.danger;
}

function grammarSummary(analysis: SpeakingRoundAnalysis, palette: RoundCardPalette) {
  if (analysis.expression?.status === 'pending') {
    return {
      title: '表达',
      subtitle: '分析中',
      color: palette.warning,
    };
  }
  if (analysis.expression?.status === 'failed') {
    return {
      title: '待补',
      subtitle: '稍后',
      color: palette.subtitle,
    };
  }

  const isCorrect = (analysis.expression?.grammarStatus ?? analysis.grammarStatus) === 'correct';
  return {
    title: isCorrect ? '语法✓' : '需优化',
    subtitle: isCorrect ? '太棒了' : '表达',
    color: isCorrect ? palette.success : palette.warning,
  };
}

function pronunciationSummary(analysis: SpeakingRoundAnalysis, palette: RoundCardPalette) {
  const score = analysis.pronunciationScore ?? analysis.assessment?.overallScore ?? null;
  const isPending = !analysis.assessment && analysis.pronunciationScore == null;
  if (isPending) {
    return {
      title: '发音',
      subtitle: '测评中',
      color: palette.pending,
    };
  }
  return {
    title: `发音${typeof score === 'number' ? Math.round(score) : '--'}`,
    subtitle:
      analysis.assessment?.accuracyScore != null || analysis.assessment?.fluencyScore != null || typeof score === 'number'
        ? '优化›'
        : '待补',
    color: typeof score === 'number' ? scoreColor(score, palette) : palette.subtitle,
  };
}

function expressionSummary(analysis: SpeakingRoundAnalysis, palette: RoundCardPalette) {
  const score = analysis.expression?.nativeScore ?? analysis.naturalnessScore ?? null;
  if (analysis.expression?.status === 'pending') {
    return {
      title: '地道',
      subtitle: '生成中',
      color: palette.success,
    };
  }
  if (analysis.expression?.status === 'failed' || (!analysis.expression?.betterExpression && score == null)) {
    return {
      title: '地道--',
      subtitle: '待补',
      color: palette.subtitle,
    };
  }
  return {
    title: `地道${typeof score === 'number' ? Math.round(score) : '--'}`,
    subtitle: analysis.expression?.betterExpression || analysis.optimizedSentence ? '语境›' : '待补',
    color: typeof score === 'number' ? scoreColor(score, palette) : palette.subtitle,
  };
}

function CompactSegment({
  title,
  subtitle,
  titleColor,
  subtitleColor,
  onPress,
  tablet = false,
}: {
  title: string;
  subtitle: string;
  titleColor: string;
  subtitleColor: string;
  onPress: () => void;
  tablet?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 0,
        height: '100%',
        paddingHorizontal: tablet ? 8 : 6,
        paddingVertical: 0,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.72 : 1,
      })}
    >
      <AppText
        numberOfLines={1}
        ellipsizeMode="clip"
        style={{
          fontSize: tablet ? 12 : 11,
          lineHeight: tablet ? 14 : 12,
          fontWeight: '700',
          color: titleColor,
          textAlign: 'center',
          includeFontPadding: false,
        }}
      >
        {title}
      </AppText>
      <AppText
        numberOfLines={1}
        ellipsizeMode="tail"
        style={{
          marginTop: 0,
          fontSize: tablet ? 9 : 8,
          lineHeight: tablet ? 11 : 9,
          fontWeight: '500',
          color: subtitleColor,
          textAlign: 'center',
          includeFontPadding: false,
        }}
      >
        {subtitle}
      </AppText>
    </Pressable>
  );
}

function isPendingAssessment(analysis: SpeakingRoundAnalysis) {
  return (
    analysis.expression?.status === 'pending' ||
    (!analysis.assessment &&
      analysis.pronunciationScore == null &&
      analysis.expression?.nativeScore == null &&
      analysis.naturalnessScore == null)
  );
}

function PendingPulseContainer({ children, active }: { children: React.ReactNode; active: boolean }) {
  const opacity = React.useRef(new Animated.Value(active ? 0.72 : 1)).current;

  React.useEffect(() => {
    if (!active) {
      opacity.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.72,
          duration: 600,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [active, opacity]);

  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

export function XfyunRoundCards({
  assessment,
  analysis,
  onPressGrammar,
  onPressPronunciation,
  onPressNative,
  onOpenPronunciationPanel,
  onOpenPronunciation,
  onOpenExpressionPanel,
  onPlayUserAudio,
  onPlayBetterExpression,
  width,
  tablet = false,
}: {
  assessment?: SpeakingRoundAnalysis;
  analysis?: SpeakingRoundAnalysis;
  onPressGrammar?: () => void;
  onPressPronunciation?: () => void;
  onPressNative?: () => void;
  onOpenPronunciationPanel?: () => void;
  onOpenPronunciation?: () => void;
  onOpenExpressionPanel?: (focus: 'grammar' | 'native') => void;
  onPlayUserAudio?: () => void;
  onPlayBetterExpression?: () => void;
  width?: number;
  tablet?: boolean;
}) {
  const { theme } = useAppTheme();
  const current = assessment ?? analysis;
  if (!current) return null;

  const palette = buildRoundCardPalette(theme);
  const grammar = grammarSummary(current, palette);
  const pronunciation = pronunciationSummary(current, palette);
  const expression = expressionSummary(current, palette);
  const pending = isPendingAssessment(current);
  const grammarPress = onPressGrammar ?? (() => (onOpenExpressionPanel ?? (() => {}))('grammar'));
  const pronunciationPress = onPressPronunciation ?? onOpenPronunciationPanel ?? onOpenPronunciation ?? (() => {});
  const nativePress = onPressNative ?? (() => (onOpenExpressionPanel ?? (() => {}))('native'));

  void onPlayUserAudio;
  void onPlayBetterExpression;

  return (
    <PendingPulseContainer active={pending}>
      <View
        style={{
          width: tablet ? Math.min(width ?? 236, 260) : width ?? 206,
          maxWidth: 260,
          height: tablet ? 34 : 26,
          borderRadius: tablet ? 17 : 13,
          backgroundColor: palette.background,
          borderWidth: 1,
          borderColor: palette.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          overflow: 'hidden',
          shadowColor: palette.shadowColor,
          shadowOpacity: palette.shadowOpacity,
          shadowRadius: tablet ? 10 : 8,
          shadowOffset: { width: 0, height: 3 },
          elevation: 3,
        }}
      >
        <CompactSegment
          title={grammar.title}
          subtitle={grammar.subtitle}
          titleColor={grammar.color}
          subtitleColor={palette.subtitle}
          onPress={grammarPress}
          tablet={tablet}
        />
        <View style={{ width: 1, height: tablet ? 18 : 14, backgroundColor: palette.separator }} />
        <CompactSegment
          title={pronunciation.title}
          subtitle={pronunciation.subtitle}
          titleColor={pronunciation.color}
          subtitleColor={palette.subtitle}
          onPress={pronunciationPress}
          tablet={tablet}
        />
        <View style={{ width: 1, height: tablet ? 18 : 14, backgroundColor: palette.separator }} />
        <CompactSegment
          title={expression.title}
          subtitle={expression.subtitle}
          titleColor={expression.color}
          subtitleColor={palette.subtitle}
          onPress={nativePress}
          tablet={tablet}
        />
      </View>
    </PendingPulseContainer>
  );
}
