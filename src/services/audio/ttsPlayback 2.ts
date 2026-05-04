import { createVideoPlayer, type VideoPlayer } from 'expo-video';
import * as FileSystem from 'expo-file-system/legacy';

import type { StoredSession } from '@/types/auth';
import { ttsSpeakingText } from '@/services/api/speakingPractice';

type PlaybackListener = (event: { type: 'start' | 'end' | 'error'; text: string; message?: string }) => void;

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
  private player: VideoPlayer;
  private activeFileUri: string | null = null;

  constructor() {
    this.player = createVideoPlayer(null);
    this.player.audioMixingMode = 'doNotMix';
    this.player.muted = false;
    this.player.volume = 1;
  }

  async synthesize(session: StoredSession, text: string, voice?: string) {
    const audioBuffer = await ttsSpeakingText(session, { text, voice });
    return writeAudioBufferToFile(audioBuffer);
  }

  async playUri(uri: string, text: string, onEvent?: PlaybackListener): Promise<'played' | 'failed' | 'cancelled'> {
    let finished = false;
    let didEnd = false;
    let didError = false;

    this.stop();
    this.activeFileUri = uri;

    return await new Promise<'played' | 'failed' | 'cancelled'>((resolve) => {
      const finalize = async (result: 'played' | 'failed' | 'cancelled', message?: string) => {
        if (finished) return;
        finished = true;
        playingSub?.remove?.();
        endSub?.remove?.();
        statusSub?.remove?.();
        onEvent?.({
          type: result === 'played' ? 'end' : 'error',
          text,
          message,
        });

        if (this.activeFileUri) {
          const cleanupUri = this.activeFileUri;
          this.activeFileUri = null;
          try {
            await FileSystem.deleteAsync(cleanupUri, { idempotent: true });
          } catch {
            // ignore cleanup failures
          }
        }

        resolve(result);
      };

      const endSub = (this.player as any).addListener?.('playToEnd', () => {
        didEnd = true;
        void finalize('played');
      });

      const statusSub = (this.player as any).addListener?.('statusChange', (payload: { error?: { message?: string } }) => {
        if (didEnd || didError) return;
        if (payload?.error) {
          didError = true;
          void finalize('failed', payload.error.message ?? 'TTS 播放失败');
        }
      });

      const playingSub = (this.player as any).addListener?.('playingChange', (payload: { isPlaying?: boolean }) => {
        if (payload?.isPlaying) {
          onEvent?.({ type: 'start', text });
        }
      });

      this.player
        .replaceAsync({ uri })
        .then(() => {
          this.player.play();
        })
        .catch((error: unknown) => {
          void finalize('failed', error instanceof Error ? error.message : 'TTS 音频加载失败');
        });
    });
  }

  stop() {
    try {
      this.player.pause();
      this.player.currentTime = 0;
    } catch {
      // ignore
    }
  }
}
