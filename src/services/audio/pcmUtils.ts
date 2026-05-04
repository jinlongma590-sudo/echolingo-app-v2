import * as FileSystem from 'expo-file-system/legacy';

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function decodeBase64(base64: string) {
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  let bufferLength = clean.length * 0.75;
  if (clean.endsWith('==')) bufferLength -= 2;
  else if (clean.endsWith('=')) bufferLength -= 1;
  const bytes = new Uint8Array(bufferLength);

  let byteIndex = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const encoded1 = BASE64_CHARS.indexOf(clean[i] ?? 'A');
    const encoded2 = BASE64_CHARS.indexOf(clean[i + 1] ?? 'A');
    const encoded3 = BASE64_CHARS.indexOf(clean[i + 2] ?? 'A');
    const encoded4 = BASE64_CHARS.indexOf(clean[i + 3] ?? 'A');

    const triple =
      ((encoded1 & 63) << 18) |
      ((encoded2 & 63) << 12) |
      (((encoded3 < 0 ? 0 : encoded3) & 63) << 6) |
      ((encoded4 < 0 ? 0 : encoded4) & 63);

    if (byteIndex < bytes.length) bytes[byteIndex++] = (triple >> 16) & 0xff;
    if (byteIndex < bytes.length) bytes[byteIndex++] = (triple >> 8) & 0xff;
    if (byteIndex < bytes.length) bytes[byteIndex++] = triple & 0xff;
  }

  return bytes;
}

export function encodeBase64(bytes: Uint8Array) {
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const hasB = i + 1 < bytes.length;
    const hasC = i + 2 < bytes.length;
    const b = hasB ? bytes[i + 1] : 0;
    const c = hasC ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;

    output += BASE64_CHARS[(triple >> 18) & 0x3f];
    output += BASE64_CHARS[(triple >> 12) & 0x3f];
    output += hasB ? BASE64_CHARS[(triple >> 6) & 0x3f] : '=';
    output += hasC ? BASE64_CHARS[triple & 0x3f] : '=';
  }
  return output;
}

export function concatUint8Arrays(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

export function resamplePcm16(inputBytes: Uint8Array, sourceSampleRate: number, targetSampleRate: number) {
  if (sourceSampleRate === targetSampleRate) {
    return inputBytes;
  }

  const inputSamples = new Int16Array(inputBytes.buffer, inputBytes.byteOffset, Math.floor(inputBytes.byteLength / 2));
  const sampleRateRatio = sourceSampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.round(inputSamples.length / sampleRateRatio));
  const outputSamples = new Int16Array(outputLength);

  let outputOffset = 0;
  let inputOffset = 0;

  while (outputOffset < outputLength) {
    const nextInputOffset = Math.min(inputSamples.length, Math.round((outputOffset + 1) * sampleRateRatio));
    let sum = 0;
    let count = 0;
    for (let i = inputOffset; i < nextInputOffset; i += 1) {
      sum += inputSamples[i] ?? 0;
      count += 1;
    }
    outputSamples[outputOffset] = count > 0 ? Math.max(-32768, Math.min(32767, Math.round(sum / count))) : 0;
    outputOffset += 1;
    inputOffset = nextInputOffset;
  }

  return new Uint8Array(outputSamples.buffer);
}

export function createWavBytes(inputBytes: Uint8Array, sampleRate: number, channels: number) {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const dataLength = inputBytes.byteLength;
  const blockAlign = channels * 2;
  const byteRate = sampleRate * blockAlign;

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  return concatUint8Arrays([new Uint8Array(header), inputBytes]);
}

export async function writeBase64AudioToCacheFile(base64: string, extension: 'wav' | 'pcm' | 'mp3' = 'wav') {
  const base = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!base) {
    throw new Error('missing_file_cache_directory');
  }
  const targetUri = `${base}pcm-dual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  await FileSystem.writeAsStringAsync(targetUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return targetUri;
}
