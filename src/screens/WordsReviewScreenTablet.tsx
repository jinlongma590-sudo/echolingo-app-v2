import { Ionicons } from '@expo/vector-icons';
import type { VideoPlayer } from 'expo-video';
import { VideoView } from 'expo-video';
import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';

import { AppText } from '@/components/AppText';
import { AppScreenShell } from '@/components/layout/AppScreenShell';
import { ActionButton, StatusPill, SurfaceCard } from '@/components/ui/ApplePrimitives';
import type { ReviewDeckWord, ReviewMode, ReviewResult } from '@/services/api/vocabulary';
import { WordsReviewAnalysisContent } from '@/screens/words-review/WordsReviewAnalysisContent';
import { COLOR_GREEN, FONT_BODY, FONT_CALLOUT, FONT_CAPTION, FONT_MICRO } from '@/theme/tokens';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { DisplayAnalysis, QueueStatus, ReviewCounts, ReviewEntrySource } from '@/screens/words-review/types';

type WordsReviewScreenTabletProps = {
  isLoggedIn: boolean;
  queueStatus: QueueStatus;
  queueLoadingTitle: string;
  queueError: string | null;
  mode: ReviewMode;
  reviewSource: ReviewEntrySource;
  activeWord: ReviewDeckWord | null;
  activeWordPhonetic: string;
  hasPhonetic: boolean;
  currentStep: number;
  totalCount: number;
  progressPercent: number;
  displayAnalysis: DisplayAnalysis | null;
  analysisLoading: boolean;
  analysisError: string | null;
  sessionStats: ReviewCounts;
  reviewedCount: number;
  extraDueReviewAvailable: number;
  submitError: string | null;
  pronunciationPlayer: VideoPlayer;
  isReviewSubmitting: boolean;
  onBack: () => void;
  onGoSignIn: () => void;
  onRetryQueue: () => void;
  onBackToPlan: () => void;
  onBackToWords: () => void;
  onPronounce: () => void;
  onRetryAnalysis: () => void;
  onModeChange: (mode: ReviewMode) => void;
  onReview: (result: ReviewResult) => void;
};

function buildModeTitle(mode: ReviewMode, source: ReviewEntrySource) {
  if (mode === 'learn') return source === 'plan' ? '今日新词' : source === 'extra' ? '额外新词' : '本轮学习';
  if (mode === 'mistake') return '错词强化';
  if (source === 'extra') return '额外加练';
  if (source === 'plan') return '今日计划内复习';
  return '本轮复习';
}

function buildCompletionCopy(
  mode: ReviewMode,
  source: ReviewEntrySource,
  reviewedCount: number,
  extraDueReviewAvailable: number,
) {
  const isCompleted = reviewedCount > 0;
  const title = isCompleted
    ? mode === 'learn' && source === 'plan'
      ? '今日新词计划完成'
      : mode === 'learn' && source === 'extra'
        ? '本轮额外新词完成'
        : mode === 'review' && source === 'extra'
          ? '加练完成'
          : mode === 'review' && source === 'plan'
            ? '今日复习计划完成'
            : mode === 'mistake'
              ? '错词强化完成'
              : '本轮完成'
    : mode === 'learn' && source === 'plan'
      ? '今日新词计划已完成'
      : mode === 'review' && source === 'plan'
        ? '今日复习计划已完成'
        : mode === 'review' && source === 'extra'
          ? '当前没有可加练的到期词'
          : mode === 'mistake'
            ? '当前没有待强化错词'
            : '暂无待复习';
  const subtitle = isCompleted
    ? mode === 'mistake'
      ? '本轮错词强化已经完成。'
      : mode === 'learn' && source === 'plan'
        ? '今天计划内的新词已经学完。'
        : mode === 'learn' && source === 'extra'
          ? '这一轮额外新词已经学完。'
          : mode === 'review' && source === 'extra'
            ? '额外加练的到期词已经处理完。'
            : mode === 'review' && source === 'plan'
              ? extraDueReviewAvailable > 0
                ? `计划内复习已经完成，还有 ${extraDueReviewAvailable} 个到期词可继续加练。`
                : '计划内到期复习已经完成。'
              : mode === 'review'
                ? '本轮到期复习已经收束好。'
                : '今天这轮学习已经收束好。'
    : mode === 'learn' && source === 'plan'
      ? '今天没有剩余的计划内新词。'
      : mode === 'review' && source === 'plan'
        ? extraDueReviewAvailable > 0
          ? `计划内复习已经完成，还有 ${extraDueReviewAvailable} 个到期词可继续加练。`
          : '今天没有剩余的计划内到期复习。'
        : mode === 'review' && source === 'extra'
          ? '当前没有额外可加练的到期词。'
          : mode === 'mistake'
            ? '当前没有待强化的错词。'
            : '今天暂无复习词。';
  const body = isCompleted
    ? mode === 'learn' && source === 'plan'
      ? `今天计划内共完成 ${reviewedCount} 个新词。`
      : mode === 'learn' && source === 'extra'
        ? `这轮额外共完成 ${reviewedCount} 个新词。`
        : mode === 'review' && source === 'extra'
          ? `这轮加练共完成 ${reviewedCount} 个到期词。`
          : mode === 'review' && source === 'plan'
            ? `今天计划内共完成 ${reviewedCount} 个到期复习。`
            : mode === 'mistake'
              ? `这轮共完成 ${reviewedCount} 个错词强化。`
              : `本轮共完成 ${reviewedCount} 个词，继续保持节奏。`
    : mode === 'review' && source === 'extra'
      ? '当前没有额外可加练的到期词。'
      : mode === 'review' && source === 'plan'
        ? '今天的复习计划已经完成。'
        : mode === 'learn' && source === 'plan'
          ? '今天的计划内新词已经完成。'
          : mode === 'mistake'
            ? '今天没有待强化的错词。'
            : '今天暂无复习词。';

  return { title, subtitle, body };
}

function ReviewAnswerButton({
  label,
  tone,
  onPress,
  disabled,
}: {
  label: string;
  tone: 'unknown' | 'unsure' | 'known';
  onPress: () => void;
  disabled?: boolean;
}) {
  const { theme } = useAppTheme();
  const palette = {
    unknown: {
      bg: theme.colorScheme === 'dark' ? 'rgba(255,69,58,0.14)' : 'rgba(255,243,240,0.94)',
      fg: theme.colorScheme === 'dark' ? theme.destructive : theme.textPrimary,
      border: theme.colorScheme === 'dark' ? 'rgba(255,69,58,0.28)' : 'rgba(255,59,48,0.14)',
    },
    unsure: {
      bg: theme.colorScheme === 'dark' ? 'rgba(235,235,245,0.10)' : 'rgba(255,255,255,0.82)',
      fg: theme.textPrimary,
      border: theme.colorScheme === 'dark' ? 'rgba(235,235,245,0.16)' : 'rgba(28,28,30,0.08)',
    },
    known: {
      bg: theme.colorScheme === 'dark' ? 'rgba(48,209,88,0.14)' : 'rgba(255,250,242,0.96)',
      fg: theme.colorScheme === 'dark' ? COLOR_GREEN : theme.textPrimary,
      border: theme.colorScheme === 'dark' ? 'rgba(48,209,88,0.24)' : 'rgba(245,166,35,0.18)',
    },
  } as const;

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        height: 56,
        borderRadius: 18,
        backgroundColor: palette[tone].bg,
        borderWidth: 1,
        borderColor: palette[tone].border,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 12,
        opacity: disabled ? 0.45 : pressed ? 0.72 : 1,
        transform: [{ scale: pressed ? 0.988 : 1 }],
      })}
    >
      <AppText style={{ fontSize: 16, lineHeight: 20, fontWeight: '700', color: palette[tone].fg }}>
        {label}
      </AppText>
    </Pressable>
  );
}

function MetricMiniCard({ label, value }: { label: string; value: string }) {
  const { theme } = useAppTheme();

  return (
    <View
      style={{
        flex: 1,
        borderRadius: 20,
        paddingVertical: 14,
        paddingHorizontal: 14,
        gap: 6,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.secondaryCardBackground,
      }}
    >
      <AppText style={{ fontSize: 12, lineHeight: 16, fontWeight: '600', color: theme.textSecondary }}>{label}</AppText>
      <AppText style={{ fontSize: 22, lineHeight: 28, fontWeight: '800', color: theme.textPrimary }}>{value}</AppText>
    </View>
  );
}

function SectionCard({
  title,
  children,
  trailing,
}: {
  title: string;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const { theme } = useAppTheme();

  return (
    <View
      style={{
        borderRadius: 22,
        padding: 18,
        gap: 8,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.secondaryCardBackground,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <AppText style={{ fontSize: 12, lineHeight: 16, fontWeight: '700', color: theme.textSecondary }}>{title}</AppText>
        {trailing ?? null}
      </View>
      {children}
    </View>
  );
}

function ModeTabs({
  mode,
  onModeChange,
}: {
  mode: ReviewMode;
  onModeChange: (mode: ReviewMode) => void;
}) {
  const { theme } = useAppTheme();
  const items: Array<{ key: ReviewMode; label: string }> = [
    { key: 'learn', label: '新词理解' },
    { key: 'review', label: '记忆复习' },
    { key: 'mistake', label: '易错强化' },
  ];

  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 8,
        padding: 4,
        borderRadius: 18,
        backgroundColor: theme.secondaryCardBackground,
      }}
    >
      {items.map((item) => {
        const active = mode === item.key;
        return (
          <Pressable
            key={item.key}
            onPress={() => onModeChange(item.key)}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 38,
              borderRadius: 14,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 8,
              backgroundColor: active ? theme.primaryBlue : 'transparent',
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <AppText
              style={{
                fontSize: 12,
                lineHeight: 16,
                fontWeight: active ? '700' : '600',
                color: active ? '#FFFFFF' : theme.textSecondary,
              }}
            >
              {item.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function CenteredStateCard({
  badge,
  title,
  message,
  loading,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: {
  badge?: { label: string; tone: 'blue' | 'amber' | 'red' };
  title: string;
  message: string;
  loading?: boolean;
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  const { theme } = useAppTheme();

  return (
    <SurfaceCard
      style={{
        width: '100%',
        maxWidth: 860,
        borderRadius: 32,
        padding: 28,
        backgroundColor: theme.cardBackground,
        borderColor: theme.border,
      }}
    >
      <View style={{ gap: 16 }}>
        {badge ? <StatusPill label={badge.label} tone={badge.tone} /> : null}
        {loading ? <ActivityIndicator size="small" color={theme.primaryBlue} /> : null}
        <AppText style={{ fontSize: 32, lineHeight: 38, fontWeight: '800', color: theme.textPrimary }}>{title}</AppText>
        <AppText style={{ fontSize: 15, lineHeight: 22, color: theme.textSecondary }}>{message}</AppText>
        {primaryLabel && onPrimary ? (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <ActionButton label={primaryLabel} variant="dark" onPress={onPrimary} />
            {secondaryLabel && onSecondary ? <ActionButton label={secondaryLabel} variant="secondary" onPress={onSecondary} /> : null}
          </View>
        ) : null}
      </View>
    </SurfaceCard>
  );
}

export function WordsReviewScreenTablet({
  isLoggedIn,
  queueStatus,
  queueLoadingTitle,
  queueError,
  mode,
  reviewSource,
  activeWord,
  activeWordPhonetic,
  hasPhonetic,
  currentStep,
  totalCount,
  progressPercent,
  displayAnalysis,
  analysisLoading,
  analysisError,
  sessionStats,
  reviewedCount,
  extraDueReviewAvailable,
  submitError,
  pronunciationPlayer,
  isReviewSubmitting,
  onBack,
  onGoSignIn,
  onRetryQueue,
  onBackToPlan,
  onBackToWords,
  onPronounce,
  onRetryAnalysis,
  onModeChange,
  onReview,
}: WordsReviewScreenTabletProps) {
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width - 48, 1240);
  const completionCopy = buildCompletionCopy(mode, reviewSource, reviewedCount, extraDueReviewAvailable);
  const reviewFlowTitle = buildModeTitle(mode, reviewSource);
  const activeWordRevealKey = activeWord ? [mode, currentStep, activeWord.word].join('::') : null;
  const [revealedWordKey, setRevealedWordKey] = React.useState<string | null>(null);
  const isHintVisible = Boolean(activeWordRevealKey && revealedWordKey === activeWordRevealKey);

  React.useEffect(() => {
    setRevealedWordKey(null);
  }, [activeWordRevealKey]);

  const overlayBackgroundColor =
    theme.colorScheme === 'dark' ? 'rgba(28,28,30,0.90)' : 'rgba(255,255,255,0.88)';
  const overlayBorderColor =
    theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.76)';
  const overlayShadowColor = theme.colorScheme === 'dark' ? '#000000' : '#0F172A';

  let content: React.ReactNode;

  if (!isLoggedIn || queueStatus === 'auth_required') {
    content = (
      <CenteredStateCard
        badge={{ label: '需要登录', tone: 'amber' }}
        title="开始学习需要登录"
        message="登录后即可继续当前学习，并同步你的训练进度、复习结果和分析记录。"
        primaryLabel="去登录"
        onPrimary={onGoSignIn}
        secondaryLabel="返回上一页"
        onSecondary={onBack}
      />
    );
  } else if (queueStatus === 'loading') {
    content = (
      <CenteredStateCard
        title={queueLoadingTitle}
        message="正在整理本轮学习单词与进度，准备好后会直接进入学习。"
        loading
      />
    );
  } else if (queueStatus === 'slow_loading') {
    content = (
      <CenteredStateCard
        badge={{ label: '网络较慢', tone: 'blue' }}
        title={queueLoadingTitle}
        message="网络有点慢，系统仍在后台继续读取。你可以稍等片刻，或先回到今日计划。"
        primaryLabel="重新读取"
        onPrimary={onRetryQueue}
        secondaryLabel="今日计划"
        onSecondary={onBackToPlan}
      />
    );
  } else if (queueStatus === 'load_error') {
    content = (
      <CenteredStateCard
        badge={{ label: '加载失败', tone: 'red' }}
        title="暂时无法加载复习内容"
        message={queueError ?? '复习队列还没有成功返回，请稍后再试。'}
        primaryLabel="重试"
        onPrimary={onRetryQueue}
        secondaryLabel="回看今日计划"
        onSecondary={onBackToPlan}
      />
    );
  } else if (queueStatus === 'completed' || !activeWord) {
    content = (
      <SurfaceCard
        style={{
          width: '100%',
          maxWidth: 920,
          borderRadius: 32,
          padding: 28,
          backgroundColor: theme.cardBackground,
          borderColor: theme.border,
        }}
      >
        <View style={{ gap: 22 }}>
          <View style={{ gap: 12, alignItems: 'center' }}>
            <View
              style={{
                width: 82,
                height: 82,
                borderRadius: 41,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: reviewedCount > 0 ? 'rgba(52,199,89,0.12)' : theme.secondaryCardBackground,
                borderWidth: 1,
                borderColor: reviewedCount > 0 ? 'rgba(52,199,89,0.18)' : theme.border,
              }}
            >
              <Ionicons
                name={reviewedCount > 0 ? 'checkmark' : 'leaf-outline'}
                size={34}
                color={reviewedCount > 0 ? '#34C759' : theme.textSecondary}
              />
            </View>
            <AppText style={{ fontSize: 32, lineHeight: 38, fontWeight: '800', color: theme.textPrimary, textAlign: 'center' }}>
              {completionCopy.title}
            </AppText>
            <AppText style={{ fontSize: 15, lineHeight: 22, color: theme.textSecondary, textAlign: 'center' }}>
              {completionCopy.subtitle}
            </AppText>
            <AppText style={{ maxWidth: 520, fontSize: 13, lineHeight: 19, color: theme.textTertiary, textAlign: 'center' }}>
              {completionCopy.body}
            </AppText>
          </View>

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <MetricMiniCard label="总词数" value={String(reviewedCount)} />
            <MetricMiniCard label="认识" value={String(sessionStats.known)} />
            <MetricMiniCard label="模糊" value={String(sessionStats.unsure)} />
            <MetricMiniCard label="不会" value={String(sessionStats.unknown)} />
          </View>

          <View style={{ width: '100%', maxWidth: 420, alignSelf: 'center', gap: 12 }}>
            <ActionButton label="回到学习流" variant="dark" onPress={onBackToWords} />
            <ActionButton label="查看今日计划" variant="secondary" onPress={onBackToPlan} />
          </View>
        </View>
      </SurfaceCard>
    );
  } else {
    content = (
      <View
        style={{
          width: contentWidth,
          flexDirection: 'row',
          gap: 20,
          alignSelf: 'center',
          flex: 1,
          minHeight: 0,
        }}
      >
        <View style={{ flexBasis: '58%', flexGrow: 1, minWidth: 0, gap: 14 }}>
          <SurfaceCard
            style={{
              borderRadius: 26,
              paddingHorizontal: 20,
              paddingVertical: 18,
              backgroundColor: theme.cardBackground,
              borderColor: theme.border,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Pressable
                onPress={onBack}
                style={({ pressed }) => ({
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.secondaryCardBackground,
                  opacity: pressed ? 0.72 : 1,
                })}
              >
                <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
              </Pressable>

              <View style={{ flex: 1, gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <AppText style={{ fontSize: 22, lineHeight: 28, fontWeight: '800', color: theme.textPrimary }}>
                    {reviewFlowTitle}
                  </AppText>
                  <AppText style={{ fontSize: 15, lineHeight: 20, fontWeight: '700', color: theme.textSecondary }}>
                    {Math.max(currentStep, totalCount > 0 ? 1 : 0)} / {Math.max(totalCount, 0)}
                  </AppText>
                </View>
                <View
                  style={{
                    width: 180,
                    height: 6,
                    borderRadius: 999,
                    overflow: 'hidden',
                    backgroundColor: theme.separator,
                  }}
                >
                  <View
                    style={{
                      width: `${Math.max(0, Math.min(100, progressPercent))}%`,
                      height: '100%',
                      borderRadius: 999,
                      backgroundColor: theme.primaryBlue,
                    }}
                  />
                </View>
              </View>
            </View>
          </SurfaceCard>

          <SurfaceCard
            style={{
              flex: 1,
              minHeight: 420,
              borderRadius: 28,
              paddingHorizontal: 28,
              paddingVertical: 30,
              backgroundColor: theme.cardBackground,
              borderColor: theme.border,
              justifyContent: 'center',
              alignItems: 'center',
              overflow: 'hidden',
            }}
          >
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 32,
                right: -24,
                width: 220,
                height: 220,
                borderRadius: 999,
                backgroundColor: theme.colorScheme === 'dark' ? 'rgba(10,132,255,0.12)' : 'rgba(0,122,255,0.08)',
              }}
            />
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                bottom: -26,
                left: -18,
                width: 180,
                height: 180,
                borderRadius: 999,
                backgroundColor: theme.colorScheme === 'dark' ? 'rgba(52,199,89,0.10)' : 'rgba(52,199,89,0.08)',
              }}
            />

            <View style={{ width: '100%', alignItems: 'center', gap: 14 }}>
              <AppText
                style={{
                  fontSize: 60,
                  lineHeight: 68,
                  fontWeight: '800',
                  letterSpacing: -1.6,
                  color: theme.textPrimary,
                  textAlign: 'center',
                }}
              >
                {activeWord.word}
              </AppText>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <AppText
                  style={{
                    minHeight: 26,
                    fontSize: 20,
                    lineHeight: 26,
                    color: hasPhonetic ? theme.textSecondary : theme.textTertiary,
                  }}
                >
                  {activeWordPhonetic}
                </AppText>
                <Pressable
                  onPress={onPronounce}
                  style={({ pressed }) => ({
                    width: 42,
                    height: 42,
                    borderRadius: 21,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: theme.secondaryCardBackground,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Ionicons name="volume-medium-outline" size={20} color={theme.textPrimary} />
                </Pressable>
              </View>
              <AppText style={{ fontSize: FONT_MICRO, lineHeight: 18, letterSpacing: 0.2, color: theme.textTertiary }}>
                先回想释义，再做判断。
              </AppText>
            </View>
          </SurfaceCard>

          <SurfaceCard
            style={{
              borderRadius: 26,
              paddingHorizontal: 20,
              paddingVertical: 18,
              backgroundColor: theme.cardBackground,
              borderColor: theme.border,
            }}
          >
            <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center', gap: 12 }}>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <ReviewAnswerButton label="不会" tone="unknown" disabled={isReviewSubmitting} onPress={() => onReview('unknown')} />
                <ReviewAnswerButton label="模糊" tone="unsure" disabled={isReviewSubmitting} onPress={() => onReview('unsure')} />
                <ReviewAnswerButton label="认识" tone="known" disabled={isReviewSubmitting} onPress={() => onReview('known')} />
              </View>
              {submitError ? (
                <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: theme.destructive }}>
                  {submitError}
                </AppText>
              ) : null}
            </View>
          </SurfaceCard>
        </View>

        <SurfaceCard
          style={{
            flexBasis: '42%',
            flexGrow: 1,
            minWidth: 0,
            borderRadius: 26,
            padding: 0,
            backgroundColor: theme.cardBackground,
            borderColor: theme.border,
            overflow: 'hidden',
          }}
        >
          <View style={{ flex: 1, minHeight: 0 }}>
            <View style={{ paddingTop: 22, paddingHorizontal: 22, paddingBottom: 14, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <AppText style={{ fontSize: 22, lineHeight: 28, fontWeight: '800', color: theme.textPrimary }}>
                    学习提示
                  </AppText>
                  <AppText style={{ fontSize: 13, lineHeight: 18, color: theme.textSecondary }}>
                    常驻查看词义、记忆法、搭配和 AI 分析，不再使用底部抽屉。
                  </AppText>
                </View>
                <StatusPill label={displayAnalysis?.tier === 'deep' ? 'AI 分析已补全' : '基础提示'} tone="blue" />
              </View>
              <ModeTabs mode={mode} onModeChange={onModeChange} />
            </View>

            <View style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 22, gap: 14 }}
              >
              <View
                pointerEvents={isHintVisible ? 'auto' : 'none'}
                style={{ gap: 14, opacity: isHintVisible ? 1 : 0.15 }}
              >
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <MetricMiniCard
                    label="预测记忆率"
                    value={displayAnalysis?.predictedRetention?.trim() || '整理中'}
                  />
                  <MetricMiniCard
                    label="最佳窗口"
                    value={displayAnalysis?.bestReviewWindow?.trim() || '整理中'}
                  />
                </View>

                {analysisLoading ? (
                  <SectionCard title="分析状态" trailing={<ActivityIndicator size="small" color={theme.primaryBlue} />}>
                    <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: theme.textSecondary }}>
                      正在整理这个单词的学习提示…
                    </AppText>
                  </SectionCard>
                ) : null}

                {!displayAnalysis ? (
                  <SectionCard title="当前暂无分析">
                    <AppText style={{ fontSize: FONT_BODY, lineHeight: 21, color: theme.textSecondary }}>
                      当前还没有可展示的分析内容，完成一轮学习后会在这里显示。
                    </AppText>
                  </SectionCard>
                ) : (
                  <>
                    <WordsReviewAnalysisContent
                      word={activeWord}
                      analysis={displayAnalysis}
                      error={analysisError}
                      onRetry={onRetryAnalysis}
                      showError={Boolean(analysisError)}
                    />

                    {displayAnalysis.collocations.length > 0 ? (
                      <SectionCard title="高频搭配">
                        <View style={{ gap: 10 }}>
                          {displayAnalysis.collocations.map((item, index) => (
                            <View key={`${item.phrase}-${index}`} style={{ gap: 4 }}>
                              <AppText style={{ fontSize: 15, lineHeight: 20, fontWeight: '700', color: theme.textPrimary }}>
                                {item.phrase}
                              </AppText>
                              <AppText style={{ fontSize: 13, lineHeight: 19, color: theme.textSecondary }}>
                                {item.meaning}
                              </AppText>
                            </View>
                          ))}
                        </View>
                      </SectionCard>
                    ) : null}

                    {displayAnalysis.confusableWords.length > 0 ? (
                      <SectionCard title="易混词辨析">
                        <View style={{ gap: 10 }}>
                          {displayAnalysis.confusableWords.map((item, index) => (
                            <View key={`${item.word}-${index}`} style={{ gap: 4 }}>
                              <AppText style={{ fontSize: 15, lineHeight: 20, fontWeight: '700', color: theme.textPrimary }}>
                                {item.word}
                              </AppText>
                              <AppText style={{ fontSize: 13, lineHeight: 19, color: theme.textSecondary }}>
                                {item.difference}
                              </AppText>
                            </View>
                          ))}
                        </View>
                      </SectionCard>
                    ) : null}

                    {displayAnalysis.speakingPhrase ? (
                      <SectionCard title="表达补充">
                        <AppText style={{ fontSize: FONT_BODY, lineHeight: 22, color: theme.textPrimary }}>
                          {displayAnalysis.speakingPhrase}
                        </AppText>
                      </SectionCard>
                    ) : null}
                  </>
                )}
              </View>
              </ScrollView>

              {!isHintVisible ? (
                <View
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: 0,
                    bottom: 0,
                    borderRadius: 24,
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                    paddingHorizontal: 28,
                    paddingTop: 104,
                    backgroundColor: overlayBackgroundColor,
                    borderWidth: 1,
                    borderColor: overlayBorderColor,
                    shadowColor: overlayShadowColor,
                    shadowOpacity: theme.colorScheme === 'dark' ? 0.22 : 0.08,
                    shadowRadius: 18,
                    shadowOffset: { width: 0, height: 10 },
                  }}
                >
                  <View
                    style={{
                      width: '100%',
                      maxWidth: 320,
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <View
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: 28,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor:
                          theme.colorScheme === 'dark' ? 'rgba(10,132,255,0.16)' : 'rgba(0,122,255,0.10)',
                        borderWidth: 1,
                        borderColor:
                          theme.colorScheme === 'dark' ? 'rgba(10,132,255,0.24)' : 'rgba(0,122,255,0.12)',
                      }}
                    >
                      <Ionicons name="sparkles-outline" size={24} color={theme.primaryBlue} />
                    </View>
                    <View style={{ alignItems: 'center', gap: 6 }}>
                      <AppText style={{ fontSize: 19, lineHeight: 24, fontWeight: '800', color: theme.textPrimary, textAlign: 'center' }}>
                        点击查看详细提示
                      </AppText>
                      <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: theme.textSecondary, textAlign: 'center' }}>
                        先根据记忆判断，再按需查看词义、记忆法和 AI 分析。
                      </AppText>
                    </View>
                    <Pressable
                      onPress={() => setRevealedWordKey(activeWordRevealKey)}
                      style={({ pressed }) => ({
                        marginTop: 12,
                        minWidth: 124,
                        height: 42,
                        borderRadius: 999,
                        paddingHorizontal: 18,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: theme.primaryBlue,
                        opacity: pressed ? 0.82 : 1,
                      })}
                    >
                      <AppText style={{ fontSize: 15, lineHeight: 20, fontWeight: '700', color: '#FFFFFF' }}>
                        查看提示
                      </AppText>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>
          </View>
        </SurfaceCard>
      </View>
    );
  }

  return (
    <AppScreenShell
      scrollable={false}
      backgroundColor={theme.pageBackground}
      includeBottomInset={false}
      disableTabletTopInset
    >
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingHorizontal: 24, paddingTop: 12, paddingBottom: 14 }}>
        {content}
      </View>
      <VideoView player={pronunciationPlayer} nativeControls={false} contentFit="contain" style={{ width: 0, height: 0 }} />
    </AppScreenShell>
  );
}
