import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';

let activePlayer: AudioPlayer | null = null;
let activeFileUri: string | null = null;

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

function toBytes(audio: ArrayBuffer | Uint8Array) {
  return audio instanceof Uint8Array ? audio : new Uint8Array(audio);
}

async function writePreviewToCache(audio: ArrayBuffer | Uint8Array) {
  const base = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!base) {
    throw new Error('当前环境没有可写入的缓存目录，无法保存试听音频。');
  }

  const targetUri = `${base}roast-tts-preview-${Date.now()}.mp3`;
  await FileSystem.writeAsStringAsync(targetUri, encodeBase64(toBytes(audio)), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return targetUri;
}

export async function stopRoastTtsPreview() {
  const previousPlayer = activePlayer;
  const previousFileUri = activeFileUri;
  activePlayer = null;
  activeFileUri = null;

  try {
    previousPlayer?.pause();
    previousPlayer?.remove();
  } catch {
    // Preview playback is best-effort.
  }

  if (previousFileUri) {
    await FileSystem.deleteAsync(previousFileUri, { idempotent: true }).catch(() => undefined);
  }
}

export async function playRoastTtsPreview(audio: ArrayBuffer | Uint8Array) {
  try {
    await stopRoastTtsPreview();
    const uri = await writePreviewToCache(audio);

    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'doNotMix',
      shouldPlayInBackground: false,
      allowsRecording: false,
    });

    const player = createAudioPlayer({ uri }, {
      updateInterval: 250,
      keepAudioSessionActive: false,
    });
    activePlayer = player;
    activeFileUri = uri;
    player.volume = 1;
    player.muted = false;
    player.play();

    return { uri };
  } catch (error) {
    await stopRoastTtsPreview().catch(() => undefined);
    const message = error instanceof Error ? error.message : 'Roast TTS 试听播放失败。';
    throw new Error(message || 'Roast TTS 试听播放失败。');
  }
}
