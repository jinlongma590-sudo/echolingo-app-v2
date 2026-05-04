import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

import type {
  PcmCaptureStartResult,
  PcmCaptureStatsEvent,
  PcmCaptureStopResult,
  PcmCaptureSupport,
  PcmChunkEvent,
} from '@/types/pcmDualStream';

type PcmCaptureNativeModule = {
  isSupported(): Promise<PcmCaptureSupport>;
  start(input: { sampleRate: number; channels: number; chunkMs: number }): Promise<PcmCaptureStartResult>;
  stop(): Promise<PcmCaptureStopResult>;
  ensureCaptureActiveAfterPlayback?(): Promise<{
    ok: boolean;
    restarted: boolean;
    reason?: string | null;
    engineRunning?: boolean;
    isCapturing?: boolean;
    route?: unknown;
  }>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};

const nativeModule = NativeModules.PcmCaptureModule as PcmCaptureNativeModule | undefined;
const eventEmitter = nativeModule ? new NativeEventEmitter(nativeModule as never) : null;

function getModule() {
  return Platform.OS === 'ios' || Platform.OS === 'android' ? nativeModule : undefined;
}

export async function getPcmCaptureSupport(): Promise<PcmCaptureSupport> {
  const module = getModule();
  if (!module) {
    return {
      supported: false,
      platform: Platform.OS,
      reason: 'pcm_capture_native_module_unavailable',
    };
  }
  return module.isSupported();
}

export async function startPcmCapture(input: {
  sampleRate: number;
  channels: number;
  chunkMs: number;
}) {
  const module = getModule();
  if (!module) {
    return {
      ok: false,
      sampleRate: input.sampleRate,
      channels: input.channels,
      chunkMs: input.chunkMs,
      format: 'pcm16' as const,
      reason: 'pcm_capture_native_module_unavailable',
    };
  }
  return module.start(input);
}

export async function stopPcmCapture() {
  const module = getModule();
  if (!module) {
    return {
      ok: false,
      capturedBytes: 0,
      sampleRate: 24000,
      channels: 1,
      chunkMs: 40,
      format: 'pcm16' as const,
      durationMs: 0,
      reason: 'pcm_capture_native_module_unavailable',
    };
  }
  return module.stop();
}

export async function ensureCaptureActiveAfterPlayback() {
  const module = getModule();
  if (!module?.ensureCaptureActiveAfterPlayback) {
    return {
      ok: false,
      restarted: false,
      reason: 'pcm_capture_resume_method_unavailable',
    };
  }
  return module.ensureCaptureActiveAfterPlayback();
}

export function addPcmChunkListener(listener: (event: PcmChunkEvent) => void) {
  return eventEmitter?.addListener('pcmChunk', listener);
}

export function addPcmCaptureStatsListener(listener: (event: PcmCaptureStatsEvent) => void) {
  return eventEmitter?.addListener('captureStats', listener);
}
