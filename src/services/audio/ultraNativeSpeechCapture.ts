import { NativeModules, Platform } from 'react-native';

export const ENABLE_NATIVE_AUDIO_TAP = false;
const NATIVE_AUDIO_TAP_DISABLED_REASON = 'native_audio_tap_disabled_to_protect_realtime_audio';

type NativeSupportResult = {
  supported: boolean;
  platform: 'ios';
  reason?: string;
};

export type UltraNativeSpeechCaptureResult = {
  ok: boolean;
  turnId?: string;
  uri?: string;
  durationMs?: number;
  size?: number;
  sampleRate?: number;
  channels?: number;
  format?: string;
  mimeType?: string;
  reason?: string;
};

type UltraSpeechCaptureNativeModule = {
  isSupported(): Promise<NativeSupportResult>;
  startTurn(input: { turnId: string }): Promise<{ ok: boolean; turnId: string }>;
  stopTurn(input: { turnId: string }): Promise<UltraNativeSpeechCaptureResult>;
  getLastResult(): Promise<UltraNativeSpeechCaptureResult>;
};

const nativeModule = NativeModules.UltraSpeechCaptureModule as UltraSpeechCaptureNativeModule | undefined;
const resultsByTurnId = new Map<string, UltraNativeSpeechCaptureResult>();

function getModule() {
  return Platform.OS === 'ios' ? nativeModule : undefined;
}

export async function getUltraNativeSpeechCaptureSupport(): Promise<NativeSupportResult> {
  if (!ENABLE_NATIVE_AUDIO_TAP) {
    return {
      supported: false,
      platform: 'ios',
      reason: NATIVE_AUDIO_TAP_DISABLED_REASON,
    };
  }
  const module = getModule();
  if (!module) {
    return {
      supported: false,
      platform: 'ios',
      reason: 'native_module_unavailable',
    };
  }
  return module.isSupported();
}

export async function startUltraNativeSpeechCaptureTurn(turnId: string) {
  if (!ENABLE_NATIVE_AUDIO_TAP) {
    return {
      ok: false,
      turnId,
      reason: 'native_audio_tap_disabled',
    };
  }
  const module = getModule();
  if (!module) {
    return {
      ok: false,
      turnId,
      reason: 'native_module_unavailable',
    };
  }
  return module.startTurn({ turnId });
}

export async function stopUltraNativeSpeechCaptureTurn(turnId: string): Promise<UltraNativeSpeechCaptureResult> {
  if (!ENABLE_NATIVE_AUDIO_TAP) {
    return {
      ok: false,
      turnId,
      reason: 'native_audio_tap_disabled',
    };
  }
  const module = getModule();
  if (!module) {
    return {
      ok: false,
      turnId,
      reason: 'native_module_unavailable',
    };
  }
  const result = await module.stopTurn({ turnId });
  if (result.ok && result.turnId) {
    resultsByTurnId.set(result.turnId, result);
  }
  return result;
}

export async function getLastUltraNativeSpeechCaptureResult(): Promise<UltraNativeSpeechCaptureResult> {
  if (!ENABLE_NATIVE_AUDIO_TAP) {
    return {
      ok: false,
      reason: 'native_audio_tap_disabled',
    };
  }
  const module = getModule();
  if (!module) {
    return {
      ok: false,
      reason: 'native_module_unavailable',
    };
  }
  const result = await module.getLastResult();
  if (result.ok && result.turnId) {
    resultsByTurnId.set(result.turnId, result);
  }
  return result;
}

export async function getUltraNativeSpeechCaptureResultForTurn(turnId: string) {
  const cached = resultsByTurnId.get(turnId);
  if (cached?.ok) {
    return cached;
  }

  const lastResult = await getLastUltraNativeSpeechCaptureResult();
  if (lastResult.ok && lastResult.turnId === turnId) {
    return lastResult;
  }

  return null;
}
