import type {
  XfyunPhoneAssessment,
  XfyunPronunciationAssessment,
  XfyunSyllableAssessment,
  XfyunWordAssessment,
} from '@/types/xfyunSpeakingAssessment';

type LooseRecord = Record<string, unknown>;

function asRecord(value: unknown): LooseRecord | null {
  return value && typeof value === 'object' ? (value as LooseRecord) : null;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripXmlTags(value: string) {
  return value.replace(/<[^>]+>/g, ' ');
}

function isPauseToken(value: string) {
  const normalized = value.trim().toLowerCase();
  return ['sil', '<sil>', 'silence', 'sp', 'spn', 'unknown'].includes(normalized);
}

function normalizeDisplayWord(value: unknown) {
  const decoded = decodeHtmlEntities(stripXmlTags(readString(value))).replace(/\s+/g, ' ').trim();
  return decoded;
}

function normalizePhone(input: unknown): XfyunPhoneAssessment {
  const record = asRecord(input);
  return {
    content: normalizeDisplayWord(record?.content) || '--',
    score: readNumber(record?.score) ?? readNumber(record?.totalScore),
    errorType: readString(record?.errorType) || readString(record?.dpMessage) || null,
  };
}

function normalizeSyllable(input: unknown): XfyunSyllableAssessment {
  const record = asRecord(input);
  return {
    content: normalizeDisplayWord(record?.content) || '--',
    score: readNumber(record?.score) ?? readNumber(record?.totalScore),
    errorType: readString(record?.errorType) || readString(record?.serrMsg) || null,
    phones: asArray(record?.phones).map(normalizePhone),
  };
}

function normalizeWord(input: unknown): XfyunWordAssessment {
  const record = asRecord(input);
  const syllables = asArray(record?.syllables).map(normalizeSyllable);
  const normalizedWord = normalizeDisplayWord(record?.word) || normalizeDisplayWord(record?.content);
  return {
    word: normalizedWord || '--',
    score: readNumber(record?.score) ?? readNumber(record?.totalScore),
    accuracyScore: readNumber(record?.accuracyScore),
    errorType: readString(record?.errorType) || readString(record?.werrMsg) || readString(record?.dpMessage) || null,
    beginMs: readNumber(record?.beginMs) ?? readNumber(record?.begPos),
    endMs: readNumber(record?.endMs) ?? readNumber(record?.endPos),
    syllables,
  };
}

export function normalizeXfyunIseResult(input: unknown): XfyunPronunciationAssessment | null {
  const root = asRecord(input);
  if (!root) return null;

  const normalizedScores = asRecord(root.scores);
  const legacyScores = asRecord(root.score);
  const words = asArray(root.words).map(normalizeWord);
  const transcriptText =
    normalizeDisplayWord(root.transcriptText) ||
    normalizeDisplayWord(root.referenceText) ||
    words
      .map((item) => item.word)
      .filter((item) => item !== '--' && !isPauseToken(item))
      .join(' ')
      .trim();

  if (!transcriptText && words.length === 0) {
    return null;
  }

  return {
    provider: 'xfyun',
    engine: 'ise',
    transcriptText: transcriptText || '已识别语音',
    overallScore: readNumber(normalizedScores?.overall) ?? readNumber(legacyScores?.totalScore),
    accuracyScore: readNumber(normalizedScores?.accuracy) ?? readNumber(legacyScores?.accuracyScore),
    fluencyScore: readNumber(normalizedScores?.fluency) ?? readNumber(legacyScores?.fluencyScore),
    integrityScore: readNumber(normalizedScores?.integrity) ?? readNumber(legacyScores?.integrityScore),
    standardScore: readNumber(normalizedScores?.standard) ?? readNumber(legacyScores?.standardScore),
    wordsPerMinute: readNumber(root.wordsPerMinute) ?? readNumber(asRecord(root.meta)?.speakingSpeed),
    words,
  };
}
