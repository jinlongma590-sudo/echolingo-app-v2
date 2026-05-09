import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';

import { playRoastTtsPreview, stopRoastTtsPreview } from '@/services/audio/playRoastTtsPreview';
import { stopRoastNativeStreamPlayer } from '@/services/audio/roastStreamNativePlayer';
import type { RoastReaction } from '@/services/api/roastCall';

export type StreamingAudioResult = {
  supported: boolean;
  reason?: string;
};

export type RemoteStreamPlaybackResult = {
  supported: boolean;
  reason?: string;
  error?: string;
  t0Click: number;
  t1LoadStart: number;
  t2PlayCalled?: number;
  t3FirstPlaybackEvent?: number;
  playerReadyMs?: number;
  firstPlaybackEventMs?: number;
};

const bruhSfxAsset = require('../../../assets/sfx/roast/bruh_01.wav');

let activeSfxPlayer: AudioPlayer | null = null;
let activeStreamPlayer: AudioPlayer | null = null;

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function readStatusNumber(status: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = status[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

export async function stopRoastAudioQueue() {
  try {
    activeSfxPlayer?.pause();
    activeSfxPlayer?.remove();
  } catch {
    // SFX cleanup is best-effort.
  }
  activeSfxPlayer = null;
  try {
    activeStreamPlayer?.pause();
    activeStreamPlayer?.remove();
  } catch {
    // Stream cleanup is best-effort.
  }
  activeStreamPlayer = null;
  await stopRoastNativeStreamPlayer();
  await stopRoastTtsPreview();
}

export async function playRoastReactionSfx(
  reaction: RoastReaction,
): Promise<{ played: boolean; reason?: string; requestedAt: number; completedAt: number }> {
  const requestedAt = globalThis.performance?.now?.() ?? Date.now();
  try {
    const asset = reaction === 'none' ? null : bruhSfxAsset;
    if (!asset) {
      return {
        played: false,
        reason: 'roast_sfx_assets_missing',
        requestedAt,
        completedAt: globalThis.performance?.now?.() ?? Date.now(),
      };
    }

    try {
      activeSfxPlayer?.pause();
      activeSfxPlayer?.remove();
    } catch {
      // ignore previous player cleanup failure
    }

    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'doNotMix',
      shouldPlayInBackground: false,
      allowsRecording: false,
    });
    const player = createAudioPlayer(asset, {
      updateInterval: 250,
      keepAudioSessionActive: false,
    });
    activeSfxPlayer = player;
    player.volume = 0.8;
    player.muted = false;
    player.play();

    return {
      played: true,
      reason: `reaction:${reaction}:bruh_01`,
      requestedAt,
      completedAt: globalThis.performance?.now?.() ?? Date.now(),
    };
  } catch (error) {
    return {
      played: false,
      reason: error instanceof Error ? error.message : 'roast_sfx_play_failed',
      requestedAt,
      completedAt: globalThis.performance?.now?.() ?? Date.now(),
    };
  }
}

export async function playRoastMp3Fallback(audio: ArrayBuffer | Uint8Array) {
  return await playRoastTtsPreview(audio);
}

export async function playRoastTtsStreamIfSupported(_response: Response): Promise<StreamingAudioResult> {
  return {
    supported: false,
    reason: 'expo_audio_does_not_accept_incremental_http_audio_chunks_yet',
  };
}

export async function playRoastRemoteStreamUrl(url: string, t0Click = now()): Promise<RemoteStreamPlaybackResult> {
  const t1LoadStart = now();
  await stopRoastAudioQueue();
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'doNotMix',
      shouldPlayInBackground: false,
      allowsRecording: false,
    });

    const player = createAudioPlayer({ uri: url }, {
      updateInterval: 100,
      keepAudioSessionActive: false,
    });
    activeStreamPlayer = player;
    player.volume = 1;
    player.muted = false;

    return await new Promise<RemoteStreamPlaybackResult>((resolve) => {
      let settled = false;
      let t2PlayCalled: number | undefined;
      let firstStatusLogged = false;
      const subscription = (player as any).addListener?.(
        'playbackStatusUpdate',
        (status: {
          playing?: boolean;
          didJustFinish?: boolean;
          isLoaded?: boolean;
          error?: string;
          currentTime?: number;
          duration?: number;
          currentPosition?: number;
          currentPositionMillis?: number;
          durationMillis?: number;
        }) => {
          const statusRecord = status as Record<string, unknown>;
          const currentTime = readStatusNumber(statusRecord, ['currentTime', 'currentPosition', 'currentPositionMillis']);
          const duration = readStatusNumber(statusRecord, ['duration', 'durationMillis']);
          if (!firstStatusLogged || status.playing || status.error) {
            firstStatusLogged = true;
            console.log('[ROAST_STREAM_PLAYER] status', JSON.stringify({
              isLoaded: status.isLoaded ?? null,
              playing: status.playing ?? null,
              didJustFinish: status.didJustFinish ?? false,
              currentTime,
              duration,
              error: status.error ?? null,
            }));
          }
          if (settled) return;
          if (typeof status.error === 'string' && status.error) {
            settled = true;
            subscription?.remove?.();
            resolve({
              supported: false,
              reason: 'expo_audio_stream_status_error',
              error: status.error,
              t0Click,
              t1LoadStart,
              t2PlayCalled,
            });
            return;
          }
          if (status.playing || (typeof currentTime === 'number' && currentTime > 0)) {
            const t3FirstPlaybackEvent = now();
            settled = true;
            subscription?.remove?.();
            resolve({
              supported: true,
              reason: 'expo_audio_remote_stream_playing',
              t0Click,
              t1LoadStart,
              t2PlayCalled,
              t3FirstPlaybackEvent,
              playerReadyMs: Math.round(t3FirstPlaybackEvent - t1LoadStart),
              firstPlaybackEventMs: Math.round(t3FirstPlaybackEvent - t0Click),
            });
          }
        },
      );

      try {
        player.play();
        t2PlayCalled = now();
        console.log('[ROAST_STREAM_PLAYER] play_call_done', JSON.stringify({
          clickToPlayCallMs: Math.round(t2PlayCalled - t0Click),
          loadStartToPlayCallMs: Math.round(t2PlayCalled - t1LoadStart),
        }));
      } catch (error) {
        settled = true;
        subscription?.remove?.();
        resolve({
          supported: false,
          reason: 'expo_audio_stream_play_call_failed',
          error: error instanceof Error ? error.message : 'play_call_failed',
          t0Click,
          t1LoadStart,
          t2PlayCalled: now(),
        });
        return;
      }

      setTimeout(() => {
        if (settled) return;
        settled = true;
        subscription?.remove?.();
        resolve({
          supported: false,
          reason: 'expo_audio_stream_timeout_no_playing_event',
          t0Click,
          t1LoadStart,
          t2PlayCalled,
        });
      }, 6000);
    });
  } catch (error) {
    return {
      supported: false,
      reason: 'expo_audio_remote_stream_setup_failed',
      error: error instanceof Error ? error.message : 'stream_setup_failed',
      t0Click,
      t1LoadStart,
    };
  }
}
