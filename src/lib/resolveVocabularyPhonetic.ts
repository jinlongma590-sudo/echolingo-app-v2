import { getVocabularyPhoneticFallback } from './vocabularyPhoneticFallback';

type UnknownRecord = Record<string, unknown>;

const INVALID_PHONETIC_VALUES = new Set(['', '-', 'n/a', 'na', 'none', 'null', 'undefined']);
const PHONETIC_LIKE_PATTERN = /^[\/\[\]ˈˌɑæʌəɚɝɪiːʊuːeɛɔoɒɜɞɡŋθðʃʒtʃdʒɹrjwɫbpftdvszmnklhɐɘɨʉøœçxɾ\s.a-zA-Z'-]+$/;
const CHINESE_PATTERN = /[\u3400-\u9fff]/;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
}

function looksLikePhonetic(value: string) {
  if (CHINESE_PATTERN.test(value)) return false;
  if (/\b(the|a|an|to|of|and|that|which|something|someone|core vocabulary meaning)\b/i.test(value)) return false;
  if (value.length > 80) return false;
  return PHONETIC_LIKE_PATTERN.test(value);
}

export function normalizePhonetic(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = decodeHtmlEntities(String(value))
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
  if (INVALID_PHONETIC_VALUES.has(raw.toLowerCase())) return null;
  if (!looksLikePhonetic(raw)) return null;
  if ((raw.startsWith('/') && raw.endsWith('/')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    return raw;
  }
  return `/${raw.replace(/^[/\[]+|[/\]]+$/g, '').trim()}/`;
}

function readPath(root: unknown, path: Array<string | number>) {
  let cursor = root;
  for (const key of path) {
    if (typeof key === 'number') {
      if (!Array.isArray(cursor)) return undefined;
      cursor = cursor[key];
      continue;
    }
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

type PhoneticCandidate = {
  value: string;
  source: string;
};

function pushCandidate(candidates: PhoneticCandidate[], value: unknown, source: string) {
  const normalized = normalizePhonetic(value);
  if (normalized && !candidates.some((candidate) => candidate.value === normalized)) {
    candidates.push({ value: normalized, source });
  }
}

function walkForPhonetics(value: unknown, candidates: PhoneticCandidate[], sourcePrefix: string, depth = 0) {
  if (depth > 3 || value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkForPhonetics(item, candidates, `${sourcePrefix}[${index}]`, depth + 1));
    return;
  }
  if (!isRecord(value)) return;

  for (const key of ['phonetic', 'ipa', 'usPhonetic', 'ukPhonetic', 'us', 'uk', 'text', 'value']) {
    pushCandidate(candidates, value[key], `${sourcePrefix}.${key}`);
  }

  for (const nestedKey of ['phonetics', 'pronunciation', 'dictionary', 'metadata', 'raw', 'extra', 'payload']) {
    walkForPhonetics(value[nestedKey], candidates, `${sourcePrefix}.${nestedKey}`, depth + 1);
  }
}

function extractVocabularyPhoneticCandidateDetails(word: unknown): PhoneticCandidate[] {
  const candidates: PhoneticCandidate[] = [];
  const priorityPaths: Array<{ path: Array<string | number>; source: string }> = [
    { path: ['ipa'], source: 'api.ipa' },
    { path: ['phonetic'], source: 'api.phonetic' },
    { path: ['usPhonetic'], source: 'api.usPhonetic' },
    { path: ['ukPhonetic'], source: 'api.ukPhonetic' },
    { path: ['phonetics', 0, 'text'], source: 'api.phonetics[0].text' },
    { path: ['pronunciation', 'ipa'], source: 'api.pronunciation.ipa' },
    { path: ['pronunciation', 'us'], source: 'api.pronunciation.us' },
    { path: ['pronunciation', 'uk'], source: 'api.pronunciation.uk' },
    { path: ['pronunciation', 'phonetic'], source: 'api.pronunciation.phonetic' },
    { path: ['dictionary', 'phonetic'], source: 'api.dictionary.phonetic' },
    { path: ['dictionary', 'ipa'], source: 'api.dictionary.ipa' },
    { path: ['metadata', 'phonetic'], source: 'metadata.phonetic' },
    { path: ['metadata', 'ipa'], source: 'metadata.ipa' },
    { path: ['metadata', 'usPhonetic'], source: 'metadata.usPhonetic' },
    { path: ['metadata', 'ukPhonetic'], source: 'metadata.ukPhonetic' },
    { path: ['raw', 'phonetic'], source: 'raw.phonetic' },
    { path: ['raw', 'ipa'], source: 'raw.ipa' },
    { path: ['extra', 'phonetic'], source: 'extra.phonetic' },
    { path: ['extra', 'ipa'], source: 'extra.ipa' },
  ];

  for (const { path, source } of priorityPaths) {
    pushCandidate(candidates, readPath(word, path), source);
  }

  const phonetics = readPath(word, ['phonetics']);
  if (Array.isArray(phonetics)) {
    for (let index = 0; index < phonetics.length; index += 1) {
      const item = phonetics[index];
      if (!isRecord(item)) continue;
      pushCandidate(candidates, item.text, `api.phonetics[${index}].text`);
      pushCandidate(candidates, item.value, `api.phonetics[${index}].value`);
      pushCandidate(candidates, item.ipa, `api.phonetics[${index}].ipa`);
    }
  }

  walkForPhonetics(readPath(word, ['raw']), candidates, 'raw');
  walkForPhonetics(readPath(word, ['extra']), candidates, 'extra');
  walkForPhonetics(readPath(word, ['payload']), candidates, 'payload');
  return candidates;
}

export function extractVocabularyPhoneticCandidates(word: unknown): string[] {
  return extractVocabularyPhoneticCandidateDetails(word).map((candidate) => candidate.value);
}

export function resolveVocabularyPhonetic(word: unknown): string {
  const wordText = isRecord(word) && typeof word.word === 'string' ? word.word : '';
  console.log('vocabulary_phonetic_resolve_start', { word: wordText });

  const candidates = extractVocabularyPhoneticCandidateDetails(word);
  if (candidates[0]) {
    console.log('vocabulary_phonetic_resolve_hit_api_field', {
      word: wordText,
      phonetic: candidates[0].value,
      source: candidates[0].source,
    });
    console.log('vocabulary_phonetic_resolved_source', {
      word: wordText,
      source: candidates[0].source,
    });
    return candidates[0].value;
  }

  const fallback = wordText ? normalizePhonetic(getVocabularyPhoneticFallback(wordText)) : null;
  if (fallback) {
    console.log('vocabulary_phonetic_resolve_hit_fallback', {
      word: wordText,
      phonetic: fallback,
      source: 'fallback.common',
    });
    console.log('vocabulary_phonetic_resolved_source', {
      word: wordText,
      source: 'fallback.common',
    });
    return fallback;
  }

  console.log('vocabulary_phonetic_resolve_missing', { word: wordText });
  return '';
}
