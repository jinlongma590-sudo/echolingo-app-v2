#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/debug-ise-audio-from-wav.js /path/to/recording.wav');
  process.exit(1);
}

const bytes = fs.readFileSync(inputPath);

function readString(offset, length) {
  return bytes.subarray(offset, offset + length).toString('ascii');
}

function readUInt16LE(offset) {
  return bytes.readUInt16LE(offset);
}

function readUInt32LE(offset) {
  return bytes.readUInt32LE(offset);
}

function parseWav() {
  if (readString(0, 4) !== 'RIFF' || readString(8, 4) !== 'WAVE') {
    throw new Error('input_is_not_wav');
  }

  let offset = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= bytes.length) {
    const id = readString(offset, 4);
    const size = readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;
    if (id === 'fmt ') {
      fmt = {
        audioFormat: bytes.readUInt16LE(chunkDataOffset),
        channels: bytes.readUInt16LE(chunkDataOffset + 2),
        sampleRate: bytes.readUInt32LE(chunkDataOffset + 4),
        byteRate: bytes.readUInt32LE(chunkDataOffset + 8),
        blockAlign: bytes.readUInt16LE(chunkDataOffset + 12),
        bitsPerSample: bytes.readUInt16LE(chunkDataOffset + 14),
      };
    }
    if (id === 'data') {
      dataOffset = chunkDataOffset;
      dataSize = size;
      break;
    }
    offset = chunkDataOffset + size + (size % 2);
  }

  if (!fmt || dataOffset < 0) {
    throw new Error('missing_wav_fmt_or_data');
  }
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16 || fmt.channels !== 1) {
    throw new Error(`unsupported_wav_format_${JSON.stringify(fmt)}`);
  }
  return {
    fmt,
    pcm: bytes.subarray(dataOffset, dataOffset + dataSize),
  };
}

function summarizePcm16(buffer) {
  const sampleCount = Math.floor(buffer.length / 2);
  if (sampleCount <= 0) return { samples: 0, rms: 0, peak: 0, zeroRatio: 1 };
  let sumSquares = 0;
  let peak = 0;
  let zeroLikeCount = 0;
  for (let offset = 0; offset + 1 < buffer.length; offset += 2) {
    const sample = buffer.readInt16LE(offset);
    const abs = Math.abs(sample);
    peak = Math.max(peak, abs);
    sumSquares += sample * sample;
    if (abs <= 1) zeroLikeCount += 1;
  }
  return {
    samples: sampleCount,
    rms: Math.round(Math.sqrt(sumSquares / sampleCount) * 100) / 100,
    peak,
    zeroRatio: Math.round((zeroLikeCount / sampleCount) * 10000) / 10000,
  };
}

function resamplePcm16(buffer, sourceSampleRate, targetSampleRate) {
  if (sourceSampleRate === targetSampleRate) return Buffer.from(buffer);
  const inputSamples = new Int16Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.length / 2));
  const ratio = sourceSampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.round(inputSamples.length / ratio));
  const output = Buffer.alloc(outputLength * 2);
  let inputOffset = 0;
  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const nextInputOffset = Math.min(inputSamples.length, Math.round((outputIndex + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let inputIndex = inputOffset; inputIndex < nextInputOffset; inputIndex += 1) {
      sum += inputSamples[inputIndex] || 0;
      count += 1;
    }
    const sample = count > 0 ? Math.max(-32768, Math.min(32767, Math.round(sum / count))) : 0;
    output.writeInt16LE(sample, outputIndex * 2);
    inputOffset = nextInputOffset;
  }
  return output;
}

function normalizePcm16ForIse(buffer) {
  const before = summarizePcm16(buffer);
  if (before.samples <= 0 || before.peak <= 0 || before.rms <= 0) {
    return { buffer, applied: false, gain: 1, before, after: before, reason: 'empty_or_silent' };
  }
  const gain = Math.max(1, Math.min(160, 1800 / before.rms, 12000 / before.peak));
  if (gain <= 1.05) {
    return { buffer, applied: false, gain, before, after: before, reason: 'already_loud_enough' };
  }
  const output = Buffer.alloc(buffer.length);
  for (let offset = 0; offset + 1 < buffer.length; offset += 2) {
    const sample = buffer.readInt16LE(offset);
    const amplified = Math.max(-32768, Math.min(32767, Math.round(sample * gain)));
    output.writeInt16LE(amplified, offset);
  }
  return {
    buffer: output,
    applied: true,
    gain: Math.round(gain * 1000) / 1000,
    before,
    after: summarizePcm16(output),
    reason: 'low_ise_level',
  };
}

function createWav(buffer, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + buffer.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(buffer.length, 40);
  return Buffer.concat([header, buffer]);
}

const parsed = parseWav();
const pcm16k = resamplePcm16(parsed.pcm, parsed.fmt.sampleRate, 16000);
const normalized = normalizePcm16ForIse(pcm16k);
const outputBase = inputPath.replace(/\.wav$/i, '');
const rawPath = `${outputBase}.ise.raw.pcm`;
const wavPath = `${outputBase}.ise.wav`;
fs.writeFileSync(rawPath, normalized.buffer);
fs.writeFileSync(wavPath, createWav(normalized.buffer, 16000));

console.log(JSON.stringify({
  inputPath,
  input: {
    sampleRate: parsed.fmt.sampleRate,
    channels: parsed.fmt.channels,
    bitsPerSample: parsed.fmt.bitsPerSample,
    dataBytes: parsed.pcm.length,
    signal: summarizePcm16(parsed.pcm),
  },
  ise: {
    payloadKind: 'raw_pcm16_16k',
    rawPath,
    wavPath,
    pcmBytes: normalized.buffer.length,
    durationMs: Math.round((normalized.buffer.length / 2 / 16000) * 1000),
    normalization: normalized,
  },
}, null, 2));
