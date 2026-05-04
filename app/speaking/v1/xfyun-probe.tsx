import React from 'react';
import { Pressable, ScrollView, StatusBar, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { DevOnlyRoute } from '@/components/dev/DevOnlyRoute';
import { XfyunPronunciationPanel } from '../../../src/components/speaking/XfyunPronunciationPanel';
import { XfyunRoundCards } from '@/components/speaking/XfyunRoundCards';
import { useSpeakingV1XfyunProbeRuntime } from '@/hooks/speaking/useSpeakingV1XfyunProbeRuntime';

function stateLabel(runtimeState: 'ready' | 'recognizing' | 'analyzing') {
  switch (runtimeState) {
    case 'recognizing':
      return '正在模拟 RTASR 识别...';
    case 'analyzing':
      return '正在补发 ISE 评分与中文建议...';
    default:
      return '可开始一轮 mock 用户发言';
  }
}

function Bubble({
  role,
  text,
  isStreaming,
}: {
  role: 'ai' | 'user';
  text: string;
  isStreaming?: boolean;
}) {
  const isUser = role === 'user';
  return (
    <View style={{ alignItems: isUser ? 'flex-end' : 'flex-start' }}>
      <View
        style={{
          maxWidth: '92%',
          borderRadius: 24,
          paddingHorizontal: 16,
          paddingVertical: 14,
          backgroundColor: isUser ? '#0A84FF' : '#171923',
          borderTopRightRadius: isUser ? 10 : 24,
          borderTopLeftRadius: isUser ? 24 : 10,
          borderWidth: 1,
          borderColor: isUser ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.08)',
        }}
      >
        <AppText style={{ fontSize: 16, lineHeight: 24, color: '#FFFFFF' }}>
          {text}
          {isStreaming ? '▌' : ''}
        </AppText>
      </View>
    </View>
  );
}

export default function SpeakingV1XfyunProbeRoute() {
  return (
    <DevOnlyRoute>
      <SpeakingV1XfyunProbeContent />
    </DevOnlyRoute>
  );
}

function SpeakingV1XfyunProbeContent() {
  const {
    scenario,
    messages,
    runtimeState,
    isBusy,
    roundAnalysisMap,
    selectedAnalysis,
    pronunciationPanelVisible,
    startMockTurn,
    resetProbe,
    openPronunciationPanel,
    closePronunciationPanel,
  } = useSpeakingV1XfyunProbeRuntime();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#020617' }} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1 }}>
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 12,
            paddingBottom: 16,
            gap: 8,
            borderBottomWidth: 1,
            borderColor: 'rgba(255,255,255,0.06)',
          }}
        >
          <AppText style={{ fontSize: 24, fontWeight: '800', color: '#FFFFFF' }}>{scenario.title}</AppText>
          <AppText style={{ fontSize: 13, lineHeight: 20, color: '#94A3B8' }}>{scenario.subtitle}</AppText>
          <View
            style={{
              alignSelf: 'flex-start',
              borderRadius: 999,
              paddingHorizontal: 12,
              paddingVertical: 8,
              backgroundColor: 'rgba(255,255,255,0.05)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.08)',
            }}
          >
            <AppText style={{ fontSize: 12, color: '#CBD5E1' }}>{stateLabel(runtimeState)}</AppText>
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 20, gap: 14 }}
          showsVerticalScrollIndicator={false}
        >
          {messages.map((message) => {
            const analysis = message.role === 'user' && message.roundId != null ? roundAnalysisMap[message.roundId] ?? null : null;
            return (
              <View key={message.id} style={{ gap: 12 }}>
                <Bubble role={message.role} text={message.text} isStreaming={message.isStreaming} />
                {message.role === 'user' && analysis ? (
                  <XfyunRoundCards
                    analysis={analysis}
                    onOpenPronunciation={() => openPronunciationPanel(analysis.roundId)}
                    onPlayBetterExpression={() => {}}
                  />
                ) : null}
              </View>
            );
          })}
        </ScrollView>

        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 12,
            paddingBottom: 18,
            gap: 12,
            borderTopWidth: 1,
            borderColor: 'rgba(255,255,255,0.06)',
          }}
        >
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Pressable
              accessibilityRole="button"
              disabled={isBusy}
              onPress={startMockTurn}
              style={({ pressed }) => ({
                flex: 1,
                borderRadius: 18,
                paddingVertical: 15,
                alignItems: 'center',
                backgroundColor: isBusy ? 'rgba(10,132,255,0.28)' : '#0A84FF',
                opacity: pressed ? 0.84 : 1,
              })}
            >
              <AppText style={{ fontSize: 15, fontWeight: '800', color: '#FFFFFF' }}>
                {isBusy ? '识别中...' : '开始 Mock 麦克风'}
              </AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={resetProbe}
              style={({ pressed }) => ({
                borderRadius: 18,
                paddingHorizontal: 18,
                justifyContent: 'center',
                backgroundColor: 'rgba(255,255,255,0.06)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.08)',
                opacity: pressed ? 0.84 : 1,
              })}
            >
              <AppText style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>重置</AppText>
            </Pressable>
          </View>
          <AppText style={{ fontSize: 12, lineHeight: 18, color: '#64748B' }}>
            当前页只做 provider adapter / UI 映射验证：Realtime 主链路不在此页替换，先验证 transcript、评分卡、逐词分析与中文建议的挂载能力。
          </AppText>
        </View>
      </View>

      <XfyunPronunciationPanel analysis={selectedAnalysis} visible={pronunciationPanelVisible} onClose={closePronunciationPanel} />
    </SafeAreaView>
  );
}
