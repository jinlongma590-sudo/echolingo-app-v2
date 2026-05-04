import { normalizeXfyunIseResult } from '@/services/speaking/normalizeXfyunIseResult';
import { normalizeXfyunRtasrResult } from '@/services/speaking/normalizeXfyunRtasrResult';
import type {
  SpeakingRoundAnalysis,
  XfyunPronunciationAssessment,
  XfyunTranscriptResult,
} from '@/types/xfyunSpeakingAssessment';

const DEFAULT_TRANSCRIPT_TEXT = 'I want a latte, please.';

const XFYUN_PROBE_RTASR_RAW_RESULT = {
  provider: 'xfyun',
  service: 'rtasr_standard',
  timing: {
    firstTranscriptMs: 320,
    finalTranscriptMs: 820,
  },
  transcript: {
    finalText: DEFAULT_TRANSCRIPT_TEXT,
  },
};

const XFYUN_PROBE_ISE_RAW_RESULT = {
  provider: 'xfyun',
  engine: 'ise_streaming',
  transcriptText: DEFAULT_TRANSCRIPT_TEXT,
  scores: {
    overall: 74,
    accuracy: 78,
    fluency: 72,
    integrity: 100,
    standard: 81,
  },
  wordsPerMinute: 146,
  words: [
    {
      word: 'I',
      score: 88,
      accuracyScore: 88,
      beginMs: 0,
      endMs: 180,
      syllables: [
        {
          content: 'ay',
          score: 88,
          phones: [{ content: 'ay', score: 88, errorType: null }],
        },
      ],
    },
    {
      word: 'want',
      score: 76,
      accuracyScore: 76,
      errorType: 'minor_vowel_shift',
      beginMs: 180,
      endMs: 520,
      syllables: [
        {
          content: 'w aa nt',
          score: 76,
          errorType: 'minor_vowel_shift',
          phones: [
            { content: 'w', score: 84, errorType: null },
            { content: 'aa', score: 70, errorType: 'vowel' },
            { content: 'nt', score: 79, errorType: null },
          ],
        },
      ],
    },
    {
      word: 'a',
      score: 71,
      accuracyScore: 71,
      errorType: 'article_reduced_vowel',
      beginMs: 520,
      endMs: 690,
      syllables: [
        {
          content: 'uh',
          score: 71,
          errorType: 'article_reduced_vowel',
          phones: [{ content: 'uh', score: 71, errorType: 'vowel' }],
        },
      ],
    },
    {
      word: 'latte',
      score: 67,
      accuracyScore: 67,
      errorType: 'stress_needs_work',
      beginMs: 690,
      endMs: 1220,
      syllables: [
        {
          content: 'la',
          score: 69,
          errorType: 'stress_needs_work',
          phones: [
            { content: 'l', score: 79, errorType: null },
            { content: 'ae', score: 64, errorType: 'vowel' },
          ],
        },
        {
          content: 'te',
          score: 66,
          errorType: 'stress_needs_work',
          phones: [
            { content: 't', score: 71, errorType: null },
            { content: 'iy', score: 63, errorType: 'ending' },
          ],
        },
      ],
    },
    {
      word: 'please',
      score: 90,
      accuracyScore: 90,
      beginMs: 1220,
      endMs: 1640,
      syllables: [
        {
          content: 'pl iy z',
          score: 90,
          phones: [
            { content: 'pl', score: 90, errorType: null },
            { content: 'iy', score: 89, errorType: null },
            { content: 'z', score: 92, errorType: null },
          ],
        },
      ],
    },
  ],
};

export const XFYUN_PROBE_SCENARIO = {
  id: 'coffee-order',
  title: 'Coffee Order Probe',
  subtitle: 'Hidden provider adapter / UI mapping validation',
  aiOpening: 'Hi there. Welcome to our cafe. What would you like to order today?',
};

export const XFYUN_PROBE_PARTIAL_TEXT = 'I want...';
export const XFYUN_PROBE_FINAL_TRANSCRIPT =
  normalizeXfyunRtasrResult(XFYUN_PROBE_RTASR_RAW_RESULT) ??
  ({
    provider: 'xfyun',
    engine: 'rtasr',
    text: DEFAULT_TRANSCRIPT_TEXT,
    isFinal: true,
    startedAt: Date.now() - 820,
    endedAt: Date.now(),
    latencyMs: 820,
  } satisfies XfyunTranscriptResult);

export const XFYUN_PROBE_ASSESSMENT =
  normalizeXfyunIseResult(XFYUN_PROBE_ISE_RAW_RESULT) ??
  ({
    provider: 'xfyun',
    engine: 'ise',
    transcriptText: DEFAULT_TRANSCRIPT_TEXT,
    overallScore: 74,
    accuracyScore: 78,
    fluencyScore: 72,
    integrityScore: 100,
    standardScore: 81,
    wordsPerMinute: 146,
    words: [],
  } satisfies XfyunPronunciationAssessment);

export function createMockSpeakingRoundAnalysis({
  roundId,
  transcriptText,
}: {
  roundId: number;
  transcriptText?: string | null;
}): SpeakingRoundAnalysis {
  const normalizedTranscript = transcriptText?.trim() || XFYUN_PROBE_FINAL_TRANSCRIPT.text;

  return {
    roundId,
    source: 'mock',
    transcriptText: normalizedTranscript,
    grammarStatus: 'needsOptimization',
    grammarLabel: '需要优化',
    pronunciationScore: XFYUN_PROBE_ASSESSMENT.overallScore,
    naturalnessScore: 100,
    optimizedSentence: "I'd like a latte, please.",
    explanationZh: '在点单场景里，用 “I’d like ...” 比 “I want ...” 更自然也更礼貌。',
    assessment: {
      ...XFYUN_PROBE_ASSESSMENT,
      transcriptText: normalizedTranscript,
    },
  };
}
