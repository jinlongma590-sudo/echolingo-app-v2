import React from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/AppText';
import type { ReviewDeckWord } from '@/services/api/vocabulary';
import { ACCENT, FONT_BODY, FONT_CALLOUT, FONT_CAPTION } from '@/theme/tokens';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { DisplayAnalysis } from '@/screens/words-review/types';

type WordsReviewAnalysisContentProps = {
  word: ReviewDeckWord;
  analysis: DisplayAnalysis;
  error?: string | null;
  onRetry?: () => void;
  showError?: boolean;
};

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
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
      <AppText style={{ fontSize: 12, lineHeight: 16, fontWeight: '700', color: theme.textSecondary }}>
        {title}
      </AppText>
      {children}
    </View>
  );
}

function buildNextStepText(analysis: DisplayAnalysis) {
  if (analysis.speakingPhrase?.trim()) {
    return `先用这个表达回想一遍：${analysis.speakingPhrase}`;
  }
  if (analysis.collocations[0]) {
    return `优先记住搭配「${analysis.collocations[0].phrase}」`;
  }
  return '先完成当前判断，再决定是否继续回看这个词。';
}

export function WordsReviewAnalysisContent({
  word,
  analysis,
  error,
  onRetry,
  showError = false,
}: WordsReviewAnalysisContentProps) {
  const { theme } = useAppTheme();

  return (
    <>
      {showError && error ? (
        <SectionCard title="分析状态">
          <AppText style={{ fontSize: FONT_CALLOUT, lineHeight: 20, color: theme.textSecondary }}>
            暂时没整理好，先按自己的感觉判断即可。
          </AppText>
          {onRetry ? (
            <Pressable
              onPress={onRetry}
              style={({ pressed }) => ({ alignSelf: 'flex-start', opacity: pressed ? 0.68 : 1 })}
            >
              <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, fontWeight: '700', color: ACCENT }}>
                重新整理
              </AppText>
            </Pressable>
          ) : null}
        </SectionCard>
      ) : null}

      <SectionCard title="语境理解">
        <AppText style={{ fontSize: FONT_BODY, lineHeight: 22, color: theme.textPrimary }}>
          {analysis.contextualMeaning}
        </AppText>
      </SectionCard>

      <SectionCard title="记忆方法">
        <AppText style={{ fontSize: FONT_BODY, lineHeight: 22, color: theme.textPrimary }}>
          {analysis.memoryTip}
        </AppText>
      </SectionCard>

      <SectionCard title="容易卡住的点">
        <AppText style={{ fontSize: FONT_BODY, lineHeight: 22, color: theme.textPrimary }}>
          {analysis.errorReasonSummary}
        </AppText>
      </SectionCard>

      <SectionCard title="下一步练习">
        <AppText style={{ fontSize: FONT_BODY, lineHeight: 22, color: theme.textPrimary }}>
          {buildNextStepText(analysis)}
        </AppText>
      </SectionCard>

      <SectionCard title="词条补充">
        <View style={{ gap: 6 }}>
          <AppText style={{ fontSize: FONT_BODY, lineHeight: 21, color: theme.textPrimary }}>
            {word.chinese}
          </AppText>
          {word.english?.trim() ? (
            <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: theme.textSecondary }}>
              {word.english}
            </AppText>
          ) : null}
          {word.example?.trim() ? (
            <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: theme.textSecondary }}>
              {word.example}
            </AppText>
          ) : null}
          {word.exampleZh?.trim() ? (
            <AppText style={{ fontSize: FONT_CAPTION, lineHeight: 18, color: theme.textSecondary }}>
              {word.exampleZh}
            </AppText>
          ) : null}
        </View>
      </SectionCard>
    </>
  );
}
