import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StatusBar, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { XfyunPronunciationDetailContent } from '@/components/speaking/XfyunPronunciationDetailContent';
import { ChromeIconButton } from '@/components/ui/ApplePrimitives';
import { XfyunPronunciationPanel } from '@/components/speaking/XfyunPronunciationPanel';
import { XfyunRoundCards } from '@/components/speaking/XfyunRoundCards';
import { SCENARIOS } from '@/data/scenarios';
import { useDeviceClass } from '@/hooks/useDeviceClass';
import { useSpeakingV1PcmDualStreamRuntime } from '@/hooks/speaking/useSpeakingV1PcmDualStreamRuntime';
import { translateSpeakingMessage } from '@/services/api/speakingPractice';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import { useAiDataConsent } from '@/services/privacy/AiDataConsentProvider';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { PcmDualConversationMessage, PcmDualUserMessage } from '@/types/pcmDualStream';
import type { SpeakingRoundAnalysis } from '@/types/xfyunSpeakingAssessment';

type DetailSheetState = {
  messageId: string;
  focus: 'pronunciation' | 'grammar' | 'native';
};

type MessageTranslationState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  text?: string;
  error?: string;
};

function stageLabel(stage: string) {
  switch (stage) {
    case 'idle':
      return '点击说话';
    case 'starting':
    case 'recording':
      return '正在聆听…';
    case 'recognizing':
      return '正在识别…';
    case 'thinking':
      return '正在生成回复…';
    case 'playing':
      return 'AI 正在回复…';
    case 'error':
      return '当前回合出现问题，可重试';
    default:
      return '处理中…';
  }
}

function clampInlineText(text: string, maxLength = 40) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function buildDefaultInlineText(analysis: SpeakingRoundAnalysis | null) {
  const text =
    analysis?.expression?.betterExpressionZh?.trim() ||
    analysis?.expression?.nativeFeedbackZh?.trim() ||
    analysis?.expression?.grammarFeedbackZh?.trim() ||
    analysis?.grammarExplanationZh?.trim() ||
    '';
  return text ? clampInlineText(text) : null;
}

function log(step: string, payload: Record<string, unknown>) {
  console.log(`[V1_PCM_DUAL] ${step} = ${JSON.stringify(payload)}`);
}

function countChineseChars(text: string) {
  return (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
}

function isDisplayableEnglishSuggestion(text: string | null | undefined) {
  const normalized = text?.trim() ?? '';
  if (!normalized) return false;
  const englishCharCount = (normalized.match(/[A-Za-z]/g) ?? []).length;
  const chineseCharCount = countChineseChars(normalized);
  const totalLetters = englishCharCount + chineseCharCount;
  if (englishCharCount < 6) return false;
  if (totalLetters > 0 && chineseCharCount / totalLetters >= 0.2) return false;
  return /[A-Za-z]/.test(normalized);
}

function getBetterExpressionCandidate(analysis: SpeakingRoundAnalysis | null) {
  const expressionCandidate = analysis?.expression?.betterExpression?.trim();
  if (expressionCandidate) {
    return { text: expressionCandidate, source: 'analysis.expression.betterExpression' };
  }
  const optimizedCandidate = analysis?.optimizedSentence?.trim();
  if (optimizedCandidate) {
    return { text: optimizedCandidate, source: 'analysis.optimizedSentence' };
  }
  return null;
}

function normalizeForRoleCheck(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s?]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isQuestionLike(text: string) {
  const normalized = normalizeForRoleCheck(text);
  return (
    text.trim().endsWith('?') ||
    /^(what|how|why|where|when|can|could|would|do|does|did|is|are|am|may|should)\b/i.test(normalized)
  );
}

function getBetterExpressionRejectionReason({
  originalText,
  betterExpression,
  scenarioTitle,
  assistantLastText,
}: {
  originalText: string;
  betterExpression?: string | null;
  scenarioTitle?: string;
  assistantLastText?: string;
}) {
  const candidate = betterExpression?.trim() ?? '';
  if (!candidate) return 'empty';
  if (!isDisplayableEnglishSuggestion(candidate)) return 'not_displayable_english';

  const normalizedCandidate = normalizeForRoleCheck(candidate);
  const normalizedAssistant = normalizeForRoleCheck(assistantLastText ?? '');
  if (
    normalizedCandidate &&
    normalizedAssistant &&
    (normalizedAssistant.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedAssistant))
  ) {
    return 'similar_to_assistant';
  }

  const originalIsQuestion = isQuestionLike(originalText);
  const serviceSideQuestionPatterns = [
    /\bwhat would you like\b/i,
    /\bwould you like\b/i,
    /\bhow can i help\b/i,
    /\bcan i help you\b/i,
    /\bmay i take your order\b/i,
    /\bwhat can i get you\b/i,
    /\bdo you want to\b/i,
    /\bare you looking for\b/i,
    /\bwhat would you prefer\b/i,
    /\bplease tell me\b/i,
    /\blet me know\b/i,
    /\bcould you tell me\b/i,
    /\bcan you tell me\b/i,
  ];
  const isServiceScenario = /咖啡|餐厅|酒店|机场|购物|看病|医生|面试|校园|旅行|点单|入住|商店/.test(
    scenarioTitle ?? '',
  );
  const looksLikeServiceSidePrompt = serviceSideQuestionPatterns.some((pattern) => pattern.test(candidate));
  if (looksLikeServiceSidePrompt && (!originalIsQuestion || isServiceScenario)) {
    return 'service_side_question';
  }

  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getMaskLineWidths(text: string) {
  const normalizedLength = text.trim().length;
  const count = clamp(Math.ceil(normalizedLength / 28) || 1, 1, 4);
  const presets = ['88%', '76%', '64%', '48%'] as const;
  return presets.slice(0, count);
}

function AssistantMaskSkeleton({ text }: { text: string }) {
  const widths = getMaskLineWidths(text);
  return (
    <View
      pointerEvents="none"
      style={{
        ...StyleSheet.absoluteFillObject,
        top: 13,
        left: 15,
        right: 34,
        bottom: 13,
        justifyContent: 'flex-start',
      }}
    >
      {widths.map((width, index) => (
        <View
          key={`${width}-${index}`}
          style={{
            width,
            height: 10,
            borderRadius: 5,
            backgroundColor: 'rgba(255,255,255,0.09)',
            marginBottom: index === widths.length - 1 ? 0 : 9,
          }}
        />
      ))}
    </View>
  );
}

function AssistantTypingBubble({ variant = 'dots' }: { variant?: 'dots' }) {
  void variant;
  const { theme } = useAppTheme();
  const dotOpacities = useRef([0, 1, 2].map(() => new Animated.Value(0.35))).current;
  const bubbleBackground = theme.colorScheme === 'dark' ? 'rgba(36,36,38,0.94)' : theme.secondaryCardBackground;
  const bubbleBorder = theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.08)' : theme.border;
  const dotColor = theme.colorScheme === 'dark' ? 'rgba(245,245,247,0.52)' : theme.textTertiary;

  useEffect(() => {
    const animations = dotOpacities.map((opacity, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 120),
          Animated.timing(opacity, {
            toValue: 1,
            duration: 240,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0.35,
            duration: 240,
            useNativeDriver: true,
          }),
          Animated.delay(900 - index * 120 - 480),
        ]),
      ),
    );
    animations.forEach((animation) => animation.start());
    return () => {
      animations.forEach((animation) => animation.stop());
    };
  }, [dotOpacities]);

  return (
    <View
      style={{
        alignSelf: 'flex-start',
        marginLeft: 0,
        marginTop: 12,
        marginBottom: 4,
        backgroundColor: bubbleBackground,
        borderWidth: 1,
        borderColor: bubbleBorder,
        borderRadius: 19,
        width: 74,
        height: 38,
        paddingHorizontal: 15,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        shadowColor: theme.shadowColor,
        shadowOpacity: theme.colorScheme === 'dark' ? 0 : 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: theme.colorScheme === 'dark' ? 0 : 2,
      }}
    >
      {dotOpacities.map((opacity, index) => (
        <Animated.View
          key={index}
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: dotColor,
            opacity,
          }}
        />
      ))}
    </View>
  );
}

function ActionPill({
  label,
  icon,
  onPress,
  height,
  paddingHorizontal,
  textSize,
  iconSize,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  height: number;
  paddingHorizontal: number;
  textSize: number;
  iconSize: number;
}) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        height,
        paddingHorizontal,
        borderRadius: height / 2,
        backgroundColor: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.075)' : theme.secondaryCardBackground,
        borderWidth: 1,
        borderColor: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.08)' : theme.border,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        opacity: pressed ? 0.72 : 1,
      })}
    >
      <Ionicons name={icon} size={iconSize} color={theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.72)' : theme.textSecondary} />
      <AppText style={{ fontSize: textSize, fontWeight: '600', color: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.72)' : theme.textSecondary }}>{label}</AppText>
    </Pressable>
  );
}

function InlineExplanation({
  analysis,
  width,
}: {
  analysis: SpeakingRoundAnalysis | null;
  width: number;
}) {
  const defaultText = buildDefaultInlineText(analysis);
  if (!defaultText) return null;

  return (
    <View
      style={{
        alignSelf: 'flex-end',
        width,
        marginTop: 0,
        marginRight: 2,
      }}
    >
      <AppText
        numberOfLines={1}
        style={{
          alignSelf: 'center',
          maxWidth: width,
          fontSize: 9,
          lineHeight: 12,
          color: 'rgba(255,255,255,0.25)',
          textAlign: 'center',
        }}
      >
        {defaultText}
      </AppText>
    </View>
  );
}

function MessageCard({
  message,
  onReplay,
  replayDisabled,
  bubbleMaxWidth,
  bubbleMinWidth,
  masked,
  onToggleMask,
  suggestedExpression,
  onSuggestedAudioPress,
  suggestedAudioPlaying,
}: {
  message: PcmDualConversationMessage;
  onReplay: () => void;
  replayDisabled: boolean;
  bubbleMaxWidth: number;
  bubbleMinWidth?: number;
  masked?: boolean;
  onToggleMask?: () => void;
  suggestedExpression?: string | null;
  onSuggestedAudioPress?: () => void;
  suggestedAudioPlaying?: boolean;
}) {
  const { theme } = useAppTheme();
  const isUser = message.role === 'user';
  const hasSuggestedExpression = isUser && Boolean(suggestedExpression);
  const messageText = `${message.text}${!isUser && message.replyStatus === 'pending' ? '▌' : ''}`;
  const BubbleContainer = !isUser ? Pressable : View;

  return (
    <View
      style={{
        width: '100%',
        alignItems: isUser ? 'flex-end' : 'flex-start',
      }}
    >
      <BubbleContainer
        {...(!isUser
          ? {
              onPress: onToggleMask,
            }
          : {})}
        style={{
          position: 'relative',
          width: isUser ? 'auto' : undefined,
          maxWidth: bubbleMaxWidth,
          minWidth: isUser ? bubbleMinWidth ?? 0 : 0,
          marginTop: isUser ? 13 : 14,
          marginBottom: 4,
          paddingTop: isUser ? 11 : 13,
          paddingBottom: isUser ? 11 : 13,
          paddingLeft: isUser ? 14 : 15,
          paddingRight: isUser ? 12 : 34,
          backgroundColor: isUser ? '#0A84FF' : theme.colorScheme === 'dark' ? '#1F1F21' : theme.cardBackground,
          borderRadius: isUser ? 17 : 16,
          borderBottomLeftRadius: isUser ? 17 : 6,
          borderBottomRightRadius: isUser ? 6 : 16,
          alignSelf: isUser ? 'flex-end' : 'flex-start',
          overflow: isUser ? 'visible' : undefined,
          borderWidth: isUser ? 0 : 1,
          borderColor: isUser ? 'transparent' : theme.colorScheme === 'dark' ? 'transparent' : theme.border,
        }}
      >
        {isUser ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', width: '100%', gap: 8 }}>
              <AppText
                style={{
                  flex: 1,
                  flexShrink: 1,
                  minWidth: 0,
                  fontSize: 17,
                  lineHeight: 23,
                  fontWeight: '500',
                  color: '#FFFFFF',
                  paddingRight: 0,
                  letterSpacing: 0,
                  includeFontPadding: false,
                }}
              >
                {messageText}
              </AppText>
              <Pressable
                hitSlop={8}
                onPress={onReplay}
                disabled={replayDisabled}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  backgroundColor: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.22)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: -1,
                  flexShrink: 0,
                  opacity: replayDisabled ? 0.35 : 1,
                }}
              >
                <Ionicons name="volume-medium-outline" size={15} color="rgba(255,255,255,0.78)" />
              </Pressable>
            </View>

            {hasSuggestedExpression ? (
              <>
                <View
                  style={{
                    height: 1,
                    marginTop: 9,
                    marginBottom: 8,
                    backgroundColor: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.28)',
                  }}
                />
                <AppText
                  style={{
                    fontSize: 12,
                    lineHeight: 15,
                    color: 'rgba(255,255,255,0.78)',
                    marginBottom: 4,
                  }}
                >
                  你也可以说：
                </AppText>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', width: '100%', gap: 8 }}>
                  <AppText
                    style={{
                      flex: 1,
                      flexShrink: 1,
                      minWidth: 0,
                      fontSize: 15,
                      lineHeight: 21,
                      fontWeight: '400',
                      color: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.92)' : theme.textPrimary,
                      paddingRight: 0,
                      includeFontPadding: false,
                    }}
                  >
                    {suggestedExpression}
                  </AppText>
                  <Pressable
                    hitSlop={8}
                    onPress={onSuggestedAudioPress}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(10,132,255,0.14)',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      opacity: suggestedAudioPlaying ? 0.65 : 1,
                    }}
                  >
                    <Ionicons name="volume-medium-outline" size={15} color={theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.82)' : theme.primaryBlue} />
                  </Pressable>
                </View>
              </>
            ) : null}
          </>
        ) : (
          <>
            <AppText
              style={{
                fontSize: 18,
                lineHeight: 25,
                fontWeight: '400',
                color: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.90)' : theme.textPrimary,
                letterSpacing: 0,
                includeFontPadding: false,
                opacity: masked ? 0 : 1,
              }}
            >
              {messageText}
            </AppText>
            {masked ? <AssistantMaskSkeleton text={messageText} /> : null}
          </>
        )}

        {!isUser ? (
          <Pressable
            hitSlop={12}
            onPress={onReplay}
            disabled={replayDisabled}
            style={{
              position: 'absolute',
              right: 12,
              top: 12,
              opacity: replayDisabled ? 0.35 : 1,
              zIndex: 4,
              width: 18,
              height: 18,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="volume-medium-outline" size={15} color={theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.48)' : theme.textTertiary} />
          </Pressable>
        ) : null}
      </BubbleContainer>
    </View>
  );
}

export function SpeakingV1Screen() {
  const { theme } = useAppTheme();
  const aiConsent = useAiDataConsent();
  const params = useLocalSearchParams<{ scenarioId?: string }>();
  const scenarioIdParam = Array.isArray(params.scenarioId) ? params.scenarioId[0] : params.scenarioId;
  const scenario = useMemo(() => SCENARIOS.find((item) => item.id === scenarioIdParam) ?? SCENARIOS[0], [scenarioIdParam]);
  const { isTablet } = useDeviceClass();
  const insets = useSafeAreaInsets();
  const appSession = useAppSession();
  const isLoggedIn = appSession.status === 'authenticated';
  const runtime = useSpeakingV1PcmDualStreamRuntime({
    session: appSession.session,
    scenario,
  });
  const conversationRef = useRef<ScrollView | null>(null);
  const previousDisplayedMessageCountRef = useRef(0);
  const suppressNextAutoScrollRef = useRef(false);
  const replayScrollSuppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedAssistantMaskIdsRef = useRef<Set<string>>(new Set());
  const buttonDebounceRef = useRef(new Map<string, number>());
  const betterExpressionLogRef = useRef(new Set<string>());
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [detailSheetState, setDetailSheetState] = useState<DetailSheetState | null>(null);
  const [textInputMode, setTextInputMode] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [maskedAssistantMessageIds, setMaskedAssistantMessageIds] = useState<Set<string>>(() => new Set());
  const [translationsByMessageId, setTranslationsByMessageId] = useState<Record<string, MessageTranslationState>>({});
  const [visibleTranslationMessageIds, setVisibleTranslationMessageIds] = useState<Set<string>>(() => new Set());
  const [initialAssistantBooting, setInitialAssistantBooting] = useState(true);

  useEffect(() => {
    return () => {
      if (replayScrollSuppressTimerRef.current) {
        clearTimeout(replayScrollSuppressTimerRef.current);
        replayScrollSuppressTimerRef.current = null;
      }
    };
  }, []);

  const analysisMap = useMemo(() => {
    const map = new Map<string, SpeakingRoundAnalysis>();
    runtime.messages.forEach((message) => {
      if (message.role !== 'user' || !message.analysis) return;
      map.set(message.id, message.analysis);
    });
    return map;
  }, [runtime.messages]);

  useEffect(() => {
    const hasAssistantReady = runtime.messages.some(
      (message) =>
        message.role === 'assistant' &&
        message.text.trim().length > 0 &&
        (message.roundId !== 0 || message.replyStatus === 'ready'),
    );
    if (!hasAssistantReady) return;
    setInitialAssistantBooting(false);
  }, [runtime.messages]);

  useEffect(() => {
    const nextAssistantIds: string[] = [];
    runtime.messages.forEach((message) => {
      if (message.role !== 'assistant') return;
      if (message.roundId === 0) return;
      if (initializedAssistantMaskIdsRef.current.has(message.id)) return;
      initializedAssistantMaskIdsRef.current.add(message.id);
      nextAssistantIds.push(message.id);
    });
    if (nextAssistantIds.length === 0) return;
    setMaskedAssistantMessageIds((current) => {
      const next = new Set(current);
      nextAssistantIds.forEach((id) => next.add(id));
      return next;
    });
  }, [runtime.messages]);

  const selectedAnalysis = useMemo(
    () => (detailSheetState ? analysisMap.get(detailSheetState.messageId) ?? null : null),
    [analysisMap, detailSheetState],
  );

  const selectedUserMessage = useMemo(
    () =>
      detailSheetState
        ? runtime.messages.find(
            (message): message is PcmDualUserMessage =>
              message.id === detailSheetState.messageId && message.role === 'user',
          ) ?? null
        : null,
    [detailSheetState, runtime.messages],
  );

  useEffect(() => {
    if (!detailSheetState) return;
    const hasMessage = runtime.messages.some(
      (message) => message.id === detailSheetState.messageId && message.role === 'user',
    );
    if (!hasMessage || !analysisMap.has(detailSheetState.messageId)) {
      setDetailSheetState(null);
    }
  }, [analysisMap, detailSheetState, runtime.messages]);

  const displayedMessages = useMemo(
    () =>
      runtime.messages.filter((message) => {
        if (message.role === 'assistant') {
          return message.replyStatus !== 'failed' && (Boolean(message.text.trim()) || message.replyStatus === 'pending');
        }
        // 用户消息：隐藏"正在聆听"状态（开始录音但还没文字）
        if (message.transcriptStatus === 'listening') {
          return false;
        }
        // recognizing 但还没文字：隐藏
        if (message.transcriptStatus === 'recognizing' && !message.text.trim()) {
          return false;
        }
        // failed/unavailable：若有 interim 文字则保留气泡，否则隐藏空气泡
        if (message.transcriptStatus === 'failed' || message.transcriptStatus === 'unavailable') {
          return Boolean(message.text.trim());
        }
        return Boolean(message.text.trim());
      }),
    [runtime.messages],
  );

  const micDisabled =
    !runtime.enabled ||
    !runtime.recorderCapability.available ||
    runtime.stage === 'starting' ||
    runtime.stage === 'recognizing' ||
    runtime.stage === 'thinking';

  const pageHorizontalPadding = isTablet ? 32 : 28;
  const contentMaxWidth = isTablet ? 980 : screenWidth;
  const contentWidth = isTablet
    ? Math.min(Math.max(screenWidth - pageHorizontalPadding * 2, 0), contentMaxWidth)
    : screenWidth;
  const messageListMaxWidth = isTablet ? Math.min(contentWidth, 900) : undefined;
  const userBubbleMaxWidth = isTablet ? 460 : Math.round(screenWidth * 0.68);
  const userBubbleMinWidth = isTablet ? 210 : Math.min(210, Math.round(screenWidth * 0.48));
  const aiBubbleMaxWidth = isTablet ? 520 : screenWidth * 0.72;
  const compactBarWidth = isTablet
    ? Math.min(260, Math.max(220, Math.round(userBubbleMaxWidth * 0.56)))
    : Math.min(216, Math.max(196, Math.round(userBubbleMaxWidth * 0.7)));
  const inlineExplanationWidth = compactBarWidth;
  const creditsText = runtime.creditsLoading ? '… Credits' : `${Math.max(runtime.credits?.balanceCredits ?? 0, 0)} Credits`;
  // 将内部错误码映射为用户友好文案，避免把 "pcm_capture_native_module_unavailable" 这类
  // 内部字符串直接显示到 UI 上
  const recorderUnavailableText = (() => {
    const reason = runtime.recorderCapability.reason ?? '';
    if (reason === 'pcm_capture_native_module_unavailable' || reason === 'pcm_capture_not_supported') {
      return '语音功能暂不可用，请使用文字输入';
    }
    return reason || '当前设备暂不支持录音';
  })();
  // 将 runtimeError.message 中的内部错误码映射为用户友好文案
  const mapRuntimeErrorMessage = (msg: string): string => {
    if (msg === 'microphone_permission_denied') return '请在系统设置中开启麦克风权限后重试';
    if (msg.startsWith('pcm_capture')) return '录音功能暂时不可用，请重试';
    return msg;
  };
  const bottomStatusText =
    (runtime.runtimeError?.message ? mapRuntimeErrorMessage(runtime.runtimeError.message) : null) ||
    (!runtime.recorderCapability.available
      ? recorderUnavailableText
      : stageLabel(runtime.stage));
  const bottomStatusColor = runtime.runtimeError ? theme.warning : runtime.stage === 'idle' ? theme.textPrimary : theme.textSecondary;
  const bottomBarContentHeight = isTablet ? 56 : 50;
  const bottomBarMaxWidth = isTablet ? 600 : screenWidth - 48;
  const bottomBarHeight = insets.bottom + (isTablet ? 80 : 74);
  const scrollBottomPadding =
    (isTablet ? bottomBarContentHeight + 88 : bottomBarHeight + 32) +
    (textInputMode ? 48 : 0);
  const tabletContentWidth = Math.min(Math.max(screenWidth - 48, 0), 1400);
  const tabletRightWidth = Math.min(456, Math.max(390, Math.round(tabletContentWidth * 0.38)));
  const tabletLeftWidth = Math.max(0, tabletContentWidth - tabletRightWidth - 16);
  const tabletLeftMinWidth = Math.min(720, tabletLeftWidth);
  const hasAssistantReady = runtime.messages.some(
    (message) =>
      message.role === 'assistant' &&
      message.text.trim().length > 0 &&
      (message.roundId !== 0 || message.replyStatus === 'ready'),
  );
  const hasAssistantMessage = runtime.messages.some((message) => message.role === 'assistant');
  const showInitialAssistantLoading = !hasAssistantReady && !hasAssistantMessage && initialAssistantBooting;

  const getPreviousAssistantText = (messageId: string) => {
    const messageIndex = runtime.messages.findIndex((item) => item.id === messageId);
    const previousMessages = messageIndex >= 0 ? runtime.messages.slice(0, messageIndex) : runtime.messages;
    return (
      [...previousMessages]
        .reverse()
        .find((item) => item.role === 'assistant' && item.text.trim())
        ?.text.trim() ?? ''
    );
  };

  const logBetterExpressionSelection = ({
    message,
    candidate,
    accepted,
    reason,
  }: {
    message: PcmDualUserMessage;
    candidate: ReturnType<typeof getBetterExpressionCandidate>;
    accepted: boolean;
    reason?: string | null;
  }) => {
    if (!candidate) return;
    const sourceKey = `source:${message.id}:${candidate.source}:${accepted}:${reason ?? 'ok'}`;
    if (betterExpressionLogRef.current.has(sourceKey)) return;
    betterExpressionLogRef.current.add(sourceKey);
    log('better_expression_source_selected', {
      roundId: message.roundId,
      source: candidate.source,
      originalText: message.text,
      candidate: candidate.text,
      accepted,
    });
    if (!accepted) {
      log('better_expression_rejected_role_mismatch', {
        originalText: message.text,
        betterExpression: candidate.text,
        scenarioTitle: scenario.name,
        reason: reason ?? 'unknown',
      });
    }
  };

  const getDisplayableBetterExpressionForMessage = (message: PcmDualUserMessage, analysis: SpeakingRoundAnalysis | null) => {
    const candidate = getBetterExpressionCandidate(analysis);
    if (!candidate) return null;
    const reason = getBetterExpressionRejectionReason({
      originalText: message.text,
      betterExpression: candidate.text,
      scenarioTitle: scenario.name,
      assistantLastText: getPreviousAssistantText(message.id),
    });
    const accepted = !reason;
    logBetterExpressionSelection({ message, candidate, accepted, reason });
    return accepted ? candidate.text : null;
  };

  const getTranslationContext = (message: PcmDualConversationMessage) => {
    const messageIndex = runtime.messages.findIndex((item) => item.id === message.id);
    const previousMessages = messageIndex >= 0 ? runtime.messages.slice(0, messageIndex) : runtime.messages;
    const previousUserText =
      [...previousMessages]
        .reverse()
        .find((item) => item.role === 'user' && item.text.trim())
        ?.text.trim() ?? '';
    const previousAssistantText =
      [...previousMessages]
        .reverse()
        .find((item) => item.role === 'assistant' && item.text.trim())
        ?.text.trim() ?? '';
    const betterExpression =
      message.role === 'user'
        ? getDisplayableBetterExpressionForMessage(message, analysisMap.get(message.id) ?? null) ?? undefined
        : undefined;

    return {
      scenarioId: scenario.id,
      scenarioTitle: scenario.name,
      level: scenario.level,
      previousUserText,
      previousAssistantText,
      roundId: message.roundId,
      betterExpression,
    };
  };

  const runAutoScroll = (reason: string, messageCount: number) => {
    if (suppressNextAutoScrollRef.current) {
      log('message_list_auto_scroll_suppressed', { reason: 'audio_replay' });
      return;
    }
    const timer = setTimeout(() => {
      if (suppressNextAutoScrollRef.current) {
        log('message_list_auto_scroll_suppressed', { reason: 'audio_replay' });
        return;
      }
      log('message_list_auto_scroll', { reason, messageCount });
      conversationRef.current?.scrollToEnd({ animated: true });
    }, 60);
    return () => clearTimeout(timer);
  };

  useEffect(() => {
    const previousCount = previousDisplayedMessageCountRef.current;
    const currentCount = displayedMessages.length;
    previousDisplayedMessageCountRef.current = currentCount;
    if (currentCount <= previousCount) {
      return;
    }
    return runAutoScroll('message_added', currentCount);
  }, [displayedMessages.length]);

  const suppressAutoScrollForReplay = () => {
    suppressNextAutoScrollRef.current = true;
    if (replayScrollSuppressTimerRef.current) {
      clearTimeout(replayScrollSuppressTimerRef.current);
    }
    replayScrollSuppressTimerRef.current = setTimeout(() => {
      suppressNextAutoScrollRef.current = false;
      replayScrollSuppressTimerRef.current = null;
    }, 300);
  };

  const shouldIgnoreDebouncedPress = (key: string, waitMs: number) => {
    const now = Date.now();
    const previous = buttonDebounceRef.current.get(key) ?? 0;
    if (now - previous < waitMs) {
      return true;
    }
    buttonDebounceRef.current.set(key, now);
    return false;
  };

  const handleMicPress = () => {
    if (micDisabled) return;
    if (runtime.stage === 'recording') {
      void runtime.stopRecording();
      return;
    }
    void (async () => {
      const consented = await aiConsent.requestConsent();
      if (!consented) return;
      await runtime.startRecording();
    })();
  };

  const handleSendText = () => {
    const trimmed = draftText.trim();
    if (!trimmed) return;
    setDraftText('');
    void runtime.sendTextMessage(trimmed);
  };

  const handleBack = () => router.back();

  const handleUserAudioButtonPress = (message: PcmDualUserMessage) => {
    suppressAutoScrollForReplay();
    const hasUri = Boolean(message.turnAssessment?.userAudio?.uri);
    log('user_audio_button_press', { roundId: message.roundId, hasUri });
    if (!hasUri) {
      log('user_audio_unavailable', { roundId: message.roundId });
      return;
    }
    void runtime.replayUserAudio(message.id);
  };

  const handleAssistantAudioButtonPress = (message: PcmDualConversationMessage) => {
    if (message.role !== 'assistant') return;
    suppressAutoScrollForReplay();
    const audioFileUri = message.audioFileUri ?? message.audioUrl ?? null;
    log('assistant_bubble_audio_press', {
      messageId: message.id,
      hasAudioFileUri: Boolean(audioFileUri),
      audioFileUriPreview: audioFileUri ? audioFileUri.slice(0, 80) : null,
    });
    if (!audioFileUri) {
      log('assistant_bubble_audio_missing', {
        messageId: message.id,
        keys: Object.keys(message),
      });
      return;
    }
    log('assistant_bubble_audio_play_start', { messageId: message.id });
    void runtime.replayAssistantAudio(message.id);
  };

  const toggleAssistantMask = (messageId: string) => {
    setMaskedAssistantMessageIds((current) => {
      const next = new Set(current);
      const nextMasked = !next.has(messageId);
      if (nextMasked) {
        next.add(messageId);
      } else {
        next.delete(messageId);
      }
      log('assistant_mask_toggle', {
        messageId,
        masked: nextMasked,
      });
      return next;
    });
  };

  const toggleTranslationVisibility = (messageId: string) => {
    setVisibleTranslationMessageIds((current) => {
      const next = new Set(current);
      const visible = !next.has(messageId);
      if (visible) {
        next.add(messageId);
      } else {
        next.delete(messageId);
      }
      log('message_translate_toggle_visible', {
        messageId,
        visible,
      });
      return next;
    });
  };

  const requestMessageTranslation = async (
    message: PcmDualConversationMessage,
    role: 'assistant' | 'user',
  ) => {
    if (!appSession.session || !message.text.trim()) {
      setTranslationsByMessageId((current) => ({
        ...current,
        [message.id]: {
          status: 'error',
          error: '缺少翻译能力',
        },
      }));
      setVisibleTranslationMessageIds((current) => {
        const next = new Set(current);
        next.add(message.id);
        log('message_translate_toggle_visible', {
          messageId: message.id,
          visible: true,
        });
        return next;
      });
      return;
    }

    const state = translationsByMessageId[message.id];
    if (state?.status === 'ready') {
      toggleTranslationVisibility(message.id);
      return;
    }

    setTranslationsByMessageId((current) => ({
      ...current,
      [message.id]: {
        status: 'loading',
      },
    }));
    setVisibleTranslationMessageIds((current) => {
      const next = new Set(current);
      next.add(message.id);
      log('message_translate_toggle_visible', {
        messageId: message.id,
        visible: true,
      });
      return next;
    });
    log('message_translate_request_start', {
      messageId: message.id,
      role,
    });

    try {
      const result = await translateSpeakingMessage(appSession.session, {
        text: message.text,
        role,
        ...getTranslationContext(message),
      });
      setTranslationsByMessageId((current) => ({
        ...current,
        [message.id]: {
          status: 'ready',
          text: result.translation,
        },
      }));
      log('message_translate_request_done', {
        messageId: message.id,
        role,
      });
    } catch (error) {
      setTranslationsByMessageId((current) => ({
        ...current,
        [message.id]: {
          status: 'error',
          error: error instanceof Error ? error.message : '翻译失败，点按重试',
        },
      }));
      log('message_translate_request_failed', {
        messageId: message.id,
        role,
        message: error instanceof Error ? error.message : 'message_translate_request_failed',
      });
    }
  };

  const openAssessmentSheet = (
    messageId: string,
    roundId: number,
    focus: 'grammar' | 'pronunciation' | 'native',
  ) => {
    console.log(`[V1_PCM_DUAL] compact_bar_press = ${JSON.stringify({ roundId, target: focus === 'native' ? 'native' : focus })}`);
    console.log(`[V1_PCM_DUAL] assessment_sheet_opened = ${JSON.stringify({ roundId, focus })}`);
    setDetailSheetState({ messageId, focus });
  };

  const renderTranslationBubble = (message: PcmDualConversationMessage) => {
    if (!visibleTranslationMessageIds.has(message.id)) return null;
    const translationState = translationsByMessageId[message.id] ?? { status: 'idle' as const };
    const translationText =
      translationState.status === 'loading'
        ? '翻译中…'
        : translationState.status === 'error'
          ? '翻译失败，点按重试'
          : translationState.text?.trim() || '';

    if (!translationText) return null;

    return (
      <View
        style={{
          alignSelf: message.role === 'assistant' ? 'flex-start' : 'flex-end',
          maxWidth: message.role === 'assistant' ? aiBubbleMaxWidth : userBubbleMaxWidth,
          marginTop: 5,
          marginRight: message.role === 'user' ? 2 : undefined,
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 11,
          backgroundColor: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.045)' : theme.secondaryCardBackground,
          borderWidth: theme.colorScheme === 'dark' ? 0 : 1,
          borderColor: theme.border,
        }}
      >
        <AppText
          style={{
            fontSize: 12,
            lineHeight: 17,
            color: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.56)' : theme.textSecondary,
          }}
        >
          {translationText}
        </AppText>
      </View>
    );
  };

  if (!isLoggedIn) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.pageBackground }}>
        <StatusBar barStyle={theme.colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
        <View style={{ flex: 1, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 28, justifyContent: 'space-between' }}>
          <View style={{ gap: 18 }}>
            <ChromeIconButton icon="chevron-back" onPress={handleBack} accessibilityLabel="返回" />
            <View style={{ gap: 10 }}>
              <AppText style={{ fontSize: 30, fontWeight: '800', color: theme.textPrimary }}>口语 V1</AppText>
              <AppText style={{ fontSize: 15, lineHeight: 24, color: theme.textSecondary }}>
                当前页面已切到 App 自采集 PCM 双路分发版本。登录后即可开始正式对话练习。
              </AppText>
            </View>
          </View>
          <Pressable
            onPress={() => router.push('/auth/sign-in')}
            style={{
              borderRadius: 20,
              backgroundColor: theme.primaryBlue,
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 16,
            }}
          >
            <AppText style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>去登录继续练习</AppText>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (isTablet) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.pageBackground }}>
        <StatusBar barStyle={theme.colorScheme === 'dark' ? 'light-content' : 'dark-content'} />

        <View
          style={{
            minHeight: 74,
            paddingHorizontal: 24,
            paddingTop: 6,
            paddingBottom: 8,
            borderBottomWidth: 1,
            borderBottomColor: theme.separator,
            backgroundColor: theme.pageBackground,
          }}
        >
          <View
            style={{
              minHeight: 58,
              justifyContent: 'center',
              width: '100%',
              maxWidth: tabletContentWidth,
              alignSelf: 'center',
            }}
          >
            <View style={{ position: 'absolute', left: 0, top: '50%', marginTop: -22 }}>
              <ChromeIconButton icon="chevron-back" onPress={handleBack} accessibilityLabel="返回" />
            </View>

            <View style={{ alignItems: 'center', gap: 6, paddingLeft: 56, paddingRight: 142 }}>
              <AppText
                style={{ fontSize: 17, lineHeight: 21, fontWeight: '700', color: theme.textPrimary }}
                numberOfLines={1}
              >
                {scenario.name}
              </AppText>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View
                  style={{
                    height: 20,
                    borderRadius: 10,
                    paddingHorizontal: 9,
                    backgroundColor: 'rgba(48,209,88,0.18)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <AppText style={{ fontSize: 12, lineHeight: 15, fontWeight: '700', color: '#30D158' }}>
                    {scenario.level}
                  </AppText>
                </View>
                <View
                  style={{
                    height: 20,
                    borderRadius: 10,
                    paddingHorizontal: 9,
                    backgroundColor: theme.secondaryCardBackground,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <AppText style={{ fontSize: 12, lineHeight: 15, fontWeight: '600', color: theme.textSecondary }}>
                    {runtime.sessionId ? '练习中' : '待开始'}
                  </AppText>
                </View>
              </View>
            </View>

            <View
              style={{
                position: 'absolute',
                right: 0,
                top: '50%',
                marginTop: -19,
                minWidth: 72,
                height: 38,
                borderRadius: 19,
                paddingHorizontal: 13,
                backgroundColor: theme.secondaryCardBackground,
                borderWidth: 1,
                borderColor: theme.border,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
              }}
            >
              <Ionicons name="sparkles-outline" size={15} color="#FFD60A" />
              <AppText style={{ fontSize: 17, fontWeight: '700', color: theme.textPrimary }}>{creditsText}</AppText>
            </View>
          </View>
        </View>

        <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 16 }}>
          <View
            style={{
              flex: 1,
              width: '100%',
              maxWidth: tabletContentWidth,
              alignSelf: 'center',
              flexDirection: 'row',
              gap: 16,
            }}
          >
            <View
              style={{
                width: tabletLeftWidth,
                minWidth: tabletLeftMinWidth,
                flexShrink: 1,
                backgroundColor: theme.cardBackground,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 26,
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <ScrollView
                ref={conversationRef}
                style={{ flex: 1 }}
                contentContainerStyle={{
                  paddingHorizontal: 22,
                  paddingTop: 18,
                  paddingBottom: scrollBottomPadding,
                }}
                showsVerticalScrollIndicator={false}
              >
                <View style={{ width: '100%' }}>
                  {showInitialAssistantLoading ? (
                    <AssistantTypingBubble variant="dots" />
                  ) : displayedMessages.length === 0 ? (
                    <View style={{ alignItems: 'center', paddingTop: 32, paddingHorizontal: 28 }}>
                      <AppText style={{ fontSize: 15, lineHeight: 22, color: theme.textSecondary, textAlign: 'center' }}>
                        点击底部长条开始第一句点单练习。
                      </AppText>
                    </View>
                  ) : null}

                  {displayedMessages.map((message) => (
                    <View key={message.id} style={{ width: '100%' }}>
                      {message.role === 'user' ? (() => {
                        const analysis = analysisMap.get(message.id) ?? null;
                        const suggestedExpression = getDisplayableBetterExpressionForMessage(message, analysis);
                        const suggestionPlaying =
                          runtime.playbackMessageId === message.id &&
                          runtime.playbackText?.trim() === suggestedExpression?.trim();
                        const selectedForTablet = detailSheetState?.messageId === message.id;
                        return (
                          <>
                            <MessageCard
                              message={message}
                              onReplay={() => {
                                handleUserAudioButtonPress(message);
                              }}
                              replayDisabled={!message.turnAssessment?.userAudio?.uri}
                              bubbleMaxWidth={userBubbleMaxWidth}
                              bubbleMinWidth={userBubbleMinWidth}
                              suggestedExpression={suggestedExpression}
                              suggestedAudioPlaying={suggestionPlaying}
                              onSuggestedAudioPress={() => {
                                if (shouldIgnoreDebouncedPress(`better-expression:${message.id}`, 600)) {
                                  return;
                                }
                                log('better_expression_audio_press', {
                                  roundId: message.roundId,
                                  textPreview: suggestedExpression?.slice(0, 120) ?? null,
                                });
                                void runtime.playBetterExpression(message.id);
                              }}
                            />

                            <View
                              style={{
                                alignSelf: 'flex-end',
                                marginTop: 6,
                                marginRight: 2,
                                marginBottom: 4,
                              }}
                            >
                              <ActionPill
                                label="中译英"
                                icon="language-outline"
                                onPress={() => {
                                  if (shouldIgnoreDebouncedPress(`translate:user:${message.id}`, 500)) {
                                    return;
                                  }
                                  log('user_translate_press', {
                                    roundId: message.roundId,
                                    messageId: message.id,
                                  });
                                  void requestMessageTranslation(message, 'user');
                                }}
                                height={24}
                                paddingHorizontal={9}
                                textSize={11}
                                iconSize={13}
                              />
                            </View>

                            {renderTranslationBubble(message)}

                            {message.transcriptStatus === 'ready' && message.text.trim() && analysis ? (
                              <>
                                <View
                                  style={{
                                    alignSelf: 'flex-end',
                                    marginTop: 5,
                                    marginBottom: 4,
                                    marginRight: 2,
                                    borderRadius: 22,
                                    padding: selectedForTablet ? 4 : 0,
                                    backgroundColor: selectedForTablet
                                      ? theme.colorScheme === 'dark'
                                        ? 'rgba(10,132,255,0.16)'
                                        : 'rgba(0,122,255,0.08)'
                                      : 'transparent',
                                    borderWidth: selectedForTablet ? 1 : 0,
                                    borderColor: selectedForTablet ? theme.primaryBlue : 'transparent',
                                  }}
                                >
                                  <XfyunRoundCards
                                    assessment={analysis}
                                    width={compactBarWidth}
                                    tablet
                                    onPressGrammar={() => openAssessmentSheet(message.id, message.roundId, 'grammar')}
                                    onPressPronunciation={() => openAssessmentSheet(message.id, message.roundId, 'pronunciation')}
                                    onPressNative={() => openAssessmentSheet(message.id, message.roundId, 'native')}
                                  />
                                </View>
                                <InlineExplanation analysis={analysis} width={inlineExplanationWidth} />
                              </>
                            ) : null}
                          </>
                        );
                      })() : (
                        <>
                          {(!message.text.trim() && message.replyStatus === 'pending') ||
                          (initialAssistantBooting && message.roundId === 0 && !(message.audioFileUri ?? message.audioUrl)) ? (
                            <AssistantTypingBubble variant="dots" />
                          ) : (
                            <>
                              <MessageCard
                                message={message}
                                onReplay={() => {
                                  handleAssistantAudioButtonPress(message);
                                }}
                                replayDisabled={!(message.audioFileUri ?? message.audioUrl)}
                                bubbleMaxWidth={aiBubbleMaxWidth}
                                masked={maskedAssistantMessageIds.has(message.id)}
                                onToggleMask={() => toggleAssistantMask(message.id)}
                              />

                              <View
                                style={{
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  gap: 8,
                                  marginTop: 6,
                                }}
                              >
                                <ActionPill
                                  label="中译英"
                                  icon="language-outline"
                                  onPress={() => {
                                    if (shouldIgnoreDebouncedPress(`translate:assistant:${message.id}`, 500)) {
                                      return;
                                    }
                                    log('assistant_translate_press', { messageId: message.id });
                                    void requestMessageTranslation(message, 'assistant');
                                  }}
                                  height={24}
                                  paddingHorizontal={8}
                                  textSize={11}
                                  iconSize={13}
                                />
                                <ActionPill
                                  label={maskedAssistantMessageIds.has(message.id) ? '显示' : '隐藏'}
                                  icon={maskedAssistantMessageIds.has(message.id) ? 'eye-off-outline' : 'eye-outline'}
                                  onPress={() => toggleAssistantMask(message.id)}
                                  height={24}
                                  paddingHorizontal={8}
                                  textSize={11}
                                  iconSize={13}
                                />
                              </View>
                              {renderTranslationBubble(message)}
                            </>
                          )}
                        </>
                      )}
                    </View>
                  ))}
                </View>
              </ScrollView>

              <View
                style={{
                  position: 'absolute',
                  left: 18,
                  right: 18,
                  bottom: 14,
                }}
              >
                <View style={{ maxWidth: 560, width: '100%', alignSelf: 'center' }}>
                  <View
                    style={{
                      width: '100%',
                      height: bottomBarContentHeight,
                      borderRadius: bottomBarContentHeight / 2,
                      backgroundColor: theme.colorScheme === 'dark' ? '#1C1C1E' : theme.cardBackground,
                      borderWidth: 1,
                      borderColor: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.14)' : theme.border,
                      justifyContent: 'center',
                      position: 'relative',
                      shadowColor: theme.shadowColor,
                      shadowOpacity: theme.colorScheme === 'dark' ? 0 : 0.08,
                      shadowRadius: 12,
                      shadowOffset: { width: 0, height: 4 },
                      elevation: theme.colorScheme === 'dark' ? 0 : 3,
                    }}
                  >
                    {textInputMode ? (
                      <TextInput
                        value={draftText}
                        onChangeText={setDraftText}
                        onSubmitEditing={handleSendText}
                        returnKeyType="send"
                        blurOnSubmit={false}
                        placeholder="输入文字…"
                        placeholderTextColor={theme.textTertiary}
                        style={{
                          flex: 1,
                          paddingLeft: 18,
                          paddingRight: draftText.trim() ? 88 : 52,
                          color: theme.textPrimary,
                          fontSize: 17,
                          fontWeight: '600',
                        }}
                      />
                    ) : (
                      <Pressable
                        onPress={handleMicPress}
                        disabled={micDisabled}
                        style={({ pressed }) => ({
                          flex: 1,
                          justifyContent: 'center',
                          paddingLeft: 18,
                          paddingRight: 52,
                          opacity: micDisabled ? 0.45 : pressed ? 0.72 : 1,
                        })}
                      >
                        <AppText
                          numberOfLines={1}
                          style={{
                            fontSize: 17,
                            fontWeight: '600',
                            color: bottomStatusColor,
                            textAlign: 'center',
                          }}
                        >
                          {bottomStatusText}
                        </AppText>
                      </Pressable>
                    )}

                    {textInputMode && draftText.trim() ? (
                      <Pressable
                        hitSlop={8}
                        onPress={handleSendText}
                        style={{
                          position: 'absolute',
                          right: 50,
                          top: 0,
                          bottom: 0,
                          justifyContent: 'center',
                        }}
                      >
                        <Ionicons name="arrow-up-circle" size={26} color={theme.primaryBlue} />
                      </Pressable>
                    ) : null}

                    <Pressable
                      hitSlop={12}
                      onPress={() => setTextInputMode((value) => !value)}
                      style={{
                        position: 'absolute',
                        right: 18,
                        top: 0,
                        bottom: 0,
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons
                        name={textInputMode ? 'mic-outline' : 'keypad-outline'}
                        size={22}
                        color={theme.textSecondary}
                      />
                    </Pressable>
                  </View>
                </View>
              </View>
            </View>

            <View
              style={{
                width: tabletRightWidth,
                minWidth: 390,
                maxWidth: 456,
                backgroundColor: theme.cardBackground,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 26,
                overflow: 'hidden',
                padding: 18,
              }}
            >
              <AppText style={{ fontSize: 22, lineHeight: 28, fontWeight: '800', color: theme.textPrimary }}>
                逐句评分
              </AppText>
              <AppText style={{ marginTop: 6, fontSize: 13, lineHeight: 18, color: theme.textSecondary }}>
                {selectedAnalysis
                  ? '查看当前句的发音、地道表达与优化建议'
                  : '完成一句练习后，点击评分胶囊查看详细反馈'}
              </AppText>

              {selectedAnalysis ? (
                <XfyunPronunciationDetailContent
                  analysis={selectedAnalysis}
                  visible
                  initialFocus={detailSheetState?.focus ?? 'pronunciation'}
                  messageText={selectedUserMessage?.text ?? null}
                  originalText={selectedUserMessage?.text ?? null}
                  hasUserAudio={Boolean((selectedUserMessage?.turnAssessment?.userAudio ?? selectedUserMessage?.userAudio)?.uri)}
                  recordingDurationMs={
                    selectedUserMessage?.turnAssessment?.userAudio?.durationMs ??
                    selectedUserMessage?.userAudio?.durationMs ??
                    null
                  }
                  onPlayUserAudio={() => {
                    if (!selectedUserMessage) return;
                    void runtime.replayUserAudio(selectedUserMessage.id);
                  }}
                  onPlayUkText={(text) => {
                    if (!selectedUserMessage) return;
                    void runtime.playReferenceText({
                      messageId: selectedUserMessage.id,
                      roundId: selectedUserMessage.roundId,
                      text,
                      accent: 'uk',
                    });
                  }}
                  onPlayUsText={(text) => {
                    if (!selectedUserMessage) return;
                    void runtime.playReferenceText({
                      messageId: selectedUserMessage.id,
                      roundId: selectedUserMessage.roundId,
                      text,
                      accent: 'us',
                    });
                  }}
                  onPlayStressText={(text) => {
                    if (!selectedUserMessage) return;
                    void runtime.playReferenceText({
                      messageId: selectedUserMessage.id,
                      roundId: selectedUserMessage.roundId,
                      text,
                      accent: 'us',
                    });
                  }}
                  onLoopExpression={(text) => {
                    if (!selectedUserMessage) return;
                    void runtime.loopPracticeText({
                      messageId: selectedUserMessage.id,
                      roundId: selectedUserMessage.roundId,
                      text,
                      times: 3,
                      gapMs: 600,
                    });
                  }}
                  onPlayExpressionText={(text) => {
                    if (!selectedUserMessage) return;
                    void runtime.playReferenceText({
                      messageId: selectedUserMessage.id,
                      roundId: selectedUserMessage.roundId,
                      text,
                      accent: 'us',
                      purpose: 'expression_ai_read',
                    });
                  }}
                  style={{ flex: 1, marginTop: 16 }}
                />
              ) : (
                <View
                  style={{
                    marginTop: 16,
                    borderRadius: 22,
                    backgroundColor: theme.secondaryCardBackground,
                    borderWidth: 1,
                    borderColor: theme.border,
                    padding: 20,
                    gap: 14,
                  }}
                >
                  <View
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 18,
                      backgroundColor: theme.colorScheme === 'dark' ? 'rgba(10,132,255,0.16)' : 'rgba(0,122,255,0.10)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="sparkles-outline" size={24} color={theme.primaryBlue} />
                  </View>
                  <View style={{ gap: 6 }}>
                    <AppText style={{ fontSize: 18, lineHeight: 24, fontWeight: '800', color: theme.textPrimary }}>
                      等待你的第一句练习
                    </AppText>
                    <AppText style={{ fontSize: 14, lineHeight: 22, color: theme.textSecondary }}>
                      说完一句后，系统会生成逐句评分。点击左侧评分胶囊，可在这里查看发音、流利度和优化表达。
                    </AppText>
                  </View>
                  <View style={{ gap: 10 }}>
                    {['发音评分', '地道表达', '优化建议'].map((item) => (
                      <View
                        key={item}
                        style={{
                          borderRadius: 18,
                          backgroundColor: theme.cardBackground,
                          borderWidth: 1,
                          borderColor: theme.border,
                          paddingHorizontal: 14,
                          paddingVertical: 14,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 10,
                        }}
                      >
                        <View
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 14,
                            backgroundColor: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(60,60,67,0.08)',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Ionicons name="checkmark" size={16} color={theme.textSecondary} />
                        </View>
                        <AppText style={{ fontSize: 14, lineHeight: 20, fontWeight: '700', color: theme.textPrimary }}>
                          {item}
                        </AppText>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.pageBackground }}>
      <StatusBar barStyle={theme.colorScheme === 'dark' ? 'light-content' : 'dark-content'} />

      <View
        style={{
          minHeight: 74,
          paddingHorizontal: pageHorizontalPadding,
          paddingTop: 6,
          paddingBottom: 8,
          borderBottomWidth: 1,
          borderBottomColor: theme.separator,
          backgroundColor: theme.pageBackground,
        }}
      >
        <View
          style={{
            minHeight: 58,
            justifyContent: 'center',
            width: '100%',
            maxWidth: contentWidth,
            alignSelf: 'center',
          }}
        >
          <View style={{ position: 'absolute', left: 0, top: '50%', marginTop: -22 }}>
            <ChromeIconButton icon="chevron-back" onPress={handleBack} accessibilityLabel="返回" />
          </View>

          <View style={{ alignItems: 'center', gap: 6, paddingLeft: 56, paddingRight: 142 }}>
            <AppText
              style={{ fontSize: 17, lineHeight: 21, fontWeight: '700', color: theme.textPrimary }}
              numberOfLines={1}
            >
              {scenario.name}
            </AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View
                style={{
                  height: 20,
                  borderRadius: 10,
                  paddingHorizontal: 9,
                  backgroundColor: 'rgba(48,209,88,0.18)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AppText style={{ fontSize: 12, lineHeight: 15, fontWeight: '700', color: '#30D158' }}>
                  {scenario.level}
                </AppText>
              </View>
              <View
                style={{
                  height: 20,
                  borderRadius: 10,
                  paddingHorizontal: 9,
                  backgroundColor: theme.secondaryCardBackground,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AppText style={{ fontSize: 12, lineHeight: 15, fontWeight: '600', color: theme.textSecondary }}>
                  {runtime.sessionId ? '练习中' : '待开始'}
                </AppText>
              </View>
            </View>
          </View>

          <View
            style={{
              position: 'absolute',
              right: 0,
              top: '50%',
              marginTop: -19,
              minWidth: 72,
              height: 38,
              borderRadius: 19,
              paddingHorizontal: 13,
              backgroundColor: theme.secondaryCardBackground,
              borderWidth: 1,
              borderColor: theme.border,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
            }}
          >
            <Ionicons name="sparkles-outline" size={15} color="#FFD60A" />
            <AppText style={{ fontSize: 17, fontWeight: '700', color: theme.textPrimary }}>{creditsText}</AppText>
          </View>
        </View>
      </View>

      <ScrollView
        ref={conversationRef}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: 16,
          paddingHorizontal: pageHorizontalPadding,
          paddingBottom: scrollBottomPadding,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            width: '100%',
            maxWidth: messageListMaxWidth ?? undefined,
            alignSelf: 'center',
          }}
        >
          {showInitialAssistantLoading ? (
            <AssistantTypingBubble variant="dots" />
          ) : displayedMessages.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 32, paddingHorizontal: 28 }}>
              <AppText style={{ fontSize: 15, lineHeight: 22, color: theme.textSecondary, textAlign: 'center' }}>
                点击底部长条开始第一句点单练习。
              </AppText>
            </View>
          ) : null}

          {displayedMessages.map((message) => (
            <View key={message.id} style={{ width: '100%' }}>
              {message.role === 'user' ? (() => {
                const analysis = analysisMap.get(message.id) ?? null;
                const suggestedExpression = getDisplayableBetterExpressionForMessage(message, analysis);
                const suggestionPlaying =
                  runtime.playbackMessageId === message.id &&
                  runtime.playbackText?.trim() === suggestedExpression?.trim();
                return (
                  <>
                    <MessageCard
                      message={message}
                      onReplay={() => {
                        handleUserAudioButtonPress(message);
                      }}
                      replayDisabled={!message.turnAssessment?.userAudio?.uri}
                      bubbleMaxWidth={userBubbleMaxWidth}
                      bubbleMinWidth={userBubbleMinWidth}
                      suggestedExpression={suggestedExpression}
                      suggestedAudioPlaying={suggestionPlaying}
                      onSuggestedAudioPress={() => {
                        if (shouldIgnoreDebouncedPress(`better-expression:${message.id}`, 600)) {
                          return;
                        }
                        log('better_expression_audio_press', {
                          roundId: message.roundId,
                          textPreview: suggestedExpression?.slice(0, 120) ?? null,
                        });
                        void runtime.playBetterExpression(message.id);
                      }}
                    />

                    <View
                      style={{
                        alignSelf: 'flex-end',
                        marginTop: 6,
                        marginRight: 2,
                        marginBottom: 4,
                      }}
                    >
                      <ActionPill
                        label="中译英"
                        icon="language-outline"
                        onPress={() => {
                          if (shouldIgnoreDebouncedPress(`translate:user:${message.id}`, 500)) {
                            return;
                          }
                          log('user_translate_press', {
                            roundId: message.roundId,
                            messageId: message.id,
                          });
                          void requestMessageTranslation(message, 'user');
                        }}
                        height={24}
                        paddingHorizontal={9}
                        textSize={11}
                        iconSize={13}
                      />
                    </View>

                    {renderTranslationBubble(message)}

                    {message.transcriptStatus === 'ready' && message.text.trim() && analysis ? (
                      <>
                        <View
                          style={{
                            alignSelf: 'flex-end',
                            width: compactBarWidth,
                            marginTop: 5,
                            marginBottom: 4,
                            marginRight: 2,
                          }}
                        >
                          <XfyunRoundCards
                            assessment={analysis}
                            width={compactBarWidth}
                            tablet={isTablet}
                            onPressGrammar={() => openAssessmentSheet(message.id, message.roundId, 'grammar')}
                            onPressPronunciation={() => openAssessmentSheet(message.id, message.roundId, 'pronunciation')}
                            onPressNative={() => openAssessmentSheet(message.id, message.roundId, 'native')}
                          />
                        </View>
                        <InlineExplanation analysis={analysis} width={inlineExplanationWidth} />
                      </>
                    ) : null}
                  </>
                );
              })() : (
                <>
                  {(!message.text.trim() && message.replyStatus === 'pending') ||
                  (initialAssistantBooting && message.roundId === 0 && !(message.audioFileUri ?? message.audioUrl)) ? (
                    <AssistantTypingBubble variant="dots" />
                  ) : (
                    <>
                      <MessageCard
                        message={message}
                        onReplay={() => {
                          handleAssistantAudioButtonPress(message);
                        }}
                        replayDisabled={!(message.audioFileUri ?? message.audioUrl)}
                        bubbleMaxWidth={aiBubbleMaxWidth}
                        masked={maskedAssistantMessageIds.has(message.id)}
                        onToggleMask={() => toggleAssistantMask(message.id)}
                      />

                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 8,
                          marginTop: 6,
                        }}
                      >
                        <ActionPill
                          label="中译英"
                          icon="language-outline"
                          onPress={() => {
                            if (shouldIgnoreDebouncedPress(`translate:assistant:${message.id}`, 500)) {
                              return;
                            }
                            log('assistant_translate_press', { messageId: message.id });
                            void requestMessageTranslation(message, 'assistant');
                          }}
                          height={24}
                          paddingHorizontal={8}
                          textSize={11}
                          iconSize={13}
                        />
                        <ActionPill
                          label={maskedAssistantMessageIds.has(message.id) ? '显示' : '隐藏'}
                          icon={maskedAssistantMessageIds.has(message.id) ? 'eye-off-outline' : 'eye-outline'}
                          onPress={() => toggleAssistantMask(message.id)}
                          height={24}
                          paddingHorizontal={8}
                          textSize={11}
                          iconSize={13}
                        />
                      </View>
                      {renderTranslationBubble(message)}
                    </>
                  )}
                </>
              )}
            </View>
          ))}
        </View>
      </ScrollView>

      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: theme.pageBackground,
          borderTopWidth: 1,
          borderTopColor: theme.separator,
          paddingTop: 12,
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 12,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 4,
            width: '100%',
            maxWidth: isTablet ? bottomBarMaxWidth : undefined,
            alignSelf: 'center',
          }}
        >
          <View
            style={{
              width: isTablet ? '100%' : bottomBarMaxWidth,
              height: bottomBarContentHeight,
              borderRadius: bottomBarContentHeight / 2,
              backgroundColor: theme.colorScheme === 'dark' ? '#1C1C1E' : theme.cardBackground,
              borderWidth: 1,
              borderColor: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.14)' : theme.border,
              justifyContent: 'center',
              position: 'relative',
            }}
          >
            {textInputMode ? (
              <TextInput
                value={draftText}
                onChangeText={setDraftText}
                onSubmitEditing={handleSendText}
                returnKeyType="send"
                blurOnSubmit={false}
                placeholder="输入文字…"
                placeholderTextColor={theme.textTertiary}
                style={{
                  flex: 1,
                  paddingLeft: 18,
                  paddingRight: draftText.trim() ? 88 : 52,
                  color: theme.textPrimary,
                  fontSize: 17,
                  fontWeight: '600',
                }}
              />
            ) : (
              <Pressable
                onPress={handleMicPress}
                disabled={micDisabled}
                style={({ pressed }) => ({
                  flex: 1,
                  justifyContent: 'center',
                  paddingLeft: 18,
                  paddingRight: 52,
                  opacity: micDisabled ? 0.45 : pressed ? 0.72 : 1,
                })}
              >
                <AppText
                  numberOfLines={1}
                  style={{
                    fontSize: 17,
                    fontWeight: '600',
                    color: bottomStatusColor,
                    textAlign: 'center',
                  }}
                >
                  {bottomStatusText}
                </AppText>
              </Pressable>
            )}

            {textInputMode && draftText.trim() ? (
              <Pressable
                hitSlop={8}
                onPress={handleSendText}
                style={{
                  position: 'absolute',
                  right: 50,
                  top: 0,
                  bottom: 0,
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="arrow-up-circle" size={26} color={theme.primaryBlue} />
              </Pressable>
            ) : null}

            <Pressable
              hitSlop={12}
              onPress={() => setTextInputMode((value) => !value)}
              style={{
                position: 'absolute',
                right: 18,
                top: 0,
                bottom: 0,
                justifyContent: 'center',
              }}
            >
              <Ionicons name={textInputMode ? 'mic-outline' : 'keypad-outline'} size={22} color={theme.textSecondary} />
            </Pressable>
          </View>
        </View>
      </View>

      <XfyunPronunciationPanel
        analysis={selectedAnalysis}
        visible={detailSheetState !== null}
        initialFocus={detailSheetState?.focus ?? 'pronunciation'}
        onClose={() => setDetailSheetState(null)}
        hasUserAudio={Boolean((selectedUserMessage?.turnAssessment?.userAudio ?? selectedUserMessage?.userAudio)?.uri)}
        recordingDurationMs={
          selectedUserMessage?.turnAssessment?.userAudio?.durationMs ??
          selectedUserMessage?.userAudio?.durationMs ??
          null
        }
        onPlayUserAudio={() => {
          if (!selectedUserMessage) return;
          void runtime.replayUserAudio(selectedUserMessage.id);
        }}
        onPlayUkText={(text) => {
          if (!selectedUserMessage) return;
          void runtime.playReferenceText({
            messageId: selectedUserMessage.id,
            roundId: selectedUserMessage.roundId,
            text,
            accent: 'uk',
          });
        }}
        onPlayUsText={(text) => {
          if (!selectedUserMessage) return;
          void runtime.playReferenceText({
            messageId: selectedUserMessage.id,
            roundId: selectedUserMessage.roundId,
            text,
            accent: 'us',
          });
        }}
        onPlayStressText={(text) => {
          if (!selectedUserMessage) return;
          void runtime.playReferenceText({
            messageId: selectedUserMessage.id,
            roundId: selectedUserMessage.roundId,
            text,
            accent: 'us',
          });
        }}
        onLoopExpression={(text) => {
          if (!selectedUserMessage) return;
          void runtime.loopPracticeText({
            messageId: selectedUserMessage.id,
            roundId: selectedUserMessage.roundId,
            text,
            times: 3,
            gapMs: 600,
          });
        }}
        onPlayExpressionText={(text) => {
          if (!selectedUserMessage) return;
          void runtime.playReferenceText({
            messageId: selectedUserMessage.id,
            roundId: selectedUserMessage.roundId,
            text,
            accent: 'us',
            purpose: 'expression_ai_read',
          });
        }}
      />
    </SafeAreaView>
  );
}
