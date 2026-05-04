import type { XfyunTranscriptResult } from '@/types/xfyunSpeakingAssessment';

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

type LooseRecord = Record<string, unknown>;

function asRecord(value: unknown): LooseRecord | null {
  return value && typeof value === 'object' ? (value as LooseRecord) : null;
}

export function normalizeXfyunRtasrResult(input: unknown): XfyunTranscriptResult | null {
  const root = asRecord(input);
  if (!root) return null;

  const transcript = asRecord(root.transcript);
  const timing = asRecord(root.timing);
  const now = Date.now();
  const firstTranscriptMs = readNumber(timing?.firstTranscriptMs) ?? 0;
  const finalTranscriptMs = readNumber(timing?.finalTranscriptMs) ?? firstTranscriptMs;
  const text =
    readString(transcript?.finalText) ||
    readString(root.finalText) ||
    readString(asRecord(root.data)?.finalText) ||
    readString(asRecord(root.result)?.finalText);

  if (!text) {
    return null;
  }

  return {
    provider: 'xfyun',
    engine: 'rtasr',
    text,
    isFinal: true,
    startedAt: now - finalTranscriptMs,
    endedAt: now,
    latencyMs: finalTranscriptMs,
  };
}
