import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { NativeModules, Platform } from 'react-native';

import type { StoredSession } from '@/types/auth';
import { ttsSpeakingText } from '@/services/api/speakingPractice';
import { decodeBase64 } from '@/services/audio/pcmUtils';

type PlaybackListener = (event: { type: 'start' | 'end' | 'error'; text: string; message?: string }) => void;
type PlaybackOptions = {
  cleanupFileAfterPlay?: boolean;
  skipAudioModeConfig?: boolean;
  reason?: string;
  debugHooks?: {
    onCreateSoundStart?: () => void;
    onCreateSoundDone?: () => void;
    onPlayAsyncStart?: () => void;
    onPlayAsyncDone?: () => void;
    onPlaybackError?: (error: unknown) => void;
  };
};

function logTtsPlayback(step: string, payload: Record<string, unknown>) {
  console.log(`[tts_playback] ${step} ${JSON.stringify(payload)}`);
}

function normalizePlaybackError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function readStatusNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

type AudioSessionRouteInfo = {
  category?: string | null;
  mode?: string | null;
  isOtherAudioPlaying?: boolean | null;
  outputVolume?: number | null;
  outputs?: Array<{
    portType?: string | null;
    portName?: string | null;
    uid?: string | null;
  }>;
  inputs?: Array<{
    portType?: string | null;
    portName?: string | null;
    uid?: string | null;
  }>;
};

type PcmCaptureRouteModule = {
  getAudioSessionRoute?: () => Promise<AudioSessionRouteInfo>;
  forceSpeakerOutput?: () => Promise<boolean>;
  prepareSpeakerPlayback?: () => Promise<AudioSessionRouteInfo>;
};

async function getIosAudioSessionRoute() {
  if (Platform.OS !== 'ios') {
    return null;
  }
  const module = NativeModules.PcmCaptureModule as PcmCaptureRouteModule | undefined;
  if (!module?.getAudioSessionRoute) {
    logTtsPlayback('ios_audio_route_unsupported', {
      reason: 'pcm_capture_route_method_unavailable',
    });
    return null;
  }
  return await module.getAudioSessionRoute();
}

async function forceIosSpeakerOutput() {
  if (Platform.OS !== 'ios') {
    return false;
  }
  const module = NativeModules.PcmCaptureModule as PcmCaptureRouteModule | undefined;
  if (!module?.forceSpeakerOutput) {
    logTtsPlayback('ios_force_speaker_unsupported', {
      reason: 'pcm_capture_force_speaker_method_unavailable',
    });
    return false;
  }
  const applied = await module.forceSpeakerOutput();
  logTtsPlayback('ios_force_speaker_applied', {
    applied,
  });
  return applied;
}

async function prepareIosSpeakerPlayback() {
  if (Platform.OS !== 'ios') {
    return null;
  }
  const module = NativeModules.PcmCaptureModule as PcmCaptureRouteModule | undefined;
  if (!module?.prepareSpeakerPlayback) {
    logTtsPlayback('ios_prepare_speaker_playback_unsupported', {
      reason: 'pcm_capture_prepare_speaker_playback_method_unavailable',
    });
    return null;
  }
  const route = await module.prepareSpeakerPlayback();
  logTtsPlayback('ios_prepare_speaker_playback_done', {
    route,
  });
  return route;
}

function parseWavHeaderFromBase64(base64: string) {
  const bytes = decodeBase64(base64).slice(0, 44);
  if (bytes.byteLength < 44) {
    return { valid: false, reason: 'wav_header_too_small' };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const readString = (offset: number, length: number) =>
    String.fromCharCode(...bytes.slice(offset, offset + length));
  return {
    valid: readString(0, 4) === 'RIFF' && readString(8, 4) === 'WAVE',
    riff: readString(0, 4),
    wave: readString(8, 4),
    sampleRate: view.getUint32(24, true),
    channels: view.getUint16(22, true),
    bitsPerSample: view.getUint16(34, true),
    dataSize: view.getUint32(40, true),
  };
}

function encodeBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const hasB = i + 1 < bytes.length;
    const hasC = i + 2 < bytes.length;
    const b = hasB ? bytes[i + 1] : 0;
    const c = hasC ? bytes[i + 2] : 0;

    const triple = (a << 16) | (b << 8) | c;
    output += chars[(triple >> 18) & 0x3f];
    output += chars[(triple >> 12) & 0x3f];
    output += hasB ? chars[(triple >> 6) & 0x3f] : '=';
    output += hasC ? chars[triple & 0x3f] : '=';
  }

  return output;
}

function buildCacheUri() {
  const base = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!base) {
    throw new Error('当前环境没有可写入的缓存目录，无法保存 TTS 音频。');
  }
  return `${base}speak-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`;
}

async function writeAudioBufferToFile(arrayBuffer: ArrayBuffer) {
  const targetUri = buildCacheUri();
  const bytes = new Uint8Array(arrayBuffer);
  await FileSystem.writeAsStringAsync(targetUri, encodeBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return targetUri;
}

export class SpeakingTtsPlayback {
  private player: AudioPlayer;
  private activeFileUri: string | null = null;
  private cancelPendingPlayback: ((message?: string) => void) | null = null;

  constructor() {
    this.player = this.createPlayer();
  }

  private createPlayer() {
    return createAudioPlayer(null, {
      updateInterval: 100,
      keepAudioSessionActive: false,
    });
  }

  private recreatePlayer() {
    try {
      this.player.remove();
    } catch {
      // ignore
    }
    this.player = this.createPlayer();
  }

  async synthesize(session: StoredSession, text: string, voice?: string) {
    const audioBuffer = await ttsSpeakingText(session, { text, voice });
    return writeAudioBufferToFile(audioBuffer);
  }

  async playUri(
    uri: string,
    text: string,
    onEvent?: PlaybackListener,
    options?: PlaybackOptions,
  ): Promise<'played' | 'failed' | 'cancelled'> {
    const reason = options?.reason ?? 'unknown';
    let finished = false;
    let started = false;
    let probeTimer: ReturnType<typeof setInterval> | null = null;
    let totalTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

    try {
      this.stop('playback_replaced');
      this.activeFileUri = uri;
      const playbackFileUri = uri;
      const shouldCleanupFile = options?.cleanupFileAfterPlay !== false;

      logTtsPlayback('file_info_start', {
        reason,
        uri,
      });
      const fileInfo = (await FileSystem.getInfoAsync(uri)) as {
        exists?: boolean;
        size?: number | null;
        isDirectory?: boolean;
      };
      logTtsPlayback('file_info_done', {
        reason,
        uri,
        exists: fileInfo.exists ?? false,
        size: fileInfo.size ?? null,
        isDirectory: fileInfo.isDirectory ?? false,
      });
      if (!fileInfo.exists || (typeof fileInfo.size === 'number' && fileInfo.size <= 0)) {
        logTtsPlayback('file_invalid', {
          reason,
          uri,
          exists: fileInfo.exists ?? false,
          size: fileInfo.size ?? null,
          isDirectory: fileInfo.isDirectory ?? false,
        });
        throw new Error(
          `tts_file_invalid: reason=${reason} uri=${uri} exists=${String(fileInfo.exists ?? false)} size=${String(fileInfo.size ?? null)}`,
        );
      }

      try {
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        logTtsPlayback('assistant_audio_wav_header', {
          reason,
          uri,
          header: parseWavHeaderFromBase64(base64),
        });
      } catch (error) {
        logTtsPlayback('assistant_audio_wav_header_error', {
          reason,
          uri,
          errorMessage: normalizePlaybackError(error, 'wav_header_read_failed'),
        });
      }

      if (!options?.skipAudioModeConfig) {
        logTtsPlayback('audio_mode_config_start', {
          reason,
          uri,
        });
        try {
          // 必须用 allowsRecording:true（PlayAndRecord 类别），与 PcmCaptureModule 的
          // overrideOutputAudioPort 扬声器路由兼容。
          // 若用 allowsRecording:false（Playback 类别），iOS 在两种类别之间切换时会
          // 中断播放（playing:true 后立刻变 false），且 overrideOutputAudioPort 也只
          // 在 PlayAndRecord 下有效（否则 forceSpeakerOutput 报 OSStatus -50）。
          await setAudioModeAsync({
            playsInSilentMode: true,
            interruptionMode: 'doNotMix',
            shouldPlayInBackground: false,
            allowsRecording: true,
            shouldRouteThroughEarpiece: false,
          });
          logTtsPlayback('audio_mode_config_done', {
            reason,
          });
        } catch (error) {
          logTtsPlayback('audio_mode_config_error', {
            reason,
            errorMessage: normalizePlaybackError(error, 'audio_mode_config_failed'),
          });
          throw error;
        }
      }

      try {
        const routeBeforePrepare = await getIosAudioSessionRoute();
        if (routeBeforePrepare) {
          logTtsPlayback('ios_audio_route_before_speaker_prepare', {
            reason,
            route: routeBeforePrepare,
          });
        }
      } catch (error) {
        logTtsPlayback('ios_audio_route_before_speaker_prepare_error', {
          reason,
          errorMessage: normalizePlaybackError(error, 'ios_audio_route_before_speaker_prepare_failed'),
        });
      }

      try {
        await prepareIosSpeakerPlayback();
      } catch (error) {
        logTtsPlayback('ios_prepare_speaker_playback_error', {
          reason,
          errorMessage: normalizePlaybackError(error, 'ios_prepare_speaker_playback_failed'),
        });
      }

      try {
        const routeBefore = await getIosAudioSessionRoute();
        if (routeBefore) {
          logTtsPlayback('ios_audio_route_before', {
            reason,
            route: routeBefore,
          });
        }
      } catch (error) {
        logTtsPlayback('ios_audio_route_before_error', {
          reason,
          errorMessage: normalizePlaybackError(error, 'ios_audio_route_before_failed'),
        });
      }

      try {
        await forceIosSpeakerOutput();
      } catch (error) {
        logTtsPlayback('ios_force_speaker_error', {
          reason,
          errorMessage: normalizePlaybackError(error, 'ios_force_speaker_failed'),
        });
      }

      return await new Promise<'played' | 'failed' | 'cancelled'>((resolve) => {
        let statusSubscription: { remove?: () => void } | undefined;
        let hasLoggedFirstStatus = false;
        let hasLoggedProgressStarted = false;
        let lastPlaying: boolean | null = null;
        let playInterruptRetryCount = 0;
        const MAX_INTERRUPT_RETRIES = 3;
        const cleanup = async (result: 'played' | 'failed' | 'cancelled', message?: string) => {
          if (finished) return;
          finished = true;
          if (probeTimer) {
            clearInterval(probeTimer);
            probeTimer = null;
          }
          if (totalTimeoutHandle) {
            clearTimeout(totalTimeoutHandle);
            totalTimeoutHandle = null;
          }
          if (this.cancelPendingPlayback) {
            this.cancelPendingPlayback = null;
          }
          statusSubscription?.remove?.();
          onEvent?.({
            type: result === 'played' ? 'end' : 'error',
            text,
            message,
          });

          if (shouldCleanupFile) {
            const currentFile = playbackFileUri;
            if (this.activeFileUri === playbackFileUri) {
              this.activeFileUri = null;
            }
            try {
              await FileSystem.deleteAsync(currentFile, { idempotent: true });
            } catch {
              // ignore cleanup failures
            }
          } else if (this.activeFileUri === playbackFileUri) {
            this.activeFileUri = null;
          }

          resolve(result);
        };

        this.cancelPendingPlayback = (message) => {
          void cleanup('cancelled', message ?? 'playback_cancelled');
        };

        try {
          options?.debugHooks?.onCreateSoundStart?.();
          logTtsPlayback('create_player_start', {
            reason,
            uri,
          });
          this.recreatePlayer();
          logTtsPlayback('create_player_done', {
            reason,
            uri,
          });
          options?.debugHooks?.onCreateSoundDone?.();
          try {
            this.player.volume = 1;
            this.player.muted = false;
            logTtsPlayback('player_output_config', {
              reason,
              volume: this.player.volume,
              muted: this.player.muted,
            });
          } catch {
            logTtsPlayback('player_output_config_unsupported', {
              reason,
            });
          }
          let hasRetiredPlayOnLoaded = false;
          statusSubscription = (this.player as any).addListener?.(
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
              if (finished) return;

              const statusRecord = status as Record<string, unknown>;
              const playing = typeof status.playing === 'boolean' ? status.playing : null;
              const shouldLogStatus =
                !hasLoggedFirstStatus ||
                (playing !== null && playing !== lastPlaying) ||
                status.didJustFinish === true ||
                status.isLoaded === false ||
                typeof status.error === 'string';

              if (shouldLogStatus) {
                hasLoggedFirstStatus = true;
                lastPlaying = playing;
                logTtsPlayback('status_update', {
                  reason,
                  isLoaded: status.isLoaded ?? null,
                  playing,
                  didJustFinish: status.didJustFinish ?? false,
                  duration: readStatusNumber(statusRecord, ['duration', 'durationMillis']),
                  currentTime: readStatusNumber(statusRecord, ['currentTime', 'currentPosition', 'currentPositionMillis']),
                  error: typeof status.error === 'string' ? status.error : null,
                });
              }

              const progressCurrentTime = readStatusNumber(statusRecord, ['currentTime', 'currentPosition', 'currentPositionMillis']);
              const progressDuration = readStatusNumber(statusRecord, ['duration', 'durationMillis']);

              // 修复1：expo-audio replace() 异步加载，play() 在 isLoaded=false 时被静默忽略。
              // isLoaded 变为 true 且还没开始播放时，重新触发 play()。
              if (status.isLoaded && !status.playing && !started && !finished && !hasRetiredPlayOnLoaded) {
                hasRetiredPlayOnLoaded = true;
                try {
                  logTtsPlayback('play_retry_on_loaded', { reason });
                  this.player.play();
                } catch (retryError) {
                  logTtsPlayback('play_retry_on_loaded_error', {
                    reason,
                    errorMessage: normalizePlaybackError(retryError, 'play_retry_failed'),
                  });
                }
              }

              // 修复2：playing:true 后立刻变 false（AVAudioSession 中断，currentTime=0）。
              // 这种情况下 didJustFinish 不会触发，Promise 会永久挂起。
              // 检测到中断后最多重试 MAX_INTERRUPT_RETRIES 次，超过后强制结束。
              if (
                status.isLoaded &&
                !status.playing &&
                !status.didJustFinish &&
                started &&
                !finished &&
                (progressCurrentTime === 0 || progressCurrentTime == null)
              ) {
                if (playInterruptRetryCount < MAX_INTERRUPT_RETRIES) {
                  playInterruptRetryCount += 1;
                  logTtsPlayback('play_retry_after_interrupt', {
                    reason,
                    retryCount: playInterruptRetryCount,
                    maxRetries: MAX_INTERRUPT_RETRIES,
                  });
                  try {
                    this.player.play();
                  } catch (retryError) {
                    logTtsPlayback('play_retry_after_interrupt_error', {
                      reason,
                      retryCount: playInterruptRetryCount,
                      errorMessage: normalizePlaybackError(retryError, 'play_retry_failed'),
                    });
                  }
                } else {
                  logTtsPlayback('play_interrupt_give_up', {
                    reason,
                    retryCount: playInterruptRetryCount,
                  });
                  void cleanup('failed', 'play_interrupted_no_recovery');
                }
              }

              if (!hasLoggedProgressStarted && typeof progressCurrentTime === 'number' && progressCurrentTime > 0) {
                hasLoggedProgressStarted = true;
                logTtsPlayback('status_progress_started', {
                  reason,
                  duration: progressDuration,
                  currentTime: progressCurrentTime,
                  playing,
                });
              }

              if (status.playing && !started) {
                started = true;
                onEvent?.({ type: 'start', text });
              }
              if (status.didJustFinish) {
                logTtsPlayback('status_finished', {
                  reason,
                  duration: progressDuration,
                  currentTime: progressCurrentTime,
                  didJustFinish: true,
                });
                void cleanup('played');
              }
            },
          );
          this.player.replace({ uri });
          logTtsPlayback('play_status_before', {
            reason,
            uri,
            isLoaded: this.player.isLoaded ?? null,
            playing: this.player.playing ?? null,
            duration: typeof this.player.duration === 'number' ? this.player.duration : null,
            currentTime: typeof this.player.currentTime === 'number' ? this.player.currentTime : null,
          });
          options?.debugHooks?.onPlayAsyncStart?.();
          logTtsPlayback('play_call_start', {
            reason,
            uri,
          });
          this.player.play();
          logTtsPlayback('play_call_done', {
            reason,
            uri,
          });
          logTtsPlayback('play_status_after', {
            reason,
            uri,
            isLoaded: this.player.isLoaded ?? null,
            playing: this.player.playing ?? null,
            duration: typeof this.player.duration === 'number' ? this.player.duration : null,
            currentTime: typeof this.player.currentTime === 'number' ? this.player.currentTime : null,
          });
          // 总超时保底：防止任何边界情况导致 Promise 永久挂起
          totalTimeoutHandle = setTimeout(() => {
            logTtsPlayback('play_total_timeout', {
              reason,
              started,
              finished,
            });
            void cleanup('failed', 'play_total_timeout');
          }, 20000);

          let probeTick = 0;
          if (probeTimer) {
            clearInterval(probeTimer);
          }
          probeTimer = setInterval(() => {
            if (finished) {
              if (probeTimer) {
                clearInterval(probeTimer);
                probeTimer = null;
              }
              return;
            }
            probeTick += 1;
            logTtsPlayback('playback_probe', {
              reason,
              tick: probeTick,
              isLoaded: this.player.isLoaded ?? null,
              playing: this.player.playing ?? null,
              didJustFinish: false,
              duration: typeof this.player.duration === 'number' ? this.player.duration : null,
              currentTime: typeof this.player.currentTime === 'number' ? this.player.currentTime : null,
              error: null,
            });
            if (probeTick >= 10) {
              if (probeTimer) {
                clearInterval(probeTimer);
                probeTimer = null;
              }
            }
          }, 500);
          void (async () => {
            try {
              const routeAfter = await getIosAudioSessionRoute();
              if (routeAfter) {
                logTtsPlayback('ios_audio_route_after', {
                  reason,
                  route: routeAfter,
                });
              }
            } catch (error) {
              logTtsPlayback('ios_audio_route_after_error', {
                reason,
                errorMessage: normalizePlaybackError(error, 'ios_audio_route_after_failed'),
              });
            }
          })();
          options?.debugHooks?.onPlayAsyncDone?.();
        } catch (error) {
          options?.debugHooks?.onPlaybackError?.(error);
          logTtsPlayback('play_failed', {
            reason,
            uri,
            errorMessage: normalizePlaybackError(error, 'TTS 音频播放失败'),
          });
          void cleanup('failed', normalizePlaybackError(error, 'TTS 音频播放失败'));
        }
      });
    } catch (error) {
      logTtsPlayback('play_failed', {
        reason,
        uri,
        errorMessage: normalizePlaybackError(error, 'TTS 音频播放失败'),
      });
      throw error;
    }
  }

  stop(message = 'playback_cancelled') {
    this.cancelPendingPlayback?.(message);
    this.cancelPendingPlayback = null;
    try {
      this.player.pause();
      this.player.seekTo(0).catch(() => undefined);
    } catch {
      // ignore
    }
  }

  remove() {
    this.stop('playback_removed');
    try {
      this.player.remove();
    } catch {
      // ignore
    }
  }
}
