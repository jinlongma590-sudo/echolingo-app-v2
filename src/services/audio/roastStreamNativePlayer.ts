import { NativeModules, Platform } from 'react-native';

type NativeStreamResult = {
  status?: string;
  elapsedMs?: number;
};

type RoastStreamPlayerNativeModule = {
  playStream(url: string): Promise<NativeStreamResult>;
  stop(): Promise<{ status?: string }>;
  getState(): Promise<{ status?: string; playerStatus?: string; error?: string | null }>;
};

const nativeModule = NativeModules.RoastStreamPlayer as RoastStreamPlayerNativeModule | undefined;

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function isRoastNativeStreamPlayerAvailable() {
  return Platform.OS === 'ios' && !!nativeModule?.playStream;
}

export async function playRoastNativeStreamUrl(url: string, t0Click = now()) {
  if (!isRoastNativeStreamPlayerAvailable() || !nativeModule) {
    return {
      supported: false,
      reason: 'native_stream_player_unavailable',
      t0Click,
    };
  }

  const t1NativeCall = now();
  try {
    const result = await nativeModule.playStream(url);
    const t2NativePlaying = now();
    return {
      supported: true,
      reason: result.status || 'native_avplayer_stream_playing',
      nativeElapsedMs: result.elapsedMs ?? null,
      t0Click,
      t1NativeCall,
      t2NativePlaying,
      clickToNativePlayingMs: Math.round(t2NativePlaying - t0Click),
    };
  } catch (error) {
    return {
      supported: false,
      reason: 'native_stream_player_failed',
      error: error instanceof Error ? error.message : 'native_stream_failed',
      t0Click,
      t1NativeCall,
    };
  }
}

export async function stopRoastNativeStreamPlayer() {
  if (!nativeModule?.stop) return;
  await nativeModule.stop().catch(() => undefined);
}
