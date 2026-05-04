import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StatusBar, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { DevOnlyRoute } from '@/components/dev/DevOnlyRoute';
import { XfyunPronunciationPanel } from '../../../src/components/speaking/XfyunPronunciationPanel';
import { XfyunRoundCards } from '@/components/speaking/XfyunRoundCards';
import { createSpeakingRecorder } from '@/services/audio/recording';
import {
  GatewayAssessApiError,
  type GatewayAssessApiErrorDetails,
  uploadGatewayAssessAudio,
} from '@/services/api/xfyunGatewayAssess';
import type { SpeakingRecordingResult } from '@/types/speaking';
import type { SpeakingRoundAnalysis } from '@/types/xfyunSpeakingAssessment';

type GatewayProbeResponse = Awaited<ReturnType<typeof uploadGatewayAssessAudio>>['raw'];

const LOG_PREFIX = '[V1_GATEWAY_PROBE]';

function log(step: string, details: unknown = {}) {
  let normalized: string;
  try {
    normalized = JSON.stringify(details);
  } catch {
    normalized = String(details);
  }
  console.log(`${LOG_PREFIX} ${step} = ${normalized}`);
}

function Bubble({ text }: { text: string }) {
  return (
    <View style={{ alignItems: 'flex-end' }}>
      <View
        style={{
          maxWidth: '92%',
          borderRadius: 24,
          paddingHorizontal: 16,
          paddingVertical: 14,
          backgroundColor: '#0A84FF',
          borderTopRightRadius: 10,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.12)',
        }}
      >
        <AppText style={{ fontSize: 16, lineHeight: 24, color: '#FFFFFF' }}>{text}</AppText>
      </View>
    </View>
  );
}

function stateLabel(state: 'idle' | 'recording' | 'uploading' | 'done' | 'error') {
  switch (state) {
    case 'recording':
      return '正在录音，再点一次即可结束';
    case 'uploading':
      return '正在上传到 Gateway Probe，并等待讯飞 transcript / 评分返回';
    case 'done':
      return 'Gateway Probe 已返回真实 transcript 与发音评分';
    case 'error':
      return '本轮失败，请检查本地 API 地址、录音权限和服务端日志';
    default:
      return '当前页使用独立本地录音，不走 WebRTC / Realtime';
  }
}

export default function SpeakingV1GatewayProbeRoute() {
  return (
    <DevOnlyRoute>
      <SpeakingV1GatewayProbeContent />
    </DevOnlyRoute>
  );
}

function SpeakingV1GatewayProbeContent() {
  const recorder = useMemo(() => createSpeakingRecorder(), []);
  const [runtimeState, setRuntimeState] = useState<'idle' | 'recording' | 'uploading' | 'done' | 'error'>('idle');
  const [recording, setRecording] = useState<SpeakingRecordingResult | null>(null);
  const [analysis, setAnalysis] = useState<SpeakingRoundAnalysis | null>(null);
  const [rawResponse, setRawResponse] = useState<GatewayProbeResponse | null>(null);
  const [transcriptText, setTranscriptText] = useState<string>('');
  const [errorDetails, setErrorDetails] = useState<GatewayAssessApiErrorDetails | null>(null);
  const [panelVisible, setPanelVisible] = useState(false);
  const [mode, setMode] = useState<'fast' | 'full'>('fast');

  useEffect(() => {
    return () => {
      recorder.cleanup().catch(() => undefined);
    };
  }, [recorder]);

  async function startRecording() {
    setErrorDetails(null);
    const permission = await recorder.requestPermissions();
    if (!permission.granted) {
      setRuntimeState('error');
      setErrorDetails({
        code: 'RECORDING_PERMISSION_DENIED',
        message: '录音权限未开启。',
        url: '',
        method: 'POST',
        baseUrl: null,
        endpoint: '/api/dev/xfyun/gateway-assess',
      });
      return;
    }
    await recorder.start();
    setRecording(null);
    setAnalysis(null);
    setRawResponse(null);
    setTranscriptText('');
    setErrorDetails(null);
    setRuntimeState('recording');
    log('recording_start', {
      provider: recorder.capability.provider,
    });
  }

  async function stopRecording() {
    const result = await recorder.stop();
    if (!result) {
      throw new Error('recording_stop_no_file');
    }
    setRecording(result);
    setRuntimeState('uploading');
    log('recording_stop', {
      uri: result.uri,
      durationMs: result.durationMs ?? null,
      size: result.size ?? null,
    });

    const gatewayResult = await uploadGatewayAssessAudio({
      audio: result,
      language: 'en_us',
      category: 'read_sentence',
      mode,
    });
    setRawResponse(gatewayResult.raw);
    setTranscriptText(gatewayResult.transcript?.text || gatewayResult.pronunciation?.transcriptText || '');
    setAnalysis(gatewayResult.analysis);
    setRuntimeState('done');
  }

  async function handlePrimaryPress() {
    try {
      if (runtimeState === 'recording') {
        await stopRecording();
        return;
      }
      await startRecording();
    } catch (error) {
      const details =
        error instanceof GatewayAssessApiError
          ? error.details
          : {
              code: 'UNEXPECTED_GATEWAY_PROBE_ERROR',
              message: error instanceof Error ? error.message : String(error),
              url: '',
              method: 'POST' as const,
              baseUrl: null,
              endpoint: '/api/dev/xfyun/gateway-assess',
            };
      setRuntimeState('error');
      setErrorDetails(details);
      log('upload_failed', details);
    }
  }

  function resetProbe() {
    setRuntimeState('idle');
    setRecording(null);
    setAnalysis(null);
    setRawResponse(null);
    setTranscriptText('');
    setErrorDetails(null);
    setPanelVisible(false);
  }

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
          <AppText style={{ fontSize: 24, fontWeight: '800', color: '#FFFFFF' }}>Gateway Probe</AppText>
          <AppText style={{ fontSize: 13, lineHeight: 20, color: '#94A3B8' }}>
            独立验证 App 真实录音上传到 dev API 后，由服务端串行调用 XFYUN RTASR + ISE，再回填 transcript、评分卡与逐词分析。
          </AppText>
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
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['fast', 'full'] as const).map((item) => (
              <Pressable
                key={item}
                onPress={() => setMode(item)}
                style={({ pressed }) => ({
                  borderRadius: 999,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  backgroundColor: mode === item ? 'rgba(10,132,255,0.16)' : 'rgba(255,255,255,0.05)',
                  borderWidth: 1,
                  borderColor: mode === item ? 'rgba(10,132,255,0.28)' : 'rgba(255,255,255,0.08)',
                  opacity: pressed ? 0.84 : 1,
                })}
              >
                <AppText style={{ fontSize: 12, fontWeight: '700', color: mode === item ? '#8BC2FF' : '#CBD5E1' }}>
                  mode={item}
                </AppText>
              </Pressable>
            ))}
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 20, gap: 14 }}
          showsVerticalScrollIndicator={false}
        >
          <View
            style={{
              borderRadius: 18,
              padding: 16,
              backgroundColor: 'rgba(255,255,255,0.04)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.08)',
              gap: 8,
            }}
          >
            <AppText style={{ fontSize: 13, fontWeight: '700', color: '#D6E8FF' }}>本地录音</AppText>
            <AppText style={{ fontSize: 12, lineHeight: 18, color: '#CBD5E1' }}>
              uri: {recording?.uri ?? '--'}
            </AppText>
            <AppText style={{ fontSize: 12, lineHeight: 18, color: '#CBD5E1' }}>
              durationMs: {recording?.durationMs ?? '--'}
            </AppText>
            <AppText style={{ fontSize: 12, lineHeight: 18, color: '#CBD5E1' }}>
              size: {recording?.size ?? '--'}
            </AppText>
          </View>

          {runtimeState === 'uploading' ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                borderRadius: 18,
                padding: 16,
                backgroundColor: 'rgba(10,132,255,0.12)',
                borderWidth: 1,
                borderColor: 'rgba(10,132,255,0.24)',
              }}
            >
              <ActivityIndicator color="#8BC2FF" />
              <AppText style={{ fontSize: 13, color: '#D6E8FF' }}>
                正在上传并等待服务端返回真实 transcript / pronunciation...
              </AppText>
            </View>
          ) : null}

          {transcriptText ? <Bubble text={transcriptText} /> : null}

          {analysis ? (
            <XfyunRoundCards
              analysis={analysis}
              onOpenPronunciation={() => setPanelVisible(true)}
              onPlayBetterExpression={() => {}}
            />
          ) : null}

          {rawResponse ? (
            <View
              style={{
                borderRadius: 18,
                padding: 16,
                backgroundColor: 'rgba(255,255,255,0.04)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.08)',
                gap: 8,
              }}
            >
              <AppText style={{ fontSize: 13, fontWeight: '700', color: '#D6E8FF' }}>调试信息</AppText>
              <AppText style={{ fontSize: 12, lineHeight: 18, color: '#CBD5E1' }}>mode: {rawResponse.mode}</AppText>
              <AppText style={{ fontSize: 12, lineHeight: 18, color: '#CBD5E1' }}>
                totalMs: {rawResponse.timing.totalMs}
              </AppText>
              <AppText style={{ fontSize: 12, lineHeight: 18, color: '#CBD5E1' }}>
                rtasrMs: {rawResponse.timing.rtasrMs ?? '--'}
              </AppText>
              <AppText style={{ fontSize: 12, lineHeight: 18, color: '#CBD5E1' }}>
                iseMs: {rawResponse.timing.iseMs ?? '--'}
              </AppText>
              <AppText style={{ fontSize: 12, lineHeight: 18, color: rawResponse.performanceVerdict.acceptableForRealtime ? '#86EFAC' : '#FCA5A5' }}>
                acceptableForRealtime: {String(rawResponse.performanceVerdict.acceptableForRealtime)} ({rawResponse.performanceVerdict.reason})
              </AppText>
              {!rawResponse.performanceVerdict.acceptableForRealtime ? (
                <AppText style={{ fontSize: 12, lineHeight: 18, color: '#FCA5A5' }}>
                  当前延迟不适合正式实时口语体验
                </AppText>
              ) : null}
              <AppText style={{ fontSize: 12, lineHeight: 18, color: '#CBD5E1' }}>
                mergeStrategy: {rawResponse.transcript?.raw?.mergeStrategy ?? '--'}
              </AppText>
              <AppText style={{ fontSize: 12, lineHeight: 18, color: '#CBD5E1' }}>
                rawTextBeforeNormalize: {rawResponse.transcript?.raw?.rawTextBeforeNormalize ?? '--'}
              </AppText>
              <AppText style={{ fontSize: 12, lineHeight: 18, color: '#CBD5E1' }}>
                normalizedText: {rawResponse.transcript?.raw?.normalizedText ?? '--'}
              </AppText>
              <AppText style={{ fontSize: 12, lineHeight: 18, color: '#CBD5E1' }}>
                pronunciationDebug: {rawResponse.pronunciationDebug.errorMessage || rawResponse.pronunciationDebug.skipReason || (rawResponse.pronunciation ? 'ok' : '--')}
              </AppText>
            </View>
          ) : null}

          {errorDetails ? (
            <View
              style={{
                borderRadius: 18,
                padding: 16,
                backgroundColor: 'rgba(239,68,68,0.14)',
                borderWidth: 1,
                borderColor: 'rgba(239,68,68,0.22)',
              }}
            >
              <AppText style={{ fontSize: 14, fontWeight: '700', color: '#FECACA' }}>请求失败</AppText>
              <AppText style={{ fontSize: 13, lineHeight: 20, color: '#FECACA' }}>
                code: {errorDetails.code}
              </AppText>
              <AppText style={{ fontSize: 13, lineHeight: 20, color: '#FECACA' }}>
                message: {errorDetails.message}
              </AppText>
              <AppText style={{ fontSize: 13, lineHeight: 20, color: '#FECACA' }}>
                status: {errorDetails.status ?? '--'}
              </AppText>
              <AppText style={{ fontSize: 13, lineHeight: 20, color: '#FECACA' }}>
                content-type: {errorDetails.contentType ?? '--'}
              </AppText>
              <AppText style={{ fontSize: 13, lineHeight: 20, color: '#FECACA' }}>
                url: {errorDetails.url || '--'}
              </AppText>
              <AppText style={{ fontSize: 13, lineHeight: 20, color: '#FECACA' }}>
                fileUri: {recording?.uri ?? errorDetails.fileUri ?? '--'}
              </AppText>
              <AppText style={{ fontSize: 13, lineHeight: 20, color: '#FECACA' }}>
                fileSize: {recording?.size ?? errorDetails.size ?? '--'}
              </AppText>
              <AppText style={{ fontSize: 13, lineHeight: 20, color: '#FECACA' }}>
                raw: {errorDetails.rawPreview ?? '--'}
              </AppText>
            </View>
          ) : null}
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
              onPress={handlePrimaryPress}
              style={({ pressed }) => ({
                flex: 1,
                borderRadius: 18,
                paddingVertical: 15,
                alignItems: 'center',
                backgroundColor: runtimeState === 'recording' ? '#EF4444' : '#0A84FF',
                opacity: pressed ? 0.84 : 1,
              })}
            >
              <AppText style={{ fontSize: 15, fontWeight: '800', color: '#FFFFFF' }}>
                {runtimeState === 'recording' ? '停止并上传' : '开始录音'}
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
            当前页不走正式 V1 Realtime，也不走 WebRTC 音频。这里只验证真实本地录音经过 dev API 返回 transcript 与发音评分。
          </AppText>
        </View>
      </View>

      <XfyunPronunciationPanel analysis={analysis} visible={panelVisible} onClose={() => setPanelVisible(false)} />
    </SafeAreaView>
  );
}
