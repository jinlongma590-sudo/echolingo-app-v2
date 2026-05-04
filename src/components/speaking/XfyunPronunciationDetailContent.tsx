import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clipboard,
  Pressable,
  ScrollView,
  StyleProp,
  View,
  ViewStyle,
} from 'react-native';

import { AppText } from '@/components/AppText';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type {
  ExpressionStyleResult,
  SpeakingExpressionStylesState,
  SpeakingRoundAnalysis,
  XfyunWordAssessment,
} from '@/types/xfyunSpeakingAssessment';

export type PronunciationPanelFocus = 'grammar' | 'pronunciation' | 'native';
type ExpressionStyle = 'us' | 'business' | 'british';

export type ScorePalette = {
  overlay: string;
  panel: string;
  card: string;
  cardSoft: string;
  border: string;
  separator: string;
  progressTrack: string;
  closeBackground: string;
  selectedWordBackground: string;
  disabledFill: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  danger: string;
  warning: string;
  success: string;
};

export const scoreDark = {
  overlay: 'rgba(0,0,0,0.52)',
  panel: '#1C1C1E',
  card: '#2C2C2E',
  cardSoft: '#242426',
  border: 'rgba(255,255,255,0.10)',
  separator: 'rgba(255,255,255,0.12)',
  progressTrack: 'rgba(255,255,255,0.10)',
  closeBackground: 'rgba(255,255,255,0.10)',
  selectedWordBackground: 'rgba(255,255,255,0.06)',
  disabledFill: 'rgba(255,255,255,0.05)',
  textPrimary: '#F5F5F7',
  textSecondary: 'rgba(245,245,247,0.72)',
  textTertiary: 'rgba(245,245,247,0.48)',
  danger: '#FF453A',
  warning: '#FF9F0A',
  success: '#30D158',
} as const satisfies ScorePalette;

export function buildScoreLight(
  theme: ReturnType<typeof useAppTheme>['theme'],
): ScorePalette {
  return {
    overlay: 'rgba(0,0,0,0.32)',
    panel: theme.cardBackground,
    card: theme.secondaryCardBackground,
    cardSoft: '#F5F6FA',
    border: theme.border,
    separator: theme.separator,
    progressTrack: 'rgba(60,60,67,0.14)',
    closeBackground: 'rgba(0,0,0,0.06)',
    selectedWordBackground: 'rgba(0,122,255,0.08)',
    disabledFill: 'rgba(60,60,67,0.06)',
    textPrimary: theme.textPrimary,
    textSecondary: theme.textSecondary,
    textTertiary: theme.textTertiary,
    danger: '#FF3B30',
    warning: '#FF9500',
    success: '#34C759',
  };
}

function mapStyleLogValue(style: ExpressionStyle) {
  if (style === 'us') return 'americanCasual';
  if (style === 'business') return 'businessFormal';
  return 'britishNatural';
}

function scoreTone(score: number | null, palette: ScorePalette) {
  if (typeof score !== 'number') {
    return { color: palette.textTertiary, label: '待补' };
  }
  if (score >= 80) {
    return { color: palette.success, label: '很完美' };
  }
  if (score >= 60) {
    return { color: palette.warning, label: '小瑕疵' };
  }
  return { color: palette.danger, label: '待提高' };
}

function metricLabel(value: number | null | undefined) {
  return typeof value === 'number' ? String(Math.round(value)) : '--';
}

function progressColor(score: number | null | undefined, palette: ScorePalette) {
  if (typeof score !== 'number') return palette.progressTrack;
  if (score >= 85) return palette.success;
  if (score >= 70) return palette.warning;
  return palette.danger;
}

function scoreLabel(score: number | null | undefined) {
  if (typeof score !== 'number') return '待后补';
  if (score >= 85) return '很好';
  if (score >= 70) return '还不错';
  return '需要优化';
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripXmlTags(value: string) {
  return value.replace(/<[^>]+>/g, ' ');
}

function normalizeDisplayWord(value: string | null | undefined) {
  return decodeHtmlEntities(stripXmlTags(value ?? ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function isPauseToken(value: string | null | undefined) {
  const normalized = normalizeDisplayWord(value).toLowerCase();
  return ['sil', '<sil>', 'silence', 'sp', 'spn', 'unknown', ''].includes(normalized);
}

function getVisibleAssessmentWords(words: XfyunWordAssessment[] | undefined) {
  return (words ?? [])
    .map((word) => ({
      ...word,
      word: normalizeDisplayWord(word.word),
    }))
    .filter((word) => word.word && !isPauseToken(word.word));
}

function countSpokenWords(text: string) {
  return (normalizeDisplayWord(text).match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? []).length;
}

function isConcreteAdvice(text: string | null | undefined) {
  const normalized = (text ?? '').trim();
  if (!normalized) return false;
  return !/分析中|待补|稍后|暂无|进行中|生成失败|稍后补充|当前先使用|待后补/i.test(normalized);
}

function buildSuggestionData(analysis: SpeakingRoundAnalysis | null) {
  if (!analysis) {
    return { text: '本轮数据还在整理，稍后再看一次。', source: 'fallback' as const };
  }

  const backendCandidate =
    analysis.suggestions?.find((item) => isConcreteAdvice(item)) ||
    [
      analysis.expression?.nativeFeedbackZh,
      analysis.expression?.grammarFeedbackZh,
      analysis.grammarExplanationZh,
    ].find((item) => isConcreteAdvice(item)) ||
    null;
  if (backendCandidate) {
    return { text: backendCandidate.trim(), source: 'backend' as const };
  }

  const assessment = analysis.assessment;
  if (assessment) {
    const visibleWords = getVisibleAssessmentWords(assessment.words);
    const lowestWords = [...visibleWords]
      .filter((word) => typeof (word.score ?? word.accuracyScore) === 'number')
      .sort(
        (a, b) =>
          (a.score ?? a.accuracyScore ?? 100) -
          (b.score ?? b.accuracyScore ?? 100),
      )
      .slice(0, 2)
      .map((word) => word.word);

    const chunks: string[] = [];
    const fluency = assessment.fluencyScore;
    const accuracy = assessment.accuracyScore ?? assessment.standardScore;
    const integrity = assessment.integrityScore;
    const nativeScore = analysis.expression?.nativeScore ?? analysis.naturalnessScore;

    if (lowestWords.length > 0 && typeof accuracy === 'number' && accuracy < 80) {
      chunks.push(`重点再练一下 ${lowestWords.join('、')} 的发音。`);
    } else if (typeof accuracy === 'number' && accuracy < 80) {
      chunks.push('核心单词的发音清晰度还可以再提一点。');
    }
    if (typeof fluency === 'number' && fluency < 80) {
      chunks.push('停顿稍多，把整句连起来读会更自然。');
    }
    if (typeof integrity === 'number' && integrity < 75) {
      chunks.push('句子完整度再稳一点，表达会更像真实对话。');
    }
    if (typeof nativeScore === 'number' && nativeScore < 75) {
      chunks.push('表达可以再口语一点，听起来会更自然。');
    }
    if (chunks.length > 0) {
      return { text: chunks.slice(0, 2).join(''), source: 'score_rule' as const };
    }
  }

  return { text: '本轮数据较少，建议再完整读一遍这句话。', source: 'fallback' as const };
}

function computeSpeechRate(
  transcriptText: string,
  durationMs: number | null | undefined,
  backendWpm: number | null | undefined,
) {
  if (typeof backendWpm === 'number' && Number.isFinite(backendWpm) && backendWpm > 0) {
    return { value: Math.round(backendWpm), source: 'backend' as const };
  }
  const wordCount = countSpokenWords(transcriptText);
  if (typeof durationMs === 'number' && durationMs >= 800 && wordCount > 0) {
    return {
      value: Math.round((wordCount / durationMs) * 60000),
      source: 'duration' as const,
    };
  }
  return { value: null, source: 'insufficient' as const };
}

function WordToken({
  word,
  selected,
  onPress,
  palette,
}: {
  word: XfyunWordAssessment;
  selected: boolean;
  onPress: () => void;
  palette: ScorePalette;
}) {
  const displayWord = normalizeDisplayWord(word.word);
  if (isPauseToken(displayWord)) {
    return null;
  }
  const tone = scoreTone(word.score, palette);
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        marginRight: 2,
        marginBottom: 10,
        paddingHorizontal: 4,
        paddingTop: 2,
        paddingBottom: word.score != null && word.score < 80 ? 2 : 0,
        borderRadius: 10,
        borderWidth: selected ? 1 : 0,
        borderColor: palette.border,
        backgroundColor: selected ? palette.selectedWordBackground : 'transparent',
        borderBottomWidth: word.score != null && word.score < 80 ? 3 : selected ? 1 : 0,
        borderBottomColor: tone.color,
        opacity: pressed ? 0.72 : 1,
      })}
    >
      <AppText
        style={{
          fontSize: 24,
          lineHeight: 34,
          fontWeight: '800',
          color: tone.color,
          includeFontPadding: false,
        }}
      >
        {displayWord}
      </AppText>
    </Pressable>
  );
}

function MetricRow({
  label,
  value,
  palette,
}: {
  label: string;
  value: number | null | undefined;
  palette: ScorePalette;
}) {
  const numeric = typeof value === 'number' ? Math.round(value) : null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
      <AppText
        style={{
          width: 64,
          fontSize: 15,
          fontWeight: '700',
          color: palette.textPrimary,
        }}
      >
        {label}
      </AppText>
      <View
        style={{
          flex: 1,
          height: 8,
          borderRadius: 4,
          backgroundColor: palette.progressTrack,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${Math.max(0, Math.min(100, numeric ?? 0))}%`,
            height: '100%',
            borderRadius: 4,
            backgroundColor: progressColor(value, palette),
          }}
        />
      </View>
      <AppText
        style={{
          width: 36,
          textAlign: 'right',
          fontSize: 15,
          fontWeight: '800',
          color: palette.textPrimary,
        }}
      >
        {numeric ?? '--'}
      </AppText>
    </View>
  );
}

function ActionButton({
  label,
  enabled,
  onPress,
  icon,
  palette,
  flex = 0,
}: {
  label: string;
  enabled: boolean;
  onPress: () => void;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  palette: ScorePalette;
  flex?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        minWidth: 56,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.72 : enabled ? 1 : 0.45,
        flex,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: enabled ? palette.border : palette.disabledFill,
          }}
        >
          <Ionicons
            name={icon}
            size={12}
            color={enabled ? palette.textPrimary : palette.textTertiary}
          />
        </View>
        <AppText
          style={{
            fontSize: 15,
            fontWeight: '800',
            color: enabled ? palette.textPrimary : palette.textTertiary,
          }}
        >
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}

function resolveExpressionStyleContent(
  selectedStyle: ExpressionStyle,
  styles: SpeakingExpressionStylesState | null | undefined,
  fallbackExpression: string,
  fallbackExplanation: string,
) {
  const styleMap: Record<ExpressionStyle, ExpressionStyleResult | null | undefined> = {
    us: styles?.americanCasual,
    business: styles?.businessFormal,
    british: styles?.britishNatural,
  };

  const generated = styleMap[selectedStyle];
  const hasGeneratedStyle = Boolean(generated?.expression);
  const status = styles?.status ?? 'idle';

  if (hasGeneratedStyle && generated) {
    return {
      expression: generated.expression,
      displayExpression: generated.expression,
      explanationZh: generated.explanationZh,
      status,
      hasGeneratedStyle: true,
    };
  }

  if (selectedStyle === 'us') {
    return {
      expression: fallbackExpression,
      displayExpression: fallbackExpression,
      explanationZh: fallbackExplanation,
      status,
      hasGeneratedStyle: false,
    };
  }

  if (status === 'loading') {
    return {
      expression: null,
      displayExpression: '正在生成…',
      explanationZh:
        selectedStyle === 'business'
          ? '正在生成商务正式表达…'
          : '正在生成地道英式表达…',
      status,
      hasGeneratedStyle: false,
    };
  }

  return {
    expression: null,
    displayExpression: '暂未生成',
    explanationZh:
      selectedStyle === 'business'
        ? '商务正式表达暂未生成。'
        : '地道英式表达暂未生成。',
    status,
    hasGeneratedStyle: false,
  };
}

export function XfyunPronunciationDetailContent({
  analysis,
  visible = true,
  initialFocus = 'pronunciation',
  onPlayUserAudio,
  hasUserAudio = false,
  onPlayUkText,
  onPlayUsText,
  onPlayStressText,
  onLoopExpression,
  onPlayExpressionText,
  onCopyText,
  recordingDurationMs = null,
  messageText,
  originalText,
  palette,
  style,
  contentContainerStyle,
}: {
  analysis: SpeakingRoundAnalysis | null;
  visible?: boolean;
  initialFocus?: PronunciationPanelFocus;
  onPlayUserAudio?: () => void;
  hasUserAudio?: boolean;
  onPlayUkText?: (text: string) => void;
  onPlayUsText?: (text: string) => void;
  onPlayStressText?: (text: string) => void;
  onLoopExpression?: (text: string) => void;
  onPlayExpressionText?: (text: string) => void;
  onCopyText?: (text: string) => void;
  recordingDurationMs?: number | null;
  messageText?: string | null;
  originalText?: string | null;
  palette?: ScorePalette;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  const { theme } = useAppTheme();
  const scorePalette = palette ?? (theme.colorScheme === 'dark' ? scoreDark : buildScoreLight(theme));
  const scrollRef = useRef<ScrollView | null>(null);
  const sectionOffsetsRef = useRef<Record<PronunciationPanelFocus, number>>({
    pronunciation: 0,
    grammar: 0,
    native: 0,
  });
  const [selectedStyle, setSelectedStyle] = useState<ExpressionStyle>('us');
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const legendItems = useMemo(
    () => [
      { label: '待提高', color: scorePalette.danger },
      { label: '小瑕疵', color: scorePalette.warning },
      { label: '很完美', color: scorePalette.success },
      { label: '连读', color: scorePalette.success },
      { label: '重读词', color: scorePalette.success },
    ],
    [scorePalette.danger, scorePalette.success, scorePalette.warning],
  );

  useEffect(() => {
    if (!visible) return;
    setSelectedStyle('us');
    setSelectedWord(null);
    setCopied(false);
  }, [visible, analysis?.roundId]);

  useEffect(() => {
    if (!visible) return;
    const timeout = setTimeout(() => {
      scrollRef.current?.scrollTo({
        y: sectionOffsetsRef.current[initialFocus] ?? 0,
        animated: false,
      });
    }, 80);
    return () => clearTimeout(timeout);
  }, [visible, initialFocus, analysis?.roundId]);

  const transcriptText =
    messageText?.trim() ||
    originalText?.trim() ||
    analysis?.transcriptText?.trim() ||
    analysis?.assessment?.transcriptText?.trim() ||
    '';
  const overallScore = analysis?.assessment?.overallScore ?? null;
  const visibleWords = useMemo(
    () => getVisibleAssessmentWords(analysis?.assessment?.words),
    [analysis?.assessment?.words],
  );
  const baseExpression =
    analysis?.expression?.betterExpression?.trim() ||
    analysis?.optimizedSentence?.trim() ||
    transcriptText ||
    '当前暂无润色结果';
  const baseExplanation =
    analysis?.expression?.betterExpressionZh?.trim() ||
    analysis?.expression?.nativeFeedbackZh?.trim() ||
    analysis?.polishedExplanationZh?.trim() ||
    analysis?.explanationZh?.trim() ||
    '当前先使用地道表达，更多风格正在生成。';
  const expressionStyles = analysis?.expressionStyles ?? null;
  const grammarTitle =
    analysis?.expression?.grammarTitle?.trim() ||
    analysis?.grammarTitle?.trim() ||
    ((analysis?.expression?.grammarStatus ?? analysis?.grammarStatus) === 'correct'
      ? '语法正确'
      : '需要优化');
  const grammarExplanation =
    analysis?.expression?.grammarFeedbackZh?.trim() ||
    analysis?.grammarExplanationZh?.trim() ||
    '语法与表达分析结果稍后补充。';

  const selectedStyleContent = resolveExpressionStyleContent(
    selectedStyle,
    expressionStyles,
    baseExpression,
    baseExplanation,
  );
  const selectedExpression = selectedStyleContent.expression;
  const selectedExpressionDisplay = selectedStyleContent.displayExpression;
  const selectedExplanation = selectedStyleContent.explanationZh;
  const suggestion = useMemo(() => buildSuggestionData(analysis), [analysis]);
  const speechRate = useMemo(
    () =>
      computeSpeechRate(
        transcriptText,
        recordingDurationMs,
        analysis?.assessment?.wordsPerMinute,
      ),
    [analysis?.assessment?.wordsPerMinute, recordingDurationMs, transcriptText],
  );
  const pronunciationPlaybackTarget =
    selectedWord ||
    transcriptText ||
    visibleWords.map((word) => word.word).join(' ').trim();

  useEffect(() => {
    if (!visible) return;
    console.log(
      `[V1_PCM_DUAL] pronunciation_advice_source_selected = ${JSON.stringify({
        roundId: analysis?.roundId ?? null,
        source: suggestion.source,
        textPreview: suggestion.text.slice(0, 120),
      })}`,
    );
  }, [analysis?.roundId, suggestion.source, suggestion.text, visible]);

  useEffect(() => {
    if (!visible) return;
    console.log(
      `[V1_PCM_DUAL] pronunciation_speech_rate_computed = ${JSON.stringify({
        roundId: analysis?.roundId ?? null,
        source: speechRate.source,
        value: speechRate.value,
        transcriptWordCount: countSpokenWords(transcriptText),
        durationMs: recordingDurationMs ?? null,
      })}`,
    );
  }, [analysis?.roundId, recordingDurationMs, speechRate.source, speechRate.value, transcriptText, visible]);

  const handlePronunciationAction = (
    action: 'play_user_audio' | 'play_us' | 'play_uk' | 'play_stress',
    enabled: boolean,
    extra?: Record<string, unknown>,
  ) => {
    const type =
      action === 'play_uk'
        ? 'british'
        : action === 'play_us'
          ? 'american'
          : action === 'play_user_audio'
            ? 'mine'
            : 'stress';
    console.log(
      `[V1_PCM_DUAL] pronunciation_reference_audio_press = ${JSON.stringify({
        type,
        word: selectedWord || null,
        targetTextPreview: pronunciationPlaybackTarget.slice(0, 80) || null,
        roundId: analysis?.roundId ?? null,
        enabled,
        wordLevelUserAudioAvailable: false,
        ...extra,
      })}`,
    );
    if (!enabled) return;
    if (action === 'play_user_audio') {
      onPlayUserAudio?.();
      return;
    }
    if (action === 'play_us') {
      onPlayUsText?.(pronunciationPlaybackTarget);
      return;
    }
    if (action === 'play_uk') {
      onPlayUkText?.(pronunciationPlaybackTarget);
      return;
    }
    onPlayStressText?.(pronunciationPlaybackTarget);
  };

  const handleExpressionAction = (
    action: 'copy' | 'ai_read' | 'loop_follow',
    enabled: boolean,
    extra?: Record<string, unknown>,
  ) => {
    const eventName =
      action === 'copy'
        ? 'expression_style_copy_press'
        : action === 'ai_read'
          ? 'expression_style_ai_read_press'
          : 'expression_style_repeat_press';
    console.log(
      `[V1_PCM_DUAL] ${eventName} = ${JSON.stringify({
        roundId: analysis?.roundId ?? null,
        style: mapStyleLogValue(selectedStyle),
        textPreview: (selectedExpression ?? '').slice(0, 120),
        enabled,
        ...extra,
      })}`,
    );
    if (!enabled) return;
    if (action === 'copy') {
      if (onCopyText) {
        onCopyText(selectedExpression ?? '');
      } else {
        Clipboard.setString(selectedExpression ?? '');
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
      return;
    }
    if (action === 'ai_read') {
      onPlayExpressionText?.(selectedExpression ?? '');
      return;
    }
    onLoopExpression?.(selectedExpression ?? '');
  };

  const handleStylePress = (nextStyle: ExpressionStyle) => {
    setSelectedStyle(nextStyle);
    console.log(
      `[V1_PCM_DUAL] expression_panel_tab_press = ${JSON.stringify({
        roundId: analysis?.roundId ?? null,
        style: mapStyleLogValue(nextStyle),
        status: resolveExpressionStyleContent(
          nextStyle,
          expressionStyles,
          baseExpression,
          baseExplanation,
        ).status,
        hasGeneratedStyle: resolveExpressionStyleContent(
          nextStyle,
          expressionStyles,
          baseExpression,
          baseExplanation,
        ).hasGeneratedStyle,
      })}`,
    );
  };

  const canPlayUserAudio = Boolean(onPlayUserAudio && hasUserAudio);
  const canPlayUs = Boolean(onPlayUsText && pronunciationPlaybackTarget);
  const canPlayUk = Boolean(onPlayUkText && pronunciationPlaybackTarget);
  const canPlayStress = Boolean(onPlayStressText && pronunciationPlaybackTarget);
  const canLoop = Boolean(onLoopExpression && selectedExpression);
  const canRead = Boolean(onPlayExpressionText && selectedExpression);
  const canCopy = Boolean(selectedExpression);

  return (
    <ScrollView
      ref={scrollRef}
      style={style}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[{ paddingBottom: 32 }, contentContainerStyle]}
    >
      <View
        onLayout={(event) => {
          sectionOffsetsRef.current.pronunciation = event.nativeEvent.layout.y;
        }}
        style={{
          backgroundColor: scorePalette.card,
          borderRadius: 22,
          borderWidth: 1,
          borderColor: scorePalette.border,
          padding: 18,
          marginBottom: 18,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 10,
            marginBottom: 16,
          }}
        >
          {legendItems.map((item) => (
            <AppText
              key={item.label}
              style={{
                fontSize: 12,
                lineHeight: 16,
                fontWeight: '700',
                color: item.color,
              }}
            >
              {item.label}
            </AppText>
          ))}
        </View>

        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            rowGap: 10,
            columnGap: 8,
            marginTop: 18,
          }}
        >
          {visibleWords.length ? (
            visibleWords.map((word, wordIndex) => (
              <WordToken
                key={`${analysis?.roundId ?? 'na'}-${wordIndex}-${word.word}-${word.beginMs ?? 'bna'}-${word.endMs ?? 'ena'}`}
                word={word}
                selected={selectedWord === word.word}
                palette={scorePalette}
                onPress={() =>
                  setSelectedWord((current) =>
                    current === word.word ? null : word.word,
                  )
                }
              />
            ))
          ) : (
            <AppText
              style={{
                fontSize: 16,
                lineHeight: 24,
                color: scorePalette.textTertiary,
              }}
            >
              逐词分析数据暂未返回
            </AppText>
          )}
        </View>

        <View
          style={{
            height: 44,
            flexDirection: 'row',
            borderTopWidth: 1,
            borderTopColor: scorePalette.separator,
            marginTop: 20,
            paddingTop: 12,
          }}
        >
          <ActionButton
            label="英音"
            enabled={canPlayUk}
            icon="volume-medium-outline"
            flex={1}
            palette={scorePalette}
            onPress={() =>
              handlePronunciationAction('play_uk', canPlayUk, {
                text: pronunciationPlaybackTarget,
                accent: 'uk',
              })
            }
          />
          <ActionButton
            label="美音"
            enabled={canPlayUs}
            icon="volume-medium-outline"
            flex={1}
            palette={scorePalette}
            onPress={() =>
              handlePronunciationAction('play_us', canPlayUs, {
                text: pronunciationPlaybackTarget,
                accent: 'us',
              })
            }
          />
          <ActionButton
            label="我的"
            enabled={canPlayUserAudio}
            icon="person-outline"
            flex={1}
            palette={scorePalette}
            onPress={() =>
              handlePronunciationAction('play_user_audio', canPlayUserAudio)
            }
          />
          <ActionButton
            label="重读"
            enabled={canPlayStress}
            icon="play-outline"
            flex={1}
            palette={scorePalette}
            onPress={() =>
              handlePronunciationAction('play_stress', canPlayStress, {
                text: pronunciationPlaybackTarget,
              })
            }
          />
        </View>
      </View>

      <View
        onLayout={(event) => {
          sectionOffsetsRef.current.grammar = event.nativeEvent.layout.y;
        }}
      >
        <AppText
          style={{
            fontSize: 22,
            lineHeight: 28,
            fontWeight: '800',
            color: scorePalette.textPrimary,
            marginBottom: 14,
          }}
        >
          评分建议
        </AppText>

        <View
          style={{
            backgroundColor: scorePalette.card,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: scorePalette.border,
            padding: 18,
            marginBottom: 18,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 18,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                flex: 1,
              }}
            >
              <View
                style={{
                  width: 58,
                  height: 58,
                  borderRadius: 29,
                  borderWidth: 5,
                  borderColor: progressColor(overallScore, scorePalette),
                  backgroundColor: scorePalette.cardSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AppText
                  style={{
                    fontSize: 22,
                    fontWeight: '800',
                    color: scorePalette.textPrimary,
                  }}
                >
                  {metricLabel(overallScore)}
                </AppText>
              </View>
              <View style={{ marginLeft: 14, flex: 1 }}>
                <AppText
                  style={{
                    fontSize: 19,
                    fontWeight: '800',
                    color: scorePalette.textPrimary,
                  }}
                >
                  综合评分
                </AppText>
                <AppText
                  style={{
                    marginTop: 3,
                    fontSize: 14,
                    color: progressColor(overallScore, scorePalette),
                  }}
                >
                  {scoreLabel(overallScore)}
                </AppText>
              </View>
            </View>

            <View
              style={{
                width: 94,
                height: 58,
                borderRadius: 18,
                backgroundColor: scorePalette.cardSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AppText
                style={{ fontSize: 13, color: scorePalette.textTertiary }}
              >
                语速
              </AppText>
              <AppText
                style={{
                  fontSize: 16,
                  fontWeight: '800',
                  color: scorePalette.textPrimary,
                }}
              >
                {speechRate.value != null ? `${speechRate.value} 词/分` : '待分析'}
              </AppText>
            </View>
          </View>

          <MetricRow
            label="流利度"
            value={analysis?.assessment?.fluencyScore}
            palette={scorePalette}
          />
          <MetricRow
            label="发音分"
            value={
              analysis?.assessment?.accuracyScore ??
              analysis?.assessment?.standardScore
            }
            palette={scorePalette}
          />
          <MetricRow
            label="完整度"
            value={analysis?.assessment?.integrityScore}
            palette={scorePalette}
          />

          <View
            style={{
              height: 1,
              backgroundColor: scorePalette.separator,
              marginTop: 6,
            }}
          />
          <View style={{ paddingTop: 14 }}>
            <AppText
              style={{
                fontSize: 16,
                lineHeight: 24,
                fontWeight: '800',
                color: scorePalette.textPrimary,
              }}
            >
              {grammarTitle}
            </AppText>
            <AppText
              style={{
                marginTop: 8,
                fontSize: 15,
                lineHeight: 24,
                color: scorePalette.textSecondary,
              }}
            >
              {grammarExplanation}
            </AppText>
            <AppText
              style={{
                marginTop: 10,
                fontSize: 15,
                lineHeight: 24,
                color: scorePalette.textSecondary,
              }}
            >
              {suggestion.text}
            </AppText>
          </View>
        </View>
      </View>

      <View
        onLayout={(event) => {
          sectionOffsetsRef.current.native = event.nativeEvent.layout.y;
        }}
      >
        <AppText
          style={{
            fontSize: 22,
            lineHeight: 28,
            fontWeight: '800',
            color: scorePalette.textPrimary,
            marginBottom: 12,
            marginTop: 6,
          }}
        >
          语境润色
        </AppText>

        <View
          style={{
            backgroundColor: scorePalette.card,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: scorePalette.border,
            padding: 18,
            marginBottom: 18,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginBottom: 18,
            }}
          >
            <Pressable onPress={() => handleStylePress('us')}>
              <View
                style={{
                  paddingBottom: 6,
                  borderBottomWidth: selectedStyle === 'us' ? 3 : 0,
                  borderBottomColor: scorePalette.success,
                }}
              >
                <AppText
                  style={{
                    fontSize: 16,
                    fontWeight: '800',
                    color: scorePalette.textPrimary,
                  }}
                >
                  地道美式
                </AppText>
              </View>
            </Pressable>
            <Pressable
              onPress={() => handleStylePress('business')}
              style={{ marginLeft: 24 }}
            >
              <View
                style={{
                  paddingBottom: 6,
                  borderBottomWidth: selectedStyle === 'business' ? 3 : 0,
                  borderBottomColor: scorePalette.success,
                }}
              >
                <AppText
                  style={{
                    fontSize: 16,
                    fontWeight: selectedStyle === 'business' ? '800' : '700',
                    color:
                      selectedStyle === 'business'
                        ? scorePalette.textPrimary
                        : scorePalette.textTertiary,
                    opacity: selectedStyle === 'business' ? 1 : 0.75,
                  }}
                >
                  商务正式
                </AppText>
              </View>
            </Pressable>
            <Pressable
              onPress={() => handleStylePress('british')}
              style={{ marginLeft: 24 }}
            >
              <View
                style={{
                  paddingBottom: 6,
                  borderBottomWidth: selectedStyle === 'british' ? 3 : 0,
                  borderBottomColor: scorePalette.success,
                }}
              >
                <AppText
                  style={{
                    fontSize: 16,
                    fontWeight: selectedStyle === 'british' ? '800' : '700',
                    color:
                      selectedStyle === 'british'
                        ? scorePalette.textPrimary
                        : scorePalette.textTertiary,
                    opacity: selectedStyle === 'british' ? 1 : 0.75,
                  }}
                >
                  地道英式
                </AppText>
              </View>
            </Pressable>
          </View>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 18,
            }}
          >
            <ActionButton
              label="循环跟读"
              enabled={canLoop}
              icon="repeat-outline"
              palette={scorePalette}
              onPress={() =>
                handleExpressionAction('loop_follow', canLoop, {
                  text: selectedExpression,
                })
              }
            />
            <ActionButton
              label={copied ? '已复制' : '复制'}
              enabled={canCopy}
              icon="copy-outline"
              palette={scorePalette}
              onPress={() =>
                handleExpressionAction('copy', canCopy, {
                  text: selectedExpression,
                })
              }
            />
            <ActionButton
              label="AI朗读"
              enabled={canRead}
              icon="volume-medium-outline"
              palette={scorePalette}
              onPress={() =>
                handleExpressionAction('ai_read', canRead, {
                  text: selectedExpression,
                })
              }
            />
          </View>

          <View>
            <AppText
              style={{
                fontSize: 15,
                lineHeight: 22,
                color: scorePalette.textSecondary,
              }}
            >
              优化后的句子：{selectedExpressionDisplay}
            </AppText>
            <AppText
              style={{
                marginTop: 12,
                fontSize: 15,
                lineHeight: 24,
                color: scorePalette.textSecondary,
              }}
            >
              修改解释：{selectedExplanation}
            </AppText>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}
