import { Redirect, router } from 'expo-router';
import React, { useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { isDevOnlyRouteEnabled } from '@/components/dev/DevOnlyRoute';
import { SCENARIOS } from '@/data/scenarios';
import { useSpeakingV1UltraRuntime } from '@/hooks/speaking/useSpeakingV1UltraRuntime';
import { useAppSession } from '@/services/auth/AppSessionProvider';
import {
  COLOR_BLUE,
  TEXT_ON_DARK,
  TEXT_ON_DARK_SOFT,
  TEXT_SECONDARY,
} from '@/theme/tokens';

const COFFEE_ORDER_SCENARIO = SCENARIOS.find((item) => item.id === 'coffee-order') ?? SCENARIOS[0];

function connectionLabel(status: string) {
  switch (status) {
    case 'starting':
      return '启动中';
    case 'connecting':
      return '连接中';
    case 'connected':
      return '已连接';
    case 'disconnected':
      return '已断开';
    case 'completed':
      return '已结束';
    case 'error':
      return '异常';
    default:
      return '未开始';
  }
}

function stateLabel(runtimeState: string, isMicHot: boolean) {
  switch (runtimeState) {
    case 'initializing':
    case 'ready':
      return '连接中';
    case 'waitingUser':
      return '等你说话';
    case 'userSpeaking':
      return isMicHot ? '正在听' : '等你说话';
    case 'assistantThinking':
    case 'assistantStreaming':
    case 'assistantSpeaking':
      return 'AI 正在回复';
    case 'completed':
      return '练习已结束';
    case 'error':
      return '连接异常';
    default:
      return '处理中';
  }
}

function handleBack() {
  if (typeof router.canGoBack === 'function' && router.canGoBack()) {
    router.back();
    return;
  }
  router.replace('/(tabs)/speaking');
}

function MessageBubble({
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
          maxWidth: '86%',
          borderRadius: 24,
          borderTopRightRadius: isUser ? 8 : 24,
          borderTopLeftRadius: isUser ? 24 : 8,
          paddingHorizontal: 16,
          paddingVertical: 14,
          backgroundColor: isUser ? COLOR_BLUE : '#1C1C1E',
          borderWidth: 1,
          borderColor: isUser ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.08)',
        }}
      >
        <AppText style={{ fontSize: 16, lineHeight: 24, color: TEXT_ON_DARK }}>
          {text}
          {isStreaming ? '▌' : ''}
        </AppText>
      </View>
    </View>
  );
}

export function SpeakingV1UltraScreen() {
  if (!isDevOnlyRouteEnabled) {
    return <Redirect href="/(tabs)/speaking" />;
  }

  const appSession = useAppSession();
  const runtime = useSpeakingV1UltraRuntime({
    session: appSession.session,
    scenario: COFFEE_ORDER_SCENARIO,
  });
  const conversationRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      conversationRef.current?.scrollToEnd({ animated: true });
    }, 80);
    return () => clearTimeout(timer);
  }, [runtime.messages, runtime.partialUserTranscript, runtime.error, runtime.runtimeState]);

  const isLoggedIn = appSession.status === 'authenticated';
  const assistantMessageCount = useMemo(
    () => runtime.messages.filter((item) => item.role === 'ai').length,
    [runtime.messages],
  );

  if (!isLoggedIn) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#000000' }}>
        <StatusBar barStyle="light-content" />
        <View style={{ flex: 1, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 28, justifyContent: 'space-between' }}>
          <View style={{ gap: 18 }}>
            <Pressable onPress={handleBack} style={{ alignSelf: 'flex-start', paddingVertical: 8 }}>
              <AppText style={{ fontSize: 16, color: '#8BC2FF' }}>‹ 返回</AppText>
            </Pressable>
            <View style={{ gap: 10 }}>
              <AppText style={{ fontSize: 30, fontWeight: '800', color: TEXT_ON_DARK }}>V1 Ultra PoC</AppText>
              <AppText style={{ fontSize: 15, lineHeight: 24, color: TEXT_ON_DARK_SOFT }}>
                这是隐藏的 Realtime 回合制验证页。请先登录后再进入真机测试。
              </AppText>
            </View>
          </View>
          <Pressable
            onPress={() => router.push('/auth/sign-in')}
            style={{
              borderRadius: 20,
              backgroundColor: '#FFFFFF',
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 16,
            }}
          >
            <AppText style={{ fontSize: 16, fontWeight: '700', color: '#000000' }}>去登录继续测试</AppText>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const currentStateLabel = stateLabel(runtime.runtimeState, runtime.isMicHot);
  const micDisabled =
    !runtime.transportReady ||
    runtime.connectionStatus !== 'connected' ||
    runtime.runtimeState === 'assistantThinking' ||
    runtime.runtimeState === 'assistantStreaming' ||
    runtime.runtimeState === 'assistantSpeaking' ||
    runtime.runtimeState === 'completed';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000000' }}>
      <StatusBar barStyle="light-content" />

      <View
        style={{
          paddingHorizontal: 18,
          paddingTop: 6,
          paddingBottom: 14,
          borderBottomWidth: 1,
          borderBottomColor: 'rgba(255,255,255,0.06)',
          backgroundColor: 'rgba(0,0,0,0.94)',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
          <Pressable onPress={handleBack} style={{ width: 72, justifyContent: 'center' }}>
            <AppText style={{ fontSize: 16, color: '#8BC2FF' }}>‹ 返回</AppText>
          </Pressable>

          <View style={{ position: 'absolute', left: 84, right: 84, alignItems: 'center', gap: 8 }}>
            <AppText style={{ fontSize: 18, fontWeight: '700', color: TEXT_ON_DARK }}>V1 Ultra PoC</AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <View
                style={{
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  backgroundColor: 'rgba(255,255,255,0.08)',
                }}
              >
                <AppText style={{ fontSize: 11, fontWeight: '700', color: TEXT_ON_DARK_SOFT }}>
                  {COFFEE_ORDER_SCENARIO.id}
                </AppText>
              </View>
              <View
                style={{
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  backgroundColor: runtime.connectionStatus === 'connected' ? 'rgba(52,199,89,0.18)' : 'rgba(255,255,255,0.08)',
                }}
              >
                <AppText style={{ fontSize: 11, fontWeight: '700', color: TEXT_ON_DARK_SOFT }}>
                  {connectionLabel(runtime.connectionStatus)}
                </AppText>
              </View>
            </View>
          </View>

          <View style={{ width: 72, alignItems: 'flex-end' }}>
            <View
              style={{
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 7,
                backgroundColor: 'rgba(255,255,255,0.08)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.08)',
              }}
            >
              <AppText style={{ fontSize: 11, fontWeight: '700', color: TEXT_ON_DARK_SOFT }}>
                内测验证
              </AppText>
            </View>
          </View>
        </View>
      </View>

      <ScrollView
        ref={conversationRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 24, gap: 18 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ alignItems: 'center', gap: 10, paddingHorizontal: 18 }}>
          <AppText style={{ fontSize: 14, lineHeight: 22, color: TEXT_SECONDARY, textAlign: 'center' }}>
            基于现有 Realtime/WebRTC 底层的隐藏 V1 Ultra 回合制 PoC。固定场景：{COFFEE_ORDER_SCENARIO.name}
          </AppText>
          <View
            style={{
              borderRadius: 999,
              paddingHorizontal: 12,
              paddingVertical: 7,
              backgroundColor: 'rgba(255,255,255,0.06)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.06)',
            }}
          >
            <AppText style={{ fontSize: 12, color: TEXT_ON_DARK_SOFT }}>{currentStateLabel}</AppText>
          </View>
          <AppText style={{ fontSize: 12, lineHeight: 18, color: TEXT_SECONDARY, textAlign: 'center' }}>
            评分待接入 · assistant turns {runtime.turnCount} · ai messages {assistantMessageCount}
            {runtime.model ? ` · ${runtime.model}` : ''}
            {runtime.voice ? ` · voice ${runtime.voice}` : ''}
          </AppText>
        </View>

        {runtime.messages.length === 0 ? (
          <View
            style={{
              alignSelf: 'center',
              width: '100%',
              borderRadius: 24,
              paddingHorizontal: 18,
              paddingVertical: 18,
              backgroundColor: 'rgba(255,255,255,0.04)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.05)',
            }}
          >
            <AppText style={{ fontSize: 15, lineHeight: 24, color: TEXT_ON_DARK_SOFT, textAlign: 'center' }}>
              页面加载后会自动建立 Realtime 会话并请求 AI 开场。请等待连接 ready，再开始说第一句。
            </AppText>
          </View>
        ) : null}

        {runtime.messages.map((message) => (
          <MessageBubble
            key={message.id}
            role={message.role}
            text={message.text}
            isStreaming={message.isStreaming}
          />
        ))}

        {runtime.partialUserTranscript ? (
          <View style={{ alignItems: 'flex-end', gap: 8 }}>
            <View
              style={{
                maxWidth: '86%',
                borderRadius: 24,
                borderTopRightRadius: 8,
                paddingHorizontal: 16,
                paddingVertical: 14,
                backgroundColor: COLOR_BLUE,
                opacity: 0.92,
              }}
            >
              <AppText style={{ fontSize: 16, lineHeight: 24, color: TEXT_ON_DARK }}>
                {runtime.partialUserTranscript} ▌
              </AppText>
            </View>
            <AppText style={{ fontSize: 12, color: TEXT_SECONDARY }}>实时 transcript partial</AppText>
          </View>
        ) : null}
      </ScrollView>

      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: 22,
          borderTopWidth: 1,
          borderTopColor: 'rgba(255,255,255,0.06)',
          backgroundColor: 'rgba(0,0,0,0.94)',
          gap: 14,
        }}
      >
        {runtime.error ? (
          <View
            style={{
              borderRadius: 18,
              backgroundColor: 'rgba(255,59,48,0.12)',
              borderWidth: 1,
              borderColor: 'rgba(255,59,48,0.18)',
              paddingHorizontal: 14,
              paddingVertical: 12,
              gap: 6,
            }}
          >
            <AppText style={{ fontSize: 11, fontWeight: '700', color: '#FF8A80' }}>{runtime.error.scope.toUpperCase()}</AppText>
            <AppText style={{ fontSize: 13, lineHeight: 19, color: TEXT_ON_DARK_SOFT }}>{runtime.error.message}</AppText>
            {runtime.error.debugMessage ? (
              <AppText style={{ fontSize: 11, lineHeight: 16, color: TEXT_SECONDARY }}>
                debug: {runtime.error.debugMessage}
              </AppText>
            ) : null}
            <Pressable onPress={runtime.clearError} style={{ alignSelf: 'flex-start', paddingTop: 2 }}>
              <AppText style={{ fontSize: 12, fontWeight: '600', color: '#8BC2FF' }}>知道了</AppText>
            </Pressable>
          </View>
        ) : null}

        {!runtime.transportReady ? (
          <View
            style={{
              borderRadius: 18,
              backgroundColor: 'rgba(255,59,48,0.12)',
              borderWidth: 1,
              borderColor: 'rgba(255,59,48,0.16)',
              paddingHorizontal: 14,
              paddingVertical: 12,
            }}
          >
            <AppText style={{ fontSize: 13, lineHeight: 20, color: TEXT_ON_DARK_SOFT }}>
              {runtime.transportReason ?? '当前构建未接通 react-native-webrtc。'}
            </AppText>
          </View>
        ) : null}

        <View style={{ alignItems: 'center', gap: 12 }}>
          <View style={{ minHeight: 22, justifyContent: 'center' }}>
            <AppText style={{ fontSize: 12, lineHeight: 18, color: TEXT_SECONDARY, textAlign: 'center' }}>
              {currentStateLabel}
            </AppText>
          </View>

          <View style={{ alignItems: 'center', justifyContent: 'center', minHeight: 110 }}>
            {(runtime.runtimeState === 'assistantThinking' ||
              runtime.runtimeState === 'assistantStreaming' ||
              runtime.runtimeState === 'assistantSpeaking') && (
              <View
                style={{
                  position: 'absolute',
                  width: 108,
                  height: 108,
                  borderRadius: 54,
                  backgroundColor: 'rgba(10,132,255,0.18)',
                }}
              />
            )}

            <Pressable
              onPress={runtime.startUserTurn}
              disabled={micDisabled || !runtime.canStartTurn}
              style={{
                width: 76,
                height: 76,
                borderRadius: 38,
                backgroundColor: runtime.canStartTurn ? '#FFFFFF' : 'rgba(255,255,255,0.18)',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: micDisabled || !runtime.canStartTurn ? 0.5 : 1,
              }}
            >
              {runtime.connectionStatus === 'starting' || runtime.connectionStatus === 'connecting' ? (
                <ActivityIndicator color="#000000" />
              ) : runtime.runtimeState === 'assistantThinking' ? (
                <ActivityIndicator color={COLOR_BLUE} />
              ) : (
                <AppText style={{ fontSize: 28, color: runtime.canStartTurn ? '#000000' : '#D1D1D6' }}>🎙</AppText>
              )}
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
            <Pressable onPress={() => void runtime.endSession('completed')}>
              <AppText style={{ fontSize: 13, fontWeight: '600', color: '#8BC2FF' }}>结束练习</AppText>
            </Pressable>
            <Pressable onPress={() => void runtime.retryConnection()}>
              <AppText style={{ fontSize: 13, fontWeight: '600', color: '#8BC2FF' }}>重试连接</AppText>
            </Pressable>
          </View>

          <View
            style={{
              width: '100%',
              borderRadius: 18,
              backgroundColor: 'rgba(255,255,255,0.05)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.06)',
              paddingHorizontal: 14,
              paddingVertical: 12,
              gap: 6,
            }}
          >
            <AppText style={{ fontSize: 12, fontWeight: '700', color: TEXT_ON_DARK }}>PoC 说明</AppText>
            <AppText style={{ fontSize: 12, lineHeight: 18, color: TEXT_ON_DARK_SOFT }}>
              这是隐藏验证页，不代表正式 V1。当前只验证 Realtime 开场、用户 transcript、AI 短回复和远端音频是否能显著提速。
            </AppText>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}
